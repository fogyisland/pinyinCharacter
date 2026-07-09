/**
 * Mirror data/poems-manifest.json + data/poems/<id>.json into the poems MySQL
 * table. JSON is single source of truth (see lib/poetry/loader.ts); DB is a
 * query-time mirror for tables that want SQL-side joins.
 *
 * Idempotent: re-running yields inserted=manifest.items.length (UNIQUE KEY
 * uniq_poem(dynasty,title,author) handles UPSERT).
 *
 * Previously this script did an HTTP fetch from chinese-poetry/chinese-poetry
 * GitHub. That dependency was removed 2026-07-09 — the JSONs in data/poems/
 * already contain post-processed pinyin + t2s-converted content, so a fresh
 * fetch was redundant and fragile (CDN 503 rate-limits could fail the wizard's
 * init phase on prod).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import type { PoemsManifest, PoemDetail } from '../lib/poetry-types';

const MANIFEST_PATH = join(process.cwd(), 'data', 'poems-manifest.json');
const POEMS_DIR = join(process.cwd(), 'data', 'poems');
const DEFAULT_SOURCE_TAG = 'prebuilt-json:data/poems';

export async function buildPoems(): Promise<number> {
  const pool = getPool();
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`build-poems: missing ${MANIFEST_PATH} — cannot mirror without a manifest`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PoemsManifest;
  let inserted = 0;
  for (const item of manifest.items) {
    const filePath = join(POEMS_DIR, `${item.id}.json`);
    if (!existsSync(filePath)) {
      console.warn(`[build-poems] missing ${filePath}; skipping id=${item.id}`);
      continue;
    }
    const poem = JSON.parse(readFileSync(filePath, 'utf8')) as PoemDetail;
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, form, category, content, pinyin, appreciation, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         form = VALUES(form),
         content = VALUES(content),
         pinyin = VALUES(pinyin),
         appreciation = VALUES(appreciation),
         category = VALUES(category),
         source = VALUES(source)`,
      [
        poem.dynasty,
        poem.title,
        poem.author,
        poem.form,
        poem.category,
        JSON.stringify(poem.content),
        JSON.stringify(poem.pinyin),
        poem.appreciation,
        poem.source ?? DEFAULT_SOURCE_TAG,
      ]
    );
    inserted++;
  }
  return inserted;
}

if (require.main === module) {
  buildPoems()
    .then((n) => {
      console.log(`[build-poems] mirrored ${n} poems`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-poems] failed:', err);
      process.exit(1);
    });
}