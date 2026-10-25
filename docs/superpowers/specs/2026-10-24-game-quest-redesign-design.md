# /game 闯关重设计 (Quest Redesign) — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to produce the implementation plan after this spec is approved.

**Goal:** Replace the three-tab mini-game board at `/game` with a **一字一关 quest ladder** — 5 chars per level, 4 fixed questions per char (读音 / 声调 / 部首 / 词义) — plus a **learning loop** that carries every char the user masters into the site's existing dictionary / etymology / story / worksheet surfaces.

**Why now:** User feedback 2026-10-24: 「http://localhost:4444/game 游戏界面感觉上有些偏弱，从汉字游戏设计的角度优化当前结构」. A read of the current code shows the weakness is **structural, not cosmetic** — the three games are three unrelated micro-quizzes with no objective, no progress, and no connection to what the rest of the site teaches.

**Revision note (2026-10-24, second pass).** The first draft of this document was checked by a fresh builder-reviewer agent before handover. The review found 16 defects in the *design* (not the code) — most importantly that questions ① and ② were the same question for 99%+ of chars, and that the option-shuffling PRNG in the repo is degenerate. Every number in §3 and every rule in §5 below was **re-measured against the real database and the real content files** after those findings; the sections that changed are flagged inline with a *Measured* note. Numbers in this document are measured, not estimated.

**Revision note (2026-10-25, third pass).** This document was checked by a second, independent builder-reviewer agent, which found 11 open questions and 12 internal contradictions. Every one of them was resolved and **re-measured**, and the document was rewritten where it was wrong:

- the ④ eligibility rule was stated three incompatible ways — it is now one rule (**the first free clause must exist and be ≥ 2 chars**, §1.1 C) and the measured pool follows it (2238 eligible / 449 levels);
- the ① ranking never said what a 零声母 syllable does — it is now defined (§1.1 G) and the §6.1 example is regenerated from the real PRNG;
- the same-syllable-pair count was wrong (**875 → 1390** before the sweep, **14 → 21** after it) and the "every char in a level has a different syllable" claim was false — both are now measured, and the unit test asserts *near*-zero instead of zero;
- §5.4 said both "the distractor sets are unseeded" and "the seed picks the ④ clauses" in the same breath — the seed's two jobs are now stated once, and the **pre-shuffle input order** is fixed, which is what makes the §6.1 payload reproducible at all;
- the hint rule could delete the correct answer 25% of the time — it now removes the last **wrong** option;
- `passed[hsk]` was ambiguous — it records exactly the 通关 levels;
- the legacy 声调 round was found to be **unwinnable** whenever two chars share a tone (certain in hard mode) — that bug is now §0 #10 and ships with the daily card;
- the quest's data path was found to need a deterministic row order (`ORDER BY char`) or ④'s distractors would drift between visits.

The numbers in this document are measured against the real data (the DB where it is the source of truth, `data/content/*.json` and `pinyin-pro` elsewhere), not estimated.

---

## §0 Diagnosis (verified in source, 2026-10-24)

| # | Problem | Evidence |
|---|---|---|
| 1 | **The 「声调·部首」 tab can serve a pure-pinyin round.** The tab title lies about its own content. | `lib/game-round.ts:59-65` — `pickMode(seed)` picks randomly among `tone \| radical \| pinyin`. `buildRound(count, seed, source, hskLevel)` has **no `mode` parameter**. `app/api/game/round/route.ts` parses `mode` but only feeds it to `modeForReveal` (reveal config), never to the round. `components/game/ToneRadicalGame.tsx:80-84` never sends `mode` in the query. `lib/validators.ts:179-184` even documents the intended behavior ("When set, the round is built for the requested mode") — the code never implemented it. |
| 2 | No objective, no progress, no memory. Nothing persists between visits except the HSK chip. | `components/game/GameModeTabs.tsx` — localStorage holds only the HSK level. |
| 3 | **Nothing tests the character itself.** The three games test tone-token↔char, pinyin↔char, and last-letter chaining. 部首 appears only as a *drop-target label*, 词义 never appears at all. | `components/game/ToneRadicalGame.tsx` (token bank), `DragMatchGame.tsx`, `ChainGame.tsx` |
| 4 | Wrong answers teach nothing — the correct answer is never revealed. | `ToneRadicalGame.handleDrop` on a mismatch does only `setMismatches((m) => m + 1)`. |
| 5 | Desktop-only. The two main games are drag-and-drop. | `DragMatchGame.tsx` uses the HTML5 DnD API; `ToneRadicalGame` is drop-based. No touch path exists. |
| 6 | The learned char goes nowhere — no link to the dictionary / etymology / story / worksheet pages the site already has. | `app/game/page.tsx` renders only `GameModeTabs`. |
| 7 | Copy bug: the subtitle says 「两种玩法」 but three modes exist. | `app/game/page.tsx` — `subtitle="声调·部首 或 拼音·字 两种玩法"`. |
| 8 | **The seeded shuffle is degenerate — every option set puts the answer in the same slot.** `lib/shuffle.ts` advances an LCG with `s = (s * 1103515245 + 12345) & 0x7fffffff`; the product exceeds 2^53, so float64 silently truncates the low bits, and the index is taken from those low bits. | `lib/shuffle.ts` — **Measured**: over 8952 (char × question-kind) combinations, the correct option landed in slot 3 for **99.9%** of them (slot 0: 0, slot 1: 0.06%, slot 2: 0.03%). Every game built on this helper has a fixed answer position. The existing unit test only asserts length/uniqueness/no-mutation, so it never caught this. |
| 9 | **The three legacy games expose no completion signal**, so a daily-challenge card cannot show 「已完成 + 分数」 without changing all three. | `DragMatchGame.tsx:40` and `ToneRadicalGame.tsx:31` take **no props at all**; they keep `mismatches` / `matchCount` internally. `ChainGame.tsx:22` has a `phase: 'finished'` and a `chain[]` but no score (its own comment says "there's no score system"). |
| 10 | **The 声调 round is unwinnable whenever two chars share a tone** — and in hard mode that is guaranteed. | `lib/game-round.ts:171` — `toneChoices = [...ALL_TONES]` is always the 4 tone tokens, but a round holds 3 / 4 / 6 chars (`lib/difficulty.ts` `TONE_RADICAL_CONFIG`). `components/game/ToneToken.tsx:12` disables a matched token, and `ToneRadicalGame.tsx:133` tracks matched **values** (tones) — so two chars of the same tone fight over one token, the second can never be matched, `matchCount` never reaches `round.chars.length`, and the round never auto-finishes. With 6 chars and 4 tones, the pigeonhole principle makes the collision certain. |

**Conclusion:** the fix is not a reskin. It needs a new information architecture (a quest ladder), a new question model (the character as the subject of the test), real feedback, a progress model, and a learning loop.

---

## §1 Locked user decisions (2026-10-24)

These were decided by the user via structured questions. **They are binding.**

1. **改造幅度 = 一字一关闯关 + 学习闭环** (the fullest option, not "polish in place").
2. **旧玩法 = 降级为「每日一局」** — the three existing games are kept, not deleted, but demoted to a daily-challenge side entry.
3. **考问集 = 固定 4 项全考** — every char is tested on 读音 + 声调 + 部首 + 词义; **all four must be correct** for the char to count as learned.
4. **进度存储 = 本地 localStorage** — no server table this round.
5. **关卡长度 = 5 字一关** — 5 chars per level.

**Terminology reconciliation (mine, for the record):** decision 1 names the mode 「一字一关」 and decision 5 fixes the level at 5 chars. The two are consistent under this reading, which the approved mockup already showed: **a level (关) contains 5 chars, and each char is one 关卡 checkpoint inside the level.** The level title is 「第 N 关」; the checkpoint header reads 「第 N 关 · 第 i/5 字」. Both phrasings are used in the UI exactly this way.

### 1.1 Design calls I made (mine, not the user's — flag them if you disagree)

| # | Call | Why |
|---|---|---|
| A | **① 读音 asks for the *toneless syllable* (`ai`), ② 声调 asks for the *tone-marked form* (`āi` / `ái` / `ǎi` / `ài`) — and ② plays the character aloud.** | The two questions must have **disjoint answer spaces**, otherwise one of them is free. If ① offered the four tone forms of the same syllable, ② would be literally the same question (the answer key of ① determines ②). With ① = syllable and ② = tone, the pair determines the full reading `ài` and neither question leaks the other. The learner still practises reading a tone mark, because ②'s options are the marked forms. The user chose (2026-10-25) that ① stays silent — a 认读 question — and ② is answered by ear, so the pair trains one skill each: 形→音 and 音→调. |
| B | **轻声 chars and 嗯 are excluded from the quest pool** (13 chars). | 轻声 has no tone mark, so ② has no correct option; 嗯's tone mark (`ǹ`) is a syllabic nasal with no displayable variants. Excluding 13 chars is far cheaper than inventing a 轻声 question type. |
| C | **A char is excluded from the ④ question unless its *first free clause* exists and is ≥ 2 chars** — "free" = a clause that does not contain the quest char. **381 chars** across the tiers are excluded. | Otherwise the correct option literally shows the char inside the definition and the question is a free point; and a 1-char option is not a definition. *Measured*: 337 chars have **no** free clause at all, and 46 more have a first free clause of only 1 char — 2 of those 46 are 轻声/嗯 and are already excluded by rule B, leaving **381** skipped for this reason. |
| D | **The level ladder is built by a "syllable sweep"**, not a plain 5-char slice (§5.1.2). | A plain slice puts same-syllable chars (八 bā / 爸 bà) in the same level, which makes ① ask the *identical question twice* — measured at **1390** such pairs across 449 levels (up to **5** chars of one level can share a syllable). The sweep cuts that to **21** pairs in 6 levels, and yields a proper textbook curriculum (one char per syllable, alphabetically). |
| E | **The PRNG in `lib/shuffle.ts` is fixed** (32-bit `Math.imul` LCG + high-bit index) as part of this work. | §0 #8. Without it the quest's whole premise (the answer is not always in the same place) is false. |
| F | **部首 distractors are the Kangxi radicals nearest in Unicode code point.** | The DB stores the canonical Kangxi radical, and the Kangxi radicals are laid out in Unicode order by meaning/appearance (爪 U+722A next to 父 U+7236; 木 U+6728 next to 月 U+6708 and 欠 U+6B20). Nearest-by-code-point therefore yields the radicals a learner is most likely to confuse. |
| G | **A 零声母 syllable never counts as "same initial"** when the ① distractors are ranked (§5.2 ①). | 零声母 vs 零声母 is not a confusion the language has — 爱 and 儿 do not sound alike, they only look alike. Ranking them as "same initial" would also put the *same* syllable twice in one option set. With the rule, 爱's distractors are `cai / kai / lai` — three real confusions. |
| H | **The ④ option is always the *first* free clause, and the eligibility rule is the same rule** (§1.1 C, §5.1.1). | The question and the pool must agree, or the answer key of one char would not be the option of another. The looser reading ("some free clause of ≥ 2 chars exists") would admit 40 more chars and 8 more levels, and the numbers in §3 would be wrong. |

