/**
 * The pure quest level + question builder.
 *
 * It turns a tier's raw per-char facts into the eligible pool, the
 * syllable-swept level ladder and the four option sets. Pure by design: no
 * database, no filesystem — only pinyin-pro, the seeded shuffle and the tone
 * table. The data layer owns the I/O; this module owns the rules.
 *
 * The rules are the spec's rules (docs/superpowers/specs/
 * 2026-10-24-game-quest-redesign-design.md §5.1 - §5.4 and §6.1). If a number
 * here disagrees with the spec, the spec is wrong — not this module.
 */
import { pinyin } from 'pinyin-pro';
import { seededShuffle } from '@/lib/shuffle';
import { TONE_MAP, toneFromPinyin } from '@/lib/pinyin-tone';
import type {
  QuestCharFact,
  QuestCharPayload,
  QuestLevelPayload,
  QuestQuestion,
  QuestQuestionKind,
  QuestSyllable,
  QuestTier,
} from './game-quest-types';

// --------------------------------------------------------------- tone tables
// The 24 tone marks live in exactly one place: lib/pinyin-tone.ts. Every
// plain form and every tone group below is derived from that table, so a new
// mark can never be added in one copy and forgotten in the other.

/** The combining diaeresis (U+0308) and the plain vowel it belongs to (U+00FC). */
const DIAERESIS = String.fromCharCode(0x308);
const PLAIN_U_UMLAUT = String.fromCharCode(0xfc);

/** The plain vowel of a tone mark: ā → 'a', ǖ → 'ü'. */
function plainVowelOf(mark: string): string {
  const decomposed = mark.normalize('NFD');
  // The diaeresis (U+0308) is what makes ǖ / ǘ / ǚ / ǜ a 'ü' group.
  if (decomposed.includes(DIAERESIS)) return PLAIN_U_UMLAUT;
  return decomposed[0] ?? '';
}

/** mark → plain vowel, for all 24 marks. */
const PLAIN_OF = new Map<string, string>();
/** plain vowel → its 4 marks, ordered by tone (1 → 4). */
const TONE_GROUP_OF = new Map<string, string[]>();
for (const mark of Object.keys(TONE_MAP)) {
  const plain = plainVowelOf(mark);
  PLAIN_OF.set(mark, plain);
  const group = TONE_GROUP_OF.get(plain) ?? [];
  group.push(mark);
  TONE_GROUP_OF.set(plain, group);
}
for (const [plain, group] of TONE_GROUP_OF) {
  group.sort((a, b) => TONE_MAP[a]! - TONE_MAP[b]!);
  TONE_GROUP_OF.set(plain, group);
}

/** The reading with its tone mark replaced by the plain vowel (ü preserved). */
export function plainSyllable(reading: string): string {
  for (let i = 0; i < reading.length; i++) {
    const plain = PLAIN_OF.get(reading[i]!);
    if (plain !== undefined) return reading.slice(0, i) + plain + reading.slice(i + 1);
  }
  return reading;
}

/** The toneless final of a char's syllable: 略 → 'üe', 绿 → 'ü'. */
function tonelessFinal(char: string): string {
  const final = pinyin(char, { pattern: 'final' });
  for (let i = 0; i < final.length; i++) {
    const plain = PLAIN_OF.get(final[i]!);
    if (plain !== undefined) return final.slice(0, i) + plain + final.slice(i + 1);
  }
  return final;
}

/**
 * The 4 tone forms of the char's syllable, or null when its final carries no
 * tone mark (轻声 and 嗯, whose ǹ is deliberately not a tone mark).
 */
export function toneFormsOf(char: string): string[] | null {
  const final = pinyin(char, { pattern: 'final' });
  for (let i = 0; i < final.length; i++) {
    const mark = final[i]!;
    if (!Object.hasOwn(TONE_MAP, mark)) continue;
    const group = TONE_GROUP_OF.get(PLAIN_OF.get(mark) ?? '');
    if (!group || group.length !== 4) return null;
    const initial = pinyin(char, { pattern: 'initial' });
    return group.map((m) => initial + final.slice(0, i) + m + final.slice(i + 1));
  }
  return null;
}

