# /game 闯关重设计 (Quest Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-tab mini-game board at `/game` with a 一字一关 quest ladder (5 chars per level, 4 fixed questions per char — 读音 / 声调 / 部首 / 词义) plus a learning loop that carries every mastered char into the site's dictionary / etymology / story / worksheet pages.

**Architecture:** The quest is split into three layers so each is testable on its own. `lib/game-quest.ts` holds **pure** builders (no DB, no fs — only `pinyin-pro`) that turn plain per-char facts into the level ladder and the four option sets. `lib/game-quest-data.ts` is the thin server-only data layer (one SQL query per tier + `data/content/*.json` reads) that owns the per-tier memo and hands the pure module plain data. `app/api/game/quest/route.ts` is a thin adapter over the two. The client keeps progress in `localStorage` and never re-derives the ladder.

**Tech Stack:** Next.js 15.5 App Router, React 19, TypeScript 5.6 strict, Tailwind v4 (`@theme` in `app/globals.css`), `pinyin-pro` 3.25, `mysql2/promise`, vitest 2.1 (`environment: 'node'` by default; component tests opt into `// @vitest-environment happy-dom`).

**Spec:** `docs/superpowers/specs/2026-10-24-game-quest-redesign-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- **npm only**; installs use `--legacy-peer-deps`; **no new dependency** for this feature.
- Branch `perf/frontend-scan-2026-10-24`. **No push.** No production operations.
- Tailwind v4 reads **only** the `@theme` block in `app/globals.css`. Available colour tokens: `paper` `#f4ecd8`, `paper-soft` `#fffaee`, `paper-deep` `#e8dcc0`, `paper-warm` `#ecdfc2`, `ink` `#3a2a14`, `ink-soft` `#5a4530`, `ink-faint` `#8b6f3a`, `seal` `#b22b2b`, `success` `#4a7c59`, `warning` `#c99a3e`, `danger` `#b22b2b`, `info` `#4f6b8c`. A class naming an undefined colour renders nothing.
- TypeScript strict — no `any` in exported interfaces; use `unknown` + narrowing.
- No `// TODO`, no ellipsis-as-code, no stub functions, no silent `catch {}` — every catch logs and degrades explicitly.
- Functions ≤ 50 lines; files 300-500 lines.
- UI copy in Chinese; code identifiers in English.
- Commit subjects end with `[YYYY-MM-DD HH.MM]` (substitute the real local time); commit bodies end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- `git add` **explicit paths only** — never `git add -A` (a concurrent session touches this tree).
- New API routes send `Cache-Control: no-store`.
- Middleware gates every route except `/init*` behind the `setup_completed=1` cookie — smoke-test with `curl -b "setup_completed=1"`. The quest route is 307-gated without it; that is the site's normal behaviour, not a quest bug.
- `app/**/page.tsx` changes require a successful `next build`, run in the **isolated worktree** `D:/Temp/pinyin-build-check` — never in the main tree while the 4444 dev server is alive.
- The tone-mark table has exactly **one** source of truth: `TONE_MAP` in `lib/pinyin-tone.ts` (24 marks, no `ǹ`/`ň`/`ḿ`). The quest derives its plain forms and tone groups from it; it never hard-codes a second copy.

## Review Focus

Five input classes the spec implies but no task's tests exercise — each is pinned by a test in the task that owns the code.

1. **A stale level pointer beyond the tier's level count** (`current[1].level = 999` after the content shrank, or a hand-edited localStorage). The board must clamp to the tier's last level, must not render an unreachable tile, and must not 500. → Task 8 (`QuestBoard`).
2. **A 生字本 with more than 500 chars.** `POST /api/worksheets` caps `content` at 500; the batch action must send only the first 500, must say 「本次生成前 500 字」, and the per-char 练字帖 links must keep working for the rest. → Task 8 (`WrongBook`).
3. **A collected char whose content files were later regenerated.** The 字卡册 renders from the stored snapshot with **no fetch** — it must not show an empty card, and it must not crash when the file is gone. → Task 4 (`lib/game-progress.ts`) + Task 8 (`CharCollection`).
4. **The daily key's three axes.** `tone:medium:hsk1`, `tone:medium:hsk2` and `tone:hard:hsk1` are three independent daily slots; completing one must not mark the other two, and switching the difficulty or the HSK tier must switch which slot a card shows. → Task 4 (`dailyKey`) + Task 9 (`DailyChallenge`).
5. **A wrong ① answer must not leak ②.** After ① is answered wrong, its correct option is revealed **in the question card** — but the char card must still hide the pinyin, because ②'s four options are the four tone forms of exactly that syllable. → Task 8 (`QuestRunner`).

---

### Task 1: Repair the seeded shuffle PRNG

**Files:**
- Modify: `lib/shuffle.ts:12-21` (`seededShuffle`)
- Test: `tests/unit/lib/shuffle.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `seededShuffle<T>(arr: T[], seed: number): T[]` — same signature as today, new implementation. It is the **only** PRNG the quest uses (`lib/shuffle.ts` also keeps `shuffle<T>(arr: T[]): T[]`, the unseeded variant, unchanged).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/shuffle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seededShuffle } from '@/lib/shuffle';

describe('seededShuffle — the §0 #8 PRNG repair', () => {
  it('spreads the answer across all four slots (regression: 99.9% in slot 3)', () => {
    const counts = [0, 0, 0, 0];
    for (let seed = 0; seed < 500; seed++) {
      const out = seededShuffle(['correct', 'w1', 'w2', 'w3'], seed);
      counts[out.indexOf('correct')]! += 1;
    }
    // Each slot ≥ 10% of the 500 combinations.
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(50);
  });

  it('is a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    const before = [...input];
    const out = seededShuffle(input, 42);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
    expect(input).toEqual(before);
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect(seededShuffle(input, 7)).toEqual(seededShuffle(input, 7));
    expect(seededShuffle(input, 7)).not.toEqual(seededShuffle(input, 8));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/shuffle.test.ts`
Expected: FAIL — the first test fails (`counts[3]` is ~500, the others ~0). The other two pass.

- [ ] **Step 3: Repair `seededShuffle` in `lib/shuffle.ts`**

Replace the body of `seededShuffle` with the exact implementation the spec pins (§5.4) — the 32-bit `Math.imul` LCG with the index taken from the **high** bits:

```ts
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 16) % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
```

Also update the file's header comment: the old note describes a different regression (a duplicated `a[j]`); add that the LCG's low bits have period 2, which is what collapsed the answer position.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/shuffle.test.ts tests/unit/lib/game-round.test.ts`
Expected: PASS — the new file green **and** the pre-existing `game-round.test.ts` seededShuffle assertions still green (they never depended on the old byte order).

- [ ] **Step 5: Commit**

```bash
git add lib/shuffle.ts tests/unit/lib/shuffle.test.ts
git commit -m "fix(game): repair the seeded shuffle PRNG [YYYY-MM-DD HH.MM]" -m "The LCG advanced with (s * 1103515245 + 12345) & 0x7fffffff. The product
exceeds 2^53, so float64 silently truncates the low bits, and the shuffle
index was taken from those low bits - which have period 2. Measured over
8952 char x kind combinations, the correct option landed in slot 3 for 99.9%
of them, so every seeded round had a fixed answer position.

Math.imul keeps the LCG exact in 32 bits and the index now comes from the
high bits. Measured over the same 8952 combinations: 25.6% / 25.2% / 24.8% /
24.3% across the four slots.

Standalone bug fix - independent of the quest redesign.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: The pure quest level + question builder

**Files:**
- Modify: `lib/pinyin-tone.ts:9` — `export const TONE_MAP` (one-word change)
- Create: `lib/game-quest-types.ts`
- Create: `lib/game-quest.ts`
- Create: `tests/unit/lib/fixtures/quest-tier1.json` (generated)
- Create: `tests/unit/lib/game-quest.test.ts`
- Modify: `scripts/verify-quest-numbers.mjs` — add a `--emit-tier1-fixture` flag

**Interfaces:**
- Consumes: `seededShuffle` from `@/lib/shuffle` (Task 1), `TONE_MAP` and `toneFromPinyin` from `@/lib/pinyin-tone`, `pinyin` from `pinyin-pro`.
- Produces (the contract every later task codes against):

```ts
// lib/game-quest-types.ts
export type QuestQuestionKind = 'pinyin' | 'tone' | 'radical' | 'meaning';

export interface QuestQuestion {
  kind: QuestQuestionKind;
  options: string[];
  answerIndex: number;
}

/** One char's raw facts, as the data layer resolved them. */
export interface QuestCharFact {
  char: string;
  /** Tone-marked reading, e.g. "ài". */
  reading: string;
  radical: string;
  /** The full `dict.meaning_zh` phrase (one string, not a list). */
  meaningZh: string;
  /** Alternate readings, tone-marked, e.g. ["bù", "fǒu"]. */
  pinyinAlt: string[];
  hasStory: boolean;
}

export interface QuestSyllable {
  syllable: string;
  /** '' for a 零声母 syllable. */
  initial: string;
  /** Toneless final. */
  final: string;
}

/** Everything the question builders need about one HSK tier. */
export interface QuestTier {
  tier: number;
  /** Rows in the tier, before eligibility filtering. */
  tierSize: number;
  /** Chars dropped from the eligible pool. */
  skipped: number;
  /** The eligible pool, swept and sliced into levels of 5. */
  levels: QuestCharFact[][];
  /** The tier's plain-syllable vocabulary, sorted alphabetically. */
  syllables: QuestSyllable[];
  /** The tier's radical vocabulary, sorted by code point. */
  radicals: string[];
  /** The tier's meaning-clause pool, in the tier's row order. */
  clauses: string[];
}

/** One char as the API returns it. */
export interface QuestCharPayload {
  char: string;
  pinyin: string;
  plainPinyin: string;
  tone: 1 | 2 | 3 | 4;
  toneName: string;
  radical: string;
  meaningZh: string;
  meaningShort: string;
  hasStory: boolean;
  questions: QuestQuestion[];
}

export interface QuestLevelPayload {
  hsk: number;
  level: number;
  levelCount: number;
  tierSize: number;
  skipped: number;
  chars: QuestCharPayload[];
}

// lib/game-quest.ts
export function fnv1a32(text: string): number;
export function plainSyllable(reading: string): string;          // ü preserved
export function toneFormsOf(char: string): string[] | null;      // 4 forms, or null
export function splitClauses(meaningZh: string): string[];
export function firstFreeClause(meaningZh: string, char: string): string | null;
export function questSeed(hsk: number, level: number, char: string, kind: QuestQuestionKind): number;
export function buildTier(tier: number, facts: QuestCharFact[]): QuestTier;
export function buildLevel(tier: QuestTier, level: number): QuestLevelPayload | null;
```

`lib/game-quest.ts` imports **only** `pinyin-pro` and `@/lib/shuffle` + `@/lib/pinyin-tone`. It must not import `@/lib/db`, `@/lib/content`, `@/lib/chars` or anything else that touches the DB or the filesystem.

