/**
 * verify-quest-numbers — re-derives every measured number in the /game quest
 * design spec (docs/superpowers/specs/2026-10-24-game-quest-redesign-design.md).
 *
 * Run it from the repo root:  node scripts/verify-quest-numbers.mjs
 *
 * Data sources (no DB required):
 *   data/hsk-vocab.json    — the HSK tier membership (same source as chars.hsk_level)
 *   data/content/<char>.json — dict.meaning_zh, dict.pinyin_alt
 *   data/radicals.json     — the char → radical map (a proxy for chars.radical; the
 *                            six tier radical pools it produces are identical to the
 *                            DB's, which is the cross-check that makes the proxy safe)
 *   pinyin-pro              — the readings
 *
 * Every rule implemented here is the spec's rule. If a number here disagrees with
 * the spec, the spec is wrong (or the data changed) — fix the spec, not the script.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';

const hskVocab = JSON.parse(readFileSync('data/hsk-vocab.json', 'utf8'));
const radicalMap = JSON.parse(readFileSync('data/radicals.json', 'utf8'));
const TIERS = [1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------- tone tables
// Mirrors lib/pinyin-tone.ts (TONE_MAP: 24 marks, no syllabic nasals).
const PLAIN_OF = {
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
};
const TONE_OF = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};
const TONE_GROUP = ['ā', 'á', 'ǎ', 'à', 'ē', 'é', 'ě', 'è', 'ī', 'í', 'ǐ', 'ì',
  'ō', 'ó', 'ǒ', 'ò', 'ū', 'ú', 'ǔ', 'ù', 'ǖ', 'ǘ', 'ǚ', 'ǜ'];

/** The reading with its tone mark replaced by the plain vowel (ü preserved). */
function plainOf(reading) {
  for (let i = 0; i < reading.length; i++) {
    if (PLAIN_OF[reading[i]]) return reading.slice(0, i) + PLAIN_OF[reading[i]] + reading.slice(i + 1);
  }
  return reading;
}
function toneOf(reading) {
  for (const c of reading) if (TONE_OF[c]) return TONE_OF[c];
  return null;
}
const initialOf = (char) => pinyin(char, { pattern: 'initial' });
const finalOf = (char) => pinyin(char, { pattern: 'final' });

/** The 4 tone forms of the char's syllable, or null when the final has no tone mark. */
function toneForms(char) {
  const final = finalOf(char);
  for (let i = 0; i < final.length; i++) {
    const plain = PLAIN_OF[final[i]];
    if (!plain) continue;
    const variants = TONE_GROUP.filter((m) => PLAIN_OF[m] === plain).map(
      (m) => final.slice(0, i) + m + final.slice(i + 1),
    );
    return variants.length === 4 ? variants : null;
  }
  return null;
}

// ------------------------------------------------------------------- content
const CLAUSE_SEP = /[，,、；;。:：\s]+/;
const contentCache = new Map();
function contentOf(char) {
  if (contentCache.has(char)) return contentCache.get(char);
  const path = join('data', 'content', `${char}.json`);
  const value = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  contentCache.set(char, value);
  return value;
}
const clausesOf = (text) =>
  String(text ?? '').split(CLAUSE_SEP).map((s) => s.trim()).filter(Boolean);
/** Do the two clauses share any 2-character substring? */
function shares2(a, b) {
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}

// --------------------------------------------------------------- per-char facts
function factsOf(char) {
  const content = contentOf(char);
  const meaning = content?.dict?.meaning_zh ?? '';
  const all = clausesOf(meaning);
  return {
    char,
    reading: pinyin(char, { toneType: 'symbol' }).trim(),
    plain: plainOf(pinyin(char, { toneType: 'symbol' }).trim()),
    tone: toneOf(pinyin(char, { toneType: 'symbol' }).trim()),
    radical: radicalMap[char] ?? '',
    firstClause: all[0] ?? null,
    freeClause: all.find((s) => !s.includes(char)) ?? null,
    alts: (content?.dict?.pinyin_alt ?? []).map((a) => plainOf(String(a).trim())),
    forms: toneForms(char),
  };
}

