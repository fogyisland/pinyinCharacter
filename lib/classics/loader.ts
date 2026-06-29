import path from 'node:path';
import type { ClassicFile, ClassicsManifest } from '../classics-types';
import { readJsonAutoCached, invalidateJsonCache } from '../json-fs';

const MANIFEST_PATH = path.join(process.cwd(), 'data', 'classics-manifest.json');
const DATA_DIR = path.join(process.cwd(), 'data', 'classics');

let cache: ClassicsManifest | null = null;

export function invalidateManifestCache(): void { cache = null; }

export function invalidateClassicFileCache(slug?: string): void {
  if (slug) invalidateJsonCache(path.join(DATA_DIR, `${slug}.json`));
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
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  const value = readJsonAutoCached(filePath);
  return value ? (value as ClassicFile) : null;
}