/**
 * Filesystem-backed sutra access. Primary read path; DB is fallback only.
 *
 * Layout:
 *   data/sutras/<slug>.json   — full chunks array (with pinyin)
 *   data/sutras/manifest.json — { version, generatedAt, items: [{ id, slug, title, chunkCount, charCount }] }
 *
 * The manifest is the source of truth for id<->slug mapping and the cheap
 * list endpoint (avoids parsing 855KB JSON files just to compute chunkCount).
 */
import { existsSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SutraChunk, SutraListItem, SutraListResult } from './sutra-types';

const SUTRAS_DIR = join(process.cwd(), 'data', 'sutras');
const MANIFEST_PATH = join(SUTRAS_DIR, 'manifest.json');

export interface SutraManifestEntry {
  id: number;
  slug: string;
  title: string;
  chunkCount: number;
  charCount: number;
}

export interface SutraManifest {
  version: 1;
  generatedAt: string;
  items: SutraManifestEntry[];
}

function safeReadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function sutrasFsAvailable(): boolean {
  return existsSync(MANIFEST_PATH);
}

export function readSutraManifest(): SutraManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  return safeReadJson<SutraManifest>(MANIFEST_PATH);
}

export function readSutraChunksBySlug(slug: string): SutraChunk[] | null {
  const path = join(SUTRAS_DIR, `${slug}.json`);
  if (!existsSync(path)) return null;
  return safeReadJson<SutraChunk[]>(path);
}

export interface ListSutrasFsOpts {
  q?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 12;

export function listSutrasFromFs(opts: ListSutrasFsOpts = {}): SutraListResult | null {
  const manifest = readSutraManifest();
  if (!manifest) return null;
  let items = manifest.items.slice().sort((a, b) => a.id - b.id);
  const q = (opts.q ?? '').trim();
  if (q) items = items.filter((i) => i.title.includes(q));
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(DEFAULT_PAGE_SIZE, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const sliced = items.slice(offset, offset + pageSize);
  return {
    items: sliced.map(
      (i): SutraListItem => ({
        id: i.id,
        title: i.title,
        slug: i.slug,
        chunkCount: i.chunkCount,
        charCount: i.charCount,
      }),
    ),
    total: items.length,
    page,
    pageSize,
  };
}

export interface GetSutraByIdFsResult {
  id: number;
  title: string;
  slug: string;
  chunks: SutraChunk[];
}

export function getSutraByIdFromFs(id: number): GetSutraByIdFsResult | null {
  const manifest = readSutraManifest();
  if (!manifest) return null;
  const entry = manifest.items.find((i) => i.id === id);
  if (!entry) return null;
  const chunks = readSutraChunksBySlug(entry.slug);
  if (!chunks) return null;
  return { id: entry.id, title: entry.title, slug: entry.slug, chunks };
}

export function sutraExistsBySlug(slug: string): boolean {
  return existsSync(join(SUTRAS_DIR, `${slug}.json`));
}

/**
 * Write the FS layer atomically. Called by scripts/build-sutras.ts after the
 * DB upsert completes. Caller passes the full items array (overwrites the
 * manifest) plus a map of slug -> chunks.
 *
 * Returns the manifest written to disk.
 */
export function writeSutrasFs(args: {
  items: SutraManifestEntry[];
  chunksBySlug: Record<string, SutraChunk[]>;
}): SutraManifest {
  if (!existsSync(SUTRAS_DIR)) {
    // mkdirSync recursive — wrap try/catch so we don't pull in fs.mkdirSync
    // dependency for one call.
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(SUTRAS_DIR, { recursive: true });
  }
  for (const [slug, chunks] of Object.entries(args.chunksBySlug)) {
    const path = join(SUTRAS_DIR, `${slug}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(chunks), 'utf8');
    renameSync(tmp, path);
  }
  const manifest: SutraManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    items: args.items.slice().sort((a, b) => a.id - b.id),
  };
  const tmp = `${MANIFEST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmp, MANIFEST_PATH);
  return manifest;
}

/**
 * Stat helper for verification scripts.
 */
export function sutraFsStats(): { exists: boolean; dirSize: number; fileCount: number } {
  if (!existsSync(SUTRAS_DIR)) return { exists: false, dirSize: 0, fileCount: 0 };
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const files = readdirSync(SUTRAS_DIR).filter((f) => f.endsWith('.json'));
  let size = 0;
  for (const f of files) {
    try {
      size += statSync(join(SUTRAS_DIR, f)).size;
    } catch {
      // skip
    }
  }
  return { exists: true, dirSize: size, fileCount: files.length };
}