// ------------------------------------------------------------------ the sweep
/** Group by plain syllable, then read the groups column by column (§5.1.2). */
function sweep(eligible) {
  const groups = new Map();
  for (const f of eligible) {
    if (!groups.has(f.plain)) groups.set(f.plain, []);
    groups.get(f.plain).push(f);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [, group] of ordered) {
    group.sort((x, y) => (x.tone ?? 5) - (y.tone ?? 5) || (x.char < y.char ? -1 : 1));
  }
  const swept = [];
  const depth = Math.max(...ordered.map(([, group]) => group.length));
  for (let column = 0; column < depth; column++) {
    for (const [, group] of ordered) if (group[column]) swept.push(group[column]);
  }
  return swept;
}
/** How many pairs of chars in this list share a plain syllable? */
function sameSyllablePairs(list) {
  const counts = new Map();
  for (const f of list) counts.set(f.plain, (counts.get(f.plain) ?? 0) + 1);
  let pairs = 0;
  for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  return pairs;
}
const sliceIntoLevels = (list, size = 5) => {
  const levels = [];
  for (let i = 0; i < list.length; i += size) levels.push(list.slice(i, i + size));
  return levels;
};

// ------------------------------------------------------------------ the tiers
const tierFacts = new Map();
for (const tier of TIERS) {
  const chars = (hskVocab[String(tier)] ?? []).map((entry) => entry.char);
  tierFacts.set(tier, { chars, facts: chars.map(factsOf) });
}

/** The pools and the eligible set of one tier (§5.1.1). */
function buildTier(tier) {
  const { chars, facts } = tierFacts.get(tier);
  const syllablePool = [...new Set(facts.map((f) => f.plain))];
  const radicalPool = [...new Set(facts.map((f) => f.radical).filter(Boolean))];
  const clausePool = [...new Set(facts.map((f) => f.freeClause).filter(Boolean))];

  const eligible = [];
  const skipped = { tone: 0, meaning: 0, distractors: 0 };
  for (const f of facts) {
    // ② needs a tone 1-4 whose final decomposes into 4 tone forms
    if (!f.forms) { skipped.tone++; continue; }
    // ④ needs a first free clause of at least 2 chars
    if (!f.freeClause || f.freeClause.length < 2) { skipped.meaning++; continue; }
    const syllableOk = syllablePool.filter((s) => s !== f.plain && !f.alts.includes(s)).length >= 3;
    const radicalOk = radicalPool.filter((r) => r !== f.radical).length >= 3;
    const clauseOk = clausePool.filter(
      (q) => q !== f.freeClause && q.length >= 2 && !q.includes(f.char) && !shares2(f.freeClause, q),
    ).length >= 3;
    if (!syllableOk || !radicalOk || !clauseOk) { skipped.distractors++; continue; }
    eligible.push(f);
  }

  const swept = sweep(eligible);
  const levels = sliceIntoLevels(swept);
  const sorted = [...eligible].sort(
    (a, b) => (a.plain < b.plain ? -1 : a.plain > b.plain ? 1 : 0) ||
      (a.tone ?? 5) - (b.tone ?? 5) || (a.char < b.char ? -1 : 1),
  );
  const plainLevels = sliceIntoLevels(sorted);

  return {
    tier,
    tierSize: chars.length,
    eligible: eligible.length,
    skipped: skipped.tone + skipped.meaning + skipped.distractors,
    skippedDetail: skipped,
    syllablePool: syllablePool.length,
    radicalPool: radicalPool.length,
    clausePool: clausePool.length,
    levels: levels.length,
    plainSlicePairs: plainLevels.reduce((acc, l) => acc + sameSyllablePairs(l), 0),
    sweepPairs: levels.reduce((acc, l) => acc + sameSyllablePairs(l), 0),
    levelsWithPair: levels
      .map((level, i) => ({ level: i + 1, pairs: sameSyllablePairs(level) }))
      .filter((l) => l.pairs > 0),
    minRadicalsInFullLevel: Math.min(
      ...levels.filter((l) => l.length === 5).map((l) => new Set(l.map((f) => f.radical)).size),
    ),
    meanRadicals: (levels.reduce((acc, l) => acc + new Set(l.map((f) => f.radical)).size, 0) / levels.length).toFixed(2),
    tails: levels.map((l, i) => ({ level: i + 1, n: l.length })).filter((l) => l.n !== 5),
    eligibleFacts: eligible,
    swept,
  };
}

const tiers = TIERS.map(buildTier);