// ------------------------------------------------------------------ clauses
const CLAUSE_SEP = /[，,、；;。:：\s]+/;

/** The meaning phrase split into its clauses. */
export function splitClauses(meaningZh: string): string[] {
  return meaningZh
    .split(CLAUSE_SEP)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** The first clause that does not contain the char itself. */
export function firstFreeClause(meaningZh: string, char: string): string | null {
  return splitClauses(meaningZh).find((clause) => !clause.includes(char)) ?? null;
}

/** Do the two clauses share any 2-character substring? */
function shares2(a: string, b: string): boolean {
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}

// --------------------------------------------------------------------- seed
/** FNV-1a, 32 bit — the spec's hash. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The seed of one question: the same question always shuffles the same way. */
export function questSeed(
  hsk: number,
  level: number,
  char: string,
  kind: QuestQuestionKind,
): number {
  return fnv1a32(`${hsk}:${level}:${char}:${kind}`);
}

// ------------------------------------------------------------- the tier pools
interface TierPools {
  syllables: QuestSyllable[];
  radicals: string[];
  clauses: string[];
}

/** The tier's plain-syllable vocabulary, sorted alphabetically. */
function buildSyllableVocabulary(facts: QuestCharFact[]): QuestSyllable[] {
  const byPlain = new Map<string, QuestSyllable>();
  for (const fact of facts) {
    const plain = plainSyllable(fact.reading);
    if (byPlain.has(plain)) continue;
    byPlain.set(plain, {
      syllable: plain,
      initial: pinyin(fact.char, { pattern: 'initial' }),
      final: tonelessFinal(fact.char),
    });
  }
  return [...byPlain.values()].sort((a, b) => compare(a.syllable, b.syllable));
}

/** The tier's radical vocabulary, sorted by code point. */
function buildRadicalVocabulary(facts: QuestCharFact[]): string[] {
  const unique = new Set<string>();
  for (const fact of facts) if (fact.radical) unique.add(fact.radical);
  return [...unique].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}

/** The tier's meaning-clause pool, in the tier's row order. */
function buildClausePool(facts: QuestCharFact[]): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const fact of facts) {
    const clause = firstFreeClause(fact.meaningZh, fact.char);
    if (!clause || clause.length < 2 || seen.has(clause)) continue;
    seen.add(clause);
    pool.push(clause);
  }
  return pool;
}

// ------------------------------------------------------------------ filters
/** ①'s survival filter: may this plain syllable be a distractor? */
function survivesPinyinFilters(
  candidate: string,
  fact: QuestCharFact,
  correctPlain: string,
): boolean {
  if (candidate === correctPlain) return false;
  return !fact.pinyinAlt.some((alt) => plainSyllable(alt) === candidate);
}

/** ④'s survival filter: may this clause be a distractor? */
function survivesMeaningFilters(
  candidate: string,
  correct: string,
  char: string,
): boolean {
  return (
    candidate !== correct &&
    !candidate.includes(char) &&
    candidate.length >= 2 &&
    !shares2(correct, candidate)
  );
}

// ------------------------------------------------------------- the eligibility
/** A char is eligible when all four question kinds can be built for it. */
function isEligible(fact: QuestCharFact, pools: TierPools): boolean {
  // ③ needs a radical and 3 other radicals to choose from.
  if (!fact.radical) return false;
  if (pools.radicals.filter((r) => r !== fact.radical).length < 3) return false;
  // ② needs a tone 1-4 whose final decomposes into 4 tone forms.
  if (!toneFormsOf(fact.char)) return false;
  // ④ needs a first free clause of at least 2 chars and 3 usable clauses.
  const correctClause = firstFreeClause(fact.meaningZh, fact.char);
  if (!correctClause || correctClause.length < 2) return false;
  const clausesOk = pools.clauses.filter((c) =>
    survivesMeaningFilters(c, correctClause, fact.char),
  );
  if (clausesOk.length < 3) return false;
  // ① needs 3 usable plain syllables.
  const correctPlain = plainSyllable(fact.reading);
  const syllablesOk = pools.syllables.filter((s) =>
    survivesPinyinFilters(s.syllable, fact, correctPlain),
  );
  if (syllablesOk.length < 3) return false;
  // The alternates must be known, even when there are none.
  return Array.isArray(fact.pinyinAlt);
}

