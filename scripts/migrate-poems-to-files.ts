import path from 'node:path';
import fs from 'fs/promises';
import { getPool } from '../lib/db';
import type { PoemManifestItem, PoemsManifest } from '../lib/poetry-types';

const DATA_DIR = path.join(process.cwd(), 'data', 'poems');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'poems-manifest.json');

function parseJson<T>(s: unknown, fallback: T): T {
  if (Array.isArray(s)) return s as T;
  if (typeof s === 'string') {
    try { const v = JSON.parse(s); return Array.isArray(v) ? (v as T) : fallback; } catch { return fallback; }
  }
  return fallback;
}

export async function migratePoemsToFiles(): Promise<{ written: number; skipped: number; manifestWritten: boolean }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, dynasty, category, title, author, form, content, pinyin, appreciation, source
     FROM poems ORDER BY id ASC`
  );
  const arr = rows as any[];

  await fs.mkdir(DATA_DIR, { recursive: true });

  let existing: Set<string> = new Set();
  try { existing = new Set(await fs.readdir(DATA_DIR)); } catch { /* dir may not exist yet */ }

  const manifestItems: PoemManifestItem[] = [];
  let written = 0;
  let skipped = 0;

  for (const r of arr) {
    const id = Number(r.id);
    const content = parseJson<string[]>(r.content, []);
    const pinyin = parseJson<string[][]>(r.pinyin, []);
    const fileName = `${id}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    const body = {
      id, title: r.title, author: r.author, dynasty: r.dynasty,
      category: r.category ?? null, form: r.form ?? null,
      content, pinyin, appreciation: r.appreciation ?? null, source: r.source ?? null,
    };
    if (existing.has(fileName)) {
      let same = false;
      try {
        const cur = JSON.parse(await fs.readFile(filePath, 'utf8'));
        same = JSON.stringify(cur) === JSON.stringify(body);
      } catch { /* treat as different */ }
      if (same) { skipped++; }
      else { await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf8'); written++; }
    } else {
      await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf8');
      written++;
    }
    manifestItems.push({
      id, title: r.title, author: r.author, dynasty: r.dynasty,
      category: r.category ?? null, form: r.form ?? null,
      contentLineCount: content.length,
    });
  }

  const manifest: PoemsManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: manifestItems.length,
    items: manifestItems,
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

  return { written, skipped, manifestWritten: true };
}

if (require.main === module) {
  migratePoemsToFiles()
    .then((r) => { console.log(`[migrate-poems-to-files] written=${r.written} skipped=${r.skipped}`); process.exit(0); })
    .catch((err) => { console.error('[migrate-poems-to-files] failed:', err); process.exit(1); });
}
