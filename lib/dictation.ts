/**
 * The item layer of the dictation tool.
 *
 * A dictation item is one word the teacher dictates: 1-4 characters
 * (a single character, a word or a four-character idiom), its pinyin and
 * the characters that fill the cells of the paper. Everything here is a
 * pure function over items — no DOM, no timers, no network. The TTS and
 * the paper rendering live elsewhere.
 *
 * Two rules this module exists to hold:
 *
 *   1. **The machine never overrides the teacher.** `annotatePinyin`
 *      only fills EMPTY pinyin fields; whatever the teacher typed (the
 *      correct reading of a polyphonic character) is kept verbatim.
 *
 *   2. **Nothing is silently dropped.** `parseCustomList` reports every
 *      word it refuses (longer than 4 characters) so the form can show
 *      it — a truncated word discovered on the printed sheet is a
 *      teaching accident.
 */
import hskVocabJson from '../data/hsk-vocab.json';
import idiomsJson from '../data/idioms.json';
import { loadPinyinPro } from './pinyin-client';

/** One dictated word. */
export interface DictationItem {
  /** The word: 1-4 characters. */
  word: string;
  /** The pinyin; empty string = not annotated (the paper prints no hint). */
  pinyin: string;
  /** The characters of the word, one per cell of the paper. */
  chars: string[];
}

/** The result of parsing a pasted word list. */
export interface ParsedList {
  items: DictationItem[];
  /** Words that were dropped (longer than 4 characters), in input order. */
  rejected: string[];
}

/** The longest word one dictation row can hold. */
const MAX_ITEM_CHARS = 4;

/** The idiom table: `data/idioms.json` — 378 four-character idioms. */
interface IdiomRow {
  word: string;
  pinyin: string;
  meaning: string;
  level: number;
  category: string;
}

const IDIOMS = idiomsJson as IdiomRow[];

/** The HSK character pools: `data/hsk-vocab.json` — `{ char }` per level. */
const HSK_POOLS = hskVocabJson as Record<string, Array<{ char: string }>>;

/** Build one item from a word; the pinyin starts empty. */
function makeItem(word: string, pinyin = ''): DictationItem {
  return { word, pinyin, chars: Array.from(word) };
}

/**
 * A seeded random generator (mulberry32).
 *
 * Sampling must be reproducible: the same seed has to pick the same
 * items, or a test can only assert shapes and never content. Same
 * algorithm as the other seeded pickers in the repo; re-implemented
 * here rather than imported across unrelated modules.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle a copy of `items` with `rng` (Fisher-Yates). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Split a pasted word list into dictation items.
 *
 * Separators are commas (half and full width) and any whitespace. Words
 * longer than 4 characters cannot sit in one row of the paper and are
 * REJECTED and reported — never silently cut. Repeats are dropped,
 * keeping the first occurrence: a dictation that asks for the same word
 * twice wastes the teacher's paper.
 *
 * @param text what the teacher pasted.
 * @returns the items and the words that were refused.
 */
export function parseCustomList(text: string): ParsedList {
  const items: DictationItem[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,，\s]+/)) {
    const word = part.trim();
    if (word === '' || seen.has(word)) continue;
    seen.add(word);
    const chars = Array.from(word);
    if (chars.length > MAX_ITEM_CHARS) {
      rejected.push(word);
      continue;
    }
    items.push({ word, pinyin: '', chars });
  }
  return { items, rejected };
}

/**
 * Fill the EMPTY pinyin fields from the dictionary (pinyin-pro, word
 * level). An item whose pinyin is already set is returned untouched —
 * the teacher's reading of a polyphonic character always wins.
 */
export async function annotatePinyin(items: DictationItem[]): Promise<DictationItem[]> {
  const needs = items.filter((item) => item.pinyin === '');
  if (needs.length === 0) return items.map((item) => ({ ...item }));
  const { pinyin } = await loadPinyinPro();
  return items.map((item) => {
    if (item.pinyin !== '') return { ...item };
    const syllables = pinyin(item.word, { toneType: 'symbol', type: 'array' }) as string[];
    return { ...item, pinyin: syllables.join(' ') };
  });
}

/**
 * Cut items into pages of `perPage` (default 10 dictation rows on A4).
 *
 * The tail stays short — a dictation sheet of 12 words is 10 + 2, not
 * 12 rows padded to 20. Practice sheets pad to a full page because the
 * student writes on the blanks; a dictation paper has nothing to fill.
 */
export function paginate<T>(items: readonly T[], perPage = 10): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

/**
 * Items from the real idiom table (`data/idioms.json`, 378 four-
 * character idioms with pinyin). Without `count` the whole (optionally
 * level-filtered) table comes back in table order; with `count` a seeded
 * sample is picked.
 */
export function itemsFromIdioms(level?: number, count?: number, seed = 1): DictationItem[] {
  const rows = level === undefined ? IDIOMS : IDIOMS.filter((row) => row.level === level);
  const chosen =
    count === undefined ? rows : shuffle(rows, makeRng(seed)).slice(0, Math.max(0, count));
  return chosen.map((row) => makeItem(row.word, row.pinyin));
}

/**
 * Items from one HSK level's character pool (`data/hsk-vocab.json`):
 * single characters, no pinyin (the teacher decides whether the sheet
 * shows hints at all). A seeded sample without replacement.
 */
export function itemsFromHsk(level: number, count: number, seed: number): DictationItem[] {
  const pool = HSK_POOLS[String(level)] ?? [];
  const picked = shuffle(pool, makeRng(seed)).slice(0, Math.max(0, count));
  return picked.map((row) => makeItem(row.char));
}