// ------------------------------------------------------------- ① the ranking
/** The initial / toneless final of every plain syllable in the tier. */
function syllableAnatomy(tier) {
  const anatomy = new Map();
  for (const f of tierFacts.get(tier).facts) {
    if (anatomy.has(f.plain)) continue;
    const final = finalOf(f.char);
    let toneless = final;
    for (let i = 0; i < final.length; i++) {
      if (PLAIN_OF[final[i]]) {
        toneless = final.slice(0, i) + PLAIN_OF[final[i]] + final.slice(i + 1);
        break;
      }
    }
    anatomy.set(f.plain, { initial: initialOf(f.char), final: toneless });
  }
  return anatomy;
}
/**
 * ①'s ranking score. A 零声母 syllable never scores "same initial" —
 * not even against another 零声母 syllable (spec §1.1 G).
 */
function rankPinyin(candidate, correct, anatomy) {
  const cand = anatomy.get(candidate);
  const corr = anatomy.get(correct);
  if (!cand || !corr) return 0;
  let score = 0;
  if (corr.initial !== '' && cand.initial === corr.initial) score += 3;
  if (cand.final === corr.final) score += 2;
  return score;
}
function pinyinDistractors(fact, tier) {
  const anatomy = syllableAnatomy(tier);
  const pool = [...anatomy.keys()];
  return pool
    .filter((s) => s !== fact.plain && !fact.alts.includes(s))
    .map((s) => ({ s, score: rankPinyin(s, fact.plain, anatomy) }))
    .sort((a, b) => b.score - a.score || (a.s < b.s ? -1 : 1))
    .slice(0, 3)
    .map((r) => r.s);
}