// ----------------------------------------------------------------- the sweep
/** Compare two strings by code unit — the spec's alphabetical order. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The tone of a reading; 5 for a reading without a tone mark. */
function toneOf(fact: QuestCharFact): number {
  return toneFromPinyin(fact.reading) ?? 5;
}

/** Group by plain syllable, then read the groups column by column (§5.1.2). */
function sweep(eligible: QuestCharFact[]): QuestCharFact[] {
  const groups = new Map<string, QuestCharFact[]>();
  for (const fact of eligible) {
    const plain = plainSyllable(fact.reading);
    const group = groups.get(plain);
    if (group) group.push(fact);
    else groups.set(plain, [fact]);
  }
  const ordered = [...groups.entries()].sort((a, b) => compare(a[0], b[0]));
  for (const [, group] of ordered) {
    group.sort((x, y) => toneOf(x) - toneOf(y) || compare(x.char, y.char));
  }
  const swept: QuestCharFact[] = [];
  const depth = Math.max(...ordered.map(([, group]) => group.length));
  for (let column = 0; column < depth; column++) {
    for (const [, group] of ordered) {
      const fact = group[column];
      if (fact) swept.push(fact);
    }
  }
  return swept;
}

/** Slice the swept sequence into levels of 5 (the last one may be short). */
function sliceIntoLevels(list: QuestCharFact[], size = 5): QuestCharFact[][] {
  const levels: QuestCharFact[][] = [];
  for (let i = 0; i < list.length; i += size) levels.push(list.slice(i, i + size));
  return levels;
}

/** The pools, the eligible pool and the level ladder of one tier. */
export function buildTier(tier: number, facts: QuestCharFact[]): QuestTier {
  const pools: TierPools = {
    syllables: buildSyllableVocabulary(facts),
    radicals: buildRadicalVocabulary(facts),
    clauses: buildClausePool(facts),
  };
  const eligible = facts.filter((fact) => isEligible(fact, pools));
  return {
    tier,
    tierSize: facts.length,
    skipped: facts.length - eligible.length,
    levels: sliceIntoLevels(sweep(eligible)),
    syllables: pools.syllables,
    radicals: pools.radicals,
    clauses: pools.clauses,
  };
}

// ------------------------------------------------------------ the 4 questions
/** ①'s ranking score. A 零声母 syllable never scores "same initial". */
function rankPinyin(candidate: QuestSyllable, correct: QuestSyllable): number {
  let score = 0;
  if (correct.initial !== '' && candidate.initial === correct.initial) score += 3;
  if (candidate.final === correct.final) score += 2;
  return score;
}

/** ① 读音 — the 3 best distractors, best score first, then alphabetical. */
function pinyinDistractors(
  tier: QuestTier,
  fact: QuestCharFact,
  correct: QuestSyllable,
): string[] {
  return tier.syllables
    .filter((s) => survivesPinyinFilters(s.syllable, fact, correct.syllable))
    .map((s) => ({ s, score: rankPinyin(s, correct) }))
    .sort((a, b) => b.score - a.score || compare(a.s.syllable, b.s.syllable))
    .slice(0, 3)
    .map((r) => r.s.syllable);
}

