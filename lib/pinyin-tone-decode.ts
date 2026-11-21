/**
 * Tone-aware pinyin → hanzi decode — the PURE layer.
 *
 * ## Why this module exists
 *
 * `data/pinyin-hanzi.json` throws the tone away. "shi4" and "shi2" both
 * become "shi", and its frequencies come from a PHRASE list, where a rare
 * character inside many obscure words outranks a common one:
 *
 *     泥(109) above 你(10)   →  我爱你 was decoded as 我爱泥
 *     石(405) above 是      →  我是老师 was decoded as 卧石老师
 *     得(362) above 的(41)  →  你的 was decoded as 你得
 *
 * A learner typing nǐ into the candidate picker was offered 泥 first. That
 * is not a ranking nuisance — it teaches the wrong character.
 *
 * The user's input carries the TONE (ni3hao3), so nothing has to be
 * guessed: `data/pinyin-tone.json` has one bucket per TONED syllable
 * (1548 of them), ranked by REAL corpus frequencies (jieba's dict.txt,
 * where 是 = 796991 and 你 = 234587). ni3 starts 你; shi4 starts 是.
 *
 * ## ⚠️ This file must stay free of `node:` imports
 *
 * The client needs `hasTones` (to label an answer) and the panel is a
 * `'use client'` component, so this module is pulled into the browser
 * bundle. Importing `node:fs` here breaks the build at chunk-generation
 * time — a failure the unit tests cannot see and the real-machine
 * walkthrough caught immediately. The file readers live in
 * `lib/pinyin-tone-data.ts`, which only server code imports.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not claim to decode every sentence. A character-level model
 * cannot choose 今 over 心, 甚 over 什, or 杯 over 背 — those need a word
 * model, and the measurements in `scripts/build-pinyin-tone.ts` show a
 * pruned word table does not beat this one on a teacher's sentence set
 * (8/15). The honest behaviour on a hard case is to say so in the UI;
 * `convertToned` refuses to guess at a syllable it has never seen.
 *
 * ## Why it is a separate file from lib/pinyin-tone.ts
 *
 * `lib/pinyin-tone.ts` answers a different question — which of the four
 * tones does a written syllable carry (the game's tone tokens). It owns
 * the 24 tone marks as the single source of truth, so this module imports
 * its `TONE_MAP` and derives the plain letters by stripping the marks
 * rather than writing a second table that could drift.
 */
import { TONE_MAP as TONE_NUMBERS } from './pinyin-tone';

/** One character that carries a given toned syllable. */
export interface ToneEntry {
  char: string;
  freq: number;
}

/** Toned syllable ("ni3") → characters carrying it, ranked by frequency. */
export type ToneTable = Record<string, ToneEntry[]>;

/** Character transitions, as `data/bigrams.json` stores them. */
export type Bigrams = Record<string, Record<string, number>>;

/** The tone number of a neutral syllable — the same digit the input uses. */
const NEUTRAL_TONE = 5;

/**
 * Strip a tone mark to its plain letter: "ǎ" → "a".
 *
 * Derived from the mark itself (NFD + drop combining marks) rather than
 * from a second hand-written table, so `lib/pinyin-tone.ts` stays the only
 * place that lists the tone marks.
 */
