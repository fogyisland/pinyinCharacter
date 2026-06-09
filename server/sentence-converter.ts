import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCandidates, normalizePinyin, type DictEntry, type Script } from './dictionary';
import { isBadText } from './filter';

type Bigrams = Record<string, Record<string, number>>;

let bigrams: Bigrams = {};
let bigramsLoaded = false;

function loadBigrams(): void {
  if (bigramsLoaded) return;
  bigrams = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'bigrams.json'), 'utf8')
  ) as Bigrams;
  bigramsLoaded = true;
}

function logSafe(n: number): number {
  return n > 0 ? Math.log(n) : -10;
}

const BAD_SCORE = -1000;
const TOP_K = 20;
const MAX_TOKEN_LEN = 4;

export function convertSentence(
  pinyinStr: string,
  safeMode: boolean,
  script: Script
): string {
  if (!pinyinStr.trim()) return '';
  loadBigrams();

  // 1) tokenize
  const normalized = pinyinStr.replace(/\s+/g, '').toLowerCase();
  const tokens = tokenize(normalized);

  if (tokens.length === 0) return '';

  // 2) Viterbi DP
  type State = { char: string; score: number; prev: State | null };
  const dp: State[][] = [];

  for (let i = 0; i < tokens.length; i++) {
    const candidates = collectCandidates(tokens[i]!.str, safeMode, script);
    if (candidates.length === 0) return '';
    const states: State[] = [];
    const seen = new Set<string>();

    for (const cand of candidates) {
      const baseScore = logSafe(cand.freq);
      const safePenalty = isBadText(cand.char, safeMode) ? BAD_SCORE : 0;

      let bestPrev: State | null = null;
      let bestPrevScore = 0;
      if (i > 0 && dp[i - 1]!.length > 0) {
        for (const prev of dp[i - 1]!) {
          const trans = bigrams[prev.char]?.[cand.char] ?? 0;
          const transScore = trans > 0 ? logSafe(trans) : -3;
          const candidate = prev.score + transScore;
          if (!bestPrev || candidate > bestPrevScore) {
            bestPrev = prev;
            bestPrevScore = candidate;
          }
        }
      } else {
        bestPrevScore = 0;
      }
      const total = baseScore + safePenalty + bestPrevScore;

      if (seen.has(cand.char)) continue;
      seen.add(cand.char);
      states.push({ char: cand.char, score: total, prev: bestPrev });
    }

    states.sort((a, b) => b.score - a.score);
    dp.push(states.slice(0, TOP_K));
  }

  // 3) Backtrack
  const last = dp[dp.length - 1]?.[0];
  if (!last) return '';
  const out: string[] = [];
  let cur: State | null = last;
  while (cur) {
    out.unshift(cur.char);
    cur = cur.prev;
  }
  return out.join('');
}

interface Token { str: string; len: number; }

function tokenize(pinyinStr: string): Token[] {
  // Strip apostrophes (they're used for disambiguation like xi'an, but tokenize on the rest)
  // Actually keep them — tokenize will handle them.
  const tokens: Token[] = [];
  let i = 0;
  while (i < pinyinStr.length) {
    // Skip apostrophe
    if (pinyinStr[i] === "'") {
      i++;
      continue;
    }
    // Greedy: try longest first, then shorter
    let bestLen = 0;
    for (let len = Math.min(MAX_TOKEN_LEN, pinyinStr.length - i); len >= 1; len--) {
      const raw = pinyinStr.slice(i, i + len);
      // Skip if sub contains apostrophe (apostrophe is a separator, not part of a token)
      if (raw.includes("'")) continue;
      // Normalize the slice (strip diacritics, tone digits) before lookup
      const normalized = normalizePinyin(raw);
      if (normalized.length === 0) continue;
      const cands = getCandidates(normalized, false, 'simplified');
      if (cands.length > 0) {
        bestLen = len;
        break;
      }
    }
    if (bestLen === 0) {
      // No match — skip this char
      i++;
      continue;
    }
    tokens.push({ str: pinyinStr.slice(i, i + bestLen), len: bestLen });
    i += bestLen;
  }
  return tokens;
}

function collectCandidates(pinyinStr: string, safeMode: boolean, script: Script): DictEntry[] {
  return getCandidates(pinyinStr, safeMode, script);
}
