import { pinyin } from 'pinyin-pro';
import { getPool } from './db';
import { toneFromPinyin } from './pinyin-tone';
import type { CharRow } from './chars-types';

/**
 * Pinyin index over every row of the `chars` table.
 *
 * ## Why this module exists
 *
 * The 2026-06-17 content migration emptied `chars.pinyin` (and
 * `chars.stroke_count`) for all 7909 rows — the authoritative data moved to
 * data/content/<char>.json and public/strokes/<char>.json. Three features
 * still read the old columns and silently degraded:
 *
 *   - the dictionary's 按拼音 A-Z index (`listChars({ letter })`) returned
 *     **0 rows for every letter**, because it matched on `pinyin LIKE 'A%'`
 *     against a column that is empty everywhere;
 *   - the 同拼音 row on the detail page never rendered — `getCharDetail`
 *     hard-coded `relatedByPinyin: []`;
 *   - the 部首 · N 画 field always printed "0 画".
 *
 * This module rebuilds the pinyin side from pinyin-pro, the exact source
 * `resolvePinyin()` already used for the 拼音 field, so the index can never
 * disagree with the reading shown on the page.
 *
 * ## Cost
 *
 * One `SELECT` over the chars table plus one pinyin-pro call per char:
 * 23 ms for all 7909 chars. The result is memoized per process, so only the
 * first request pays it.
 */

/** A char together with the reading the index resolved for it. */
export interface PinyinIndexEntry {
  char: string;
  /** Tone-marked reading, e.g. "qī". */
  reading: string;
  /** A-Z bucket the reading files under, e.g. "Q". */
  letter: string;
}

export interface PinyinIndex {
  /** Every indexed char, sorted by reading (base syllable → tone → char). */
  entries: PinyinIndexEntry[];
  /** Raw `chars` rows, keyed by char. */
  rows: Map<string, CharRow>;
  /** Tone-marked reading → the chars that share it. */
  byReading: Map<string, string[]>;
  /** A-Z bucket → the chars under it, in reading order. */
  byLetter: Map<string, string[]>;
}

/** Resolved readings, memoized for the lifetime of the process. */
const readingCache = new Map<string, string>();

/**
 * Resolve the reading for a char, preferring the DB column and falling back
 * to pinyin-pro.
 *
 * The DB column is empty for every row since 2026-06-17, so the fallback is
 * what actually produces the reading — and it is the same source the 拼音
 * field on the page uses, which is why the index and the page never drift.
 */
export function resolvePinyin(char: string, dbPinyin: string | null | undefined): string {
  if (dbPinyin && dbPinyin.trim()) return dbPinyin.trim();
  const cached = readingCache.get(char);
  if (cached) return cached;
  const generated = pinyin(char, { toneType: 'symbol' }).trim();
  readingCache.set(char, generated);
  return generated;
}

/** Unicode combining diacritical marks (tone marks, diaeresis). */
const COMBINING_MARKS = /[\u0300-\u036f]/;

/**
 * The same class with the global flag, for `String.replace`. A non-global
 * regex only replaces the first match, which would leave the second mark of
 * a two-mark syllable (lǜ → "lù") behind.
 */
const COMBINING_MARKS_ALL = /[\u0300-\u036f]/g;

/**
 * The A-Z bucket a reading belongs to: its first letter with the tone mark
 * removed.
 *
 * Zero-initial readings (ā, ē, ǐ …) file under their own vowel, and a
 * genuinely ü-initial reading files under V — the official Hanyu Pinyin
 * alphabet lists ü there. (In practice ü only ever follows l/n/j/q/x/y, so
 * lǜ files under L; the V branch covers a bare ü.)
 */
export function baseLetter(reading: string): string {
  const first = reading.charAt(0);
  if (!first) return '';
  const decomposed = first.normalize('NFD');
  const marks = [...decomposed].filter((c) => COMBINING_MARKS.test(c));
  // U+0308 is the diaeresis.
  if (marks.includes('\u0308')) return 'V';
  const plain = [...decomposed].filter((c) => !COMBINING_MARKS.test(c)).join('');
  return (plain || first).toUpperCase();
}

/** The tone-stripped syllable, used as the primary sort key. */
export function stripTone(reading: string): string {
  return reading
    .normalize('NFD')
    .replace(COMBINING_MARKS_ALL, '')
    .replace(/\u00fc/g, 'u');
}

/**
 * The separator between the syllable and the tone in a sort key.
 *
 * U+0000 is used rather than "|" because the key is compared as a
 * plain string: "|" (0x7C) sorts after every lowercase letter, which
 * would put "ha|1" after "hao|1". U+0000 sorts before every letter,
 * so a shorter syllable always precedes the longer one it is a prefix
 * of ("ha" before "hao").
 */
const SORT_KEY_SEPARATOR = '\u0000';

/**
 * Sort key for the 按拼音 view: base syllable first, then tone (1-4), with
 * 轻声 last — the order a printed dictionary uses.
 */
export function readingSortKey(reading: string): string {
  const tone = toneFromPinyin(reading);
  return `${stripTone(reading)}${SORT_KEY_SEPARATOR}${tone === null ? 5 : tone}`;
}

let indexPromise: Promise<PinyinIndex> | null = null;

/**
 * The process-wide pinyin index. Built on first use and reused afterwards.
 * A failed build clears the memo so the next request retries.
 */
export function getPinyinIndex(): Promise<PinyinIndex> {
  if (!indexPromise) {
    indexPromise = buildIndex().catch((err: unknown) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

async function buildIndex(): Promise<PinyinIndex> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, hsk_level
     FROM chars`,
  );

  const rowMap = new Map<string, CharRow>();
  const entries: PinyinIndexEntry[] = [];
  for (const raw of rows) {
    const row = raw as CharRow;
    const char = String(row.char ?? '');
    if (!char) continue;
    const reading = resolvePinyin(char, row.pinyin);
    rowMap.set(char, row);
    entries.push({ char, reading, letter: baseLetter(reading) });
  }

  entries.sort((a, b) => {
    const keyA = readingSortKey(a.reading);
    const keyB = readingSortKey(b.reading);
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    if (a.char === b.char) return 0;
    return a.char < b.char ? -1 : 1;
  });

  const byReading = new Map<string, string[]>();
  const byLetter = new Map<string, string[]>();
  for (const entry of entries) {
    const sameReading = byReading.get(entry.reading);
    if (sameReading) sameReading.push(entry.char);
    else byReading.set(entry.reading, [entry.char]);

    const sameLetter = byLetter.get(entry.letter);
    if (sameLetter) sameLetter.push(entry.char);
    else byLetter.set(entry.letter, [entry.char]);
  }

  return { entries, rows: rowMap, byReading, byLetter };
}

/**
 * The chars that share a reading, in reading order. Excludes the char
 * itself when it is part of the bucket.
 */
export function getCharsByReading(index: PinyinIndex, reading: string, exclude?: string): string[] {
  const bucket = index.byReading.get(reading) ?? [];
  return exclude ? bucket.filter((c) => c !== exclude) : bucket;
}
