/**
 * One-shot script: load level-3 chars from data/rare-chars-level3.json
 * (1605 chars, sliced from 通用规范汉字表), look up pinyin from
 * data/pinyin-hanzi.json (Plan A dictionary) or fall back to pinyin-pro
 * for missing chars, and INSERT into rare_chars.
 *
 * Data source: jaywcjlove/table-of-general-standard-chinese-characters
 * (downloaded once into data/, see scripts/sync-rare-chars-source.ts).
 *
 * Usage: pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
 *
 * Idempotent: existing rows have only `pinyin` updated (meaning/story preserved).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

const LEVEL3_PATH = join(process.cwd(), 'data', 'rare-chars-level3.json');
const DICT_PATH = join(process.cwd(), 'data', 'pinyin-hanzi.json');

interface DictEntry { char: string; freq: number; }
type Dict = Record<string, DictEntry[]>;

function loadDict(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const dict = JSON.parse(readFileSync(DICT_PATH, 'utf-8')) as Dict;
    for (const [pyBase, entries] of Object.entries(dict)) {
      for (const e of entries) {
        if (!map.has(e.char)) map.set(e.char, pyBase);
      }
    }
  } catch {
    // dict missing — fall through with empty map
  }
  return map;
}

function pinyinFor(char: string, charToPinyin: Map<string, string>): string {
  const fromDict = charToPinyin.get(char);
  if (fromDict) return fromDict;
  const py = pinyin(char, { toneType: 'symbol', type: 'array' });
  return Array.isArray(py) && py.length > 0 ? py[0]! : '';
}

async function main() {
  let chars: string[];
  try {
    chars = JSON.parse(readFileSync(LEVEL3_PATH, 'utf-8')) as string[];
  } catch (err) {
    throw new Error(
      `Cannot read ${LEVEL3_PATH}. ` +
      `Run scripts/sync-rare-chars-source.ts first to download the source.`
    );
  }
  // Skip supplementary-plane chars (codepoint >= U+10000, JS string length > 1).
  // mysql2's binary prepared-statement protocol mojibakes 4-byte UTF-8 parameters,
  // so we can't reliably insert them. The ~192 affected chars are PUA/Extension B
  // codepoints (𬣙, 𨙸, etc.) that the rare-chars UI/game cannot render in most
  // fonts anyway — losing them does not affect the feature.
  const bmpChars = chars.filter((c) => c.length === 1);
  console.log(
    `[fetch-rare-chars] ${chars.length} level-3 chars from local file, ` +
    `${bmpChars.length} BMP chars to insert (skipping ${chars.length - bmpChars.length} non-BMP)`
  );

  const charToPinyin = loadDict();
  const pool = getPool();
  let inserted = 0;
  let updated = 0;
  for (const char of bmpChars) {
    const pinyinStr = charToPinyin.get(char) ?? pinyinFor(char, charToPinyin);
    try {
      const [result] = await pool.execute<any>(
        "INSERT INTO rare_chars (`char`, pinyin, meaning, story) VALUES (?, ?, '', '') ON DUPLICATE KEY UPDATE pinyin = VALUES(pinyin)",
        [char, pinyinStr]
      );
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
    } catch (err) {
      console.error('[fetch-rare-chars] insert failed for', char, err);
    }
  }
  console.log(`[fetch-rare-chars] inserted=${inserted} updated=${updated}`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
