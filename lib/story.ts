import 'server-only';
import { getPool } from './db';
import { getContent } from './content';

export interface HanziStory {
  char: string;
  story: string;
  pinyin?: string;
}

/**
 * Read a char's hanzi_story (汉字故事).
 *
 * Slim-DB order: data/content/<char>.json (preferred, post 2026-06-17
 * migration), then rare_chars.story (legacy L3 fallback).
 */
export async function getHanziStory(char: string): Promise<HanziStory | null> {
  const content = await getContent(char);
  if (content?.hanzi_story) {
    return { char: content.char, story: content.hanzi_story, pinyin: content.pinyin };
  }

  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, story FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (rows.length === 0 || !rows[0].story) return null;
  return { char: rows[0].char, story: rows[0].story, pinyin: rows[0].pinyin };
}