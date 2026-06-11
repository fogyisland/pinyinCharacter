/**
 * One-shot script: fetch 通用规范汉字表 third-tier (~1600 chars), look up
 * pinyin from data/pinyin-hanzi.json (Plan A dictionary) or fall back to
 * pinyin-pro for missing chars, and INSERT into rare_chars.
 *
 * Usage: pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
 *
 * Idempotent: existing rows have only `pinyin` updated (meaning/story preserved).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

const SOURCE_URL =
  'https://raw.githubusercontent.com/elkmovie/通用规范汉字表/master/《通用规范汉字表》三级字表.txt';
const DICT_PATH = join(process.cwd(), 'data', 'pinyin-hanzi.json');

interface DictEntry { char: string; freq: number; }
type Dict = Record<string, DictEntry[]>;

function loadDict(): Map<string, string> {
  // Returns a Map of char -> first pinyin base
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  const charToPinyin = loadDict();

  console.log('[fetch-rare-chars] downloading source...');
  const text = await fetchText(SOURCE_URL);
  const chars = Array.from(new Set(text.split('').filter((c) => /[一-鿿]/.test(c))));
  console.log(`[fetch-rare-chars] ${chars.length} unique chars`);

  const pool = getPool();
  let inserted = 0;
  let updated = 0;
  for (const char of chars) {
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
