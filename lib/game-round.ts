import { listChars as listCharsFromTable } from './chars';
import { toneFromPinyin, type Tone } from './pinyin-tone';
import { seededShuffle } from './shuffle';
import type { GameRound, RoundMode } from './game-round-types';
import type { CharSource, HskLevel } from './difficulty';

export type { RoundChar, GameRound, RoundMode } from './game-round-types';

export { seededShuffle } from './shuffle';

/**
 * Minimal char shape the game-round filter needs. The actual listChars
 * returns a fuller `Char` (with meaning/pinyinAlt/etc.) but the filter only
 * needs `char`, `level`, and `hsk_level`. This loose type lets callers pass
 * either `Char[]` or hand-crafted test fixtures without casts everywhere.
 *
 * `hsk_level` is `number | null` because the chars table allows NULL until
 * the HSK import has covered that char (per migration 2026-07-04-hsk-level.sql).
 */
export interface CharInfo {
  char: string;
  level: 1 | 2 | 3;
  hsk_level?: number | null;
  [k: string]: unknown;
}

/**
 * Pure HSK filter used by buildRound (and exposed for unit testing). When
 * `hskLevel` is null/undefined the filter is a no-op (caller falls back to
 * the existing chars.level logic). When set, returns only chars whose
 * `hsk_level` column matches exactly. Returns an empty array if no chars
 * match — callers are responsible for falling back to the unfiltered list
 * (do not crash the request).
 */
export function filterByHskLevel<T extends { hsk_level?: number | null }>(
  chars: T[],
  hskLevel: HskLevel | null | undefined,
): T[] {
  if (hskLevel == null) return chars.slice();
  return chars.filter((c) => c.hsk_level === hskLevel);
}

/**
 * BuildRound's return type. Wraps the legacy `GameRound` payload with
 * metadata about HSK filtering so the route can render FallbackBanner
 * when the SQL filter produced 0 rows and we fell back to chars.level.
 */
export interface BuildRoundResult {
  round: GameRound;
  /** True when hskLevel was requested but the SQL filter returned 0 rows
   *  and we fell back to the un-HSK-filtered pool. Route surfaces this as
   *  `hskFallback` so the client renders <FallbackBanner />. */
  hskFallback: boolean;
  /** Echoes the HSK level used (or null when not requested). Route uses
   *  this to derive revealConfig when no mode override is passed. */
  hskLevel: HskLevel | null;
}

/** Pick a random mode for this round. The seed makes it deterministic per
 *  call, so the same client gets a stable mode for a given seed. */
function pickMode(seed: number): RoundMode {
  // Equal-weight random among the 3 modes.
  const modes: RoundMode[] = ['tone', 'radical', 'pinyin'];
  return modes[seed % modes.length]!;
}

