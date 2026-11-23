/**
 * 读音判定 —— pure logic.
 *
 * ## What this module answers
 *
 * It does not record, does not call a network, and does not touch a browser.
 * The recogniser hands it what the learner said (characters plus readings);
 * this module says where that differs from the target, character by
 * character.
 *
 * ## Why a tone mistake is its own verdict
 *
 * In Chinese class the commonest error is not the wrong word but the right
 * syllable with the wrong tone: 买 mǎi / 卖 mài, 问 wèn / 文 wén. Calling that
 * 「说错了」 tells the learner the whole attempt was worthless; calling it
 * 「声调不对」 tells them exactly what to fix. So the verdicts are graded:
 *
 *   exact   — the same character and the same reading
 *   tone    — the same syllable, a different tone
 *   similar — a different syllable that shares the final (or the initial)
 *   wrong   — unrelated
 *   missing — the learner did not say this character at all
 *
 * The score is the average of these, which makes 「对了大半」 visible instead
 * of collapsing to a pass/fail.
 *
 * ## What it refuses to guess
 *
 * A recogniser may return plain pinyin with no tone marks (「mai」 instead of
 * 「mǎi」). Then a tone mistake is indistinguishable from an exact match, and
 * pretending otherwise would fail a learner who read perfectly. The verdict
 * falls back to comparing the character itself.
 */

/** One character of the target word, with its reading. */
export interface CharReading {
  char: string;
  /** Pinyin with the tone mark, e.g. 「xué」 or 「de」. */
  pinyin: string;
}

/** How one character compared. */
export type Verdict = 'exact' | 'tone' | 'similar' | 'wrong' | 'missing';

/** What the learner should do next. */
export type Advice = 'perfect' | 'tones' | 'sounds' | 'nothing';

/** The outcome of comparing a spoken word with its target. */
export interface Comparison {
  /** One verdict per target character. */
  verdicts: Verdict[];
  /** 0–100, averaged over the target characters. */
  score: number;
  /** The one thing to work on. */
  advice: Advice;
}

/** A perfect character scores 100. */
const SCORE_EXACT = 100;

/**
 * The same syllable with a different tone scores 70.
 *
 * Not 90: the learner has to unlearn the wrong tone, which is harder than
 * learning one they never said. High enough to mean 「almost there」.
 */
const SCORE_TONE = 70;

/** A different syllable sharing the final or initial scores 45. */
const SCORE_SIMILAR = 45;

/** An unrelated character scores 0. */
const SCORE_WRONG = 0;

/** A character that was not said scores 0. */
const SCORE_MISSING = 0;

/**
 * Tone marks → their plain letter, for stripping.
 *
 * Deliberately a superset of `lib/pinyin-tone.ts`'s four tones: this module
 * also strips the marks it does not score (there are none here), and keeping
 * the mapping local means the two files cannot drift into disagreeing about
 * which mark means what.
 */
const TONE_MARKS: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v',
  ü: 'v',
};

/** The tone marks that carry a tone number. */
const TONE_NUMBERS: Record<string, number> = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};

/**
 * The syllable with its tone mark removed: 「mǎi」 → 「mai」, 「lǜ」 → 「lv」.
 *
 * @param syllable written pinyin, with or without a mark.
 */
export function plainSyllable(syllable: string): string {
  let out = '';
  for (const raw of syllable.toLowerCase()) {
    const plain = TONE_MARKS[raw];
    if (plain !== undefined) {
      out += plain;
      continue;
    }
    if (/[a-z]/.test(raw)) out += raw;
  }
  return out;
}

/**
 * The tone of a syllable, 1–4, or 0 when it carries no mark.
 *
 * A neutral syllable (「de」) returns 0: it has no tone to compare, and a
 * recogniser that drops the mark is indistinguishable from a neutral one.
 *
 * @param syllable written pinyin.
 */
export function toneOf(syllable: string): number {
  for (const raw of syllable.toLowerCase()) {
    const tone = TONE_NUMBERS[raw];
    if (tone !== undefined) return tone;
  }
  return 0;
}

/** The two-letter initials, checked before the single-letter ones. */
const TWO_LETTER_INITIALS = ['zh', 'ch', 'sh'];

/**
 * The initial of a syllable: 「zhōng」 → 「zh」, 「ài」 → ''.
 *
 * y and w are treated as initials. That is the school convention for the
 * purposes of this comparison: 学 xué and 雪 xuě then share the final 「üe」,
 * which is exactly what a tone-only mistake needs to be recognised as.
 *
 * @param syllable written pinyin.
 */
export function initialOf(syllable: string): string {
  const plain = plainSyllable(syllable);
  for (const initial of TWO_LETTER_INITIALS) {
    if (plain.startsWith(initial)) return initial;
  }
  const first = plain[0] ?? '';
  // The consonants that can open a syllable on their own; a vowel at the
  // start means a zero initial.
  return 'bpmfdtnlgkhjqxrzcsyw'.includes(first) ? first : '';
}

