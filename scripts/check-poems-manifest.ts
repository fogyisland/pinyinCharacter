import path from 'node:path';
// Import from 'fs/promises' (not 'node:fs') intentionally: vitest's mock
// registry does not dedupe these specifiers, so `vi.mock('fs/promises')`
// would not intercept `node:fs/promises` reads in tests. Runtime behavior
// is identical (Node treats both as the same module). Do NOT change back.
import * as fs from 'fs/promises';
import type { PoemsManifest } from '../lib/poetry-types';

const DATA_DIR = path.join(process.cwd(), 'data', 'poems');
// Manifest lives at data/poems-manifest.json (sibling of data/poems/),
// not inside data/poems/. Matches the path used by lib/poetry/loader.ts.
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'poems-manifest.json');

export async function checkPoemsManifest(): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as PoemsManifest;

  const files = (await fs.readdir(DATA_DIR))
    .filter(f => f.endsWith('.json') && f !== 'poems-manifest.json');

  const fileIds = new Set(files.map(f => Number(f.replace(/\.json$/, ''))));
  const manifestIds = new Set(manifest.items.map(i => i.id));

  for (const id of manifestIds) {
    if (!fileIds.has(id)) issues.push(`file for id ${id} missing`);
  }
  for (const id of fileIds) {
    if (!manifestIds.has(id)) issues.push(`orphan file ${id}.json`);
  }
  if (files.length !== manifest.count) {
    issues.push(`file count ${files.length} != manifest count ${manifest.count}`);
  }

  return { ok: issues.length === 0, issues };
}

if (require.main === module) {
  checkPoemsManifest()
    .then(r => {
      if (r.ok) { console.log('[check-poems-manifest] OK'); process.exit(0); }
      console.error('[check-poems-manifest] FAILED:');
      for (const i of r.issues) console.error('  -', i);
      process.exit(1);
    })
    .catch(err => { console.error('[check-poems-manifest] error:', err); process.exit(1); });
}