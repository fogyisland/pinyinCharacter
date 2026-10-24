/**
 * Shared types and field tables for the character generation console.
 *
 * They live in their own module so the shell, the hooks and the result
 * views can all import them without pulling in each other's React code.
 */

export type Tab = 'dict' | 'etymology' | 'batch' | 'rare';

export interface FieldResult {
  generated: number;
  skipped: number;
  errors: { char: string; message: string }[];
}

export interface GenerateResponse {
  perField: Record<string, FieldResult>;
  totals: FieldResult;
}

export const DICT_FIELDS = [
  { key: 'meaning_zh', label: '释义 (中文)' },
  { key: 'meaning_en', label: '释义 (英文)' },
  { key: 'pinyin_alt', label: '多音' },
  { key: 'variants', label: '异体' },
] as const;

export const RARE_FIELDS = [
  { key: 'rare_meaning', label: '释义' },
  { key: 'rare_story', label: '故事' },
] as const;

export const ALL_BATCH_FIELDS = [
  { key: 'meaning_zh', label: '释义(中文)' },
  { key: 'meaning_en', label: '释义(英文)' },
  { key: 'pinyin_alt', label: '多音' },
  { key: 'variants', label: '异体' },
  { key: 'etymology_story', label: '字源故事' },
  { key: 'rare_meaning', label: '罕见字释义(L3)' },
  { key: 'rare_story', label: '罕见字故事(L3)' },
] as const;

export const LEVELS = [
  { value: 1, label: 'L1', desc: '常用字 (3500 字)' },
  { value: 2, label: 'L2', desc: '次常用字 (2996 字)' },
  { value: 3, label: 'L3 / 罕见字', desc: '罕见字 (1412 字)' },
] as const;

/** The tabs of the console, in display order. */
export const TABS: { key: Tab; label: string }[] = [
  { key: 'dict', label: '字典字段' },
  { key: 'etymology', label: '字源' },
  { key: 'batch', label: '按级别批量' },
  { key: 'rare', label: '罕见字' },
];

export type BatchStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

/**
 * The per-field progress of a batch run.
 *
 * `errors` holds only the most recent entries — a long batch can produce
 * thousands of them, and keeping every one in the React state made the
 * state grow without bound. The true number lives in `errorCount`.
 */
export interface FieldProgress {
  generated: number;
  skipped: number;
  /** How many errors occurred, including the ones no longer listed. */
  errorCount: number;
  errors: { char: string; message: string }[];
}

export interface BatchProgress {
  totalChars: number;
  processed: number;
  nextOffset: number;
  elapsedMs: number;
  perField: Record<string, FieldProgress>;
}

/** How many error entries one field keeps in the state. */
export const MAX_FIELD_ERRORS = 200;

export const EMPTY_PROGRESS: BatchProgress = {
  totalChars: 0,
  processed: 0,
  nextOffset: 0,
  elapsedMs: 0,
  perField: {},
};

/** Matches a single CJK unified ideograph. */
const HAN_CHAR = /[一-鿿]/;

/** Counts the Chinese characters of a string, ignoring everything else. */
export function countHanChars(value: string): number {
  return Array.from(value).filter((c) => HAN_CHAR.test(c)).length;
}

/** Keeps only the Chinese characters of a string, in order. */
export function extractHanChars(value: string): string[] {
  return Array.from(value).filter((c) => HAN_CHAR.test(c));
}
