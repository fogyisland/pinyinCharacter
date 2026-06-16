import 'server-only';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';
import { CharContentSchema } from '@/scripts/schemas/content';
import type { CharContent } from '@/scripts/schemas/content';
import type { GetContentOptions } from './content-types';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

function stripThinking(s: string): string {
  return s
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

/**
 * Read a single char's content from JSON (preferred) or DB (legacy fallback).
 *
 * JSON shape (data/content/<char>.json) is the source of truth; see
 * scripts/schemas/content.ts. Falls back to aggregating four DB tables
 * (chars, char_etymology, char_story, rare_chars) for legacy installs that
 * haven't run export-content yet.
 */
export async function getContent(
  char: string,
  opts: GetContentOptions = {}
): Promise<CharContent | null> {
  // 1. Read from data/content/<char>.json (preferred)
  if (!opts.dbOnly) {
    const filePath = join(CONTENT_DIR, `${char}.json`);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return CharContentSchema.parse(raw);
    }
  }

  // 2. Legacy fallback: aggregate from 4 DB tables
  const pool = getPool();
  const [charRows] = await pool.query<any[]>(
    `SELECT level, pinyin, meaning_zh, meaning_en, pinyin_alt, variants
     FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (charRows.length === 0) return null;

  const [etymRows] = await pool.query<any[]>(
    `SELECT story, generated_by, generated_at FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  const [storyRows] = await pool.query<any[]>(
    `SELECT story FROM char_story WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  const [rareRows] = await pool.query<any[]>(
    `SELECT pinyin, meaning, story, generated_by, generated_at FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );

  const c = charRows[0];
  const content: CharContent = {
    char,
    pinyin: rareRows[0]?.pinyin ?? c.pinyin ?? '',
    level: c.level ?? undefined,
  };
  const dict: NonNullable<CharContent['dict']> = {};
  if (c.meaning_zh) dict.meaning_zh = stripThinking(c.meaning_zh);
  if (c.meaning_en) dict.meaning_en = stripThinking(c.meaning_en);
  if (c.pinyin_alt) {
    try { dict.pinyin_alt = JSON.parse(c.pinyin_alt); } catch { /* skip */ }
  }
  if (c.variants) {
    try { dict.variants = JSON.parse(c.variants); } catch { /* skip */ }
  }
  if (Object.keys(dict).length > 0) content.dict = dict;

  const et = etymRows[0];
  if (et && (et.story || et.generated_by || et.generated_at)) {
    content.etymology = {
      story: et.story ? stripThinking(et.story) : undefined,
      generated_by: et.generated_by ?? undefined,
      generated_at: et.generated_at ? new Date(et.generated_at).toISOString() : undefined,
    };
  }
  const st = storyRows[0];
  if (st?.story) content.hanzi_story = stripThinking(st.story);

  const r = rareRows[0];
  if (r && (r.meaning || r.story)) {
    content.rare = {
      meaning: r.meaning ? stripThinking(r.meaning) : undefined,
      story: r.story ? stripThinking(r.story) : undefined,
      generated_by: r.generated_by ?? undefined,
      generated_at: r.generated_at ? new Date(r.generated_at).toISOString() : undefined,
    };
  }

  const stamps = [content.etymology?.generated_at, content.rare?.generated_at].filter(Boolean) as string[];
  if (stamps.length > 0) {
    stamps.sort().reverse();
    content.generated_at = stamps[0];
    const byWho = content.etymology?.generated_by ?? content.rare?.generated_by;
    if (byWho) content.generated_by = byWho;
  }

  return content;
}

/**
 * Read content synchronously from data/content/<char>.json only. Used by
 * build scripts and any non-RSC code that needs to skip the DB fallback.
 */
export function readContentFromFs(char: string): CharContent | null {
  const filePath = join(CONTENT_DIR, `${char}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return CharContentSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export interface WriteContentOptions {
  /** Merge into existing file instead of overwriting (preserves unset fields). */
  merge?: boolean;
}

/**
 * Write content to data/content/<char>.json atomically. Validates against
 * CharContentSchema before writing. Pass merge=true to preserve existing
 * fields (so a single-field write doesn't erase other fields).
 *
 * If the content doesn't pass schema validation (e.g. empty char), throws.
 */
export function writeContent(
  char: string,
  content: Partial<CharContent>,
  opts: WriteContentOptions = {}
): CharContent {
  if (!existsSync(CONTENT_DIR)) mkdirSync(CONTENT_DIR, { recursive: true });

  let merged: CharContent;
  if (opts.merge) {
    const existing = readContentFromFs(char);
    merged = { ...(existing ?? { char, pinyin: '' }), ...content, char };
  } else {
    merged = { char, pinyin: content.pinyin ?? '', ...content };
  }

  const validated = CharContentSchema.parse(merged);
  const filePath = join(CONTENT_DIR, `${char}.json`);
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
  return validated;
}