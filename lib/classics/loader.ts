import path from 'node:path';
// Import from 'fs/promises' (not 'node:fs') intentionally: vitest's mock
// registry does not dedupe these specifiers, so `vi.mock('fs/promises')`
// would not intercept `node:fs/promises` reads in tests. Runtime behavior
// is identical (Node treats both as the same module). Do NOT change back.
import * as fs from 'fs/promises';
import type { ClassicFile, ClassicsManifest } from '../classics-types';

const MANIFEST_PATH = path.join(process.cwd(), 'data', 'classics-manifest.json');
const DATA_DIR = path.join(process.cwd(), 'data', 'classics');

let cache: ClassicsManifest | null = null;

export function invalidateManifestCache(): void { cache = null; }

export async function loadManifest(): Promise<ClassicsManifest> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    cache = JSON.parse(raw) as ClassicsManifest;
    return cache;
  } catch (err) {
    throw new Error(`loadManifest: cannot read ${MANIFEST_PATH}: ${(err as Error).message}`);
  }
}

export async function loadClassicFile(slug: string): Promise<ClassicFile | null> {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as ClassicFile;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw new Error(`loadClassicFile(${slug}): parse error in ${filePath}: ${err.message}`);
  }
}