import 'server-only';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';
import { CharContentSchema, ContentManifestSchema } from '@/scripts/schemas/content';
import type { CharContent } from '@/scripts/schemas/content';
import type { GetContentOptions } from './content-types';
import { readJsonAutoCached, invalidateJsonCache } from './json-fs';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const MANIFEST_FILE = join(process.cwd(), 'data', 'content-manifest.json');

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
  // 1. Read from data/content/<char>.json (preferred). The Up/ deploy bundle
  //    ships .json.gz for these; readJsonAutoCached tries .json then .json.gz
  //    and memoizes the parsed result in memory.
  if (!opts.dbOnly) {
    const filePath = join(CONTENT_DIR, `${char}.json`);
    const raw = readJsonAutoCached(filePath);
    if (raw) {
      return CharContentSchema.parse(raw);
    }
  }

  // 2. Legacy fallback: aggregate from DB tables. Schema can be "slim"
  //    (6 cols in chars, no separate char_story) or "rich" (16+ cols +
  //    char_story table). Read the slim shape first, opportunistically
  //    upgrade to rich cols when present so neither schema breaks us.
  const pool = getPool();
  const [charRows] = await pool.query<any[]>(
    `SELECT level, pinyin, meaning_zh, meaning_en, pinyin_alt, variants
     FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  ).catch(() => {
    // Slim schema — meaning_zh etc. don't exist; fall back to bare cols.
    return pool.query<any[]>(
      `SELECT level, pinyin FROM chars WHERE \`char\` = ? LIMIT 1`,
      [char]
    ).then(([rows]) => [rows] as any);
  });
  if (charRows.length === 0) return null;

  const [etymRows] = await pool.query<any[]>(
    `SELECT story, generated_by, generated_at FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
    [char]
  ).catch(() => [[] as any[]]);
  const [storyRows] = await pool.query<any[]>(
    `SELECT story FROM char_story WHERE \`char\` = ? LIMIT 1`,
    [char]
  ).catch(() => [[] as any[]]);
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
  const raw = readJsonAutoCached(filePath);
  if (!raw) return null;
  try {
    return CharContentSchema.parse(raw);
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
  invalidateJsonCache(filePath);
  return validated;
}

export interface ContentCoverageByLevel {
  level: number;
  total: number;
  with_story: number;
}

export interface ContentCoverage {
  totalChars: number;
  withStory: number;
  byLevel: ContentCoverageByLevel[];
}

/**
 * Coverage stats aligned to DB chars as the anchor. A char "has story"
 * iff it exists in `chars` AND `data/content/<char>.json` has a non-empty
 * `etymology.story`. The `char_etymology` table is intentionally NOT used
 * (legacy cache, empty on slim-schema installs); JSON is the source of
 * truth per Plan content-bulk-gen (2026-06-17).
 *
 * Why anchored to DB: the manifest counts JSON files (incl. orphan files
 * whose char was dropped from DB), so manifest.byField.etymology_story can
 * drift from the per-DB-char coverage we actually want. Iterating
 * DB-side gives a self-consistent numerator + denominator.
 */
export async function getContentCoverage(): Promise<ContentCoverage> {
  const pool = getPool();
  const [charRows] = await pool.query<any[]>(
    `SELECT \`char\`, level FROM chars ORDER BY level`,
  );
  const totalChars = charRows.length;

  // Manifest is only used as a hint for the global "已生成字源" stat when
  // the DB is empty (e.g. fresh deploy before any chars are seeded). When
  // DB has chars, we always count from JSON files anchored to those chars.
  let manifestTotal = 0;
  if (totalChars === 0 && existsSync(MANIFEST_FILE)) {
    try {
      const manifest = ContentManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')));
      manifestTotal = manifest.byField.etymology_story;
    } catch {
      // ignore
    }
  }

  let withStory = 0;
  const byLevelMap = new Map<number, number>();
  for (const row of charRows) {
    const filePath = join(CONTENT_DIR, `${row.char}.json`);
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!raw.etymology?.story) continue;
      withStory++;
      byLevelMap.set(Number(row.level), (byLevelMap.get(Number(row.level)) ?? 0) + 1);
    } catch {
      continue;
    }
  }

  const byLevelTotals = new Map<number, number>();
  for (const row of charRows) {
    byLevelTotals.set(Number(row.level), (byLevelTotals.get(Number(row.level)) ?? 0) + 1);
  }
  const byLevel: ContentCoverageByLevel[] = [...byLevelTotals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, total]) => ({
      level,
      total,
      with_story: byLevelMap.get(level) ?? 0,
    }));

  return {
    totalChars,
    withStory: totalChars > 0 ? withStory : manifestTotal,
    byLevel,
  };
}