- [ ] **Step 1: Export `TONE_MAP`**

In `lib/pinyin-tone.ts` change `const TONE_MAP: Record<string, Tone> = {` to `export const TONE_MAP: Record<string, Tone> = {`. Add a one-line comment saying the quest derives its plain forms and tone groups from this table so there is exactly one copy of the 24 marks.

- [ ] **Step 2: Add the fixture emitter to `scripts/verify-quest-numbers.mjs`**

Add a `--emit-tier1-fixture` flag. When present, the script writes the tier-1 facts to `tests/unit/lib/fixtures/quest-tier1.json` (creating the directory) in this shape — one object per tier-1 char, in `data/hsk-vocab.json` order:

```json
{
  "tier": 1,
  "tierSize": 178,
  "facts": [
    { "char": "爱", "reading": "ài", "radical": "爪", "meaningZh": "对人和事物有深厚真挚的感情", "pinyinAlt": ["ài"], "hasStory": true }
  ]
}
```

The fixture must contain **all 178** tier-1 chars (not only the eligible ones) — the clause pool and the syllable/radical vocabularies are built from the whole tier. `hasStory` is true when the char's content file carries `etymology.story`, `hanzi_story` or `rare.story`. The script's existing `factsOf()` already computes `reading`, `radical`, `meaningZh` and `pinyinAlt`; extend it with `hasStory`.

- [ ] **Step 3: Generate the fixture**

Run: `node scripts/verify-quest-numbers.mjs --emit-tier1-fixture`
Expected: it writes `tests/unit/lib/fixtures/quest-tier1.json` and still prints the same measurement report (eligible 152, levels 31, sweepPairs 21, and the §6.1 payload unchanged).

- [ ] **Step 4: Write the failing unit test**

Create `tests/unit/lib/game-quest.test.ts`. It imports the fixture with `import tier1 from './fixtures/quest-tier1.json'` (vitest resolves JSON imports natively) and builds the tier with `buildTier(tier1.tier, tier1.facts as QuestCharFact[])`.

The test file must cover, each as its own `it`:

