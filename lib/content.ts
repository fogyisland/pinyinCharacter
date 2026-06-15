import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';
import { CharContentSchema } from '@/scripts/schemas/content';
import type { CharContent } from '@/scripts/schemas/content';
import type { GetContentOptions } from './content-types';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

export async function getContent(
  char: string,
  opts: GetContentOptions = {}
): Promise<CharContent | null> {
  // 1. 读文件 (除非 dbOnly)
  if (!opts.dbOnly) {
    const filePath = join(CONTENT_DIR, `${char}.json`);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return CharContentSchema.parse(raw);
    }
  }

  // 2. DB 回退: 三表合并
  const pool = getPool();
  const [charRows] = await pool.query<any[]>(
    `SELECT pinyin, meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (charRows.length === 0) return null;

  const [etymRows] = await pool.query<any[]>(
    `SELECT story FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  const [storyRows] = await pool.query<any[]>(
    `SELECT story FROM char_story WHERE \`char\` = ? LIMIT 1`,
    [char]
  );

  const c = charRows[0];
  return {
    char,
    pinyin: c.pinyin ?? '',
    meaning_zh: c.meaning_zh ?? undefined,
    etymology_story: etymRows[0]?.story ?? undefined,
    hanzi_story: storyRows[0]?.story ?? undefined,
  };
}