---

## §2 Scope

### Goals

- G1. A learner can start at 「第 1 关」 and progress through a **deterministic ladder** of **449 levels** (HSK 1-6) with a clear, always-visible objective.
- G2. Each char is tested on **4 fixed facets** (读音 / 声调 / 部首 / 词义), all four required. ① 读音 is answered **silently** (认读: glyph → syllable) and ② 声调 is answered **by ear** (听辨: the character's audio plays, the learner identifies its tone). One skill per question, and the two answer spaces stay disjoint.
- G3. Every answer gives **immediate, teaching-grade feedback** (correct answer revealed on a miss, with a 朱红印章 + sound on a hit).
- G4. A mastered char is **captured** into a 字卡册 with one-tap exits to 字典 / 字源 / 故事 / 字帖.
- G5. A missed char lands in a **生字本** with a one-tap path to a printable worksheet.
- G6. Progress survives a page reload (localStorage) and the entry point is 「继续闯关」.
- G7. The three legacy games keep working, reachable from a 「每日一局」 tab, and the 「声调·部首」 mode lie (§0 #1) is fixed.

### Non-goals (explicitly out)

- No server-side progress table, no account sync, no leaderboard, no social layer.
- No new npm dependency. No new audio asset files. No image assets. (The character audio is **synthesised at runtime** through the site's existing Edge TTS path — `lib/tts.ts` `speak()` + `lib/tts-cache.ts`'s Cache API — exactly like the dictionary page's 「读字」 button. Nothing is added to the repo and no new server route is needed.)
- No drag-and-drop anywhere in the new quest UI (tap-only; the legacy games keep their DnD).
- No change to the `/api/game/round` **response shape** (see §4.2 for the one semantic fix).
- No work on `SutraCopyView` / `ClassicReader` render storms (deferred by the user to a later round).
- No font subsetting work (out of scope since the 2026-10-24 perf batch).

### Anti-goals (a failure even if it "works")

- A quest that is only a reskin of the old games (no new question model ⇒ nothing gained).
- A level whose content is random per visit (breaks the shareable-URL / reproducible-level promise and makes 「重做」 unfair).
- A quiz that punishes without teaching (wrong answer must always reveal the answer).
- A progress model that silently loses data on a corrupt payload (must fall back, not crash).
- A question whose answer can be read off another question (see §1.1 A).

---

## §3 Constraints (binding)

### Project-wide

- **package manager**: `npm` (per `project-uses-npm.md`), installs with `--legacy-peer-deps`. **No new dependency.**
- **Tailwind v4** does not read `tailwind.config.ts` — the only theme source is the `@theme` block in `app/globals.css`. Available tokens: `--color-paper #f4ecd8`, `--color-paper-soft #fffaee`, `--color-paper-deep #e8dcc0`, `--color-paper-warm #ecdfc2`, `--color-ink #3a2a14`, `--color-ink-soft #5a4530`, `--color-ink-faint #8b6f3a`, `--color-seal #b22b2b`, `--color-success #4a7c59`, `--color-warning #c99a3e`, `--color-danger #b22b2b`, `--color-info #4f6b8c`. A class referencing an undefined colour silently renders nothing.
- **`app/**/page.tsx` changes require a successful `next build`** (per `feedback-per-task-pnpm-build-gap`). **The 4444 dev server must be alive-free before building** — build in the isolated worktree `D:/Temp/pinyin-build-check` (per `dev-build-cache-stomp`).
- **No push.** This branch has no production environment (per `no-prod-env-2026-06-21`).
- **New API routes** must send `Cache-Control: no-store` (per `feedback-cache-control-route-iterations`).
- **Middleware** gates every route except `/init*`, `/api/init/*` and static assets behind the `setup_completed=1` cookie — smoke-test with `curl -b "setup_completed=1"`. The quest route is therefore *also* 307-gated without that cookie; this is the site's normal behaviour, not a quest bug, and the route's unit test calls the handler directly (§11) so it does not depend on a live server.
- Commit subjects end with `[YYYY-MM-DD HH.MM]`; commit bodies end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- UI copy in Chinese; code identifiers in English.

### Data facts — *Measured 2026-10-24 against the local DB + `data/` (all numbers re-derived for this revision)*

> Every number in this table is reproducible without a database:
> `node scripts/verify-quest-numbers.mjs` re-derives all of them from `data/hsk-vocab.json`,
> `data/content/<char>.json`, `data/radicals.json` and `pinyin-pro`. If the script's output
> disagrees with this document, **the document is wrong** (or the data changed) — fix the
> document, not the script.

| Fact | Value | Consequence |
|---|---|---|
| `chars.hsk_level` distribution | 1: 178, 2: 168, 3: 272, 4: 453, 5: 639, 6: 922 (2632 total) | the tier sizes |
| `chars.pinyin` | **empty for every row** (2632/2632 HSK rows, 7909/7909 overall) | Pinyin must come from `pinyin-pro` at runtime, not the DB — `lib/pinyin-index.ts` (`resolvePinyin`) is the single resolver, used by the dictionary page, the A-Z index and this quest |
| `chars.stroke_count` | **0 for every HSK row** | Level ordering cannot use stroke count (the sweep orders by syllable, not by stroke count — see §5.1.2) |
| `chars.radical` | populated on all 2632 rows; **201 distinct values, all already Kangxi-canonical** (人 / 艸 / 車 / 辵 / 手 / 水 …; the variant forms 亻 / 艹 never appear) | the quest displays the stored string verbatim and needs **no 简繁 alias table** — every distinct stored radical is already its own base, so a "same base" check would never fire. Dropped `data/radicals.json` from the quest path (it is a 70234-entry / 0.84 MB file whose only relevant behaviour is a no-op here). |
| `chars.level` | 1 for all but 24 HSK-tier rows (HSK5: 3 rows at level 2; HSK6: 21 rows at level 2) | Not usable as an in-tier difficulty axis |
| `pinyin-pro` cost | 2632 chars in **18 ms** | Tier lists can be sorted by pinyin at request time, cached per process |
| `pinyin-pro` vs curated pinyin | **0 mismatches in 2632 chars** | The runtime reading equals `data/content/<char>.json`'s `pinyin` — one source of truth is enough |
| `pinyin-pro` on a raw accented string | `pinyin('yí', { toneType: 'none' })` → `"y í"` (it does **not** understand a pre-toned Latin syllable) | an alternate reading must be **tone-stripped by hand** (§5.2 ①), never round-tripped through pinyin-pro |
| `data/content/<char>.json` | 7905 files; **all** have top-level `pinyin` + `dict.meaning_zh` + `dict.pinyin_alt`; **all** 2632 HSK chars have one | Meaning questions always have a source |
| `dict.meaning_zh` | a single phrase, not a list; **1884/2632 contain a separator**, 748 do not | the ④ option is the **first clause that does not contain the quest char** (§5.2 ④) |
| `dict.pinyin_alt` | contains the canonical reading on **all 2632** chars; **416 chars** have an alternate reading whose *plain syllable differs* from the canonical one (不 bù/bú/fǒu/fōu/pī, 什 shén/shí, 和 hé/hè/huó/huò/hú …) | the alternate-reading exclusion is meaningful for those 416 and a no-op for the rest |
| `dict.meaning_zh` vs the char | **337 chars have no clause free of the quest char**; **46 more** have a first *free* clause of only 1 char; 777 have the char in their *first* clause | the ④ question would be a free point for the 337 → excluded; the 46 one-char free clauses are excluded too (§1.1 C) |
| Meaning clause length | mean first-clause length 7.71 chars; 62 first clauses are shorter than 2 chars; of the *first free* clauses, 46 are exactly 1 char | the ④ option must be ≥ 2 chars |
| Tier syllable pool (distinct plain syllables) | 129 / 123 / 168 / 229 / 273 / 316 | ≥ 4 per tier ⇒ the ① option set always exists |
| Tier radical pool (distinct) | 81 / 83 / 101 / 128 / 140 / 138 | ≥ 4 per tier ⇒ the ③ option set always exists |
| Tier meaning-clause pool (deduped) | 150 / 146 / 226 / 383 / 543 / 820 | ≥ 4 per tier ⇒ the ④ option set always exists |
| **Eligible pool** (all 4 questions buildable) | **152 / 140 / 220 / 376 / 535 / 815 = 2238** of 2632 | 394 chars skipped: 12 轻声 + 1 嗯 + 381 meaning; **0** chars were skipped for want of distractors |
| **Level count** (5 chars/level) | **31 / 28 / 44 / 76 / 107 / 163 = 449 levels** | the ladder depth per tier |
| Tail levels | HSK 1 level 31 holds 2 chars; HSK 4 level 76 holds 1 char; every other level holds exactly 5 | the runner must handle a short level; the UI says 「本关 N 字」 |
| Radical diversity per level | per-tier mean **4.68 – 4.91** distinct radicals; **every full 5-char level has ≥ 3** (447 full levels, 0 below 3); only the two short tail levels have 2 (HSK 1 L31) and 1 (HSK 4 L76) | the ③ question stays meaningful |
| Same-syllable pairs inside a level | **21** pairs in **6** levels (HSK 3 L44, HSK 4 L74/L75, HSK 5 L107, HSK 6 L162/L163); a plain 5-char slice would produce **1390** | the sweep (§5.1.2) is what keeps this near zero |
| 读音 distractor quality | for **2581 of 2619** tone-bearing chars the ① top-3 contains a same-initial syllable (a 零声母 syllable never counts as "same initial" — §5.2 ①) | the ① options are confusable but distinct |
| Reading a tier's content files | `data/content/<char>.json` for a whole tier, cold, including JSON.parse: **~20 ms** (tier 1) / **~70 ms** (tier 4) / **~120 ms** (tier 6) — a disk-cache-sensitive range, re-measurable with `node scripts/verify-quest-numbers.mjs`; 0 ms once the tier is memoized | the tier is loaded **once per process** and memoized (§5.1) — the first request for a tier pays ~100 ms of server time, every later request is a hit |
| Radical source cross-check | the tier radical pools measured from `data/radicals.json` (81 / 83 / 101 / 128 / 140 / 138) are **identical** to the pools measured from `chars.radical` | the two sources agree on the HSK set, so the pool sizes and the ③ distractors are source-independent |
| `lib/radical.ts` | `getRadical(char)` → radical string, `import 'server-only'` | not needed by the quest (§3 radicals row) |
| `lib/story.ts` | `getHanziStory(char)` → story or null; source order `etymology.story` → `hanzi_story` → `rare.story`. **All 2632 HSK chars have `etymology.story`** (the two legacy sources are empty) | the quest API can set `hasStory` with the same precedence; in practice it is always true for the quest pool, but the flag is still computed rather than assumed, so a future content regeneration that drops a story degrades the link instead of 404-ing |
| `components/worksheet/WorksheetGenerator.tsx:48` | accepts `?prefill=<char>` (single char, exact-match) | 练字帖 deep link per char |
| `POST /api/worksheets` | `saveWorksheetSchema`: `title`, `content[]` (1-500 CJK), `cellStyle` ∈ brush-square/brush-cross/pen-square/pen-cross/brush-trace-square/brush-trace-cross, `paperSize` ∈ A3/A4/B5/brush-12/24/28, `fontFamily` ∈ song/kai/hei/wenkai-gb/yozai/… | 生字本 → one-tap worksheet generation. **Requires login** (`getCurrentUser`). **The 500-char cap applies to the 生字本 batch** — the UI must show 「本次生成前 500 字」 and offer per-char links beyond that. |
| `lib/reveal.ts` | `REVEAL_BY_LEVEL` 1→[pinyin,meaning,radical], 2→[pinyin,meaning], 3\|4→[pinyin], 5\|6→[] | the quest's per-question hint follows the same *shape* (more hints at low HSK) but is defined separately (§5.5) because in the quest pinyin/meaning/radical are the **answers**, not the hints |

---

## §4 Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  /game  (server component: shell, HSK tier tabs, meta)                  │
│  ┌──────────────────────────┬─────────────────────────────────────────┐  │
│  │ 闯关 (Quest)             │ 每日一局 (Daily)  │ 字卡册 │ 生字本      │  │
│  └──────────────┬───────────┴────────┬─────────┴───┬─────┴───┬────────┘  │
│                 │                    │             │         │           │
│   QuestBoard    │              DailyChallenge  CharCollection  WrongBook│
│   (level map)   │              ├ ToneRadicalGame(mode=tone)          │
│        │        │              ├ ToneRadicalGame(mode=radical)       │
│        ▼        │              ├ DragMatchGame                       │
│   QuestRunner   │              └ ChainGame                           │
│   (5 chars ×    │                     │                                 │
│    4 questions) │                     ▼                                 │
│        │        │              /api/game/round?mode=…  (mode now honored)│
│        ▼        │              /api/chain/chars                        │
│  GET /api/game/quest?hsk=1&level=3                                    │
│        │                                                               │
│        ▼                                                               │
│  lib/game-quest.ts  ← pure: tier list, sweep, question builder         │
│        │                                                               │
│        ├── lib/chars.ts (SQL)  ·  pinyin-pro  ·  data/content/*.json   │
│        ▼                                                               │
│  localStorage: pinyin-character:game-progress:v1                        │
│  (per-tier level pointer · streak · collected · wrong · daily)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## §5 The quest data model

### 5.1 Tier list

For HSK tier `N`, the char list is every row with `chars.hsk_level = N` (178/168/272/453/639/922 rows). One SQL query, no `LIMIT` (max 922 rows). The tier list is **cached per process** (module-level memo) because it is identical for every request within a tier.

**What a tier load reads.** The SQL query returns `char`, `hsk_level` and `radical` for the tier's rows; the readings come from `pinyin-pro` and the meanings from `data/content/<char>.json` — one file per tier char. *Measured*: reading and parsing a whole tier's content files costs 24 ms (tier 1) / 59 ms (tier 4) / 103 ms (tier 6) cold, and nothing at all once the tier is memoized. The whole tier — rows + readings + meanings + the derived pools — is therefore built **once per process** and reused; the first request for a tier pays ~100 ms of server time, every later request is a cache hit. The memo is keyed by tier and lives in the same module as the pure builders (§7.6), so the route stays a thin adapter over it.

**The tier query must have a deterministic row order** — `ORDER BY char` (Unicode code point). Without it MySQL may return the tier's rows in a different order on a different call, and the ④ clause pool is built *in row order* (§5.2 ④), so the drawn distractors would drift between two visits to the same URL — breaking the reproducibility promise that the whole level identity rests on.

**Sort key.** `(plainSyllable, tone, char)` where:
- the **reading** comes from `resolvePinyin(char, row.pinyin)` (`lib/pinyin-index.ts`) — the same resolver the dictionary page uses, so the quest's reading and the site's reading can never drift;
- `plainSyllable` = that reading with its tone mark replaced by the plain vowel (`chūn` → `chun`, `lǜ` → `lü`). **ü is preserved**: it is a distinct vowel, and folding it to `u` would reorder the `lü`/`lu` and `nü`/`nu` syllables and change which chars share a level. (This is *not* `lib/pinyin-index.ts`'s `readingSortKey`, which folds ü→u for a compact ASCII key and is used by the dictionary's A-Z index — the two orders are deliberately different, and the numbers measured below belong to the quest's own key);
- `tone` = `toneFromPinyin(reading)` (`lib/pinyin-tone.ts`) — 1-4 (轻声 is excluded from the pool, so it is never null here).

**Sorting by plain syllable groups the tier into alphabetical-by-syllable order, which keeps consecutive levels thematically adjacent (all `a-` syllables first) while keeping ~4.8 distinct radicals per level. **Sorting by Unicode code point is forbidden**: it would put every `一`-radical char in the first levels and make the 部首 question degenerate.

### 5.1.1 The eligible pool (why the level slice has no holes)

The 4-question set can only be built for a char that satisfies **tier-level** conditions. The tier builder computes an **eligible pool** once (cached per process), and the level slice is taken from *that* pool — so a char that cannot be fully questioned simply never appears, instead of leaving a hole in a level or shipping a broken question.

A char is eligible when all of the following hold:

1. it has a non-empty radical, and the tier's radical vocabulary contains ≥ 3 other radicals (enough for question ③);
2. its canonical reading has a tone of 1-4 **and** the tone-marked final can be decomposed into 4 tone forms (§5.3) — this excludes the 12 轻声 chars and 嗯;
3. its `dict.meaning_zh` has a **first free clause** — the first clause that does not contain the quest char — and that clause is **≥ 2 chars**; and the tier's meaning pool contains ≥ 3 clauses that survive the same filters (§5.2 ④). *The "first" is load-bearing*: the ④ option is always the first free clause, so the eligibility rule must be the same rule. Measured: the looser "**some** free clause of ≥ 2 chars exists" admits 2278 chars and 457 levels — 40 more chars and 8 more levels than the numbers in §3;
4. the tier's syllable pool contains ≥ 3 plain syllables that survive the 读音 exclusion rules (§5.2 ①) for this char;
5. `dict.pinyin_alt` exists (it does for every char) so the alternate-reading exclusion can be applied.

All five conditions depend on the **tier**, never on the level index — so the pool is computed once and there is no circular dependency between "which chars are in this level" and "which distractors exist for this char". Chars that fail are skipped and counted; the count is exposed on the API response as `skipped` so a data-quality problem is visible instead of silent.

*Measured*: eligible 152/140/220/376/535/815 (2238 of 2632); skipped 26/28/52/77/104/107 (394 total: 12 轻声 + 1 嗯 + 381 meaning). **No char was skipped for want of distractors** — in all six tiers the syllable / radical / clause pools always left ≥ 3 candidates.

### 5.1.2 The level ladder — the syllable sweep

A plain `slice((L-1)*5, L*5)` over the sorted tier puts same-syllable chars next to each other (八 bā / 爸 bà are adjacent in the sort), so one level can ask ① **the identical question up to 5 times** (a whole level can be one syllable). Measured: **1390 same-syllable pairs across the 449 levels**.

The quest instead builds the ladder with a **syllable sweep**:

1. Group the tier's eligible chars by `plainSyllable`; the groups are in syllable-alphabetical order (the sort order of §5.1), and within a group the chars are in tone order.
2. **Read the groups column by column**: the 1st char of every group, then the 2nd char of every group, then the 3rd, …
3. Slice the swept sequence into levels of 5.

Result: level 1 = the first char of the first 5 syllables, level 2 = the first char of the next 5 syllables, … — a textbook sweep through the syllable space — and later levels deepen (the 2nd char of each syllable). Within a level the chars **almost always** have different syllables, so ① asks a different question for every char and ② has a different option set for every char. The exception is a column boundary (below).

*Measured*: same-syllable pairs drop from **1390** to **21** (the residue is a column-boundary artifact: when a syllable has chars in two consecutive columns, the last char of one column and the first of the next can land in the same 5-char slice). The 21 pairs sit in **6** levels — HSK 3 L44 (1 pair), HSK 4 L74 (2) and L75 (6), HSK 5 L107 (6), HSK 6 L162 (2) and L163 (4) — and at most **3** same-syllable chars share one level. They are not repaired — a repeated ① in one level is a reinforcement, not a defect, and a repair pass would perturb the curriculum order. This is stated here so the number in the code matches the number in the design, and so the unit test (§11) asserts *near*-zero rather than zero.

**Level identity.** `(hsk, level)` fully determines the 5 chars, the 4 questions, the option sets **and the option order** (see §5.4). `GET /api/game/quest?hsk=1&level=3` is therefore reproducible and shareable.

### 5.2 The four questions

Every char is asked **all four**. Each is a 4-option multiple choice. The client renders the prompt from a `kind → prompt` map; the server supplies `kind`, `options`, `answerIndex`.

#### ① 读音 (pinyin) — 「这个字读哪个音节？」

- **Correct**: the char's **toneless** syllable, e.g. `ai` (for 爱). The toned reading is *not* shown here — that is question ②.
- **No audio on ①.** ① is a 认读 question: the learner looks at the glyph and recalls its sound. A 🔊 button here would play the very syllable being asked for and hand over the answer, so ① carries no audio at all — not even an on-demand one.
- **Distractors**: 3 other toneless syllables from the tier's syllable pool.
- **Ranking score** for a candidate syllable `c` against the correct `x`:
  `+3` if same initial (声母), `+2` if same final (韵母, toneless). Ties are broken by the syllable's alphabetical order, then the whole set is permuted by the seed (§5.4).
  - **A 零声母 syllable never scores "same initial"** — not even against another 零声母 syllable. The 37 零声母 chars in the tiers (爱 / 儿 / 二 …) are compared on their finals only. *Measured*: with this rule 爱's top 3 is `cai / kai / lai` (all sharing the final `ai`); with the opposite rule it would be `er / cai / kai`, i.e. it would offer a 零声母 syllable against a 零声母 syllable — a confusability that does not exist in the language, and one that repeats the same syllable twice in the option set.
  *Measured*: 2581 of 2619 tone-bearing chars get a same-initial distractor in the top 3, so the options are confusable but never identical.
- **Exclusion rules** (a candidate is rejected outright):
  - its plain syllable equals the correct plain syllable (this is what makes ① and ② disjoint — §1.1 A);
  - its plain syllable equals the plain form of **any** reading in the char's `dict.pinyin_alt` (e.g. 什 must not offer `shi`; 416 chars are affected). The plain form of an alternate reading is computed by **stripping the tone mark by hand** — `pinyin-pro` cannot process a pre-toned Latin syllable (`pinyin('yí',{toneType:'none'})` → `"y í"`).

#### ② 声调 (tone) — 「这个音节读第几声？」

- **Prompt**: the **toneless** syllable, rendered large — e.g. 「`ai` 读第几声？」. The learner sees the sound and must place the tone.
- **The character is played aloud (听辨声调).** The question auto-plays the character's audio once when it appears, and a 🔊 button replays it. The learner identifies the tone by ear — this is the 听说 half of the pair, and it is what makes the four options meaningful (they are four *audible* alternatives, not four spellings).
- **The audio plays the character, not the pinyin string.** `speak('爱')` always carries the canonical tone, because the TTS engine resolves a real character. `speak('ài')` depends on the engine parsing a bare pinyin string, and if it flattened the tone mark every option would sound identical — the question would be unanswerable. So the quest speaks the character, with the same voice as the dictionary page's 「读字」 button.
- **Audio is a progressive enhancement, never a blocker.** The Edge TTS upstream is flaky (it returns 403 often enough to have its own fix, `fix(tts): 修复 Edge TTS 上游 403 被吞成 HTTP 500`). If the request fails or has not produced audio within ~3 s, the question stays fully answerable without it: the 🔊 button shows 「🔊 暂时不可用」 and the learner answers from the char card and memory. The audio must never gate the answer, and the audio state is per question, not per level.
- **Options**: the 4 tone forms of that syllable — `āi` `ái` `ǎi` `ài` (built from the final, §5.3).
- **Correct**: the form equal to the char's canonical reading.
- **轻声 chars are not in the pool** (§1.1 B), so there is no 轻声 variant set. This removes the 11-char special case the first draft of this spec carried — the real count of 轻声 chars in the HSK tiers is **12** (么们吗呢的吧着啊呀嘛瘩裳), not 11.

#### ③ 部首 (radical)

- **Correct**: `chars.radical` as stored (canonical Kangxi form, e.g. 艸 for 茶).
- **Distractors**: the 3 radicals of the **active tier's** radical vocabulary (81-140 distinct per tier) that are **nearest in Unicode code point** to the correct radical. The vocabulary is the tier's, so the same radical yields different distractors in different tiers. *Measured, tier 1*: 爪 U+722A → 父 U+7236 (Δ12), 犬 U+72AC (Δ130), 玉 U+7389 (Δ351) — 火 (Δ447) is 4th; 木 U+6728 → 月 U+6708 (Δ32), 日 U+65E5 (Δ323), 欠 U+6B20 (Δ1016) — 手 (Δ1245) is 4th, and 斤 (Δ388) is *not* in tier 1's vocabulary. The Kangxi radicals are laid out in Unicode order by appearance/meaning, so nearest-by-code-point surfaces the radicals a learner actually confuses.
- **Exclusion rules**:
  - the candidate string equals the correct string.
  - *Dropped from the first draft:* the "same base" check via `data/radicals.json`. **Measured**: all 201 distinct radicals stored in the DB are already their own base (亻 / 艹 never appear), so the check can never fire — and it would drag a 70234-entry / 0.84 MB JSON into the quest path for nothing. A hand-maintained 简繁 alias table is recorded as a follow-up (§13) in case the DB ever stores variant forms.
- **Display**: the stored string, verbatim.

#### ④ 词义 (meaning)

- **Correct**: a clause of `content.dict.meaning_zh` — the **first clause that does not contain the quest char** (split on `，,、；;。:：` and whitespace, trimmed) — and it must be **≥ 2 chars**: a 1-char option is not a definition, and such chars are excluded from the pool (§1.1 C). The full text is revealed on the char card after the question is answered.
- **The tier clause pool** (the distractor source, and the same shape as the correct answer): for every char in the tier, take **its** first clause that does not contain **its own** char; dedupe the result. The chars are visited in the tier's row order (`ORDER BY char`, §5.1), so the pool — and therefore the seeded draw below — is stable. *Measured*: **150 / 146 / 226 / 383 / 543 / 820** clauses for HSK 1-6. The pool is built from the *first* clause of each char, not from every clause of every meaning — so every option in the question is a short definition phrase of the same shape, instead of a short phrase next to a 20-character tail.
- **Distractors**: 3 other clauses from the tier's clause pool. The surviving candidates are shuffled with the seed and the first 3 are taken, so different chars in a level get different distractor sets (a fixed 3 would make the whole level share three identical wrong answers).
- **Exclusion rules**:
  - the candidate clause contains the quest char (that would give the answer away);
  - the candidate clause shares a 2-character substring with the correct clause (kills near-synonyms such as 春天 / 春季);
  - the candidate clause is empty, or shorter than 2 chars.
  *Measured*: the 2-char-substring filter removes a large share of the pool but never starves a tier — **0 chars in all six tiers** were rejected for a lack of surviving distractors. In HSK 1, **116 of the 157 chars** that have a valid clause have a near-synonym twin in the pool, so the filter prunes a candidate for **every single char**; the per-tier figures are 116 / 100 / 145 / 256 / 421 / 618.

### 5.3 Tone-form construction

**One source of truth for the tone marks.** `lib/pinyin-tone.ts` already owns the canonical mark→tone table (`TONE_MAP`, 24 marks: `āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ`). It deliberately **excludes** the syllabic-nasal marks (`ǹ` / `ň` / `ḿ`) — precisely why those chars cannot be questioned for tone. The quest therefore **exports `TONE_MAP` from `lib/pinyin-tone.ts`** (a one-line change: `export const TONE_MAP`) and derives the mark set, the plain-form map, and the tone-order groups from it, instead of hard-coding a second copy of the 24 marks. `toneFromPinyin(py)` stays the way the quest obtains the **tone number** (it returns `null` for 轻声).

`pinyin-pro` returns a final that already carries the tone mark on the correct vowel (`chūn` → final `ūn`; `liù` → final `iù`; `lǜ` → final `ǜ`; `lüè` → final `üè`; `cháng` → final `áng`; `guī` → final `uī`).

Algorithm (pure, unit-tested):
1. `final = pinyin(char, { pattern: 'final' })`.
2. Find the **first** character of `final` that is a key of `TONE_MAP`. Plain `ü` is **not** a key, so `lüè` resolves at the `è` (index 1), not at the `ü`.
3. If no such character exists → the char has **no tone mark** → **excluded from the quest pool**. That covers the 12 轻声 chars *and* 嗯 (`ǹg`, whose `ǹ` is deliberately not in `TONE_MAP`). *Measured*: exactly 13 chars in the HSK tiers are affected (12 轻声 + 嗯).
4. `base` = `final` with that one character replaced by its plain form (`TONE_MAP` gives the tone number; the plain form comes from a `PLAIN_OF` map derived from the same table).
5. The 4 variants = `base` with that same index replaced by the vowel's tone group: `ā á ǎ à` / `ē é ě è` / `ī í ǐ ì` / `ō ó ǒ ò` / `ū ú ǔ ù` / `ǖ ǘ ǚ ǜ`.
6. The full syllable = `initial + variant`, where `initial = pinyin(char, { pattern: 'initial' })` (may be empty for 零声母 syllables such as 爱/啊).
7. **After j / q / x / y, ü is written `u`.** `pinyin-pro`'s `final` pattern *restores* the ü of such a syllable (`学` → final `üè`, `军` → `ǖn`, `去` → `ǜ`), but the standard orthography — and pinyin-pro's own full-syllable output — write it as `u` (`xué`, `jūn`, `qù`). So when the initial is j/q/x/y, a **tone-marked** ü takes the **u** group (`ū ú ǔ ù`, not `ǖ ǘ ǚ ǜ`) and a **plain** ü in the head (the carrier of `xué` / `quán`) is spelled `u`. Without this step the four forms of 学 come out as `xüē xüé xüě xüè` and the char's own reading is not among them — §5.2 ②'s 「Correct: the form equal to the char's canonical reading」 would be violated. *Measured 2026-10-25*: 85 of the 2632 tier rows are affected (去/学/觉/雪/军/全/需/ …), and the rule changes **no** measured number — the eligible pool, the level counts and the pool sizes are identical with and without it.

Unit-test vectors (all verified against `pinyin-pro` v3.25.0): 春 `chūn` → `chūn chún chǔn chùn`; 妈 `mā` → `mā má mǎ mà`; 绿 `lǜ` → `lǖ lǘ lǚ lǜ`; 略 `lüè` → `lüē lüé lüě lüè`; 归 `guī` → `guī guí guǐ guì`; 爱 `ài` → `āi ái ǎi ài`; 长 `cháng` → `chāng cháng chǎng chàng`; 去 `qù` → `qū qú qǔ qù`; 学 `xué` → `xuē xué xuě xuè`; 军 `jūn` → `jūn jún jǔn jùn`; 全 `quán` → `quān quán quǎn quàn`.

### 5.4 Determinism

- Seed = `fnv1a32(`${hsk}:${level}:${char}:${kind}`)` — a pure 32-bit hash, no crypto import.
- **The distractor *sets* are deterministic** — that is deliberate, because they are pedagogical choices that should be explainable, not random: ① ranks by same-initial (+3) / same-final (+2) with an alphabetical tie-break; ③ ranks by |code-point distance|. **④ is the one kind whose *selection* is seeded**: the surviving candidates are seed-shuffled before the first 3 are taken, so the same clause is not the distractor for every char in a level.
- **The seed drives exactly two things**: (a) which ④ clauses are drawn, and (b) **the permutation of the 4 options** — i.e. where the correct answer sits.
- **The pre-shuffle input order is fixed** — this is what makes the option array reproducible, and it is what the §6.1 example is generated from:
  - **① / ③ / ④** → `[correct, ...distractors in their rank order]` (① ranked by the score above, ③ by code-point distance, ④ by the seed-shuffled draw);
  - **②** → the 4 tone forms in **tone order** (1 → 4), with the correct one sitting at its own tone's index.

  The options are then `seededShuffle(input, seed)` and `answerIndex` is the index of the correct option inside the permuted array.
- **The PRNG must be fixed first** (§0 #8). `lib/shuffle.ts` becomes:

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

  `Math.imul` keeps the LCG exact in 32-bit (no float64 precision loss) and the **high bits** are used for the index because an LCG's low bits have a period of 2 — using the low bits is what makes the answer position collapse. *Measured over 8952 char×kind combinations*: the old code puts the answer in slot 3 for 99.9% of them; the fixed code gives 25.6% / 25.2% / 24.8% / 24.3% (max 25.6%).
- Consequences: the same URL always produces the same paper; a shared URL is meaningful; a retry of a missed question shows the same options; the answer is not always in the same position.
- The existing `tests/unit/lib/game-round.test.ts` assertions (length, uniqueness, no mutation) all still hold after the fix — they never depended on the old byte order.

### 5.5 Per-question hint

One hint per question, available on every question, uniform across kinds:

- **Effect**: removes one **wrong** option — **the last wrong option in the seeded option permutation** (deterministic, and it works identically for all four question kinds, which the first draft's "remove the last-ranked wrong option" did not define for ②③④). The correct answer is never the one removed: the permutation's last slot holds the correct answer ~25% of the time, so "the last slot" would delete the answer a quarter of the time and make that question unanswerable.
- **Cost**: breaks the combo (连击 → 0) and is recorded on the card as 「用过提示」.
- A richer per-kind hint (e.g. revealing the 声母 for 读音, or a radical gloss) is a documented follow-up, not in this round.

### 5.6 Attempt / pass / remediation

- An **attempt** walks the level's 5 chars; each char asks its 4 questions in the fixed order 读音 → 声调 → 部首 → 词义. The char card's facet reveal follows §7.2's reveal rule (a facet is hidden while a pending question tests it).
- A question answered correctly is **locked correct**. A question answered wrong immediately reveals the correct answer, adds the char to 生字本, breaks the combo, and moves on.
- A char is **认会 (mastered)** when all 4 of its questions are correct.
- The level is **通关** when all its chars are 认会.
- If some chars are not mastered, the summary screen shows them and offers **「重挑错字」** → a **remediation round** that re-asks **only the missed questions** for those chars, entirely from the already-fetched level payload (no extra API call). Passing the remediation masters those chars; a second failure ends the attempt.
- **The level pointer advances only on a pass** (`current[hsk].level += 1`); abandoning an attempt leaves the pointer where it is, so abandoning is never mistaken for skipping a level. **`passed[hsk]` records exactly the levels that were 通关** (every char 认会) — the same condition that advances the pointer, so the board's 已通关 seal and the pointer can never disagree. A level that was completed but **not** 通关 neither advances the pointer nor gets the seal: it stays 「当前」 and can be replayed from the board (a fresh attempt re-asks all 5 chars; the remediation round *inside* an attempt re-asks only the missed questions).

---

## §6 API

### 6.1 New: `GET /api/game/quest`

Query: `hsk` (1-6, required) · `level` (1-based, required).
**No `seed` parameter** — the seed is derived from `(hsk, level, char, kind)`, so an external seed would break the reproducibility promise and the per-level identity.

Response `200` — this is the **real output** for `?hsk=1&level=1` (trimmed to the first char; the full response holds 5 chars). It is generated by the rules in §5.2–§5.4 with the seed `fnv1a32("1:1:<char>:<kind>")` and the fixed PRNG, so it is reproducible — and it is the fixture the unit test asserts against (§11):

```jsonc
{
  "ok": true,
  "data": {
    "hsk": 1,
    "level": 1,
    "levelCount": 31,      // levels in this tier
    "tierSize": 178,       // chars in the tier (before eligibility filtering)
    "skipped": 26,         // chars dropped from the pool in this tier
    "chars": [
      {
        "char": "爱",
        "pinyin": "ài",
        "plainPinyin": "ai",
        "tone": 4,
        "toneName": "去声",
        "radical": "爪",
        "meaningZh": "对人和事物有深厚真挚的感情",
        "meaningShort": "对人和事物有深厚真挚的感情",
        "hasStory": true,
        "questions": [
          { "kind": "pinyin",  "options": ["cai", "ai", "kai", "lai"],        "answerIndex": 1 },
          { "kind": "tone",    "options": ["ài", "ái", "āi", "ǎi"],          "answerIndex": 0 },
          { "kind": "radical", "options": ["父", "爪", "玉", "犬"],            "answerIndex": 1 },
          { "kind": "meaning", "options": ["被邀请或主动前来探访的人", "对人和事物有深厚真挚的感情", "光线强", "数量大"], "answerIndex": 1 }
        ]
      }
      // … 八 bā, 杯 bēi, 本 běn, 不 bù  (the sweep's order — §5.1.2)
    ]
  }
}
```

- `toneName`: 阴平 / 阳平 / 上声 / 去声.
- `hasStory`: computed server-side with the same precedence as `lib/story.ts` (`etymology.story` → `hanzi_story` → `rare.story`).
- Errors: `400 bad_input` (missing/invalid hsk or level), `404 level_not_found` (level beyond the tier's level count).
- Headers: `Cache-Control: no-store`.
- The answer key is returned to the client (a learning game, not an exam; it keeps feedback instant with zero round-trips). This is a deliberate trade-off, stated here so it is not a surprise.

### 6.2 Modified: `GET /api/game/round` (bug fix, not a contract change)

`buildRound` gains an optional 5th parameter `modeOverride?: RoundMode`. When present it replaces `pickMode(seed)`. `app/api/game/round/route.ts` passes the already-parsed `mode` query param through.

- **Response shape unchanged** (same fields, same names) → no shim needed.
- **Semantic change**: `round.mode` now equals the requested `mode` instead of a random one. The `mode` parameter was already documented in `lib/validators.ts:179-184` as having exactly this effect; the code simply never implemented it. Any existing caller that omits `mode` keeps the legacy random behavior.
- `components/game/ToneRadicalGame.tsx` gains a `mode` prop (default `undefined` = legacy random) so the daily challenge can force 声调 or 部首.
- The response shape and the `mode` semantics are the only changes; the seeded shuffle fix (§5.4) changes the *option order* of the legacy rounds, which is a cosmetic change on a game whose round seed is generated per request.

---

## §7 Client

### 7.1 Page structure — `app/game/page.tsx` (rewrite)

```
<Header />
<PageContainer>
  <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
  <SectionTitle subtitle="一字一关 · 读音 声调 部首 词义">趣味识字</SectionTitle>
  <QuestTabs />   ← client component, owns the 4-tab state
</PageContainer>
<Footer />
```

`QuestTabs` (client) holds 4 flat tabs: **闯关 · 每日一局 · 字卡册 · 生字本**. The HSK tier picker (HSK 1-6 chips) sits above the tabs and is **shared** by 闯关 and 每日一局 (extracted from the current `GameModeTabs`).

**One HSK source of truth.** The tier picker writes `useDifficulty().setHskLevel` (the store the legacy games already read) and the quest keeps its **own per-tier level pointer** in localStorage (`current[1] = {level: 7}`, `current[4] = {level: 2}`, …). The quest never derives its level from the tier picker and vice versa — a single global pointer would lose the position in the other five tiers.

### 7.2 闯关 (Quest tab)

- **QuestBoard** — the level map for the active HSK tier: a wrapped grid of level tiles (max 163 per tier). Tile states: 已通关 (a 朱红 seal), 当前 (ink-filled, the level the progress pointer sits at), 未解锁 (faint). Clicking a tile opens that level — **unlocked levels only** (only `level ≤ current.level` is startable).
- **QuestRunner** — the question flow. Layout: the char card on top (a large 楷体 glyph in a 宣纸 frame), the question card below (prompt + 4 option buttons in a 2×2 grid on desktop, 1 column on mobile), a 4-dot progress row for the current char, and a 5-seal row for the level.
- **The reveal rule — a facet stays hidden while a pending question tests it.** The char card starts with the glyph alone; a facet is revealed only once no *pending* question in the current round tests it:
  - **拼音** (the toneless syllable *and* the tone) is tested by ① **and** ②, so it stays hidden until **② is answered**. Revealing it after ① would hand the learner the answer to ② — ②'s four options are the four tone forms of exactly that syllable, so a visible 「ài」 makes ② a free point. The ① answer is still shown, but in the **question card** (the chosen / correct option), not on the char card.
  - **部首** is tested by ③ → revealed after ③.
  - **词义** is tested by ④ → revealed after ④.
  - **A remediation round re-hides a facet it re-tests.** The reveal state is per round: when 「重挑错字」 re-asks ①, the pinyin is hidden again for that whole round, while the radical and the meaning stay visible (nothing in this round tests them). Without this, a re-asked ① would be answered off the card.
- **The ② question carries the audio** (§5.2 ②, §9.1): a 🔊 button beside the prompt that plays the character, auto-playing once when the question appears. The button is the primary path — the browser blocks autoplay until the first user gesture, so the first ② of a fresh visit always needs a click. ① never carries audio.
- **Feedback**:
  - correct → the option turns 墨绿 (`--color-success`), a 朱红印章 animation stamps over the char card, a 磬-like chime plays, 连击 +1;
  - wrong → the card shakes and tints 淡红 (`--color-danger`), the correct option is revealed and marked, the wrong option is marked with a cross, a 「记一笔」 button appears (adds to 生字本 — it is added automatically as well, so the button is a **confirm + jump to 生字本** action), the combo resets to 0.
- **LevelSummary** — after the last char: 通关 (a big seal + 「下一关」) or 未通关 (the missed chars with a 「重挑错字」 button and a 生字本 shortcut). A short level (2 or 1 char) is labelled 「本关 N 字」.

### 7.3 每日一局 (Daily tab)

Four mode cards, each showing 今日状态 (未玩 / 已完成 + score):

| Card | Component | New `mode` | Score |
|---|---|---|---|
| 声调 | `ToneRadicalGame` | `tone` | correct answers |
| 部首 | `ToneRadicalGame` | `radical` | correct answers |
| 拼音·字 | `DragMatchGame` | — | matched pairs |
| 拼音接龙 | `ChainGame` | — | longest chain |

Splitting the old 「声调·部首」 tab into two explicit cards is the §0 #1 fix: the tab title can no longer lie, because the requested mode is now honored by the server. The legacy random behavior remains available when no `mode` is passed (the components' default).

**The three legacy games must report completion** (§0 #9). Each of them gains an optional prop:

```ts
export interface LegacyGameResult {
  correct: number;      // matches / pairs / chain length
  wrong: number;        // mismatches
  durationMs?: number;  // optional — the daily card shows the score, the duration is only a stat
}
export interface LegacyGameProps {
  mode?: 'tone' | 'radical';          // ToneRadicalGame only
  onComplete?: (result: LegacyGameResult) => void;
}
```

- `ToneRadicalGame` fires `onComplete` when the round ends with `{ correct: matchCount, wrong: mismatches }`.
- `DragMatchGame` fires it with `{ correct: matchedCount, wrong: mismatches }`.
- `ChainGame` fires it with `{ correct: chain.length, wrong: 0 }` when the phase becomes `finished` (it has no mismatch counter today).
- The prop is **optional**, so the legacy usage in `GameModeTabs` keeps working unchanged until that component is replaced.
- **Abandoning is not completing.** All three games have a 放弃 button that sets the phase to `finished`; that path must **not** fire `onComplete`. The completion path and the abandon path need to be distinguishable (a separate `abandoned` flag or phase), otherwise the daily card records a half-finished round as a completed one with a bogus score.

**The 声调 card cannot be completed today — an existing bug the daily card would expose every day** (§0 #10). `lib/game-round.ts:171` sets `toneChoices = [...ALL_TONES]` — always the 4 tone tokens — while a 声调·部首 round holds 3 / 4 / 6 chars (`lib/difficulty.ts` `TONE_RADICAL_CONFIG`). `components/game/ToneToken.tsx` disables a token once it is matched, and `ToneRadicalGame` tracks matched **values** (tones), not matched **tokens**. So two chars of the same tone consume one token between them: the second char can never be matched, `matchCount` never reaches `round.chars.length`, and the round never auto-finishes — no `onComplete`, and the daily card never records a score. In **hard** mode (6 chars, 4 tones) the pigeonhole principle makes this *certain*, not occasional. **The fix ships with the daily card**: the token bank holds **one token per char** (the char's own tone, duplicates allowed — two identical tokens are two identical answers), and the game tracks which **token index** was used rather than which tone value. The radical mode has the same shape but its choices are already built per char (up to 6) and only capped, so it is checked in the same pass.

"Daily" semantics: each mode can be played once per calendar day; the completion is recorded in `progress.daily[YYYY-MM-DD][key] = { done: true, score: number }` where **`key` = `${mode}:${difficulty}:${hskTier}`** (e.g. `tone:medium:hsk1`). The three axes are all part of "one round of this game": the legacy games have 3 difficulties (3 / 4 / 6 chars per round) and an HSK tier, and a `tone` round in hard mode is not the same round as a `tone` round in easy mode — a key of `mode` alone would let one overwrite the other. Playing again is allowed (the card then shows 「再玩一次」) but the first result is the one recorded. A card shows the state of the **currently selected difficulty and HSK tier**; switching either switches the card's state.

### 7.4 字卡册 (Collection tab)

A responsive grid of **字卡** for every char in `progress.collected`: the glyph, the pinyin (with the tone name), the radical, the meaning, and four exit links — **字典** (`/dictionary/<char>`), **字源** (`/etymology/<char>`), **故事** (`/stories/<char>`, rendered only when `hasStory` is true — the flag is captured at collection time), **练字帖** (`/worksheet?prefill=<char>`). Filter chips by HSK tier. Empty state: 「还没有认会的字 —— 去闯关」.

### 7.5 生字本 (Wrong book tab)

One row per missed char: the glyph, the pinyin, the radical, the meaning, the miss count, and three actions — **再练一次** (jump to the level containing that char), **练字帖** (`/worksheet?prefill=<char>`), **移出生字本** (clears the record). The header action **「一键生成字帖」**:

- **The row renders from the stored snapshot, not from a fetch.** `progress.wrong[char]` stores the same compact snapshot as `collected[char]` (pinyin / plainPinyin / tone / toneName / radical / meaningShort), so the 生字本 needs no API call and no second data source (§8).
- **「再练一次」 navigates by URL**: `/game?tab=quest&hsk=<tier>&level=<n>`. On mount `QuestTabs` reads the query, switches the shared HSK tier, selects the 闯关 tab and opens that level. A URL is the only navigation contract that can cross the tab, the tier and the level at once — the tier lives in the shared store (`useDifficulty`) and the level in the quest's own state (§7.1), so a component-level callback cannot carry all three. The target level is reachable even if it is already 通关: the board opens any level `≤ current.level` (§7.2), and a 通关 level can be replayed for practice.

The header action **「一键生成字帖」**:
- logged-in → `POST /api/worksheets` with `{ title: '生字本练习', content: [...wrongChars], cellStyle: 'brush-square', paperSize: 'A4', fontFamily: 'kai' }` → redirect to `/worksheet/<id>`;
- not logged in → an inline hint (「登录后可一键生成字帖」) plus the per-char links, which work for everyone;
- **more than 500 chars** → the API's `content` cap. The UI shows 「本次生成前 500 字」 and keeps the per-char links for the rest.

### 7.6 File list

**New**
```
app/api/game/quest/route.ts
lib/game-quest.ts               ← pure builders (unit-testable, no DB, no fs)
lib/game-quest-data.ts          ← the thin data layer: SQL + data/content reads, per-tier memo
lib/game-quest-types.ts
lib/game-progress.ts            ← localStorage read/write/migrate
lib/game-sound.ts               ← Web Audio synth
components/game/quest/QuestTabs.tsx
components/game/quest/QuestBoard.tsx
components/game/quest/QuestRunner.tsx
components/game/quest/QuestCharCard.tsx
components/game/quest/QuestQuestionCard.tsx
components/game/quest/QuestOptionButton.tsx
components/game/quest/QuestSealStamp.tsx
components/game/quest/QuestSummary.tsx
components/game/quest/CharCollection.tsx
components/game/quest/CharCard.tsx
components/game/quest/WrongBook.tsx
components/game/daily/DailyChallenge.tsx
components/game/HskPicker.tsx    ← extracted from GameModeTabs, shared by 闯关/每日一局
tests/unit/lib/game-quest.test.ts
tests/unit/lib/game-progress.test.ts
tests/unit/lib/shuffle.test.ts        ← the PRNG distribution regression
tests/unit/components/game/QuestRunner.test.tsx
tests/unit/app/api/game/quest.test.ts   ← calls the route handler directly, with the data layer mocked
tests/integration/api/game-quest-db.test.ts   ← the real ladder against the real DB (skipped without DATABASE_URL)
```

**Modified**
```
app/game/page.tsx               ← rewrite (shell + QuestTabs)
components/game/ToneRadicalGame.tsx  ← `mode` + `onComplete` props
components/game/DragMatchGame.tsx   ← `onComplete` prop
components/game/ChainGame.tsx       ← `onComplete` prop
lib/shuffle.ts                  ← the PRNG fix (§5.4)
lib/pinyin-tone.ts              ← export `TONE_MAP` so the quest derives the tone marks from one source (§5.3)
lib/game-round.ts               ← `modeOverride` param
app/api/game/round/route.ts     ← pass the mode override through
```

**Deleted**
```
components/game/GameModeTabs.tsx  ← superseded by QuestTabs + HskPicker
tests/unit/components/game/GameModeTabs.test.tsx
```

**Reused as-is**
```
lib/pinyin-index.ts    ← `resolvePinyin` (the reading) and the per-process memoized index
lib/pinyin-tone.ts     ← `toneFromPinyin` (the tone number); only `TONE_MAP` is additionally exported
lib/shuffle.ts         ← after the PRNG repair in §5.4
lib/tts.ts             ← `speak(char, { voice })` / `stopSpeaking()` for the ② audio
lib/tts-cache.ts       ← `prefetchTts(voice, char)` warms the Cache API when the level loads
```

`lib/game-quest.ts` must stay free of DB/fs imports so it can be unit-tested with plain fixtures. The DB query and the `data/content/*.json` reads live in **`lib/game-quest-data.ts`** — a thin, server-only module that owns the per-tier memo (§5.1) and hands the pure module plain data. The route is then a thin adapter over the two. The split matters for the tests: the pure builders are unit-tested with fixtures, the route is unit-tested with `lib/game-quest-data` mocked, and the *real* data path (the ladder's actual numbers) is covered by the DB-backed integration test.

---

## §8 Progress storage

`localStorage` key: **`pinyin-character:game-progress:v1`**

```jsonc
{
  "version": 1,
  "current": { "1": { "level": 1 }, "4": { "level": 2 } },   // per-tier level pointer
  "passed":  { "1": [1, 2, 3] },                             // levels 通关, per tier
  "streak": 0,
  "bestStreak": 0,
  "collected": {
    "爱": {
      "hsk": 1, "level": 1, "at": 1728000000000,
      "pinyin": "ài", "plainPinyin": "ai", "tone": 4, "toneName": "去声",
      "radical": "爪", "meaningShort": "对人和事物有深厚真挚的感情", "hasStory": true
    }
  },
  "wrong": {
    "爱": {
      "count": 2, "lastAt": 1728000000000, "hsk": 1, "level": 1,
      "pinyin": "ài", "plainPinyin": "ai", "tone": 4, "toneName": "去声",
      "radical": "爪", "meaningShort": "对人和事物有深厚真挚的感情"
    }
  },
  "daily": { "2026-10-24": { "tone:medium:hsk1": { "done": true, "score": 8 } } },
  "updatedAt": 1728000000000
}
```

Rules:
- **`current` is keyed by HSK tier** — switching tiers keeps each tier's own position.
- **`passed[hsk]` is an explicit list of the levels that were 通关** (§5.6), not derived from `collected`: the eligible pool shifts whenever the content files are regenerated, so "已通关" must not be inferred from the collected set.
- **`collected[char]` stores a compact snapshot** (pinyin / radical / meaning / hasStory) so the 字卡册 can render without re-fetching anything. **`wrong[char]` stores the same snapshot** (minus `hasStory`) so the 生字本 can render without a fetch either, plus `hsk` / `level` so 「再练一次」 can jump to the exact level (§7.5).
- All access is wrapped in `try/catch`; a **corrupt or unparsable payload resets to the default** instead of throwing (a game must never break the page).
- `loadProgress()` returns the default when `window` is undefined (SSR) — the module is client-only but must not crash during SSR/prerender.
- Unknown `version` → default (no migration chain needed for v1; a future v2 adds one).
- Writes are debounced to one per answer (not one per render).

---

## §9 Sound

`lib/game-sound.ts` — **Web Audio API only**, no files, no dependency.

| Cue | Synthesis |
|---|---|
| 答对 `playChime()` | two sine partials (880 Hz + 1320 Hz) with a fast exponential decay, ≈0.5 s — a 磬 (chime stone) |
| 答错 `playThud()` | 160 Hz sine, 0.18 s decay, low-passed |
| 通关 `playFanfare()` | three ascending notes (660 → 880 → 1320 Hz), 90 ms apart |
| 盖章 `playStamp()` | a short filtered noise burst (a 木戳 knock) |

- The `AudioContext` is created lazily and `resume()`d on the first user gesture (browsers block audio otherwise).
- A mute toggle lives in `localStorage` (`pinyin-character:game-sound`) and is exposed in the quest header. **The mute toggle also silences the character audio** (§9.1) — one switch for all sound, not two.
- All calls are wrapped so an unsupported/blocked AudioContext can never throw into the render path.

### 9.1 The character audio (② 声调)

**This is not synthesised by `lib/game-sound.ts`** — it reuses the site's existing Edge TTS path:

- `speak(char, { voice: 'male' })` from `lib/tts.ts` — the same function the dictionary page's 「读字」 button uses, so the learner hears the same voice everywhere. The character is spoken, not the pinyin string (§5.2 ②).
- `lib/tts-cache.ts` caches the MP3 in the browser's Cache API, so a char is fetched once per browser.
- **Prefetch on level load**: when the level payload arrives, the quest calls `prefetchTts('male', char)` for the level's 5 chars, so ② starts playing immediately instead of waiting on the network. The prefetch is fire-and-forget — a failure is swallowed and the question still loads.
- **Autoplay**: browsers block audio until a user gesture. The quest's first answer click is the gesture that unlocks the `AudioContext` / the audio playback, so ②'s audio cannot autoplay on the very first question of a fresh visit. The UI must therefore show the 🔊 button prominently rather than relying on autoplay — the button is the primary path, the autoplay is a bonus.
- **Failure is a degraded mode, not an error**: the TTS upstream returns 403 often enough to have its own fix. A rejected `speak()` (or a load that has not produced audio within ~3 s) must leave the question fully answerable — the 🔊 button flips to 「🔊 暂时不可用」 and the learner answers ② by recall. No error toast, no blocked question, no lost progress.
- `stopSpeaking()` is called when the quest leaves a question or unmounts, so the audio never overlaps the next question.

---

## §10 Learning loop — the exits

| Exit | Target | Condition |
|---|---|---|
| 字典 | `/dictionary/<char>` | always |
| 字源 | `/etymology/<char>` | always (the page has its own empty state) |
| 故事 | `/stories/<char>` | only when `hasStory` is true |
| 练字帖 | `/worksheet?prefill=<char>` | always (the WorksheetGenerator accepts `prefill`) |
| 一键字帖 | `POST /api/worksheets` → `/worksheet/<id>` | logged-in users only |

---

## §11 Testing & verification gates

### New unit tests

`tests/unit/lib/game-quest.test.ts` (pure, no DB):
- level slicing: `level 1` of a fixture tier = the first 5 chars of the swept sequence; a short last level is legal and reports its own size;
- the sweep: the sweep order is syllable-alphabetical, and the same-syllable pairs stay **near zero** — the property the plain slice broke (**1390 → 21**). The assertion is *near*-zero, not zero: 21 pairs in 6 levels survive by design (§5.1.2), so a "distinct syllables" assertion would fail on the real ladder;
- every **full** level of a fixture tier has ≥ 3 distinct radicals;
- 读音 distractors never equal the correct plain syllable and never equal the plain form of any `pinyin_alt` reading; the alt plain form is computed by hand-stripping the tone mark (a `pinyin-pro` round-trip would return `"y í"`);
- **读音 distractors and the 零声母 rule**: a 零声母 syllable is never scored as "same initial" against another 零声母 syllable — 爱's top 3 is `cai / kai / lai`, never `er`;
- 声调: the option set is the 4 tone forms of the correct syllable; the answer index points at the char's own reading; a 轻声 char is **not** in the pool;
- tone-form construction vectors (春/妈/绿/略/归/爱/长, §5.3);
- 部首 distractors differ from the correct radical and are the nearest code points **of the tier's radical vocabulary** (爪 → 父/犬/玉 in tier 1);
- 词义: the correct option is the **first clause that does not contain the quest char**, and it is ≥ 2 chars — a char whose first free clause is 1 char long is **not** in the pool;
- 词义 distractors share no 2-char substring with the correct clause, never contain the quest char, and are not the same three for every char in a level;
- determinism: the same `(hsk, level, char)` yields byte-identical options across two builds; different levels differ;
- **the §6.1 payload is a fixture**: for `(hsk 1, level 1, 爱)` the four option arrays and their `answerIndex` are exactly the ones printed in §6.1 — this is what pins the pre-shuffle input order (§5.4) and the seed formula.

`tests/unit/lib/shuffle.test.ts` (new — the §0 #8 regression):
- the answer position is **not** constant: over 500 (seed, length) combinations the four slots are each hit at least 10% of the time (the old code put ~100% in one slot);
- the permutation is a permutation (no loss, no duplication) and does not mutate the input.

`tests/unit/lib/game-progress.test.ts`:
- a corrupt payload → the default state, no throw;
- `loadProgress` on the server (no `window`) → the default state;
- collect / miss / level-advance round-trips, including **per-tier** pointers;
- `passed` is an explicit list and survives a re-read;
- the daily map is keyed by the local date and stores `{ done, score }`.

`tests/unit/components/game/QuestRunner.test.tsx`:
- clicking a wrong option reveals the correct answer and breaks the combo;
- clicking the right option locks the question and shows the seal;
- **the hint removes exactly one *wrong* option** — the last wrong one in the seeded permutation — and **never removes the correct answer** (the permutation's last slot holds the answer ~25% of the time, so "the last slot" would be wrong);
- a level with 5 mastered chars shows 「下一关」; a short level (3 chars) also completes;
- **the reveal rule**: the char card does not show the pinyin while ① or ② is pending, shows it after ② is answered, and a remediation round that re-asks ① hides the pinyin again;
- **the audio contract**: ① renders no 🔊 control; ② renders one; when `speak` rejects (mocked), ② is still answerable and the button shows 「🔊 暂时不可用」 — no error toast, no blocked question.

### Extended / existing

- `tests/unit/lib/game-round.test.ts` — add: `buildRound(..., 'tone')` yields `round.mode === 'tone'`; omitting it keeps the legacy random behavior; **the tone token bank holds one token per char** (a 6-char round has 6 tone tokens, so two chars of the same tone each get their own token — §0 #10).
- `tests/integration/api/game-round.test.ts` — add: `GET /api/game/round?mode=tone` returns `data.mode === 'tone'`.
- `tests/unit/app/api/game/quest.test.ts` (new) — **calls the route handler directly** (`GET(new Request('http://localhost/api/game/quest?hsk=1&level=1'))`) instead of hitting a live server, following the convention of `tests/unit/app/api/ai/char-recognize.test.ts` (mock `next/headers` + `lib/auth`, then import `{ GET }` from the route module). This is deliberately *not* modelled on `tests/integration/api/game-round.test.ts`, whose every case is `it.skip` against a server on port 4444 that the file does not start — that convention is why the game has no API coverage today. **`lib/game-quest-data` is mocked** with a fixture tier, so the test needs neither a DB nor the content files. Asserts: 200; `levelCount` / `tierSize` / `skipped` are present and consistent; every char has exactly 4 questions with 4 options and an `answerIndex` in range; the `Cache-Control: no-store` header; `?hsk=9` → 400; `?hsk=1&level=999` → 404.
- `tests/integration/api/game-quest-db.test.ts` (new) — the **real** ladder against the **real** DB and content files: the tier sizes, the eligible pool (152/140/220/376/535/815 = 2238), the level counts (31/28/44/76/107/163 = 449), the two short tail levels, the same-syllable-pair count (21) and the `ORDER BY char` determinism (the same level returns byte-identical options twice). It **skips itself when `DATABASE_URL` is unset**, so `npx vitest run` stays green on a machine without MySQL.
- `tests/unit/components/game/GameModeTabs.test.tsx` — **deleted** together with the component.

### Verification gates (per project memory)

1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — all green (the DB-backed integration test needs `set -a; . ./.env; set +a` first).
3. `npx eslint` — no new errors (7 pre-existing `no-explicit-any` warnings are tolerated).
4. `next build` in the **isolated worktree** `D:/Temp/pinyin-build-check` — exit 0. **Never build in the main tree while the 4444 dev server is alive.**
5. Manual smoke (`curl -b "setup_completed=1"` + a browser pass):
   - `/game` loads; the 4 tabs render;
   - a level runs 5 chars × 4 questions; a wrong answer reveals the answer; a correct answer stamps and chimes;
   - **the correct option is in a different position on different questions** (the §0 #8 fix, visible in one level);
   - **the pinyin stays off the char card until ② is answered** (§7.2's reveal rule) — the ② answer must not be readable off the card;
   - **② plays the character audio** and the 🔊 button replays it; ① has no audio control;
   - **with the network blocked, ② is still answerable** and the 🔊 button shows 「🔊 暂时不可用」 (the Edge TTS upstream 403s often enough that this path must be exercised, not assumed);
   - the level summary appears; the progress survives a reload; switching HSK tiers keeps each tier's own position;
   - 每日一局 → 声调 shows a tone round (not a pinyin round) and 部首 shows a radical round; a finished game marks its card 「已完成」 with a score;
   - **the 声调 daily round can actually be finished** in hard mode (6 chars, 4 tones): every char has a token, the round reaches the finished phase, and the card records the score (§0 #10);
   - 放弃 in a legacy game **does not** mark the daily card as 已完成;
   - the 字卡册 and 生字本 tabs render their entries; the 练字帖 deep link opens the worksheet with the char;
   - the mobile viewport (375 px) is tap-only and nothing overflows.

---

## §12 Risks & edge cases

| Risk | Mitigation |
|---|---|
| A char's `dict.meaning_zh` is too short or contains the char itself → the 词义 question can't be built | The char is skipped for the quest pool (§1.1 C) and counted in `skipped`. The level slice is taken from the **eligible** list, so a skipped char does not leave a hole. *Measured*: 381 chars are skipped for this reason (337 have no free clause at all, 46 more have a 1-char first free clause, 2 of those are already excluded as 轻声/嗯). |
| The 声调 legacy round is unwinnable when two chars share a tone (certain in hard mode) | Fixed with the daily card (§0 #10): one token per char, and the game tracks used **token indices**, not used tone values. Regression-tested in `tests/unit/lib/game-round.test.ts`. |
| The tier query's row order drifts between requests → ④'s drawn distractors change between visits | The tier query is `ORDER BY char` (§5.1) and the clause pool is built in that order. Covered by the DB-backed integration test (§11). |
| Loading a tier's content files costs ~100 ms on the first request (tier 6) | The tier is loaded once per process and memoized (§5.1); every later request is a cache hit. A precomputed quest-pool JSON is a follow-up if the first-request latency ever matters. |
| The quest route needs the DB (the radicals live only in `chars.radical`) | The split is deliberate: the pure builders are unit-tested with fixtures, the route is unit-tested with the data layer mocked, and the real path is covered by the DB-backed integration test (§7.6, §11). |
| A tier has too few eligible chars for a level | The level shows fewer than 5 chars (the runner handles a short level) and the UI says 「本关 N 字」. *Measured*: HSK 1 level 31 has 2 chars, HSK 4 level 76 has 1 char; all other levels hold exactly 5. |
| 轻声 chars have no tone question | Excluded from the pool (§1.1 B). 12 chars affected (么们吗呢的吧着啊呀嘛瘩裳). |
| Syllabic-nasal chars (ǹg) have no tone variants | Excluded from the pool (§5.3 step 3). 1 char affected (嗯). |
| A polyphonic char's alternate reading is offered as a distractor | Excluded via the hand-stripped plain form of `dict.pinyin_alt` (§5.2 ①). 416 chars affected. |
| Two chars in a level share a 部首 | Not a problem — the distractors are drawn from the tier's radical vocabulary, and every stored radical is already canonical (§5.2 ③). |
| The option order is always the same | Fixed in §5.4 by the PRNG repair; regression-tested in `tests/unit/lib/shuffle.test.ts`. |
| The ① and ② questions leak into each other | Prevented by construction: ①'s options are toneless syllables, ②'s are the tone forms of one syllable (§1.1 A). |
| The ② audio fails (Edge TTS 403, or the upstream is slow) → the question becomes unanswerable or blocks the flow | Audio is a **progressive enhancement**: the question stays answerable by recall, the 🔊 button degrades to 「🔊 暂时不可用」, there is no error toast and no blocked question (§9.1). The prefetch is fire-and-forget. |
| The TTS flattens the tone mark of a bare pinyin string → all four ② options sound identical | The quest speaks the **character**, not the pinyin string (§5.2 ②). A real character always carries its canonical tone; a bare pinyin string does not. |
| The learner remembers the character's sound from ② and then re-fails ① in the remediation round | Accepted, and deliberate: the character's sound is public information (the dictionary page plays it on demand too), and the quest is a learning loop rather than an exam. The reveal rule still hides the pinyin *card* during a re-asked ① (§7.2). |
| The 生字本 grows past the 500-char worksheet cap | The UI states 「本次生成前 500 字」 and keeps per-char links for the rest (§7.5). |
| The legacy games cannot report a score | All three gain an optional `onComplete` prop (§7.3); the prop is optional so the old usage keeps compiling. |
| `radicals.json` (0.84 MB) leaking into the client bundle | Not used by the quest at all (§5.2 ③). The client receives strings only. |
| localStorage quota / private mode throws on write | Every write is in a `try/catch`; the game keeps working in-memory if persistence fails. |
| The `mode` fix changes an existing API's behaviour for an existing caller | No existing caller sends `mode` (verified: only `ToneRadicalGame` calls `/api/game/round`, and it sends `count`, `source`, `hskLevel`). The response shape is unchanged. |
| A concurrent session edits the same files | `git add` explicit paths only; never `git add -A` (per `plan-admin-ui-redesign-status`). |

---

## §13 Out of scope (follow-ups)

- Server-side progress, cross-device sync, accounts.
- A 简繁 部首 alias table (not needed today — the DB already stores canonical Kangxi forms; needed only if variant forms ever appear).
- Per-kind hints (the current hint is a uniform 排除法).
- A radical **gloss** (爪 = 爪子) so the 部首 hint can teach meaning instead of only eliminating.
- A precomputed quest-pool JSON (a build step that bakes the 449 levels and their option sets), if the ~100 ms first-request tier load ever becomes visible.
- Adaptive difficulty (the tier is chosen by the user, not inferred).
- Leaderboards, streaks-with-friends, sharing a card as an image.
- The 抄经 / 古籍 render-storm fixes the user deferred.

---

## §14 Commit plan (branch `perf/frontend-scan-2026-10-24`, **not pushed**)

| # | Commit | Contents |
|---|---|---|
| 1 | `fix(game): repair the seeded shuffle PRNG` | `lib/shuffle.ts` (§5.4) + `tests/unit/lib/shuffle.test.ts` — a standalone bug fix, independent of the quest |
| 2 | `feat(game): add the pure quest level + question builder` | `lib/game-quest.ts`, `lib/game-quest-types.ts`, `tests/unit/lib/game-quest.test.ts` |
| 3 | `feat(game): add the quest level API` | `app/api/game/quest/route.ts`, `lib/game-quest-data.ts`, `tests/unit/app/api/game/quest.test.ts`, `tests/integration/api/game-quest-db.test.ts` |
| 4 | `feat(game): add the local progress store and the sound cues` | `lib/game-progress.ts`, `lib/game-sound.ts` + their unit tests |
| 5 | `fix(game): honor the requested round mode` | `lib/game-round.ts`, `app/api/game/round/route.ts`, `ToneRadicalGame` `mode` prop + tests |
| 6 | `fix(game): give every char its own tone token` | the §0 #10 fix: one tone token per char in `lib/game-round.ts` + `ToneRadicalGame` tracks used token indices — a standalone bug fix, independent of the quest |
| 7 | `feat(game): report completion from the legacy games` | `onComplete` on `ToneRadicalGame` / `DragMatchGame` / `ChainGame` + the daily-score contract (the abandon path does not fire it) |
| 8 | `feat(game): add the quest UI` | `components/game/quest/*`, `components/game/HskPicker.tsx` |
| 9 | `feat(game): rebuild the game page around the quest` | `app/game/page.tsx`, `components/game/daily/DailyChallenge.tsx`, delete `GameModeTabs` + its test |

Each commit is build-safe on its own; commits 7-8 touch `app/**/page.tsx`, so the isolated-worktree build is mandatory before they land.

---

## §15 Project-wide constraints (binding, restated)

1. `npm` only; installs use `--legacy-peer-deps`; **no new dependency** for this feature.
2. TypeScript strict — no `any` in exported interfaces; use `unknown` + narrowing.
3. No `// TODO`, no ellipsis-as-code, no stub functions, no silent `catch {}` — every catch logs and degrades explicitly.
4. Functions ≤ 50 lines; files 300-500 lines.
5. Chinese UI copy; English identifiers.
6. No push; no production operations.
7. `next build` in `D:/Temp/pinyin-build-check` only — the 4444 dev server owns the main tree.
