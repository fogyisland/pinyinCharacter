import path from 'node:path';
import { statSync } from 'node:fs';
import type { ClassicFile, ClassicsManifest } from '../classics-types';
import { readJsonAuto, readJsonAutoCached, invalidateJsonCache } from '../json-fs';

const MANIFEST_PATH = path.join(process.cwd(), 'data', 'classics-manifest.json');
const DATA_DIR = path.join(process.cwd(), 'data', 'classics');

let cache: ClassicsManifest | null = null;

export function invalidateManifestCache(): void {
  cache = null;
  invalidateJsonCache(MANIFEST_PATH);
}

export function invalidateClassicFileCache(slug?: string): void {
  if (!slug) {
    classicCache.clear();
    classicCacheBytes = 0;
    return;
  }
  const entry = classicCache.get(slug);
  if (entry) {
    classicCache.delete(slug);
    classicCacheBytes -= entry.bytes;
  }
  invalidateJsonCache(path.join(DATA_DIR, `${slug}.json`));
}

/**
 * Classic books are huge: a single book can be ~8 MB of JSON and the corpus
 * totals ~250 MB. The shared `readJsonAutoCached` map never evicts, so
 * routing book reads through it would pin every book the site ever served in
 * the heap.
 *
 * Instead we keep a small LRU bounded by the on-disk size of the books it
 * holds (the parsed object is roughly the same size as the file). Books are
 * static files, so a bounded cache is enough to serve repeat views of the
 * same book without unbounded growth.
 */
const MAX_CACHED_CLASSIC_BYTES = 48 * 1024 * 1024;

interface ClassicCacheEntry {
  file: ClassicFile;
  bytes: number;
}

/** Map preserves insertion order → the first key is the least recently used. */
const classicCache = new Map<string, ClassicCacheEntry>();
let classicCacheBytes = 0;

function classicFileBytes(slug: string): number {
  try {
    return statSync(path.join(DATA_DIR, `${slug}.json`)).size;
  } catch {
    // .gz-only deployments (Up/ bundle): the compressed size is a good enough
    // proxy for the heap cost of the parsed object.
    try {
      return statSync(path.join(DATA_DIR, `${slug}.json.gz`)).size;
    } catch {
      return 1024 * 1024;
    }
  }
}

function cacheClassicFile(slug: string, file: ClassicFile, bytes: number): void {
  const existing = classicCache.get(slug);
  if (existing) {
    classicCache.delete(slug);
    classicCacheBytes -= existing.bytes;
  }
  classicCache.set(slug, { file, bytes });
  classicCacheBytes += bytes;
  while (classicCacheBytes > MAX_CACHED_CLASSIC_BYTES && classicCache.size > 1) {
    const oldest = classicCache.keys().next();
    if (oldest.done) break;
    const key = oldest.value;
    const entry = classicCache.get(key);
    if (!entry) break;
    classicCache.delete(key);
    classicCacheBytes -= entry.bytes;
  }
}

export async function loadManifest(): Promise<ClassicsManifest> {
  if (cache) return cache;
  const value = readJsonAutoCached(MANIFEST_PATH);
  if (!value) {
    throw new Error(`loadManifest: cannot read ${MANIFEST_PATH}`);
  }
  cache = value as ClassicsManifest;
  return cache;
}

export async function loadClassicFile(slug: string): Promise<ClassicFile | null> {
  const hit = classicCache.get(slug);
  if (hit) {
    // Refresh the LRU position.
    classicCache.delete(slug);
    classicCache.set(slug, hit);
    return hit.file;
  }
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  const value = readJsonAuto(filePath);
  if (!value) return null;
  const file = value as ClassicFile;
  cacheClassicFile(slug, file, classicFileBytes(slug));
  return file;
}