function plainLetterOf(mark: string): string {
  return mark
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** A state in the Viterbi lattice. */
interface State {
  char: string;
  score: number;
  prev: State | null;
}

/** How many candidates a layer keeps before pruning. */
const TOP_K = 24;

/**
 * The cost of a missing bigram.
 *
 * `data/bigrams.json` was built from a 47k-phrase list and simply does not
 * contain most pairs (it has 这→事 but not 这→是, 事→一 but not 是→一).
 * Charging for a pair the table never had punishes the common character for
 * the table's incompleteness — measured by `.tmp/sweep-tone.ts`, -1 is the
 * best value of the sweep (8/15 exact on a teacher's sentence set).
 */
const MISSING_BIGRAM = -1;

/** The bonus a real bigram earns per log unit of its count (swept: 2 wins). */
const BIGRAM_WEIGHT = 2;

/**
 * A written syllable → its toned key: "nǐ" → "ni3", "de" → "de5".
 *
 * ü is written v (`lǜ` → `lv4`) because the rest of the codebase — the
 * shipped dictionary's keys included — spells it that way.
 *
 * @param syllable one written syllable, with or without its diacritic.
 * @returns the key, or '' when the syllable holds no letter.
 */
export function syllableKeyOf(syllable: string): string {
  let letters = '';
  let tone = 0;
  for (const raw of syllable) {
    const lower = raw.toLowerCase();
    const numbered = TONE_NUMBERS[lower];
    if (numbered !== undefined) {
      // The tone marks sit on ü as well, and ü is written v everywhere else
      // in this codebase, so the plain letter is remapped for ü/u marks.
      const plain = plainLetterOf(lower);
      letters += plain === 'u' && isUmlautMark(lower) ? 'v' : plain;
      tone = numbered;
      continue;
    }
    if (lower === 'ü') {
      // The umlaut is a spelling, not a tone; a bare ü carries tone 5.
      letters += 'v';
      continue;
    }
    if (/[a-z]/.test(lower)) letters += lower;
  }
  if (letters === '') return '';
  return letters + (tone === 0 ? NEUTRAL_TONE : tone);
}

/** True for the four tone marks that sit on ü (ǖ ǘ ǚ ǜ). */
function isUmlautMark(mark: string): boolean {
  return mark === 'ǖ' || mark === 'ǘ' || mark === 'ǚ' || mark === 'ǜ';
}

/**
 * Split tone-numbered pinyin into syllables: "ni3hao3" → ['ni3', 'hao3'].
 *
 * Spaces and apostrophes are separators, not symbols: `xi1'an1` is two
 * syllables, and a half-typed "ni3 hao3" is still a sentence. A run with
 * no tone digit gets 5, so a neutral-tone run is usable too.
 *
 * @param input what the user typed.
 * @returns the syllables; empty when the input has no pinyin in it.
 */
export function splitTonedSyllables(input: string): string[] {
  const pieces = input
    .toLowerCase()
    .replace(/[^a-z1-5v]/g, '')
    .match(/([a-z]+)([1-5])?/g);
  if (!pieces) return [];
  const out: string[] = [];
  for (const piece of pieces) {
    const match = piece.match(/([a-z]+)([1-5])?/);
    if (!match) continue;
    out.push(match[1] + (match[2] ?? String(NEUTRAL_TONE)));
  }
  return out;
}

/**
 * True when the input carries at least one tone digit.
 *
 * Plain input ("nihao") is routed to the shipped converter instead: it
 * cannot use the tone table, and stripping nothing to force a match would
 * compare different words.
 *
 * @param input what the user typed.
 */
export function hasTones(input: string): boolean {
  return /[a-z]+[1-5]/i.test(input);
}

/**
 * Decode tone-numbered pinyin into characters.
 *
 * Each syllable contributes its candidates; a Viterbi pass picks the path
 * that best explains the sequence by frequency and by character
 * transitions. A syllable the table does not know ends the decode with an
 * empty string — an empty answer is honest, a guess is not.
 *
 * @param input tone-numbered pinyin, e.g. "ni3hao3".
 * @param table the tone-aware table.
 * @param bigrams character transitions (optional; frequency alone works).
 * @returns the decoded text, or '' when it cannot be decoded.
 */
export function convertToned(
  input: string,
  table: ToneTable,
  bigrams: Bigrams = {},
): string {
  const syllables = splitTonedSyllables(input);
  if (syllables.length === 0) return '';

  let previous: State[] = [];
  const layers: State[][] = [];

  for (const syllable of syllables) {
    const bucket = table[syllable];
    if (!bucket || bucket.length === 0) return '';
    const states: State[] = [];
    for (const entry of bucket.slice(0, TOP_K * 2)) {
      let best: State | null = null;
      let transitionScore = 0;
      for (const prev of previous) {
        const count = bigrams[prev.char]?.[entry.char] ?? 0;
        const score =
          prev.score + (count > 0 ? BIGRAM_WEIGHT * Math.log(count) : MISSING_BIGRAM);
        if (best === null || score > transitionScore) {
          best = prev;
          transitionScore = score;
        }
      }
      states.push({
        char: entry.char,
        score: Math.log(Math.max(1, entry.freq)) + transitionScore,
        prev: best,
      });
    }
    states.sort((a, b) => b.score - a.score);
    previous = states.slice(0, TOP_K);
    layers.push(previous);
  }

  let current: State | null = layers[layers.length - 1]?.[0] ?? null;
  if (current === null) return '';
  const out: string[] = [];
  while (current !== null) {
    out.unshift(current.char);
    current = current.prev;
  }
  return out.join('');
}
