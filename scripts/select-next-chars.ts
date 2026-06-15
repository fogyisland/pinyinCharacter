/**
 * 选题: 输出下一轮 30 字 + 每字该填的字段。
 * 选题顺序: meaning_zh 缺口 → hanzi_story 缺口 → etymology_story 缺口
 * 同字段内: 优先 level 1 → 2 → 3, 优先 data/content/ 没有该字段的
 *
 * Run: pnpm tsx scripts/select-next-chars.ts
 * 输出: 30 行 JSON, 例: {"char": "严", "fieldsToFill": ["meaning_zh"]}
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { CharContentSchema } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const ROUND_SIZE = 30;

export interface CharToFill {
  char: string;
  fieldsToFill: Array<'meaning_zh' | 'etymology_story' | 'hanzi_story'>;
}

interface ExistingFile {
  meaning_zh: boolean;
  etymology_story: boolean;
  hanzi_story: boolean;
}

function scanContentDir(): Map<string, ExistingFile> {
  const result = new Map<string, ExistingFile>();
  if (!existsSync(CONTENT_DIR)) return result;
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const char = f.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      result.set(char, {
        meaning_zh: parsed.meaning_zh !== undefined,
        etymology_story: parsed.etymology_story !== undefined,
        hanzi_story: parsed.hanzi_story !== undefined,
      });
    } catch {
      // skip invalid files
    }
  }
  return result;
}

async function listCharsMissing(
  pool: any,
  field: 'meaning_zh' | 'etymology_story' | 'hanzi_story',
  limit: number,
  existing: Map<string, ExistingFile>,
  levels: Array<1 | 2 | 3>
): Promise<string[]> {
  const chars: string[] = [];
  for (const level of levels) {
    if (chars.length >= limit) break;
    let sql: string;
    let params: any[];
    if (field === 'meaning_zh') {
      sql = `SELECT \`char\` FROM chars
             WHERE level = ? AND (meaning_zh IS NULL OR meaning_zh = '')
             ORDER BY \`char\` LIMIT ?`;
      params = [level, limit - chars.length];
    } else {
      sql = `SELECT \`char\` FROM chars WHERE level = ? ORDER BY \`char\` LIMIT ?`;
      params = [level, limit - chars.length];
    }
    const [rows] = await pool.query(sql, params);
    for (const r of rows) {
      const c: string = r.char;
      if (chars.includes(c)) continue;
      if (existing.get(c)?.[field]) continue;
      chars.push(c);
      if (chars.length >= limit) break;
    }
  }
  return chars;
}

export async function selectNextChars(roundSize: number = ROUND_SIZE): Promise<CharToFill[]> {
  const pool = getPool();
  const existing = scanContentDir();
  const result: CharToFill[] = [];
  const seen = new Set<string>();

  const [[{ n: meaningInDb }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars WHERE meaning_zh IS NOT NULL AND meaning_zh != ''`
  );
  const meaningInFiles = [...existing.values()].filter(v => v.meaning_zh).length;
  const meaningGap = 8105 - Number(meaningInDb) - meaningInFiles;

  if (meaningGap > 0) {
    const chars = await listCharsMissing(pool, 'meaning_zh', roundSize, existing, [1, 2, 3]);
    for (const c of chars) {
      if (seen.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['meaning_zh'] });
      if (result.length >= roundSize) return result;
    }
  }

  const hanziTarget = 1607;
  const hanziInFiles = [...existing.values()].filter(v => v.hanzi_story).length;
  const hanziGap = hanziTarget - hanziInFiles;

  if (hanziGap > 0) {
    const remain = roundSize - result.length;
    const chars = await listCharsMissing(pool, 'hanzi_story', remain, existing, [3]);
    for (const c of chars) {
      if (seen.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['hanzi_story'] });
      if (result.length >= roundSize) return result;
    }
  }

  const etymTarget = 6498;
  const etymInFiles = [...existing.values()].filter(v => v.etymology_story).length;
  const etymGap = etymTarget - etymInFiles;

  if (etymGap > 0) {
    const remain = roundSize - result.length;
    const chars = await listCharsMissing(pool, 'etymology_story', remain, existing, [1, 2]);
    for (const c of chars) {
      if (seen.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['etymology_story'] });
      if (result.length >= roundSize) return result;
    }
  }

  return result;
}

async function main() {
  const result = await selectNextChars(ROUND_SIZE);
  for (const c of result) {
    console.log(JSON.stringify(c));
  }
  console.error(`Selected ${result.length} chars for next round.`);
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}