/**
 * The final of a syllable: 「zhōng」 → 「ong」, 「ài」 → 「ai」.
 *
 * @param syllable written pinyin.
 */
export function finalOf(syllable: string): string {
  const plain = plainSyllable(syllable);
  return plain.slice(initialOf(syllable).length);
}

/**
 * Score one verdict.
 *
 * @param verdict the verdict for a character.
 */
export function scoreOf(verdicts: readonly Verdict[]): number {
  if (verdicts.length === 0) return 0;
  let total = 0;
  for (const verdict of verdicts) {
    switch (verdict) {
      case 'exact':
        total += SCORE_EXACT;
        break;
      case 'tone':
        total += SCORE_TONE;
        break;
      case 'similar':
        total += SCORE_SIMILAR;
        break;
      case 'wrong':
        total += SCORE_WRONG;
        break;
      case 'missing':
        total += SCORE_MISSING;
        break;
    }
  }
  return Math.round(total / verdicts.length);
}

/**
 * Compare one spoken character with its target.
 *
 * @param target the character expected.
 * @param spoken what the recogniser heard, or null when nothing was heard.
 */
function compareOne(target: CharReading, spoken: CharReading | null): Verdict {
  if (spoken === null) return 'missing';
  if (spoken.char === target.char) {
    const targetTone = toneOf(target.pinyin);
    const spokenTone = toneOf(spoken.pinyin);
    // A recogniser that drops the mark cannot be judged on tone.
    if (targetTone === 0 || spokenTone === 0) return 'exact';
    return targetTone === spokenTone ? 'exact' : 'tone';
  }
  // A different character: compare the syllables themselves. A recogniser
  // that hears the wrong tone usually prints the character with that tone
  // (学 heard as 雪), so this branch is where a tone mistake actually lands.
  const targetPlain = plainSyllable(target.pinyin);
  const spokenPlain = plainSyllable(spoken.pinyin);
  if (targetPlain !== '' && targetPlain === spokenPlain) return 'tone';
  if (targetPlain !== '' && spokenPlain !== '') {
    const sameFinal = finalOf(target.pinyin) === finalOf(spoken.pinyin);
    const sameInitial = initialOf(target.pinyin) === initialOf(spoken.pinyin);
    if (sameFinal || sameInitial) return 'similar';
  }
  return 'wrong';
}

/**
 * Compare what the learner said with what the word expects.
 *
 * Character by character, position by position. Speaking MORE than the
 * target is ignored past the end (the recogniser padded a sentence); speaking
 * LESS leaves the remaining characters 「missing」, which is what a learner
 * who stopped halfway did.
 *
 * @param target the word's characters and readings.
 * @param spoken what the recogniser heard.
 * @returns the verdicts, the score and the advice.
 */
export function compareReadings(
  target: readonly CharReading[],
  spoken: readonly CharReading[],
): Comparison {
  if (target.length === 0) return { verdicts: [], score: 0, advice: 'nothing' };
  if (spoken.length === 0) {
    return { verdicts: target.map(() => 'missing'), score: 0, advice: 'nothing' };
  }

  const verdicts: Verdict[] = target.map((entry, index) =>
    compareOne(entry, spoken[index] ?? null),
  );
  const score = scoreOf(verdicts);

  let advice: Advice;
  if (verdicts.every((verdict) => verdict === 'exact')) advice = 'perfect';
  else if (verdicts.some((verdict) => verdict === 'tone')) advice = 'tones';
  else advice = 'sounds';

  return { verdicts, score, advice };
}

/** The best window of the spoken text for a target word. */
export interface Alignment {
  /** The spoken characters used for the comparison. */
  spoken: CharReading[];
  /** Where in the spoken text that window starts. */
  offset: number;
  /** The comparison of that window. */
  comparison: Comparison;
}

/**
 * Find the best-matching window of a longer utterance.
 *
 * A learner practising 「学生」 may say 「我是学生」 — the recogniser returns
 * four characters, and comparing the first two (「我是」) would fail a
 * learner who said the word perfectly. So every contiguous window of the
 * target's length is scored and the best one wins.
 *
 * When the utterance is shorter than the target there is only one window: the
 * whole utterance, and the missing characters are reported as missing.
 *
 * @param target the word's characters and readings.
 * @param spoken what the recogniser heard.
 * @returns the best window and its comparison, or null for an empty target.
 */
export function bestAlignment(
  target: readonly CharReading[],
  spoken: readonly CharReading[],
): Alignment | null {
  if (target.length === 0) return null;
  if (spoken.length <= target.length) {
    return { spoken: [...spoken], offset: 0, comparison: compareReadings(target, spoken) };
  }

  let best: Alignment | null = null;
  for (let offset = 0; offset <= spoken.length - target.length; offset += 1) {
    const window = spoken.slice(offset, offset + target.length);
    const comparison = compareReadings(target, window);
    // Highest score wins; ties go to the earlier window, which is the
    // learner's own sentence order (they rarely lead with the target).
    if (best === null || comparison.score > best.comparison.score) {
      best = { spoken: window, offset, comparison };
    }
  }
  return best;
}