// ------------------------------------------------------------------ the PRNG
/** The spec's seed (§5.4). */
function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
/** The repaired PRNG (§5.4) — the one that replaces lib/shuffle.ts. */
function seededShuffle(items, seed) {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = (state >>> 16) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const buildOptions = (input, seed) => {
  const options = seededShuffle(input, seed);
  return { options, answerIndex: options.indexOf(input[0]) };
};

// -------------------------------------------------------------------- output
console.log('=== per tier ===');
for (const t of tiers) {
  console.log(
    `HSK${t.tier}: tier=${t.tierSize} eligible=${t.eligible} skipped=${t.skipped} ` +
      `(tone=${t.skippedDetail.tone} meaning=${t.skippedDetail.meaning} distractors=${t.skippedDetail.distractors}) ` +
      `pools(syl/rad/clause)=${t.syllablePool}/${t.radicalPool}/${t.clausePool} ` +
      `levels=${t.levels} plainSlicePairs=${t.plainSlicePairs} sweepPairs=${t.sweepPairs} ` +
      `levelsWithPair=${t.levelsWithPair.length} minRadicals(full)=${t.minRadicalsInFullLevel} ` +
      `meanRadicals=${t.meanRadicals} tails=${JSON.stringify(t.tails)}`,
  );
}
const total = (key) => tiers.reduce((acc, t) => acc + t[key], 0);
console.log(
  `TOTAL eligible=${total('eligible')} skipped=${total('skipped')} levels=${total('levels')} ` +
    `plainSlicePairs=${total('plainSlicePairs')} sweepPairs=${total('sweepPairs')}`,
);

console.log('\n=== ① distractor quality (零声母 never counts as same initial) ===');
{
  let withSameInitial = 0;
  let toneBearing = 0;
  let zeroInitial = 0;
  for (const tier of TIERS) {
    const anatomy = syllableAnatomy(tier);
    for (const f of tierFacts.get(tier).facts) {
      if (!f.forms) continue;
      toneBearing++;
      if ((anatomy.get(f.plain)?.initial ?? '') === '') zeroInitial++;
      const pool = [...anatomy.keys()]
        .filter((s) => s !== f.plain && !f.alts.includes(s))
        .map((s) => ({ s, score: rankPinyin(s, f.plain, anatomy) }))
        .sort((a, b) => b.score - a.score || (a.s < b.s ? -1 : 1));
      if (pool.slice(0, 3).some((r) => r.score >= 3)) withSameInitial++;
    }
  }
  console.log(`top-3 contains a same-initial distractor: ${withSameInitial} / ${toneBearing}; 零声母 chars: ${zeroInitial}`);
}

console.log('\n=== ④ meaning-clause split ===');
{
  let noFreeClause = 0;
  let oneCharFreeClause = 0;
  let firstClauseHasChar = 0;
  for (const tier of TIERS) {
    for (const f of tierFacts.get(tier).facts) {
      if (f.firstClause && f.firstClause.includes(f.char)) firstClauseHasChar++;
      if (!f.freeClause) noFreeClause++;
      else if (f.freeClause.length < 2) oneCharFreeClause++;
    }
  }
  console.log(
    `no free clause at all: ${noFreeClause}; first free clause is 1 char: ${oneCharFreeClause}; ` +
      `first clause contains the char: ${firstClauseHasChar}`,
  );
}

console.log('\n=== ③ radical distractors (the tier vocabulary) ===');
{
  const t1 = tierFacts.get(1).facts;
  const vocabulary = [...new Set(t1.map((f) => f.radical).filter(Boolean))]
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  for (const radical of ['爪', '木']) {
    const near = vocabulary
      .filter((r) => r !== radical)
      .map((r) => ({ r, d: Math.abs(r.codePointAt(0) - radical.codePointAt(0)) }))
      .sort((a, b) => a.d - b.d || (a.r < b.r ? -1 : 1));
    console.log(`${radical}: ${near.slice(0, 4).map((x) => `${x.r}(Δ${x.d})`).join(' ')}`);
  }
}

console.log('\n=== the §6.1 payload: HSK 1, level 1 ===');
{
  const t1 = tiers[0];
  console.log(`level 1 chars: ${t1.swept.slice(0, 5).map((f) => `${f.char} ${f.reading}`).join(', ')}`);
  const anatomy = syllableAnatomy(1);
  const vocabulary = [...new Set(tierFacts.get(1).facts.map((f) => f.radical).filter(Boolean))]
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const clausePool = [...new Set(tierFacts.get(1).facts.map((f) => f.freeClause).filter(Boolean))];

  for (const fact of t1.swept.slice(0, 1)) {
    const seedOf = (kind) => fnv1a32(`1:1:${fact.char}:${kind}`);

    const pinyinSeed = seedOf('pinyin');
    const pinyinOptions = buildOptions(
      [fact.plain, ...pinyinDistractors(fact, 1)], pinyinSeed,
    );

    const toneSeed = seedOf('tone');
    const toneOptions = seededShuffle(fact.forms, toneSeed);
    toneOptions.answerIndex = toneOptions.indexOf(fact.reading);

    const radicalSeed = seedOf('radical');
    const radicalDistractors = vocabulary
      .filter((r) => r !== fact.radical)
      .map((r) => ({ r, d: Math.abs(r.codePointAt(0) - fact.radical.codePointAt(0)) }))
      .sort((a, b) => a.d - b.d || (a.r < b.r ? -1 : 1))
      .slice(0, 3)
      .map((x) => x.r);
    const radicalOptions = buildOptions([fact.radical, ...radicalDistractors], radicalSeed);

    const meaningSeed = seedOf('meaning');
    const candidates = clausePool.filter(
      (q) => q !== fact.freeClause && q.length >= 2 && !q.includes(fact.char) && !shares2(fact.freeClause, q),
    );
    const drawn = seededShuffle(candidates, meaningSeed).slice(0, 3);
    const meaningOptions = buildOptions([fact.freeClause, ...drawn], meaningSeed);

    console.log(`char ${fact.char} ${fact.reading} radical ${fact.radical}`);
    console.log(`  ① ${JSON.stringify(pinyinOptions)}  seed=${pinyinSeed}`);
    console.log(`  ② ${JSON.stringify({ options: toneOptions, answerIndex: toneOptions.answerIndex })}  seed=${toneSeed}`);
    console.log(`  ③ ${JSON.stringify(radicalOptions)}  seed=${radicalSeed}`);
    console.log(`  ④ ${JSON.stringify(meaningOptions)}  seed=${meaningSeed}`);
  }
}

console.log('\n=== content-file read cost per tier (cold) ===');
for (const tier of TIERS) {
  const chars = tierFacts.get(tier).chars;
  contentCache.clear();
  const started = process.hrtime.bigint();
  for (const c of chars) contentOf(c);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`tier ${tier}: ${chars.length} files, ${ms.toFixed(1)} ms`);
}
