import { listChars } from './rare-chars';
import { getRadical } from './radical';
import { toneFromPinyin, type Tone } from './pinyin-tone';
import type { RoundChar, GameRound } from './game-round-types';

export type { RoundChar, GameRound } from './game-round-types';

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function buildRound(count: number, seed?: number): Promise<GameRound | null> {
  // Pull 1 page (80) of chars with meaning
  const page = await listChars({ minMeaning: true, page: 1 });
  const withAll = page.chars.filter((c) => {
    const rad = getRadical(c.char);
    return rad !== null;
  });
  if (withAll.length < count) return null;

  const actualSeed = seed ?? Date.now();
  const shuffled = seededShuffle(withAll, actualSeed);
  const picked = shuffled.slice(0, count);

  const charToAnswer: GameRound['charToAnswer'] = {};
  const correctTones = new Set<Tone>();
  const correctRadicals = new Set<string>();
  for (const c of picked) {
    const rad = getRadical(c.char)!;
    const tone = toneFromPinyin(c.pinyin);
    charToAnswer[c.char] = { tone, radical: rad };
    correctTones.add(tone);
    correctRadicals.add(rad);
  }

  // Distractors: pick from remaining shuffled chars
  const distractors = shuffled.slice(count, count + 16);
  const extraTones = new Set<Tone>();
  const extraRadicals = new Set<string>();
  for (const c of distractors) {
    extraTones.add(toneFromPinyin(c.pinyin));
    const rad = getRadical(c.char);
    if (rad) extraRadicals.add(rad);
  }

  // tone choices: always 1-5 (5 fixed choices is simpler than dedup dance)
  const toneChoices: Tone[] = [1, 2, 3, 4, 5];

  // radical choices: dedup correct + extras, cap at 6 (4 correct + ~2 distractors)
  const radicalChoices: string[] = [];
  for (const r of correctRadicals) radicalChoices.push(r);
  for (const r of extraRadicals) {
    if (radicalChoices.length >= 6) break;
    if (!radicalChoices.includes(r)) radicalChoices.push(r);
  }
  // shuffle radical choices so correct ones aren't always first
  const finalRadicals = seededShuffle(radicalChoices, actualSeed + 1);

  return {
    chars: picked.map(({ char, pinyin, meaning }) => ({ char, pinyin, meaning })),
    charToAnswer,
    toneChoices,
    radicalChoices: finalRadicals,
  };
}