function pinyinQuestion(tier: QuestTier, fact: QuestCharFact, level: number): QuestQuestion {
  const correctPlain = plainSyllable(fact.reading);
  const correct = tier.syllables.find((s) => s.syllable === correctPlain);
  if (!correct) throw new Error(`no syllable entry for ${fact.char} (${correctPlain})`);
  const input = [correctPlain, ...pinyinDistractors(tier, fact, correct)];
  const options = seededShuffle(input, questSeed(tier.tier, level, fact.char, 'pinyin'));
  return { kind: 'pinyin', options, answerIndex: options.indexOf(correctPlain) };
}

function toneQuestion(tier: QuestTier, fact: QuestCharFact, level: number): QuestQuestion {
  const forms = toneFormsOf(fact.char);
  if (!forms) throw new Error(`no tone forms for ${fact.char}`);
  const options = seededShuffle(forms, questSeed(tier.tier, level, fact.char, 'tone'));
  return { kind: 'tone', options, answerIndex: options.indexOf(fact.reading) };
}

/** ③ 部首 — the 3 nearest radicals of the tier vocabulary. */
function radicalQuestion(tier: QuestTier, fact: QuestCharFact, level: number): QuestQuestion {
  const correct = fact.radical;
  const distractors = tier.radicals
    .filter((r) => r !== correct)
    .map((r) => ({ r, d: Math.abs(r.codePointAt(0)! - correct.codePointAt(0)!) }))
    .sort((a, b) => a.d - b.d || compare(a.r, b.r))
    .slice(0, 3)
    .map((x) => x.r);
  const input = [correct, ...distractors];
  const options = seededShuffle(input, questSeed(tier.tier, level, fact.char, 'radical'));
  return { kind: 'radical', options, answerIndex: options.indexOf(correct) };
}

/** ④ 词义 — the only kind whose distractor selection is seeded. */
function meaningQuestion(tier: QuestTier, fact: QuestCharFact, level: number): QuestQuestion {
  const correct = firstFreeClause(fact.meaningZh, fact.char);
  if (!correct) throw new Error(`no free clause for ${fact.char}`);
  const seed = questSeed(tier.tier, level, fact.char, 'meaning');
  const candidates = tier.clauses.filter((c) =>
    survivesMeaningFilters(c, correct, fact.char),
  );
  const drawn = seededShuffle(candidates, seed).slice(0, 3);
  const input = [correct, ...drawn];
  const options = seededShuffle(input, seed);
  return { kind: 'meaning', options, answerIndex: options.indexOf(correct) };
}

// ---------------------------------------------------------------- the payload
const TONE_NAMES = ['阴平', '阳平', '上声', '去声'] as const;

function buildCharPayload(
  tier: QuestTier,
  fact: QuestCharFact,
  level: number,
): QuestCharPayload {
  const tone = toneFromPinyin(fact.reading);
  if (tone === null) throw new Error(`no tone in reading ${fact.reading} of ${fact.char}`);
  const meaningShort = firstFreeClause(fact.meaningZh, fact.char);
  if (meaningShort === null) throw new Error(`no free meaning clause for ${fact.char}`);
  return {
    char: fact.char,
    pinyin: fact.reading,
    plainPinyin: plainSyllable(fact.reading),
    tone,
    toneName: TONE_NAMES[tone - 1]!,
    radical: fact.radical,
    meaningZh: fact.meaningZh,
    meaningShort,
    hasStory: fact.hasStory,
    questions: [
      pinyinQuestion(tier, fact, level),
      toneQuestion(tier, fact, level),
      radicalQuestion(tier, fact, level),
      meaningQuestion(tier, fact, level),
    ],
  };
}

/** One level of the ladder as the API returns it. `level` is 1-based. */
export function buildLevel(tier: QuestTier, level: number): QuestLevelPayload | null {
  if (!Number.isInteger(level) || level < 1 || level > tier.levels.length) return null;
  const facts = tier.levels[level - 1]!;
  return {
    hsk: tier.tier,
    level,
    levelCount: tier.levels.length,
    tierSize: tier.tierSize,
    skipped: tier.skipped,
    chars: facts.map((fact) => buildCharPayload(tier, fact, level)),
  };
}
