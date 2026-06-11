/**
 * Maintenance script: download 通用规范汉字表 (8105 chars, jaywcjlove's
 * stable mirror) and write the level-3 subset to data/rare-chars-level3.json
 * for fetch-rare-chars.ts to consume offline.
 *
 * Why self-host: production data load should not depend on a third-party URL
 * at runtime — if jaywcjlove's repo moves or GitHub has a hiccup, our
 * production char DB load shouldn't break. This script runs once (or on
 * demand when upstream updates); the resulting data file is committed to
 * the repo and read locally by fetch-rare-chars.ts.
 *
 * Usage: pnpm tsx scripts/sync-rare-chars-source.ts
 *
 * Level boundaries (per 通用规范汉字表 standard):
 *   - Level 1: indices 0..3499 (3500 chars)
 *   - Level 2: indices 3500..6499 (3000 chars)
 *   - Level 3: indices 6500..8104 (1605 chars) ← what we want
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/jaywcjlove/table-of-general-standard-chinese-characters/main/data/characters.min.json';
const DATA_DIR = join(process.cwd(), 'data');
const FULL_PATH = join(DATA_DIR, 'general-standard-chinese-characters.json');
const LEVEL3_PATH = join(DATA_DIR, 'rare-chars-level3.json');
const LEVEL3_START = 6500;

async function main() {
  console.log(`[sync] downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} -> ${res.status}`);
  const allChars = (await res.json()) as string[];

  if (!Array.isArray(allChars) || allChars.length < 8105) {
    throw new Error(`unexpected data: expected 8105-char array, got ${allChars?.length}`);
  }
  if (allChars[0] !== '一' || allChars[1] !== '乙') {
    throw new Error(`unexpected data: first chars are ${allChars[0]}, ${allChars[1]} (expected 一, 乙)`);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FULL_PATH, JSON.stringify(allChars), 'utf-8');
  console.log(`[sync] wrote ${allChars.length} chars to ${FULL_PATH}`);

  const level3 = allChars.slice(LEVEL3_START);
  writeFileSync(LEVEL3_PATH, JSON.stringify(level3), 'utf-8');
  console.log(`[sync] wrote ${level3.length} level-3 chars to ${LEVEL3_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
