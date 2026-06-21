import path from 'node:path';
// Import from 'fs/promises' (not 'node:fs') intentionally: vitest's mock
// registry does not dedupe these specifiers, so `vi.mock('fs/promises')`
// would not intercept `node:fs/promises` reads in tests. Runtime behavior
// is identical (Node treats both as the same module). Do NOT change back.
import * as fs from 'fs/promises';
import type { PoemDetail, PoemsManifest } from '../poetry-types';

const MANIFEST_PATH = path.join(process.cwd(), 'data', 'poems-manifest.json');

let cache: PoemsManifest | null = null;

export function invalidateManifestCache(): void { cache = null; }

export async function loadManifest(): Promise<PoemsManifest> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    cache = JSON.parse(raw) as PoemsManifest;
    return cache;
  } catch (err) {
    throw new Error(`loadManifest: cannot read ${MANIFEST_PATH}: ${(err as Error).message}`);
  }
}

export async function loadPoem(id: number): Promise<PoemDetail | null> {
  const filePath = path.join(process.cwd(), 'data', 'poems', `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const p = JSON.parse(raw) as PoemDetail;
    return p;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw new Error(`loadPoem(${id}): parse error in ${filePath}: ${err.message}`);
  }
}
