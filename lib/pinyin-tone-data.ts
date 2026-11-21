/**
 * The data readers for the tone-aware decoder — SERVER ONLY.
 *
 * Split from `lib/pinyin-tone-decode.ts` because that module is pulled into
 * the browser bundle: `PinyinFullSentence` is a `'use client'` component
 * that needs `hasTones`, and `node:fs` in its import graph breaks the
 * Next.js build at chunk-generation time. The walkthrough caught exactly
 * that — unit tests cannot see a bundling failure.
 *
 * Only `app/api/pinyin/*` imports this, and those routes are server-only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bigrams, ToneTable } from './pinyin-tone-decode';

/** The table, read once and kept. */
let cachedTable: ToneTable | null = null;

/** The bigrams, read once and kept. */
let cachedBigrams: Bigrams | null = null;

/**
 * The tone-aware table, read from disk on first use.
 *
 * The file is the build product of `scripts/build-pinyin-tone.ts`:
 * `npm run dict:tone`. The server is its only consumer.
 */
export function getToneTable(): ToneTable {
  if (cachedTable) return cachedTable;
  const path = join(process.cwd(), 'data', 'pinyin-tone.json');
  const raw = readFileSync(path, 'utf-8');
  cachedTable = JSON.parse(raw) as ToneTable;
  return cachedTable;
}

/** The character transitions, read on first use. */
export function getBigrams(): Bigrams {
  if (cachedBigrams) return cachedBigrams;
  const path = join(process.cwd(), 'data', 'bigrams.json');
  const raw = readFileSync(path, 'utf-8');
  cachedBigrams = JSON.parse(raw) as Bigrams;
  return cachedBigrams;
}

/** Drop the caches; a test that replaces the files needs this. */
export function __resetToneCaches(): void {
  cachedTable = null;
  cachedBigrams = null;
}
