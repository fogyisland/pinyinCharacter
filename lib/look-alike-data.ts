/**
 * 形近字 reader — SERVER ONLY.
 *
 * The comparison itself lives in `lib/look-alike.ts` (no disk access, safe
 * for the client). This module owns the DATA: the shipped table and the
 * stroke loader, both of which need `node:fs` and therefore must not be
 * imported — not even for a type — by a `'use client'` component.
 *
 * That is why `LookAlikeView` is declared in `lib/look-alike.ts`: the client
 * panel imports the type from the pure module, and the bundler never traces
 * this file into the browser graph. A type-only import from here looks
 * harmless and still breaks `next build` at chunk generation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareChars,
  prepareChar,
  type LookAlikeView,
  type Stroke,
} from './look-alike';

/** char → the characters it looks like. */
export type LookAlikeNames = Record<string, string[]>;

let cachedTable: LookAlikeNames | null = null;

/**
 * The shipped look-alike table (`data/look-alikes.json`).
 *
 * Built by `npm run lookalike:build`; 2207 characters, 10572 entries, 54 KB.
 */
export function getLookAlikeTable(): LookAlikeNames {
  if (cachedTable) return cachedTable;
  const path = join(process.cwd(), 'data', 'look-alikes.json');
  try {
    cachedTable = JSON.parse(readFileSync(path, 'utf-8')) as LookAlikeNames;
    return cachedTable;
  } catch (error) {
    throw new Error(
      `The look-alike table could not be read from ${path}. Build it with \`npm run lookalike:build\`.`,
      { cause: error },
    );
  }
}

/**
 * The look-alikes of one character.
 *
 * @param char one character.
 * @returns its look-alikes; empty when the table knows none.
 */
export function lookAlikesOf(char: string): string[] {
  if (Array.from(char).length !== 1) return [];
  return getLookAlikeTable()[char] ?? [];
}

/**
 * A character's stroke medians, or null when it has no stroke data.
 *
 * The comparison needs the raw strokes; the reader keeps this next to the
 * table so a page only imports one data module.
 *
 * @param char one character.
 */
export function strokesOf(char: string): Stroke[] | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'strokes', `${char}.json`), 'utf-8'),
    ) as { medians: Stroke[] };
    return Array.isArray(raw.medians) && raw.medians.length > 0 ? raw.medians : null;
  } catch {
    return null;
  }
}

/** The view type is declared in the pure module and re-used here. */

/**
 * Resolve everything the look-alike panel needs for one character.
 *
 * Returns null when the character has no look-alikes or no stroke data, in
 * which case the panel renders nothing.
 *
 * @param char the character on screen.
 * @returns the view, or null.
 */
export function resolveLookAlikeView(char: string): LookAlikeView | null {
  const names = lookAlikesOf(char);
  if (names.length === 0) return null;
  const strokes = strokesOf(char);
  if (!strokes) return null;
  const prepared = prepareChar(char, strokes);

  // The build sorts by `mean`, so the first name is the closest; the live
  // comparison still decides whether it is a 形近 pair at all.
  for (const other of names) {
    const otherStrokes = strokesOf(other);
    if (!otherStrokes) continue;
    const comparison = compareChars(prepared, prepareChar(other, otherStrokes));
    if (!comparison?.isLookAlike) continue;
    return {
      featured: { comparison, strokeCountA: strokes.length, strokeCountB: otherStrokes.length },
      rest: names.filter((name) => name !== other),
      total: names.length,
    };
  }

  return { featured: null, rest: names, total: names.length };
}

/** Drop the cache; a test that replaces the file needs this. */
export function __resetLookAlikeCache(): void {
  cachedTable = null;
}