export async function buildRound(
  count: number,
  seed?: number,
  source: CharSource = 'chars-all',
  hskLevel?: HskLevel | null,
  modeOverride?: RoundMode,
): Promise<BuildRoundResult | null> {
  // The game needs chars with at least one of: tone-marked pinyin, known
  // radical, and unique pinyin (for pinyin mode). Pull a page of any chars
  // that have a non-empty radical AND a tone-marked pinyin (the strictest
  // filter — neutral/轻声 is filtered out because it can't be matched
  // against the 1-4 token bank). Filter by level per `source`:
  //   'chars-level-1'   → level 1 only (simple / common)
  //   'chars-level-1-2' → level 1 or 2
  //   'chars-all'       → no filter
  // 2026-07-03: switched from `lib/rare-chars` to `lib/chars` because the
  // latter has the `level` column we need to filter on; rare_chars is
  // L3-only. Single page is enough for 3-6 chars/round, but we still
  // shuffle in case the first page doesn't have enough usable chars.
  const allPages: Array<{
    char: string;
    pinyin: string;
    meaning: string;
    radical: string;
    level: 1 | 2 | 3;
    hskLevel?: number | null;
  }> = [];
  for (let page = 1; page <= 100; page++) {
    // 2026-07-04: pass `hskLevel` to listChars so the SQL WHERE pre-filters
    // (avoids fetching thousands of rows just to drop them). When `hskLevel`
    // is null/undefined the param is omitted and behavior is unchanged.
    const result = await listCharsFromTable({
      page,
      ...(hskLevel != null ? { hskLevel } : {}),
    });
    for (const c of result.chars) {
      allPages.push({
        char: c.char,
        pinyin: c.pinyin,
        meaning: c.meaningZh ?? '',
        radical: c.radical,
        level: c.level,
        hskLevel: c.hskLevel ?? null,
      });
    }
    if (result.chars.length < 80) break;
  }
  // Defensive in-memory filter: the SQL filter above should already narrow
  // to the right rows, but `filterByHskLevel` is a no-op when hskLevel is
  // null (preserves legacy behavior). If the SQL filter produced zero rows
  // (e.g. an HSK level with no imported chars yet), fall back to the full
  // pool so the game still works — components can render <FallbackBanner/>.
  let withAll = allPages.filter((c) => {
    if (source === 'chars-level-1' && c.level !== 1) return false;
    if (source === 'chars-level-1-2' && c.level !== 1 && c.level !== 2) return false;
    return c.radical !== '' && toneFromPinyin(c.pinyin) !== null;
  });
  // 2026-07-04: HSK fallback detection. If the SQL filter returned 0 chars
  // for the requested HSK level AND we had to fall back to the broader
  // chars.level pool, surface hskFallback=true so the route can render
  // <FallbackBanner />. The fallback below widens the pool by removing
  // the HSK restriction; we record whether it actually fired.
  let hskFallback = false;
  if (hskLevel != null && withAll.length < count) {
    // HSK filter too narrow — fall back to the full (un-HSK-filtered) pool.
    hskFallback = true;
    withAll = allPages.filter((c) => {
      if (source === 'chars-level-1' && c.level !== 1) return false;
      if (source === 'chars-level-1-2' && c.level !== 1 && c.level !== 2) return false;
      return c.radical !== '' && toneFromPinyin(c.pinyin) !== null;
    });
  }
  if (withAll.length < count) return null;

  const actualSeed = seed ?? Date.now();
  const shuffled = seededShuffle(withAll, actualSeed);

  // For pinyin mode we need unique pinyin so the user can unambiguously
  // match pinyin tokens to chars. Pick greedily from the shuffled pool.
  // 2026-10-25 (Task 5): `modeOverride` wins over the per-seed random pick.
  // When it is absent the legacy behavior is untouched — the mode stays a
  // pure function of the seed.
  const mode = modeOverride ?? pickMode(actualSeed);
  const picked = mode === 'pinyin' ? pickUniquePinyin(shuffled, count) : shuffled.slice(0, count);
  if (picked.length < count) return null;

  const charToAnswer: GameRound['charToAnswer'] = {};
  for (const c of picked) {
    charToAnswer[c.char] = {
      tone: toneFromPinyin(c.pinyin)!,
      radical: c.radical,
      pinyin: c.pinyin,
    };
  }

  // 2026-10-25 (Task 6): the tone token bank is ONE TOKEN PER CHAR.
  //
  // The old bank was the four tone *values* (1-4), so two chars of the same
  // tone fought over a single token: the second could never be matched,
  // `matchCount` never reached `chars.length` and the round never
  // auto-finished. With 6 chars and 4 tones the pigeonhole principle makes
  // the collision certain, so the 声调 round was unwinnable in hard mode.
  //
  // `toneChoices[i]` is the tone of `chars[i]` — the bank is exactly the
  // answer set, one token per char, duplicates allowed.
  const toneChoices: Tone[] = picked.map((c) => toneFromPinyin(c.pinyin)!);

  // The radical mode had the same shape: the old bank was a Set of the
  // correct radicals (dedup) plus extra radicals, capped at 6. Two chars
  // sharing a radical collapsed into one token, so one of them owned no
  // token at all. One token per char fixes that the same way.
  const radicalChoices: string[] = picked.map((c) => c.radical);

  // pinyin choices: one per char, shuffled. No distractors — the user
  // just needs to find each pinyin's matching char.
  const pinyinChoices = seededShuffle(
    picked.map((c) => c.pinyin),
    actualSeed + 2,
  );

  return {
    round: {
      mode,
      chars: picked.map(({ char, pinyin, meaning, radical }) => ({
        char,
        pinyin,
        meaning,
        radical,
      })),
      charToAnswer,
      toneChoices,
      radicalChoices,
      pinyinChoices,
    },
    hskFallback,
    hskLevel: hskLevel ?? null,
  };
}

function pickUniquePinyin<T extends { pinyin: string }>(pool: T[], count: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of pool) {
    if (seen.has(c.pinyin)) continue;
    seen.add(c.pinyin);
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}
