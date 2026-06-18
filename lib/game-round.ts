import { listChars } from './rare-chars';
import { getRadical } from './radical';
import { ALL_TONES, toneFromPinyin, type Tone } from './pinyin-tone';
import type { RoundChar, GameRound, RoundMode } from './game-round-types';

export type { RoundChar, GameRound, RoundMode } from './game-round-types';

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[j]!];
  }
  return a;
}

/** Pick a random mode for this round. The seed makes it deterministic per
 *  call, so the same client gets a stable mode for a given seed. */
function pickMode(seed: number): RoundMode {
  // Equal-weight random among the 3 modes.
  const modes: RoundMode[] = ['tone', 'radical', 'pinyin'];
  return modes[seed % modes.length]!;
}

export async function buildRound(count: number, seed?: number): Promise<GameRound | null> {
  // The game needs chars with at least one of: tone-marked pinyin, known
  // radical, and unique pinyin (for pinyin mode). Pull a page of any chars
  // that have a radical lookup AND a tone-marked pinyin (the strictest
  // filter — neutral/轻声 is filtered out because it can't be matched
  // against the 1-4 token bank).
  const page = await listChars({ page: 1 });
  const withAll = page.chars.filter((c) => {
    const rad = getRadical(c.char);
    return rad !== null && toneFromPinyin(c.pinyin) !== null;
  });
  if (withAll.length < count) return null;

  const actualSeed = seed ?? Date.now();
  const shuffled = seededShuffle(withAll, actualSeed);

  // For pinyin mode we need unique pinyin so the user can unambiguously
  // match pinyin tokens to chars. Pick greedily from the shuffled pool.
  const mode = pickMode(actualSeed);
  const picked = mode === 'pinyin' ? pickUniquePinyin(shuffled, count) : shuffled.slice(0, count);
  if (picked.length < count) return null;

  const charToAnswer: GameRound['charToAnswer'] = {};
  const correctTones = new Set<Tone>();
  const correctRadicals = new Set<string>();
  for (const c of picked) {
    const rad = getRadical(c.char)!;
    const tone = toneFromPinyin(c.pinyin)!;
    charToAnswer[c.char] = { tone, radical: rad, pinyin: c.pinyin };
    correctTones.add(tone);
    correctRadicals.add(rad);
  }

  // Distractors: pick from remaining shuffled chars
  const distractors = shuffled.slice(count, count + 16);
  const extraTones = new Set<Tone>();
  const extraRadicals = new Set<string>();
  for (const c of distractors) {
    const t = toneFromPinyin(c.pinyin);
    if (t !== null) extraTones.add(t);
    const rad = getRadical(c.char);
    if (rad) extraRadicals.add(rad);
  }

  // tone choices: always 1-4 (4 fixed choices — no neutral in the game).
  const toneChoices: Tone[] = [...ALL_TONES];

  // radical choices: dedup correct + extras, cap at 6 (4 correct + ~2 distractors)
  const radicalChoices: string[] = [];
  for (const r of correctRadicals) radicalChoices.push(r);
  for (const r of extraRadicals) {
    if (radicalChoices.length >= 6) break;
    if (!radicalChoices.includes(r)) radicalChoices.push(r);
  }
  // shuffle radical choices so correct ones aren't always first
  const finalRadicals = seededShuffle(radicalChoices, actualSeed + 1);

  // pinyin choices: one per char, shuffled. No distractors — the user
  // just needs to find each pinyin's matching char.
  const pinyinChoices = seededShuffle(
    picked.map((c) => c.pinyin),
    actualSeed + 2,
  );

  return {
    mode,
    chars: picked.map(({ char, pinyin, meaning }) => ({ char, pinyin, meaning })),
    charToAnswer,
    toneChoices,
    radicalChoices: finalRadicals,
    pinyinChoices,
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