- **the sweep order is syllable-alphabetical** — the first level's 5 chars are exactly `['爱', '八', '杯', '本', '不']` and their plain syllables are `['ai', 'ba', 'bei', 'ben', 'bu']` (alphabetical).
- **the same-syllable pairs stay near zero** — count the pairs inside each level of the real tier-1 fixture and assert `pairs <= 1` (the whole ladder's 21 pairs sit in tiers 3-6; tier 1 has **0**). The assertion is *near*-zero, not zero: 21 pairs in 6 levels survive by design across all tiers (§5.1.2), so a "distinct syllables" assertion would fail on the real ladder.
- **every full level has ≥ 3 distinct radicals** — for all 30 full levels of tier 1, `new Set(level.map(f => f.radical)).size >= 3`.
- **the short tail level is legal and reports its own size** — tier 1 level 31 has 2 chars.
- **the eligible pool size** — `buildTier(1, facts).levels.flat().length === 152` and `.skipped === 26`.
- **the level count** — `.levels.length === 31`.
- **读音 distractors never equal the correct plain syllable** — for every char in the tier, the ① options contain the plain syllable exactly once, and no other option equals it.
- **读音 distractors never equal a `pinyin_alt` plain form** — for 不 (`pinyin_alt` = `['bù','bú','fǒu','fōu','pī']`), the ① options contain none of `bu`, `fo`, `pi`.
- **the 零声母 rule** — 爱's ① top-3 distractors are exactly `['cai', 'kai', 'lai']`; `er` is never among them. (The rule: the same-initial +3 bonus applies only when the **correct** syllable has a non-empty initial.)
- **声调 options are the 4 tone forms of the syllable** — for 爱: `['āi','ái','ǎi','ài']`; the answer index points at `ài`.
- **the tone-form vectors** — `toneFormsOf` for 春/妈/绿/略/归/爱/长 gives exactly:
  - 春 → `['chūn','chún','chǔn','chùn']`
  - 妈 → `['mā','má','mǎ','mà']`
  - 绿 → `['lǖ','lǘ','lǚ','lǜ']`
  - 略 → `['lüē','lüé','lüě','lüè']`
  - 归 → `['guī','guí','guǐ','guì']`
  - 爱 → `['āi','ái','ǎi','ài']`
  - 长 → `['chāng','cháng','chǎng','chàng']`
- **a 轻声 char has no tone forms** — `toneFormsOf('的')` is `null`.
- **部首 distractors are the nearest code points of the tier's radical vocabulary** — for 爱 (爪 U+722A): the distractors are `['父','犬','玉']`; for 木 (U+6728) the third is `['月','日','欠']` — 斤 is **not** in tier 1's vocabulary.
- **词义: the correct option is the first free clause, ≥ 2 chars** — 爱's ④ correct option is `'对人和事物有深厚真挚的感情'`; a char whose first free clause is 1 char long is not in the pool.
- **词义 distractors share no 2-char substring with the correct clause** — for every char in the tier, no distractor shares a 2-character substring with the correct clause, and no distractor contains the quest char.
- **the §6.1 payload is a fixture** — for `(hsk 1, level 1, 爱)` the four option arrays and their `answerIndex` are exactly:

```ts
expect(questions[0]).toEqual({ kind: 'pinyin', options: ['cai', 'ai', 'kai', 'lai'], answerIndex: 1 });
expect(questions[1]).toEqual({ kind: 'tone', options: ['ài', 'ái', 'āi', 'ǎi'], answerIndex: 0 });
expect(questions[2]).toEqual({ kind: 'radical', options: ['父', '爪', '玉', '犬'], answerIndex: 1 });
expect(questions[3]).toEqual({ kind: 'meaning', options: ['被邀请或主动前来探访的人', '对人和事物有深厚真挚的感情', '光线强', '数量大'], answerIndex: 1 });
```

- **determinism** — `buildLevel(tier, 1)` called twice returns byte-identical JSON; `buildLevel(tier, 1)` and `buildLevel(tier, 2)` differ.
- **`buildLevel` returns null for an out-of-range level** — `buildLevel(tier, 0)` and `buildLevel(tier, 32)` are both `null`.

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/game-quest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/game-quest'`.

- [ ] **Step 6: Implement `lib/game-quest-types.ts` and `lib/game-quest.ts`**

`lib/game-quest-types.ts` holds exactly the type block quoted in the Interfaces section above.

`lib/game-quest.ts` implements, in this order:

**a. The tone-mark derivations** (all from `TONE_MAP`, never a second hard-coded copy):

- `plainVowelOf(mark)`: `mark.normalize('NFD')` → if the decomposed form contains `\u0308` (the diaeresis) the plain vowel is `'ü'`, otherwise it is the first code unit (`'a'`, `'e'`, `'i'`, `'o'`, `'u'`). So `ā → 'a'`, `ǖ → 'ü'`, `ǜ → 'ü'`, `ō → 'o'`.
- `PLAIN_OF`: mark → plain vowel, for all 24 marks.
- `TONE_GROUP_OF`: plain vowel → the 4 marks of that group, ordered by `TONE_MAP[mark]` (tone 1 → 4). So `'a' → ['ā','á','ǎ','à']` and `'ü' → ['ǖ','ǘ','ǚ','ǜ']`.

**b. `plainSyllable(reading)`** — replace the **first** code unit of `reading` that is a key of `PLAIN_OF` with its plain vowel; every other code unit is kept. `plainSyllable('ài') === 'ai'`, `plainSyllable('lǜ') === 'lü'` (ü preserved — this is **not** `lib/pinyin-index.ts`'s `stripTone`, which folds ü→u and would reorder the ladder).

**c. `toneFormsOf(char)`** — the spec's §5.3 algorithm, verbatim:
1. `final = pinyin(char, { pattern: 'final' })` — `pinyin-pro` already puts the tone mark on the right vowel (`chūn` → `ūn`, `lǜ` → `ǜ`, `lüè` → `üè`, `cháng` → `áng`, `guī` → `uī`);
2. find the **first** index **within the final** whose code unit is a key of `TONE_MAP`. The plain `ü` is **not** a key, so the final `üè` resolves at the `è` (final index 1) — the index is relative to the final, not to the full syllable;
3. if there is none → return `null` (this is what excludes the 12 轻声 chars and 嗯, whose `ǹ` is deliberately not in `TONE_MAP`);
4. `base` = `final` with that index replaced by the plain vowel (`üè` → `üe`; `ǜ` → `ü`);
5. the 4 variants = `base` with that same index replaced by each mark of `TONE_GROUP_OF[plainVowel]`, in tone order (`üe` → `üē üé üě üè`; `ü` → `ǖ ǘ ǚ ǜ`);
6. the full syllable = `initial + variant`, where `initial = pinyin(char, { pattern: 'initial' })` (empty for 零声母 syllables such as 爱).

**d. `splitClauses(meaningZh)`** — split on `/[，,、；;。:：\s]+/`, trim each part, drop the empty ones. (The spec writes the separator with a literal space; `\s` covers it and also newlines.)

**e. `firstFreeClause(meaningZh, char)`** — the first clause of `splitClauses(meaningZh)` that does **not** contain `char`; `null` when there is none. (The ≥ 2-char rule is applied by the eligibility filter and by the option builder, not here — the spec's `firstFreeClause` returns the first free clause whatever its length.)

**f. `fnv1a32(text)`** — `h = 0x811c9dc5`; for each code unit `h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0`; return `h >>> 0`.

**g. `questSeed(hsk, level, char, kind)`** — `fnv1a32(`${hsk}:${level}:${char}:${kind}`)`.

**h. `buildTier(tier, facts)`** — the spec's §5.1.1 + §5.1.2, in this order:

1. **The pools** (built from **all** the tier's facts, in the given order):
   - `syllables`: the distinct plain syllables of the tier's facts, sorted alphabetically. Each entry carries its `initial` and its toneless `final`, taken from the first fact that uses it.
   - `radicals`: the distinct non-empty radicals, sorted by code point (`a.codePointAt(0) - b.codePointAt(0)`).
   - `clauses`: for **every** fact, `firstFreeClause(fact.meaningZh, fact.char)`; keep the ones that are non-null and **≥ 2 chars**; dedupe, **preserving the tier's row order** (do not sort).
2. **The eligible pool** — a fact is eligible when all five hold:
   1. `fact.radical` is non-empty **and** the tier's radical vocabulary has ≥ 3 radicals other than it;
   2. `toneFormsOf(fact.char)` is non-null (excludes 轻声 + 嗯);
   3. `firstFreeClause(fact.meaningZh, fact.char)` exists, is ≥ 2 chars, **and** ≥ 3 clauses of the tier's `clauses` pool survive the ④ filters for this char (see step 3 below);
   4. ≥ 3 plain syllables of the tier's `syllables` survive the ① filters for this char (different plain syllable, and not the plain form of any of `fact.pinyinAlt`);
   5. `fact.pinyinAlt` exists (it is an array, possibly empty — the check is that the field is present).
3. **The ④ survival filters** (used by condition 3 and by the option builder): a clause survives when it is ≠ the correct clause, does not contain `fact.char`, is ≥ 2 chars, and shares **no 2-character substring** with the correct clause. The 2-character-substring test walks the correct clause's 2-grams and checks `candidate.includes(gram)`.
4. **The ① survival filters** (used by condition 4 and by the option builder): a syllable survives when its plain form ≠ the correct plain syllable and ≠ `plainSyllable(alt)` for any `alt` of `fact.pinyinAlt`.
5. **The sweep** (§5.1.2): group the eligible facts by plain syllable; the groups are in syllable-alphabetical order; within a group the facts are ordered by tone, then by char. Then read the groups **column by column** — the 1st fact of every group, then the 2nd of every group, and so on. Slice the swept sequence into levels of **5** (the last level may be short).
6. `tierSize` = `facts.length`; `skipped` = `facts.length - eligible.length`.

**i. `buildLevel(tier, level)`** — `level` is 1-based. Return `null` when `level < 1` or `level > tier.levels.length`. Otherwise, for each fact of `tier.levels[level - 1]`, build the four questions and assemble the payload:

- `pinyin` = `fact.reading`; `plainPinyin` = `plainSyllable(fact.reading)`; `tone` = `toneFromPinyin(fact.reading)`; `toneName` = `['阴平','阳平','上声','去声'][tone - 1]`.
- `meaningZh` = `fact.meaningZh`; `meaningShort` = the fact's first free clause (the ④ correct option).
- `hasStory` = `fact.hasStory`.
- **① 读音** — the candidate set is the tier's `syllables` filtered by the ① survival rules. Rank each candidate with `score = (correct.initial !== '' && candidate.initial === correct.initial ? 3 : 0) + (candidate.final === correct.final ? 2 : 0)`; sort by score descending, then by syllable ascending; take the first 3. The pre-shuffle input is `[correctPlain, ...the 3 distractors in rank order]`; the options are `seededShuffle(input, questSeed(hsk, level, char, 'pinyin'))` and `answerIndex` is `options.indexOf(correctPlain)`.
  - **The 零声母 rule** is exactly the `correct.initial !== ''` guard above: a 零声母 *correct* syllable never awards the same-initial bonus, so a 零声母 candidate can never be scored as "same initial" against it.
- **② 声调** — `toneFormsOf(char)` gives the 4 forms in tone order; the pre-shuffle input is those 4 in tone order; the options are `seededShuffle(input, questSeed(..., 'tone'))` and `answerIndex` is the index of `fact.reading`.
- **③ 部首** — the candidates are the tier's `radicals` except the correct one, ranked by `Math.abs(a.codePointAt(0) - correct.codePointAt(0))` ascending, ties broken by the radical string ascending; take the first 3. The pre-shuffle input is `[correctRadical, ...the 3 distractors]`; the options are `seededShuffle(input, questSeed(..., 'radical'))`.
- **④ 词义** — the candidates are the tier's `clauses` that survive the ④ filters. `seededShuffle(candidates, questSeed(..., 'meaning'))` and take the first 3 — **this is the one kind whose selection is seeded**. The pre-shuffle input is `[correctClause, ...the 3 drawn clauses]`; the options are `seededShuffle(input, questSeed(..., 'meaning'))` — the same seed drives both the draw and the permutation, exactly as §5.4 states.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/game-quest.test.ts`
Expected: PASS — every case green. The §6.1 payload case must match the spec byte-for-byte; if it does not, the **spec is wrong** or the pre-shuffle order drifted — do not "fix" the test to match the code.

- [ ] **Step 8: Run the whole suite to check nothing else broke**

Run: `npx vitest run`
Expected: all green. The `lib/pinyin-tone.ts` change is additive (an `export` keyword) and must not affect any existing test.

- [ ] **Step 9: Commit**

```bash
git add lib/pinyin-tone.ts lib/game-quest-types.ts lib/game-quest.ts \
  tests/unit/lib/game-quest.test.ts tests/unit/lib/fixtures/quest-tier1.json \
  scripts/verify-quest-numbers.mjs
git commit -m "feat(game): add the pure quest level + question builder [YYYY-MM-DD HH.MM]" -m "Pure module: no DB, no fs, only pinyin-pro. Turns plain per-char facts into the
tier's eligible pool, the syllable-swept level ladder and the four option
sets.

The sweep groups the eligible chars by plain syllable and reads the groups
column by column, which keeps same-syllable pairs at 21 across the whole
449-level ladder instead of 1390 for a plain 5-char slice.

The tone forms are derived from TONE_MAP in lib/pinyin-tone.ts, so the 24
tone marks have exactly one source of truth.

tests/unit/lib/fixtures/quest-tier1.json is a snapshot of the real tier-1
facts, generated by scripts/verify-quest-numbers.mjs --emit-tier1-fixture.
It pins the 6.1 payload byte-for-byte without needing a database.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: The quest level API

**Files:**
- Create: `lib/game-quest-data.ts`
- Create: `app/api/game/quest/route.ts`
- Modify: `lib/validators.ts` — add `questQuerySchema`
- Test: `tests/unit/app/api/game/quest.test.ts` (new)
- Test: `tests/integration/api/game-quest-db.test.ts` (new)

**Interfaces:**
- Consumes: `buildTier`, `buildLevel` and the types from `@/lib/game-quest` / `@/lib/game-quest-types` (Task 2); `resolvePinyin` from `@/lib/pinyin-index`; `readContentFromFs` from `@/lib/content`.
- Produces:

```ts
// lib/game-quest-data.ts
export async function getQuestTier(tier: number): Promise<QuestTier>;

// app/api/game/quest/route.ts
export async function GET(req: NextRequest): Promise<Response>;
```

The route's success body is `{ ok: true, data: QuestLevelPayload }` with the header `Cache-Control: no-store`; its error bodies are `{ ok: false, error: { code, message } }` with `400` (`bad_input`) and `404` (`level_not_found`).

- [ ] **Step 1: Add `questQuerySchema` to `lib/validators.ts`**

```ts
export const questQuerySchema = z.object({
  hsk: z.coerce.number().int().min(1).max(6),
  // The cap only rejects absurd input; a level beyond the tier's real
  // level count is a 404 from the route, not a 400. The largest tier has
  // 163 levels, so 1000 is comfortably above every real value.
  level: z.coerce.number().int().min(1).max(1000),
});
```

- [ ] **Step 2: Write the failing route test**

Create `tests/unit/app/api/game/quest.test.ts`. It **calls the handler directly** — it does not start a server (the convention of `tests/unit/app/api/ai/char-recognize.test.ts`). The data layer is mocked:

```ts
vi.mock('@/lib/game-quest-data', () => ({ getQuestTier: vi.fn() }));
```

The mock returns a hand-built `QuestTier` fixture with 2 levels of 5 facts, enough for the assertions below. The test then imports `{ GET }` from `@/app/api/game/quest/route` and calls `GET(new NextRequest('http://localhost/api/game/quest?hsk=1&level=1'))`.

Assert:
- **200** and `body.ok === true`;
- `body.data.hsk === 1`, `body.data.level === 1`, `body.data.levelCount === 2`, `body.data.tierSize` and `body.data.skipped` are present and consistent with the fixture;
- every char has **exactly 4** questions, each with **4** options and an `answerIndex` in `[0, 3]`;
- the response header `Cache-Control` is `no-store`;
- `?hsk=9` → **400** with `body.error.code === 'bad_input'`;
- `?level=0` → **400**;
- `?hsk=1&level=999` → **404** with `body.error.code === 'level_not_found'`;
- `?hsk=1` (no level) → **400**.

- [ ] **Step 3: Write the failing DB integration test**

Create `tests/integration/api/game-quest-db.test.ts`. It **skips itself** when `DATABASE_URL` is unset, so `npx vitest run` stays green on a machine without MySQL:

```ts
const hasDb = Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasDb)('the real quest ladder', () => { ... });
```

When it runs, it asserts against the real DB + the real content files:
- the tier sizes 178 / 168 / 272 / 453 / 639 / 922;
- the eligible pool 152 / 140 / 220 / 376 / 535 / 815 = 2238;
- the level counts 31 / 28 / 44 / 76 / 107 / 163 = 449;
- the two short tail levels (HSK 1 L31 has 2 chars, HSK 4 L76 has 1 char) and that every other level has exactly 5;
- the same-syllable-pair count is **21** across the whole ladder;
- **`ORDER BY char` determinism** — `getQuestTier(1)` twice returns byte-identical levels (the route's promise is that a shared URL always produces the same paper).

- [ ] **Step 4: Run both tests to verify they fail**

Run: `npx vitest run tests/unit/app/api/game/quest.test.ts tests/integration/api/game-quest-db.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/game/quest/route'`. The integration test reports as skipped when `DATABASE_URL` is unset.

- [ ] **Step 5: Implement `lib/game-quest-data.ts`**

```ts
import 'server-only';
import { readContentFromFs } from './content';
import { resolvePinyin } from './pinyin-index';
import { getPool } from './db';
import { buildTier } from './game-quest';
import type { QuestCharFact, QuestTier } from './game-quest-types';

export async function getQuestTier(tier: number): Promise<QuestTier>;
```

- The module holds a module-level `Map<number, Promise<QuestTier>>` memo. `getQuestTier` returns the memoized promise; a **failed** build deletes the entry so the next request retries (the same pattern as `lib/pinyin-index.ts`'s `indexPromise`).
- The SQL is **one** query, no `LIMIT` (the largest tier is 922 rows):

```sql
SELECT `char`, pinyin, radical FROM chars WHERE hsk_level = ? ORDER BY `char`
```

`ORDER BY char` is **required** — the ④ clause pool is built in row order, so without it the drawn distractors would drift between two visits to the same URL.
- For each row: `reading = resolvePinyin(row.char, row.pinyin)`; the content comes from `readContentFromFs(row.char)` → `dict.meaning_zh` (fall back to `''`) and `dict.pinyin_alt` (fall back to `[]`); `hasStory` is true when the content carries `etymology.story`, else `hanzi_story`, else `rare.story` (the same precedence as `lib/story.ts`).
- The facts are assembled in the SQL's row order and handed to `buildTier(tier, facts)`.
- Every read is inside a `try/catch` that logs and rethrows — the route's `withErrorHandling` turns it into a 500.

- [ ] **Step 6: Implement `app/api/game/quest/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { questQuerySchema } from '@/lib/validators';
import { getQuestTier } from '@/lib/game-quest-data';
import { buildLevel } from '@/lib/game-quest';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) { /* see below */ }
```

Inside `withErrorHandling`:
1. `questQuerySchema.safeParse({ hsk: sp.get('hsk'), level: sp.get('level') })`; on failure → `badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input')`.
2. `const tier = await getQuestTier(hsk);` then `const payload = buildLevel(tier, level);`
3. `if (!payload) return notFound('level_not_found', `level ${level} is beyond HSK ${hsk}`);`
4. `return NextResponse.json({ ok: true, data: payload }, { headers: { 'Cache-Control': 'no-store' } });`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/game/quest.test.ts tests/integration/api/game-quest-db.test.ts`
Expected: PASS — the unit test green; the integration test either green (with `DATABASE_URL` loaded) or skipped (without it).

- [ ] **Step 8: Commit**

```bash
git add lib/game-quest-data.ts app/api/game/quest/route.ts lib/validators.ts \
  tests/unit/app/api/game/quest.test.ts tests/integration/api/game-quest-db.test.ts
git commit -m "feat(game): add the quest level API [YYYY-MM-DD HH.MM]" -m "GET /api/game/quest?hsk=N&level=M returns the level's 5 chars with their four
option sets. The tier query is ORDER BY char on purpose: the meaning-clause
pool is built in row order, so without a deterministic order the drawn
distractors would drift between two visits to the same URL.

The data layer owns the per-tier memo, so the first request for a tier pays
~100ms of server time and every later request is a hit.

The route test calls the handler directly with the data layer mocked - the
game had no API coverage at all because the old integration test only ever
ran against a server on port 4444 that the file does not start.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: The local progress store and the sound cues

**Files:**
- Create: `lib/game-progress.ts`
- Create: `lib/game-sound.ts`
- Test: `tests/unit/lib/game-progress.test.ts` (new)
- Test: `tests/unit/lib/game-sound.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// lib/game-progress.ts
export const PROGRESS_KEY = 'pinyin-character:game-progress:v1';

export interface CharSnapshot {
  pinyin: string;
  plainPinyin: string;
  tone: 1 | 2 | 3 | 4;
  toneName: string;
  radical: string;
  meaningShort: string;
}
/** The collection snapshot also carries the story flag (§8). */
export interface CollectedSnapshot extends CharSnapshot { hasStory: boolean; }
export interface CollectedChar extends CollectedSnapshot { hsk: number; level: number; at: number; }
/** The wrong book stores the same snapshot **minus** `hasStory` (§8). */
export interface WrongChar extends CharSnapshot { count: number; lastAt: number; hsk: number; level: number; }

export interface GameProgress {
  version: 1;
  /** Per-tier level pointer. */
  current: Record<string, { level: number }>;
  /** Per-tier list of the levels that were 通关. */
  passed: Record<string, number[]>;
  streak: number;
  bestStreak: number;
  collected: Record<string, CollectedChar>;
  wrong: Record<string, WrongChar>;
  /** date (YYYY-MM-DD) → daily key → result. */
  daily: Record<string, Record<string, { done: boolean; score: number }>>;
  updatedAt: number;
}

export function defaultProgress(): GameProgress;
export function loadProgress(): GameProgress;
export function saveProgress(progress: GameProgress): void;
export function collectChar(p: GameProgress, char: string, snapshot: CollectedSnapshot, hsk: number, level: number): GameProgress;
export function recordMiss(p: GameProgress, char: string, snapshot: CharSnapshot, hsk: number, level: number): GameProgress;
export function markLevelPassed(p: GameProgress, hsk: number, level: number): GameProgress;
export function recordDaily(p: GameProgress, key: string, score: number): GameProgress;
export function dailyKey(mode: string, difficulty: string, hsk: number): string;  // `${mode}:${difficulty}:hsk${hsk}`
export function localDateKey(date?: Date): string;                                // YYYY-MM-DD, local time

// lib/game-sound.ts
export const SOUND_KEY = 'pinyin-character:game-sound';
export function isSoundMuted(): boolean;
export function setSoundMuted(muted: boolean): void;
export function playChime(): void;
export function playThud(): void;
export function playFanfare(): void;
export function playStamp(): void;
```

- [ ] **Step 1: Write the failing progress test**

Create `tests/unit/lib/game-progress.test.ts`. It runs under the default `node` environment — so it must exercise the SSR path as well as a happy-dom localStorage. Cover:

- **a corrupt payload resets to the default** — `localStorage.setItem(PROGRESS_KEY, '{not json')` → `loadProgress()` returns `defaultProgress()` and **does not throw**;
- **a payload with an unknown `version` resets to the default** — `{"version": 99, ...}` → the default;
- **`loadProgress` on the server (no `window`) returns the default** — call it with `globalThis.window` deleted (or in the node environment, where `window` is undefined) and assert the default;
- **collect round-trips** — `collectChar(p, '爱', snapshot, 1, 1)` (the snapshot carries `hasStory: true`) then `loadProgress()` has `collected['爱']` with the snapshot's fields plus `hsk: 1`, `level: 1`, and an `at` timestamp;
- **miss round-trips and counts** — `recordMiss(p, '爱', snapshotWithoutStory, 1, 1)` twice on the same char gives `count: 2` and a newer `lastAt`; the stored entry has **no** `hasStory` key (§8: the wrong book stores the snapshot minus the story flag);
- **the per-tier pointers are independent** — `markLevelPassed(p, 1, 3)` then `markLevelPassed(p, 4, 2)` → `current['1'].level === 4`, `current['4'].level === 3`, `passed['1'] === [3]`, `passed['4'] === [2]`;
- **`passed` is an explicit list and survives a re-read** — after `markLevelPassed(p, 1, 3)` and a `saveProgress` + `loadProgress` round trip, `passed['1']` is still `[3]`;
- **`markLevelPassed` is idempotent** — calling it twice for the same level leaves `passed['1'] === [3]`, not `[3, 3]`;
- **the daily map is keyed by the local date** — `recordDaily(p, 'tone:medium:hsk1', 8)` → `p.daily[localDateKey()]['tone:medium:hsk1']` is `{ done: true, score: 8 }`;
- **the daily key's three axes are independent** — `dailyKey('tone', 'medium', 1)`, `dailyKey('tone', 'medium', 2)` and `dailyKey('tone', 'hard', 1)` are three distinct strings, and recording one does not mark the others;
- **a write failure does not throw** — make `localStorage.setItem` throw (private mode) and assert `saveProgress` does not throw.

- [ ] **Step 2: Write the failing sound test**

Create `tests/unit/lib/game-sound.test.ts`. It must not require a real `AudioContext` — the module must degrade silently when there is none. Cover:

- `isSoundMuted()` reads the `SOUND_KEY` localStorage entry (`'1'` → muted);
- `setSoundMuted(true)` writes it and `isSoundMuted()` returns true;
- **`playChime()` / `playThud()` / `playFanfare()` / `playStamp()` do not throw** when `AudioContext` is undefined (the node environment) — this is the "an unsupported/blocked AudioContext can never throw into the render path" rule;
- with a stub `AudioContext` installed on `globalThis`, `playChime()` creates a context and schedules at least one oscillator.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/game-progress.test.ts tests/unit/lib/game-sound.test.ts`
Expected: FAIL — `Cannot find module '@/lib/game-progress'`.

- [ ] **Step 4: Implement `lib/game-progress.ts`**

- `PROGRESS_KEY = 'pinyin-character:game-progress:v1'`.
- `defaultProgress()` returns `{ version: 1, current: {}, passed: {}, streak: 0, bestStreak: 0, collected: {}, wrong: {}, daily: {}, updatedAt: Date.now() }`.
- `loadProgress()` — if `typeof window === 'undefined'` return the default. Otherwise read the raw string; on a parse error, on a non-object, or on an unknown `version`, **log a warning and return the default** (never throw). A missing key returns the default.
- `saveProgress(progress)` — `localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...progress, updatedAt: Date.now() }))` inside a `try/catch` that logs and continues (private mode / quota).
- The mutators (`collectChar`, `recordMiss`, `markLevelPassed`, `recordDaily`) are **pure**: they return a **new** `GameProgress` and never touch `localStorage`. The caller saves. This is what makes them unit-testable without a DOM and what keeps the "one write per answer" rule (§8) in the caller's hands.
  - `collectChar` sets `collected[char] = { ...snapshot, hsk, level, at: Date.now() }` and **increments `streak`**, updating `bestStreak = Math.max(bestStreak, streak)`.
  - `recordMiss` sets `wrong[char] = { ...snapshot, count: (wrong[char]?.count ?? 0) + 1, lastAt: Date.now(), hsk, level }` and **resets `streak` to 0**.
  - `markLevelPassed(p, hsk, level)` sets `current[String(hsk)] = { level: level + 1 }` and appends `level` to `passed[String(hsk)]` **if it is not already there**.
  - `recordDaily(p, key, score)` sets `daily[localDateKey()][key] = { done: true, score }`.
- `dailyKey(mode, difficulty, hsk)` returns `` `${mode}:${difficulty}:hsk${hsk}` `` — e.g. `tone:medium:hsk1`. The **three** axes are all part of "one round of this game".
- `localDateKey(date = new Date())` formats the **local** date as `YYYY-MM-DD` (pad the month and the day).

- [ ] **Step 5: Implement `lib/game-sound.ts`**

- `SOUND_KEY = 'pinyin-character:game-sound'`; the stored value `'1'` means muted.
- `isSoundMuted()` / `setSoundMuted(muted)` read and write that key, both inside a `try/catch` that logs and falls back to "not muted".
- A lazily created `AudioContext` (`new AudioContext()` on first use, `resume()` on the first user gesture) held in a module-level variable.
- The four cues, exactly as §9 of the spec:
  - `playChime()` — two sine partials at 880 Hz and 1320 Hz, a fast exponential decay, ≈0.5 s;
  - `playThud()` — 160 Hz sine, 0.18 s decay, low-passed;
  - `playFanfare()` — three ascending notes 660 → 880 → 1320 Hz, 90 ms apart;
  - `playStamp()` — a short filtered noise burst.
- **Every** public function wraps its body in a `try/catch` that logs and returns: an unsupported or blocked `AudioContext` must never throw into the render path. When `AudioContext` is undefined (node, older browsers) the functions are no-ops.
- **The mute toggle also silences the character audio** — one switch for all sound. The character audio is played by `lib/tts.ts`'s `speak()`, so `lib/game-sound.ts` exports `isSoundMuted()` and the **quest UI** checks it before calling `speak()`. (`lib/game-sound.ts` does not import `lib/tts.ts` — the dependency runs the other way, so the tts path stays usable on its own.) The toggle itself is **rendered in the quest header** — Task 9, `QuestTabs`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/game-progress.test.ts tests/unit/lib/game-sound.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/game-progress.ts lib/game-sound.ts \
  tests/unit/lib/game-progress.test.ts tests/unit/lib/game-sound.test.ts
git commit -m "feat(game): add the local progress store and the sound cues [YYYY-MM-DD HH.MM]" -m "The progress store is pure: the mutators return a new state and never touch
localStorage, so they are unit-testable without a DOM and the caller keeps
the one-write-per-answer rule.

A corrupt payload resets to the default instead of throwing - a game must
never break the page - and an unknown version does the same.

The sound cues are Web Audio only, no files and no dependency. Every call is
wrapped so an unsupported or blocked AudioContext can never throw into the
render path.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Honor the requested round mode

**Files:**
- Modify: `lib/game-round.ts:67-72` (`buildRound` signature) and `:145` (the mode choice)
- Modify: `app/api/game/round/route.ts:34` (pass the override through)
- Modify: `components/game/ToneRadicalGame.tsx` — a `mode` prop and the query string
- Test: `tests/unit/lib/game-round.test.ts` (extend)
- Test: `tests/unit/components/game/ToneRadicalGame.test.tsx` (extend)
- Test: `tests/unit/app/api/game/round.test.ts` (new)

**Interfaces:**
- Consumes: `RoundMode` from `@/lib/game-round-types`.
- Produces:

```ts
// lib/game-round.ts
export async function buildRound(
  count: number,
  seed?: number,
  source: CharSource = 'chars-all',
  hskLevel?: HskLevel | null,
  modeOverride?: RoundMode,   // NEW 5th parameter
): Promise<BuildRoundResult | null>;

// components/game/ToneRadicalGame.tsx
export interface ToneRadicalGameProps {
  mode?: 'tone' | 'radical';
}
export function ToneRadicalGame(props: ToneRadicalGameProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/game-round.test.ts` add:
- `buildRound(count, seed, source, hskLevel, 'tone')` yields `round.mode === 'tone'`;
- `buildRound(count, seed, source, hskLevel, 'radical')` yields `round.mode === 'radical'`;
- omitting the 5th argument keeps the legacy random behavior — the mode is one of `['tone','radical','pinyin']` and it is a pure function of the seed (the same seed gives the same mode).

`buildRound` queries the DB, so these tests need the `@/lib/chars` mock that the file already declares — extend that mock so `listChars` returns a fixed array of chars with a radical and a tone-marked pinyin.

In `tests/unit/components/game/ToneRadicalGame.test.tsx` add:
- rendering `<ToneRadicalGame mode="tone" />` sends `mode=tone` in the `/api/game/round` query string;
- rendering without the prop sends **no** `mode` parameter (the legacy behavior).

The existing file already mocks `global.fetch` with `mockFetchOnce`; assert on the URL by spying on `fetch` and inspecting the first argument.

Create `tests/unit/app/api/game/round.test.ts` — the **route** test the game never had (the spec's §11 asks for `GET /api/game/round?mode=tone` → `data.mode === 'tone'`; the only round test that exists is `tests/integration/api/game-round.test.ts`, whose every case is `it.skip` against a server on port 4444 that the file does not start). It calls the handler directly and **mocks `@/lib/game-round`** so it needs no DB:

```ts
vi.mock('@/lib/game-round', () => ({ buildRound: vi.fn() }));
```

The mock returns a fixture `BuildRoundResult` whose `mode` echoes the requested mode. Then it imports `{ GET }` from `@/app/api/game/round/route` and calls `GET(new NextRequest('http://localhost/api/game/round?mode=tone&count=4'))`.

Assert:
- `buildRound` was called with `'tone'` as its **5th** argument;
- the response body's `data.mode === 'tone'`;
- without the `mode` param, `buildRound` was called with `undefined` as its 5th argument (the legacy random behavior) — the route must not pass a default mode.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx tests/unit/app/api/game/round.test.ts`
Expected: FAIL — the 5th parameter is not accepted, the query string carries no `mode`, and the route does not forward it.

- [ ] **Step 3: Implement the `modeOverride` parameter**

In `lib/game-round.ts`:
- add `modeOverride?: RoundMode` as the 5th parameter of `buildRound`;
- replace `const mode = pickMode(actualSeed);` with `const mode = modeOverride ?? pickMode(actualSeed);`.

In `app/api/game/round/route.ts`:
- pass the already-parsed `mode` through: `buildRound(count, seed, source, (hskLevel ?? null) as HskLevel | null, modeOverride ?? undefined)`.
- **The response shape is unchanged** — the same fields, the same names. Only `round.mode` now equals the requested mode instead of a random one. No shim is needed because no existing caller sends `mode`.

In `components/game/ToneRadicalGame.tsx`:
- accept an optional `mode?: 'tone' | 'radical'` prop;
- when it is set, add `mode` to the `URLSearchParams` of the `/api/game/round` request. When it is not set, the parameter is **absent** (not an empty string) so the legacy random behavior is preserved.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx tests/unit/app/api/game/round.test.ts tests/integration/api/game-round.test.ts`
Expected: PASS. (`tests/integration/api/game-round.test.ts` is the pre-existing `it.skip`-style file — it must stay skipped, not newly broken.)

- [ ] **Step 5: Commit**

```bash
git add lib/game-round.ts app/api/game/round/route.ts components/game/ToneRadicalGame.tsx \
  tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx \
  tests/unit/app/api/game/round.test.ts
git commit -m "fix(game): honor the requested round mode [YYYY-MM-DD HH.MM]" -m "The /api/game/round route already parsed a mode query param and documented
that it should build the round for the requested mode - but buildRound had
no mode parameter, so the param only reached the reveal config and the
round was always a random one of the three. The 声调·部首 tab could serve a
pure-pinyin round, and the tab title lied about its own content.

buildRound gains an optional 5th parameter; the route passes the parsed
value through. The response shape is unchanged, so no shim is needed.

The route now has a unit test that calls the handler directly - the only
round test that existed was an all-skip file pointed at a server on port
4444 that the file does not start.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Give every char its own tone token

**Files:**
- Modify: `lib/game-round.ts:170-182` (the token banks)
- Modify: `lib/game-round-types.ts:26-32` (the documented shape)
- Modify: `components/game/ToneToken.tsx` — carry the token index
- Modify: `components/game/RadicalToken.tsx` — carry the token index
- Modify: `components/game/PinyinToken.tsx` — carry the token index
- Modify: `components/game/ToneRadicalGame.tsx` — track used token indices
- Test: `tests/unit/lib/game-round.test.ts` (extend)
- Test: `tests/unit/components/game/ToneRadicalGame.test.tsx` (extend)

**Interfaces:**
- Consumes: `RoundMode`, `RoundChar` from `@/lib/game-round-types`.
- Produces: the **response shape is unchanged** — `GameRound.toneChoices` and `GameRound.radicalChoices` keep their names and types. Only their **contents** change:

```ts
export interface GameRound {
  // ...
  /**
   * The tone token bank — ONE TOKEN PER CHAR, duplicates allowed.
   * `toneChoices[i]` is the tone of `chars[i]`. Two chars of the same tone
   * get two identical tokens, so neither can starve the other.
   */
  toneChoices: Tone[];
  /** The radical token bank — ONE TOKEN PER CHAR, duplicates allowed. */
  radicalChoices: string[];
  /** Unchanged: one pinyin per char (the pinyin mode picks unique pinyins). */
  pinyinChoices: string[];
}
```

The client resolves a dropped token by its **index**, not by its value:

```ts
// components/game/ToneRadicalGame.tsx
/**
 * The token list the learner actually sees, in display order. The index in
 * the drag payload is an index into THIS array (the component shuffles the
 * bank client-side), so the value is resolved from the same array.
 */
const tokenValues: string[] = ...;  // toneOrder / radicalOrder / pinyinOrder
const [usedTokenIndices, setUsedTokenIndices] = useState<Set<number>>(new Set());
```

**All three token components carry the index**, `PinyinToken` included — the client resolves every drop through `tokenValues[Number(payload)]`, so a token that still sent its value would break that mode outright. The pinyin mode's values are unique, so index tracking changes nothing for it.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/game-round.test.ts` add:
- **the tone token bank holds one token per char** — a 6-char round has `round.toneChoices.length === 6` and `round.toneChoices[i] === round.charToAnswer[round.chars[i].char].tone` for every `i`;
- **two chars of the same tone each get their own token** — a round whose 6 chars include two chars with tone 1 still has 6 tokens, and the two tone-1 tokens are both present;
- **the radical token bank holds one token per char** — `round.radicalChoices.length === round.chars.length` and `radicalChoices[i]` is the radical of `chars[i]`.

In `tests/unit/components/game/ToneRadicalGame.test.tsx` add:
- **the round can be finished when two chars share a tone** — render a 6-char round where two chars have tone 1, drop the two matching tokens on them, and assert the round reaches the finished phase;
- **a token is disabled only after it is used** — dropping one of the two identical tone tokens disables that token and leaves the other draggable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx`
Expected: FAIL — `toneChoices` has 4 entries for a 6-char round, and the client cannot distinguish two identical tokens.

- [ ] **Step 3: Rebuild the token banks in `lib/game-round.ts`**

Replace the `toneChoices` / `radicalChoices` construction with one token per char:

- `toneChoices` = `picked.map((c) => toneFromPinyin(c.pinyin)!)` — the tone of each char, in the same order as `round.chars`. The `ALL_TONES` spread and the extra-radical distractor pool are **removed**: with one token per char the bank is exactly the answer set, and a token can no longer be shared between two chars.
- `radicalChoices` = `picked.map((c) => c.radical)`.

`pinyinChoices` is unchanged.

Update the comment above `toneChoices` to explain why: the old bank was the 4 tone *values*, so two chars of the same tone fought over one token and the second could never be matched — the round never finished, and in hard mode (6 chars, 4 tones) the pigeonhole principle made the collision certain.

- [ ] **Step 4: Make the tokens carry their index**

In `components/game/ToneToken.tsx`, `components/game/RadicalToken.tsx` and `components/game/PinyinToken.tsx`:
- add a `tokenIndex: number` prop;
- the drag payload becomes the **index**, not the value: `e.dataTransfer.setData('text/plain', String(tokenIndex))`.

All three carry the index, because the client resolves every drop through `tokenValues[Number(payload)]`. `PinyinToken`'s values are unique, so its behavior is unchanged — but the payload format must match the other two.

- [ ] **Step 5: Track used token indices in `ToneRadicalGame`**

- Replace `matchedValues` with `usedTokenIndices: Set<number>`.
- The token's `matched` prop becomes `usedTokenIndices.has(index)`.
- The React `key` of a token becomes the index — with duplicates allowed, the old `key={t}` would produce duplicate React keys.
- `handleDrop(char, kind, payload)`: `payload` is the token index as a string. Resolve `const tokenValue = tokenValues[Number(payload)]` where **`tokenValues` is the shuffled display array** (`toneOrder` / `radicalOrder` / `pinyinOrder`) — the component shuffles the bank client-side, so the index the learner drags is an index into that array, not into `round.toneChoices`. If `tokenValue === undefined` → ignore the drop (a stale or malformed payload). Compare `tokenValue` against the char's expected value exactly as today; on a mismatch, `setMismatches(m => m + 1)` and return. On a match, `setMatches(prev => ({ ...prev, [char]: tokenValue }))` — the **value** is stored so the slot still displays the tone number or the radical — and add the index to `usedTokenIndices`.
- The auto-finish effect is unchanged: it fires when `matchCount === round.chars.length`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx`
Expected: PASS — including the new "the round can be finished when two chars share a tone" case.

- [ ] **Step 7: Commit**

```bash
git add lib/game-round.ts lib/game-round-types.ts components/game/ToneToken.tsx \
  components/game/RadicalToken.tsx components/game/PinyinToken.tsx \
  components/game/ToneRadicalGame.tsx \
  tests/unit/lib/game-round.test.ts tests/unit/components/game/ToneRadicalGame.test.tsx
git commit -m "fix(game): give every char its own tone token [YYYY-MM-DD HH.MM]" -m "The tone token bank was the four tone values, but a round holds 3 / 4 / 6
chars. Two chars of the same tone fought over one token, the second could
never be matched, matchCount never reached chars.length and the round never
auto-finished. With 6 chars and 4 tones the pigeonhole principle makes the
collision certain, so the 声调 round was unwinnable in hard mode.

The radical mode had the same shape - correctRadicals was a Set, so two
chars sharing a radical collapsed into one token, and the bank was capped
at 6, so 6 chars sharing 3 radicals left one char with no token at all.

The bank is now one token per char (duplicates allowed) and the game tracks
which token index was used rather than which tone value. The response shape
is unchanged.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Report completion from the legacy games

**Files:**
- Modify: `components/game/ToneRadicalGame.tsx`
- Modify: `components/game/DragMatchGame.tsx`
- Modify: `components/game/ChainGame.tsx`
- Test: `tests/unit/components/game/ToneRadicalGame.test.tsx` (extend)
- Test: `tests/unit/components/game/DragMatchGame.test.tsx` (extend)
- Test: `tests/unit/components/game/ChainGame.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// components/game/LegacyGameResult.ts  (new, shared by the three games)
export interface LegacyGameResult {
  /** matches / pairs / chain length */
  correct: number;
  /** mismatches */
  wrong: number;
  /** optional — the daily card shows the score, the duration is only a stat */
  durationMs?: number;
}

// each of the three games gains:
export interface LegacyGameProps {
  onComplete?: (result: LegacyGameResult) => void;
}
```

`ToneRadicalGame`'s props become `ToneRadicalGameProps & LegacyGameProps` (it already has a `mode` prop from Task 5).

- [ ] **Step 1: Write the failing tests**

In each of the three component test files add:
- **the game fires `onComplete` with the score** — play to the end and assert `onComplete` was called once with `{ correct: <n>, wrong: <m> }` (ChainGame: `{ correct: chain.length, wrong: 0 }`);
- **`durationMs` is present** — the result object carries a `durationMs` number;
- **abandoning does not fire `onComplete`** — click 「放弃」 and assert `onComplete` was **not** called.

> **Note on ChainGame:** the spec says "All three games have a 放弃 button". ChainGame does **not** have one — it has 「换一条」, which pops the last char of the chain and keeps playing. So ChainGame's `onComplete` fires on the natural finish only, and there is no abandon case to test for it. The other two games gain an `abandoned` flag.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/game/ToneRadicalGame.test.tsx tests/unit/components/game/DragMatchGame.test.tsx tests/unit/components/game/ChainGame.test.tsx`
Expected: FAIL — no `onComplete` prop exists.

- [ ] **Step 3: Create the shared result type**

Create `components/game/LegacyGameResult.ts` exporting the `LegacyGameResult` interface quoted above. It is a type-only module — no runtime code.

- [ ] **Step 4: Wire `ToneRadicalGame`**

- Accept `onComplete?: (result: LegacyGameResult) => void` as a prop (the prop is **optional**, so the existing usage in `GameModeTabs` keeps compiling unchanged).
- Add an `abandoned` state. The 放弃 button sets `abandoned` to true **and** the phase to `finished`.
- The auto-finish effect fires `onComplete({ correct: matchCount, wrong: mismatches, durationMs: elapsedMs })` in the same `setTimeout` that sets the phase to `finished` — and **only** when `abandoned` is false.
- Clear the timeout on unmount (the existing cleanup already does).

- [ ] **Step 5: Wire `DragMatchGame`**

- Accept the `onComplete` prop.
- Add an `abandoned` state, set by the 放弃 button.
- **Move the completion detection out of the `setPairs` state updater.** Today `handleDrop` calls `setPhase('finished')` *inside* the updater — a side effect inside a state updater, which React may invoke twice in StrictMode. Replace it with a `useEffect` on `[pairs, chars.length, abandoned]` that fires `onComplete({ correct: matchedCount, wrong: mismatches, durationMs: elapsedMs })` once when `matchedCount === chars.length` and `abandoned` is false.

- [ ] **Step 6: Wire `ChainGame`**

- Accept the `onComplete` prop.
- In the existing effect that sets the phase to `finished` when `validNext.length === 0 && chain.length > 0`, also fire `onComplete({ correct: chain.length, wrong: 0, durationMs })`. ChainGame has no abandon path, so there is no `abandoned` guard here — but the effect must fire **once** (guard with a ref, because the effect re-runs when `validNext` changes).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/game/`
Expected: PASS — every game test file green.

- [ ] **Step 8: Commit**

```bash
git add components/game/LegacyGameResult.ts components/game/ToneRadicalGame.tsx \
  components/game/DragMatchGame.tsx components/game/ChainGame.tsx \
  tests/unit/components/game/ToneRadicalGame.test.tsx \
  tests/unit/components/game/DragMatchGame.test.tsx \
  tests/unit/components/game/ChainGame.test.tsx
git commit -m "feat(game): report completion from the legacy games [YYYY-MM-DD HH.MM]" -m "The three legacy games exposed no completion signal, so a daily-challenge
card could not show 已完成 + 分数 without changing all three. Each now takes
an optional onComplete prop; the prop is optional, so the existing usage
keeps compiling.

Abandoning is not completing: the 放弃 path must not fire onComplete, or a
half-finished round would be recorded as a completed one with a bogus
score. ChainGame has no 放弃 button - it has 换一条, which keeps the round
alive - so its completion fires on the natural finish only.

DragMatchGame's completion detection moved out of the setPairs state
updater, where StrictMode could run it twice.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: The quest UI

**Files:**
- Create: `components/game/HskPicker.tsx`
- Create: `components/game/quest/QuestBoard.tsx`
- Create: `components/game/quest/QuestRunner.tsx`
- Create: `components/game/quest/QuestCharCard.tsx`
- Create: `components/game/quest/QuestQuestionCard.tsx`
- Create: `components/game/quest/QuestOptionButton.tsx`
- Create: `components/game/quest/QuestSealStamp.tsx`
- Create: `components/game/quest/QuestSummary.tsx`
- Create: `components/game/quest/CharCollection.tsx`
- Create: `components/game/quest/CharCard.tsx`
- Create: `components/game/quest/WrongBook.tsx`
- Test: `tests/unit/components/game/QuestRunner.test.tsx` (new)
- Test: `tests/unit/components/game/QuestPanels.test.tsx` (new)

**Interfaces:**
- Consumes: `QuestLevelPayload`, `QuestCharPayload`, `QuestQuestion` from `@/lib/game-quest-types`; `loadProgress` / `saveProgress` / `collectChar` / `recordMiss` / `markLevelPassed` from `@/lib/game-progress`; `playChime` / `playThud` / `playFanfare` / `playStamp` / `isSoundMuted` from `@/lib/game-sound`; `speak` / `stopSpeaking` from `@/lib/tts`; `prefetchTts` from `@/lib/tts-cache`; `useDifficulty` from `@/lib/use-difficulty`.
- Produces (the props the page-level task codes against):

```ts
// components/game/HskPicker.tsx
export function HskPicker(): JSX.Element;   // reads/writes useDifficulty().hskLevel

// components/game/quest/QuestBoard.tsx
export interface QuestBoardProps {
  tier: number;
  levelCount: number;
  /** The tier's current level pointer (1-based). */
  currentLevel: number;
  /** The levels that were 通关. */
  passedLevels: number[];
  onOpenLevel: (level: number) => void;
}

// components/game/quest/QuestRunner.tsx
export interface QuestRunnerProps {
  tier: number;
  level: number;
  onExit: () => void;
  onPassed: (level: number) => void;
}

// components/game/quest/QuestCharCard.tsx
export interface QuestCharCardProps {
  char: QuestCharPayload;
  /** Which facets may be shown right now (the §7.2 reveal rule). */
  showPinyin: boolean;
  showRadical: boolean;
  showMeaning: boolean;
  stamped: boolean;
}

// components/game/quest/QuestQuestionCard.tsx
export interface QuestQuestionCardProps {
  question: QuestQuestion;
  index: number;
  total: number;
  /** The option the learner picked, or null. */
  selected: number | null;
  /** The question is locked (answered). */
  answered: boolean;
  /** The learner answered correctly. */
  correct: boolean;
  /** The hint has been used on this question. */
  hinted: boolean;
  onSelect: (optionIndex: number) => void;
  onHint: () => void;
  /** The ② audio state — 'idle' for the other three kinds. */
  audio: 'idle' | 'loading' | 'playing' | 'unavailable';
  onPlayAudio: () => void;
}

// components/game/quest/QuestOptionButton.tsx
export interface QuestOptionButtonProps {
  label: string;
  state: 'idle' | 'correct' | 'wrong' | 'revealed' | 'disabled';
  onClick: () => void;
}

// components/game/quest/QuestSealStamp.tsx
export interface QuestSealStampProps { visible: boolean; text?: string; }

// components/game/quest/QuestSummary.tsx
export interface QuestSummaryProps {
  tier: number;
  level: number;
  chars: QuestCharPayload[];
  /** The chars that were not mastered. */
  missed: string[];
  passed: boolean;
  onNext: () => void;
  onRemediate: () => void;
  onExit: () => void;
}

// components/game/quest/CharCollection.tsx
export interface CharCollectionProps {
  collected: Record<string, CollectedChar>;
  onFilterTierChange: (tier: number | null) => void;
}

// components/game/quest/CharCard.tsx
export interface CharCardProps { char: string; snapshot: CollectedChar; }

// components/game/quest/WrongBook.tsx
export interface WrongBookProps {
  wrong: Record<string, WrongChar>;
  onRemove: (char: string) => void;
}
```

- [ ] **Step 1: Write the failing `QuestRunner` test**

Create `tests/unit/components/game/QuestRunner.test.tsx`. It starts with `// @vitest-environment happy-dom` and follows the boilerplate of the existing component tests (`cleanup()` + `vi.restoreAllMocks()` + `vi.resetModules()` in `beforeEach`, a happy-dom `localStorage` shim, and a **dynamic** `await import('@/components/game/quest/QuestRunner')` after the mocks are in place).

Mock `@/lib/tts` (`speak` resolves, or rejects in the audio-failure case) and `@/lib/game-sound` (the four cues are no-ops). Mock `global.fetch` to return a fixture `QuestLevelPayload` with 2 chars × 4 questions.

Assert:
- **a wrong option reveals the correct answer and breaks the combo** — click a wrong option → the correct option is rendered in the `revealed` state, and the combo indicator resets to 0;
- **the right option locks the question and shows the seal** — click the correct option → the question is locked (the options are disabled) and the seal element appears;
- **the hint removes exactly one *wrong* option and never the correct answer** — click 提示 → exactly one option disappears, and the option that disappears is **not** the correct one (compare against the payload's `answerIndex`);
- **a short level completes** — a fixture level with 1 char (and another with 3) reaches the summary;
- **the reveal rule** — the char card does **not** show the pinyin while ① or ② is pending; it shows it after ② is answered; and a remediation round that re-asks ① hides it again;
- **a wrong ① answer does not leak ②** (Review Focus #5) — after answering ① wrongly, the char card still shows no pinyin, and the ① answer is visible **in the question card**;
- **the audio contract** — the ① question renders **no** 🔊 control; the ② question renders one; when `speak` rejects (mocked), ② is still answerable and the button shows 「🔊 暂时不可用」 — no error toast, no blocked question.

- [ ] **Step 2: Write the failing `QuestPanels` test**

Create `tests/unit/components/game/QuestPanels.test.tsx` — same happy-dom boilerplate as the `QuestRunner` test. It covers the three panels the runner test does not reach, and it pins **Review Focus #1, #2 and #3**:

- **Review Focus #1 — a stale level pointer clamps** (pins `QuestBoard`): render `<QuestBoard tier={1} levelCount={31} currentLevel={999} passedLevels={[]} />` → exactly **31** tiles are rendered (no tile 32), the **31st** tile carries the 当前 state, and clicking a tile beyond the count is impossible. Then render with `currentLevel={5}` and assert tiles 1-5 are startable and tile 6 is not.
- **Review Focus #2 — the 500-char cap on 一键生成字帖** (pins `WrongBook`): build a wrong book of **520** chars, mock `global.fetch`, click 「一键生成字帖」, and assert the POST body's `content` array has **500** entries (the first 500 in the book's order), the UI says 「本次生成前 500 字」, and the remaining 20 chars are still listed with their per-char 练字帖 links.
- **Review Focus #3 — the snapshot survives a content regeneration** (pins `CharCollection` / `CharCard`): render a `collected` entry for a char whose content file no longer exists, with `global.fetch` mocked to **reject** — the card still renders the stored pinyin, radical and meaning, and **no** request was made.
- the **故事 link appears only when `hasStory` is true** and is absent otherwise;
- the 练字帖 link's href is `/worksheet?prefill={char}`.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/unit/components/game/QuestRunner.test.tsx tests/unit/components/game/QuestPanels.test.tsx`
Expected: FAIL — `Cannot find module '@/components/game/quest/QuestRunner'` and `Cannot find module '@/components/game/quest/QuestBoard'`.

- [ ] **Step 4: Run the `QuestRunner` test to verify it fails**

Run: `npx vitest run tests/unit/components/game/QuestRunner.test.tsx`
Expected: FAIL — `Cannot find module '@/components/game/quest/QuestRunner'`.

- [ ] **Step 5: Create `components/game/HskPicker.tsx`**

Extract the HSK chip row out of `components/game/GameModeTabs.tsx` verbatim: six buttons (`HSK 1` … `HSK 6`), `aria-pressed` on the active one, `useDifficulty()` for the read and the write. The styles are the existing ones (`bg-seal text-white border-seal` for the active chip, `bg-paper-deep border-ink/30 hover:bg-paper` otherwise) so the look does not change. `GameModeTabs` keeps rendering its own copy until Task 9 deletes it.

- [ ] **Step 6: Create `QuestOptionButton.tsx` and `QuestSealStamp.tsx`**

`QuestOptionButton` renders a `<button type="button">` whose label is the option text, with a `state` → class mapping:
- `idle` → `border-ink/30 bg-paper hover:bg-paper-deep`;
- `correct` → `border-success bg-success/15 text-success`;
- `wrong` → `border-danger bg-danger/15 text-danger`;
- `revealed` → `border-success bg-success/10 text-success` (the answer revealed after a miss);
- `disabled` → `opacity-50 pointer-events-none`.

`QuestSealStamp` renders the 朱红 seal: a rotated square with `bg-seal text-paper-soft`, the text 「通」 by default, `visible` toggles a CSS transition (scale + fade). Use Tailwind's transition utilities — no new CSS file.

- [ ] **Step 7: Create `QuestCharCard.tsx`**

Renders the char card: the glyph in a large 楷体 (`font-kai text-7xl`), inside a 宣纸 frame (`card-paper`). Below the glyph, the revealed facets:
- **pinyin** (the toneless syllable and the tone) — rendered only when `showPinyin` is true;
- **radical** — only when `showRadical` is true;
- **meaning** — only when `showMeaning` is true, and it is the **full** `meaningZh` text (the whole `dict.meaning_zh` string), not the short clause (§5.2 ④: 「The full text is revealed on the char card after the question is answered」).

When a facet is hidden it is **not rendered at all** — no placeholder, no `?`. (The legacy games use a `?` button for on-demand reveals; the quest must not leak the answer, so a hidden facet is simply absent.) The `stamped` prop shows the seal over the glyph.

- [ ] **Step 8: Create `QuestQuestionCard.tsx`**

Renders:
- the prompt for the question kind:
  - `pinyin` → 「这个字读哪个音节？」;
  - `tone` → 「`{plainPinyin}` 读第几声？」 — the **toneless** syllable, rendered large;
  - `radical` → 「这个字的部首是？」;
  - `meaning` → 「这个字的意思是？」;
- the 4 options in a 2×2 grid on desktop (`grid-cols-1 sm:grid-cols-2`), one column on mobile — **tap only**, no drag-and-drop anywhere;
- the 🔊 button **only** for the `tone` kind, beside the prompt. Its label follows the `audio` prop: `idle` → 「🔊 听发音」, `loading` → 「🔊 加载中…」, `playing` → 「🔊 播放中」, `unavailable` → 「🔊 暂时不可用」;
- the 提示 button, available on **every** question, uniform across kinds;
- a progress row of `total` dots, the current one filled.

- [ ] **Step 9: Create `QuestRunner.tsx`**

The flow engine. Its state machine:

- `phase`: `'loading' | 'playing' | 'summary'`;
- `charIndex`: which of the level's chars is current (0-based);
- `questionIndex`: which of the 4 questions is current (0..3), in the fixed order 读音 → 声调 → 部首 → 词义;
- `answers`: `Record<char, boolean[]>` — per char, whether each of its 4 questions was answered correctly;
- `missed`: the chars with at least one wrong answer.

On mount: fetch `/api/game/quest?hsk={tier}&level={level}`; on failure show an error with a 「重试」 button. Then:
- `prefetchTts('male', char)` for each of the level's chars (fire-and-forget; a rejection is swallowed and logged);
- `speak(char, { voice: 'male' })` when the ② question appears (auto-play — the first one of a fresh visit will be blocked by the browser, which is why the 🔊 button is the primary path). `stopSpeaking()` when the question changes or the component unmounts.

The **reveal rule** (§7.2) — implemented as a pure function of the current round's state:

```ts
/** A facet is hidden while a pending question in this round tests it. */
function revealedFacets(charIndex: number, questionIndex: number, round: 'main' | 'remediation'): {
  pinyin: boolean; radical: boolean; meaning: boolean;
}
```

- the pinyin is revealed only when **② has been answered** in this round — i.e. `questionIndex > 1` in the main round, or the remediation round has passed ②;
- the radical is revealed once ③ has been answered;
- the meaning is revealed once ④ has been answered;
- **a remediation round re-hides a facet it re-tests**: when the remediation round re-asks ①, the pinyin is hidden for that whole round, while the radical and the meaning stay visible (nothing in that round tests them).

On answering:
- **correct** → lock the question, `playChime()`, increment the combo, stamp the seal on the char card;
- **wrong** → reveal the correct option, `playThud()`, reset the combo to 0, add the char to the 生字本 (`recordMiss` + `saveProgress`), and show a 「记一笔」 button (a **confirm + jump to 生字本** action — the char is already added automatically).

The **hint** (§5.5): removes **the last wrong option in the seeded option permutation** — i.e. the highest-index option that is **not** `answerIndex`. It never removes the correct answer. It breaks the combo (连击 → 0) and marks the char card 「用过提示」.

After the last question of a char, advance to the next char. After the last char, the summary:
- if every char is mastered → `markLevelPassed(progress, tier, level)` + `saveProgress` + `playFanfare()`, and the summary shows 「下一关」;
- otherwise → the summary lists the missed chars and offers 「重挑错字」.

**Remediation** (§5.6): a round that re-asks **only the missed questions** for the missed chars, entirely from the already-fetched level payload — **no extra API call**. Passing it masters those chars; a second failure ends the attempt.

The **level pointer advances only on a pass** — abandoning an attempt leaves it where it is. `markLevelPassed` is called exactly once, from the summary, and only when every char is mastered.

- [ ] **Step 10: Create `QuestBoard.tsx`**

The level map: a wrapped grid of level tiles (`grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2`), one tile per level (up to 163). The tile states:
- **已通关** — a 朱红 seal 「通」 on the tile;
- **当前** — the level the progress pointer sits at (ink-filled);
- **未解锁** — faint, and **not clickable**.

Only `level <= currentLevel` is startable. Clicking a tile calls `onOpenLevel(level)`.

**Review Focus #1 — a stale pointer beyond the tier's level count:** the board **clamps** `currentLevel` to `levelCount` (`Math.min(currentLevel, levelCount)`) before rendering, and clamps the tile's state computation the same way. A pointer of 999 in a 31-level tier renders the 31st tile as 当前 and 32 tiles of 未解锁 are never rendered.

- [ ] **Step 11: Create `QuestSummary.tsx`**

Renders the end-of-level screen:
- **通关** → a big seal + 「下一关」 (calls `onNext`) + a 生字本 shortcut;
- **未通关** → the missed chars (the glyph, the pinyin, the radical) + a 「重挑错字」 button (calls `onRemediate`) + a 生字本 shortcut + 「返回关卡地图」 (calls `onExit`);
- a short level is labelled 「本关 N 字」.

- [ ] **Step 12: Create `CharCard.tsx` and `CharCollection.tsx`**

`CharCard` renders one collected char: the glyph, the pinyin with the tone name, the radical, the meaning, and the four exit links:
- 字典 → `/dictionary/{char}`;
- 字源 → `/etymology/{char}`;
- 故事 → `/stories/{char}` — **rendered only when `snapshot.hasStory` is true**;
- 练字帖 → `/worksheet?prefill={char}`.

**Review Focus #3 — the snapshot survives a content regeneration:** the card renders **only** from `snapshot`. There is no fetch and no per-char lookup, so a char whose content file is gone still renders its stored pinyin / radical / meaning.

`CharCollection` renders the grid of `CharCard`s, a filter row of HSK tier chips, and the empty state 「还没有认会的字 —— 去闯关」.

- [ ] **Step 13: Create `WrongBook.tsx`**

One row per missed char, rendered from the stored snapshot: the glyph, the pinyin, the radical, the meaning, the miss count, and three actions:
- **再练一次** — a link to `/game?tab=quest&hsk={snapshot.hsk}&level={snapshot.level}`;
- **练字帖** — a link to `/worksheet?prefill={char}`;
- **移出生字本** — calls `onRemove(char)`.

The header action **「一键生成字帖」**:
- **Review Focus #2 — the 500-char cap:** the button sends at most the **first 500** wrong chars to `POST /api/worksheets` and the UI states 「本次生成前 500 字」 when the book is longer. The per-char links keep working for the rest.
- logged-in → `POST /api/worksheets` with `{ title: '生字本练习', content: [...chars], cellStyle: 'brush-square', paperSize: 'A4', fontFamily: 'kai' }` → redirect to `/worksheet/{id}`;
- not logged in → an inline hint 「登录后可一键生成字帖」 plus the per-char links, which work for everyone.

The component takes the wrong book as a prop and calls `onRemove`; **it does not write to localStorage itself** — the page-level task owns the store.

- [ ] **Step 14: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/game/QuestRunner.test.tsx tests/unit/components/game/QuestPanels.test.tsx`
Expected: PASS — every case green, including the three Review Focus cases.

- [ ] **Step 15: Run the whole suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 16: Commit**

```bash
git add components/game/HskPicker.tsx components/game/quest/ \
  tests/unit/components/game/QuestRunner.test.tsx \
  tests/unit/components/game/QuestPanels.test.tsx
git commit -m "feat(game): add the quest UI [YYYY-MM-DD HH.MM]" -m "The runner is tap-only - no drag-and-drop anywhere in the new UI - and asks
every char all four questions: 读音 (silent, 认读), 声调 (the character is
played, 听辨), 部首 and 词义.

The reveal rule is the load-bearing detail: the pinyin stays off the char
card until ② is answered, because ②'s four options are the four tone forms
of exactly that syllable. A remediation round re-hides a facet it re-tests.

The hint removes the last *wrong* option in the seeded permutation, never
the correct answer - the permutation's last slot holds the answer about a
quarter of the time.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Rebuild the game page around the quest

**Files:**
- Create: `components/game/quest/QuestTabs.tsx`
- Create: `components/game/daily/DailyChallenge.tsx`
- Modify: `app/game/page.tsx` (rewrite)
- Delete: `components/game/GameModeTabs.tsx`
- Delete: `tests/unit/components/game/GameModeTabs.test.tsx`

**Interfaces:**
- Consumes: everything from Task 8, plus `ToneRadicalGame` / `DragMatchGame` / `ChainGame` with their `mode` and `onComplete` props (Tasks 5, 7), `useDifficulty` from `@/lib/use-difficulty`, `dailyKey` / `localDateKey` / `loadProgress` / `saveProgress` / `recordDaily` from `@/lib/game-progress`.
- Produces:

```ts
// components/game/quest/QuestTabs.tsx
export type QuestTab = 'quest' | 'daily' | 'collection' | 'wrong';
export function QuestTabs(): JSX.Element;

// components/game/daily/DailyChallenge.tsx
export interface DailyChallengeProps {
  tier: number;
  difficulty: Difficulty;
}
export function DailyChallenge(props: DailyChallengeProps): JSX.Element;
```

- [ ] **Step 1: Create `DailyChallenge.tsx`**

Four mode cards, each showing 今日状态 (未玩 / 已完成 + score):

| Card | Component | `mode` | Score |
|---|---|---|---|
| 声调 | `ToneRadicalGame` | `tone` | `correct` |
| 部首 | `ToneRadicalGame` | `radical` | `correct` |
| 拼音·字 | `DragMatchGame` | — | `correct` (matched pairs) |
| 拼音接龙 | `ChainGame` | — | `correct` (chain length) |

- The daily key is `dailyKey(mode, difficulty, tier)` → e.g. `tone:medium:hsk1`.
- **Review Focus #4 — the three axes are independent:** the card's state is looked up with the **current** difficulty and tier, so switching either switches which slot a card shows. Completing `tone:medium:hsk1` must not mark `tone:medium:hsk2` or `tone:hard:hsk1`.
- The completion is recorded through `recordDaily(progress, key, score)` + `saveProgress`. The **first** result is the one recorded; playing again is allowed and the card then shows 「再玩一次」.
- The legacy games are loaded with `next/dynamic` (`ssr: false`) exactly as `GameModeTabs` does today, so the visitor does not download all three games before playing the first one.
- The `ToneRadicalGame` cards pass `mode="tone"` / `mode="radical"`, so the server honors the mode — the §0 #1 fix.

- [ ] **Step 2: Create `QuestTabs.tsx`**

The client component that owns the 4-tab state:
- the tabs are **闯关 · 每日一局 · 字卡册 · 生字本** (flat, 4 items);
- the HSK picker (`HskPicker`) sits **above** the tabs and is shared by 闯关 and 每日一局;
- the **quest header** (the row with the HSK chips) also carries the **声音开关** — a single toggle that mutes the four cues **and** the ② character audio (§9). It is a `<button type="button" aria-pressed={!isSoundMuted()}>` labelled 「🔊 声音」 / 「🔇 静音」, reading and writing `isSoundMuted()` / `setSoundMuted()` from `@/lib/game-sound`. One switch for all sound — there is no second toggle for the character audio;
- the panel below the tabs renders the active tab.

**The URL contract** (§7.5): on mount the component reads `window.location.search`:
- `tab` → the initial tab (`quest` / `daily` / `collection` / `wrong`; anything else → `quest`);
- `hsk` → sets the **shared** tier via `useDifficulty().setHskLevel(Number(hsk))` (only when it is 1-6);
- `level` → the level to open inside the 闯关 tab.

The 闯关 panel holds the quest's **own per-tier level pointer**, read from `progress.current[tier].level` — it is **never** derived from the tier picker, so switching tiers keeps each tier's position. The panel fetches the tier's level count from `GET /api/game/quest?hsk={tier}&level=1` (the response carries `levelCount`) and renders `QuestBoard`.

The 字卡册 panel renders `CharCollection` with `progress.collected`; the 生字本 panel renders `WrongBook` with `progress.wrong`.

- [ ] **Step 3: Rewrite `app/game/page.tsx`**

The server component becomes the shell only:

```tsx
<Header />
<PageContainer>
  <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
  <SectionTitle subtitle="一字一关 · 读音 声调 部首 词义">趣味识字</SectionTitle>
  <QuestTabs />
</PageContainer>
<Footer />
```

- The old subtitle 「声调·部首 或 拼音·字 两种玩法」 is **gone** — it lied about its own content (§0 #7) and there are now four tabs, not two modes.
- `QuestTabs` is a client component; it is imported directly (it is small — the heavy legacy games are behind `next/dynamic` inside `DailyChallenge`).
- Keep `export const dynamic = 'force-dynamic'` and the existing `generateMetadata` (update the description to match the new content).

- [ ] **Step 4: Delete `GameModeTabs.tsx` and its test**

```bash
git rm components/game/GameModeTabs.tsx tests/unit/components/game/GameModeTabs.test.tsx
```

Confirm nothing else imports `GameModeTabs`: `grep -rn "GameModeTabs" app components lib` must return only the deleted files' own history.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all green. The deleted `GameModeTabs.test.tsx` no longer runs; no other test referenced it.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Lint**

Run: `npx eslint .`
Expected: no **new** errors. The 7 pre-existing `no-explicit-any` warnings are tolerated; do not add new ones.

- [ ] **Step 8: Build in the isolated worktree**

The 4444 dev server owns the main tree — **never build there**. The worktree `D:/Temp/pinyin-build-check` already exists (it is in a **detached HEAD**, so it can be pointed at this branch's tip without touching the main tree's checkout):

```bash
# point the worktree at this branch's tip (detached — the branch itself stays
# checked out in the main tree, so `git checkout <branch>` would be refused)
git -C D:/Temp/pinyin-build-check checkout --detach perf/frontend-scan-2026-10-24
cd D:/Temp/pinyin-build-check && npx next build
```

Expected: exit 0. If the worktree is missing entirely, create it with the `superpowers:using-git-worktrees` skill instead.

Run `npm install --legacy-peer-deps` in the worktree first if `node_modules` is missing there.

- [ ] **Step 9: Commit**

```bash
git add app/game/page.tsx components/game/quest/QuestTabs.tsx \
  components/game/daily/DailyChallenge.tsx
git commit -m "feat(game): rebuild the game page around the quest [YYYY-MM-DD HH.MM]" -m "Four flat tabs: 闯关, 每日一局, 字卡册, 生字本. The HSK picker sits above them
and is shared by 闯关 and 每日一局, while the quest keeps its own per-tier
level pointer - a single global pointer would lose the position in the
other five tiers.

The old subtitle claimed two modes; there were three games, and there are
now four tabs. It is gone.

GameModeTabs and its test are deleted - QuestTabs and HskPicker supersede
them.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Final verification

After Task 9, run the whole gate:

1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — all green. The DB-backed integration test needs the env loaded first: `set -a; . ./.env; set +a; npx vitest run tests/integration/api/game-quest-db.test.ts`.
3. `npx eslint .` — no new errors.
4. `npx next build` in `D:/Temp/pinyin-build-check` — exit 0.
5. **Manual smoke** (the dev server on 4444, `curl -b "setup_completed=1"`):
   - `/game` loads and the 4 tabs render;
   - a level runs 5 chars × 4 questions; a wrong answer reveals the answer; a correct answer stamps and chimes;
   - **the correct option sits in a different position on different questions** (§0 #8, visible in one level);
   - **the pinyin stays off the char card until ② is answered** — the ② answer must not be readable off the card;
   - **② plays the character audio** and the 🔊 button replays it; ① has **no** audio control;
   - **with the network blocked, ② is still answerable** and the 🔊 button shows 「🔊 暂时不可用」;
   - the level summary appears; the progress survives a reload; switching HSK tiers keeps each tier's own position;
   - 每日一局 → 声调 shows a tone round (not a pinyin round) and 部首 shows a radical round; a finished game marks its card 「已完成」 with a score;
   - **the 声调 daily round can be finished in hard mode** (6 chars, 4 tones): every char has a token, the round reaches the finished phase, the card records the score (§0 #10);
   - 放弃 in a legacy game **does not** mark the daily card 已完成;
   - the 字卡册 and 生字本 render their entries; the 练字帖 deep link opens the worksheet with the char;
   - the mobile viewport (375 px) is tap-only and nothing overflows.

**Note:** the MySQL service on this machine could not be started without administrator rights during planning, so the dev environment's DB was down. The quest's data path is covered by the DB-backed integration test (which skips without `DATABASE_URL`) and by the DB-free `scripts/verify-quest-numbers.mjs`. **Start MySQL with admin rights before the manual smoke** — the data pages 500 without it.
