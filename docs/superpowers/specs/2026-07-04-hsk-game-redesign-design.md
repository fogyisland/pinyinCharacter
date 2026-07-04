# /game HSK × Progressive Reveal Redesign — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to produce the implementation plan after this spec is approved.

**Goal:** Re-anchor the `/game` mini-games (声调匹配 ToneRadicalGame, 部首匹配 DragMatchGame, 拼音接龙 ChainGame) on **HSK 1-6** as the difficulty axis, with a **6-档 progressive reveal** model so the games' char cells show progressively fewer hints as the user's level advances.

**Why now:** Current difficulty in `lib/difficulty.ts` is keyed by Unicode tier (`chars-level-1|1+2|all`) — a char-pool size metric, not a learning curve. The 3 games' UI does not telegraph "why is this harder?" to the user, and the game loops (drag-drop, chain) are quiz forms, not learning-fluent exercises. HSK + progressive reveal re-anchors difficulty on a recognized Chinese-proficiency pedagogy and makes the loop progressively work the user's recognition muscle.

---

## User-affecting decisions (locked 2026-07-04)

1. **Difficulty labels use HSK 1-6 国际原名** (not 中文 入门/初级/中级/高级; not dual labels). UI renders literal "HSK 1" … "HSK 6" tags.
2. **6 档 reveal (not 3 档)** — each game has HSK 1 = 全 reveal (拼音+部首+含义), HSK 6 = 仅字 + on-demand hint (扣分).
3. **Reveal elements** are exactly three: `pinyin`, `radical`, `meaning`. Char-cell level only — drop tokens (ToneToken / RadicalToken / PinyinToken) are quiz options, always shown.
4. **On-demand hint** (HSK 4-6 only) lets the user click the char cell to reveal a hidden hint; it costs +1 mismatch in ToneRadical/DragMatch (their score system already tracks mismatches). HSK 1-3 disallow on-demand since all hints are already shown. ChainGame does NOT have a score system, so on-demand there is free.
5. **拼音接龙 chain rule is strict** — strictly last-letter exact match, **NO 同音 wildcard**. Rollback note: this deliberately reverses the `i/u/ü → expanded sets` rule shipped in plan-pinyin-solitaire (`9689768a..6a935d77`); `expandLastLetter` becomes identity.
6. **Mobile touch + 错误反馈 (shake/flash)** are explicitly deferred to follow-up plans; NOT in this spec.

---

## Architecture

```
                ┌───────────────────────────────────────┐
                │  GameModeTabs (HSK 1-6 picker, localStorage)
                │  ↓ HSK level                             │
                ▼                                          │
   ┌────────────────────────────┐                          │
   │  round fetch:               │                          │
   │  /api/game/round           │   ←─── hskLevel=N param  │
   │   ?count&seed&source&…    │                          │
   │  /api/chain/chars          │                          │
   │   ?source&hskLevel=N      │                          │
   └────────────────────────────┘                          │
                ↓                                          │
                ▼                                          │
   Server filter: chars.hsk_level === N  (fallback:        │
                  chars.level when hsk_level IS NULL)      │
                ↓                                          │
                ▼                                          │
   Server embed: revealConfig { cellHints: RevealElement[], │
                  allowOnDemandHints: bool }               │
                ↓                                          │
                ▼                                          │
   ┌─────────────────────────────────────────┐             │
   │  Game client (Tone/Drag/Chain) reads    │             │
   │  revealConfig → passes down to cell     │             │
   │  components which conditional-render    │             │
   │  <PinyinToken/> <RadicalToken/>         │             │
   │  <MeaningToken/>; on-demand click →     │             │
   │  local-state reveal + score bump        │             │
   └─────────────────────────────────────────┘             │
                                                          │
```

---

## §1 Data + DB Schema

### HSK vocab source

`data/hsk-vocab.json` (new) — public domain HSK 1.0 vocab list, ≈150 words → ≈300 unique chars. Format:
```json
{
  "1": [
    { "char": "你", "pinyin": "nǐ", "meaning_zh": "你", "pos": "pron" },
    ...
  ],
  "2": [],
  ...
  "6": []
}
```
Round 1 ships with HSK 1.0 only. HSK 2-6 entries are populated in subsequent import rounds using the established 30-char/round bulk pattern (memory `bulk-content-generation-pattern.md`).

### Migration

`scripts/migrations/2026-07-04-hsk-level.sql` (new):
```sql
ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL;
CREATE INDEX idx_chars_hsk_level ON chars (hsk_level);
```

### Import script

`scripts/import-hsk.ts` (new) — single-pass `INSERT … ON DUPLICATE KEY UPDATE hsk_level=VALUES(hsk_level)`, mirroring the single-statement style of `import-chars-data.ts`. Idempotent re-runs OK.

### Difficulty config

`lib/difficulty.ts` extends `GameConfig` with a `hskLevel` field. Source mapping:
```ts
function sourceForHsk(level: HskLevel): CharSource {
  // HSK 1 lands in round 1; HSK 2-6 fall back to existing char pools
  // until their own import lands. UI shows a banner.
  if (level === 1) return 'chars-level-1';
  if (level === 2 || level === 3) return 'chars-level-1-2';
  return 'chars-all';
}
```

---

## §2 Reveal Model

### Type definition (`lib/reveal.ts`, new)

```ts
export type RevealElement = 'pinyin' | 'radical' | 'meaning';
export type HskLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type GameMode = 'tone-radical' | 'drag-match' | 'chain';

export type RevealConfig = {
  cellHints: ReadonlyArray<RevealElement>;
  allowOnDemandHints: boolean;
  onDemandPenalty: number;  // 0 in chain (no score); 1 in tone/drag
};

const REVEAL_BY_LEVEL: Record<HskLevel, {
  cellHints: ReadonlyArray<RevealElement>;
  allowOnDemandHints: boolean;
}> = {
  1: { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false },
  2: { cellHints: ['pinyin', 'meaning'],            allowOnDemandHints: false },
  3: { cellHints: ['pinyin'],                       allowOnDemandHints: false },
  4: { cellHints: ['pinyin'],                       allowOnDemandHints: true  },
  5: { cellHints: [],                               allowOnDemandHints: true  },
  6: { cellHints: [],                               allowOnDemandHints: true  },
};

export function getRevealConfig(game: GameMode, level: HskLevel): RevealConfig;
```

### Game-specific override hooks

`getRevealConfig` reads REVEAL_BY_LEVEL then layers game-specific tweaks:
- **`drag-match` and `chain`**: drop `radical` from `cellHints` even at HSK 1 — those games have no radical context on the char cell, only `pinyin` and/or `meaning` apply. The REVEAL_BY_LEVEL `radical` entry is filtered out by `getRevealConfig('drag-match' | 'chain', level)`.
- **`tone-radical`**: keep `radical` in `cellHints` at HSK 1-3 — and **separately**, the radical *drop-token* on the right (which is a quiz answer the user drags onto the cell, not a hint about the cell) is rendered unconditionally; drop tokens are not affected by reveal config.
- **`onDemandPenalty`**: `1` for `tone-radical` and `drag-match` (each on-demand reveal is +1 mismatch); `0` for `chain` (no score system in the chain game).

### Cell components (modified)

`ToneRadicalChar`, `CharDropZone`, and the per-char cell inside `ChainScroll` each gain:
- prop `revealConfig: RevealConfig`
- prop `onDemandReveal: (element: RevealElement) => void`
- internal state `revealedOnDemand: Set<RevealElement>` accumulating hidden hints the user has clicked to expose
- render reads `(revealConfig.cellHints.includes(el) || revealedOnDemand.has(el))` per element
- Hidden-but-clickable elements render a dashed `<button aria-label="显示拼音">?</button>` that triggers `onDemandReveal(el)`

### On-demand hint scoring (ToneRadical/DragMatch only)

Existing `mismatches: number` counter is bumped by `onDemandPenalty` on each reveal. ChainGame unchanged.

---

## §3 Game Wiring

### Files modified

| File | Change |
|------|--------|
| `lib/reveal.ts` | NEW — types + `REVEAL_BY_LEVEL` + `getRevealConfig` |
| `lib/pinyin-syllable.ts` | `expandLastLetter` → identity (rollback `i/u/ü → expanded sets`) |
| `lib/difficulty.ts` | Add `HskLevel`, `hskLevel` field on `GameConfig`, `sourceForHsk()` |
| `lib/game-round.ts` | `buildRound(content, count, seed, mode, hskLevel)` filters by `chars.hsk_level === N` with fallback to `chars.level` |
| `lib/api-chain.ts` | Extend `fetchChainChars(source, hskLevel)`; pass hskLevel to API |
| `app/api/game/round/route.ts` | Accept + zod-validate `hskLevel∈{1..6}`; embed `revealConfig` in response; add `Cache-Control: no-store` |
| `app/api/chain/chars/route.ts` | Accept `hskLevel`; filter by `chars.hsk_level` with fallback; add `Cache-Control: no-store` |
| `components/game/GameModeTabs.tsx` | Add HSK 1-6 picker chip row, persisted via `useDifficulty`'s localStorage |
| `components/game/ToneRadicalGame.tsx` | Local `hskLevel` state; pass to fetch + reveal props; on-demand reveal bumps `mismatches` |
| `components/game/DragMatchGame.tsx` | Same as ToneRadical |
| `components/game/ChainGame.tsx` | Pass `hskLevel` to `fetchChainChars`; reveal props threaded; on-demand free (no penalty) |
| `components/game/ToneRadicalChar.tsx` | Reveal-aware render + on-demand click |
| `components/game/CharDropZone.tsx` | Same |
| `components/game/ChainScroll.tsx` | Same for chain char cells |

### Fallback UI (HSK 2-6 hardcoded)

When `chars.hsk_level` is NULL (post-`sourceForHsk` fallback), UI surfaces a banner:
> 「HSK N 字库尚在补充中—当前以 HSK N-1 字池代替」

The banner is informational, not blocking; the game proceeds with the fallback pool and the HSK label still reads literal "HSK N".

### Pinyin chain rule strictness (mandatory)

`lib/pinyin-syllable.ts`:
```ts
export function expandLastLetter(letter: string): string[] {
  return [letter];
}
```

Strict semantics:
- ✓ `你` (nǐ, last `i`) → `期` (qī, first `i`)
- ✗ `你` (nǐ) → `衣` (yī, first `y`) — different spelling even though same sound
- ✗ `姑` (gū, last `u`) → `女` (nǚ, first `n`) — even though ü is read with u-glide

Drop-token semantics unchanged: pinyin tokens in ChainPickerModal show the full syllable incl. tone. The strict rule governs chain continuation only.

### pinyin-solitaire follow-ups folded in (W2/W3)

`/api/chain/chars/route.ts:22-39` per-page try/catch and `components/game/ChainGame.tsx:23` useEffect AbortController cleanup — both shipped as defensive W-tier follow-ups in pinyin-solitaire whole-branch review. Folded into this spec because the HSK change also reroutes the same `useEffect` to refetch on difficulty change; AbortController hygiene must accompany that refactor.

### Existing tests requiring update

- `tests/unit/lib/pinyin-syllable.test.ts` — rewrite wildcard assertions to identity (the `expandLastLetter('i') → ['i','y']` cases become `expandLastLetter('i') → ['i']`)
- `tests/unit/lib/chain-rules.test.ts` — rewrite cases that relied on cross-spelling bridging (you→衣, etc.)
- `tests/unit/lib/api-chain.test.ts` — extend with `?hskLevel=N` test

---

## §4 Testing + Verification

### New unit tests

- `tests/unit/lib/reveal.test.ts` — REVEAL_BY_LEVEL × GameMode matrix; `getRevealConfig` defaults + per-game overrides
- `tests/unit/scripts/import-hsk.test.ts` — verify 300 HSK 1 chars landed + idempotent re-run

### Extended unit tests

- `tests/unit/lib/game-round.test.ts` — `buildRound(…, hskLevel=N)` filters correctly + fallback path
- `tests/unit/lib/difficulty.test.ts` — `sourceForHsk` mapping
- `tests/unit/components/game/ToneRadicalGame.test.tsx` — `revealConfig` prop threading + on-demand click bumps `mismatches`
- `tests/unit/components/game/DragMatchGame.test.tsx` — same as ToneRadical
- `tests/unit/components/game/ChainGame.test.tsx` — HSK change triggers refetch + AbortController cancels in-flight; on-demand free (no penalty)
- `tests/unit/components/game/{ToneRadicalChar,CharDropZone,ChainScroll}.test.tsx` — render with/without hints, click reveals, ARIA labels

### Integration tests

- `tests/integration/api/game-round.test.ts` — `?hskLevel=1` returns HSK-1 chars only; `?hskLevel=99` rejected by zod
- `tests/integration/api/chain-chars.test.ts` — same coverage on chain endpoint
- `Cache-Control: no-store` header assertion on both routes

### Verification gates (per project memory)

- `npx vitest run` — all green; no regressions
- `npx tsc --noEmit` — exit 0
- `npx next build` — review-stage only, never while dev server on :4444 alive (memory `dev-build-cache-stomp`)
- Manual smoke (4 steps):
  1. HSK 1 — all hints visible
  2. HSK 6 — only char, click reveals hint + bumps score in tone/drag
  3. 拼音声调接龙 with HSK 字池 — strict last-letter only (you→期 ✓, you→衣 ✗)
  4. HSK 4-6 banner appears for fallback levels

---

## Out of scope (follow-up plans / separate specs)

- Mobile/touch DnD fallback (HTML5 DnD unreliable on mobile Safari/Chrome)
- Wrong-answer feedback (shake / flash / correct-answer readout — currently silent increment)
- `ChainPickerModal` 100+ char search/filter
- 字转音拍照 premium feature (image → AI OCR → 字转音, member-gated) — separate spec, sequenced AFTER this HSK plan ships (locked decision 2026-07-04)
- HSK 等级 progress / unlock tracking across sessions
- HSK label i18n

---

## Risks

- **HSK 1 字符集小 (≈300 chars)** — chain game `pickStarter` may struggle to find a starter with ≥3 valid next chars under strict last-letter rule. Mitigation: `pickStarter` already has a 5-retry fallback that returns a random char; verify on import run, and if insufficient, fall back to `chars-level-1` pool (which has ~3500 GB2312 chars and is bigger than HSK 1).
- **HSK 数据 import 失败** — UI banner fallback must work even if migration didn't run (column missing → handler swallows and uses existing `chars.level`). Server logs the error.
- **`expandLastLetter` rollback breaks chain-rules.test.ts's 你→衣 cases** — explicit test rewrite required (covered above).
- **`api-chain.ts` client cache invalidation** — extending the cache key from `(source)` to `(source, hskLevel)` invalidates existing 1h cache; first-load will fetch the new key. Acceptable; not a regression.
- **128 routes preserved** — no new pages, no new API routes; only existing endpoints gain a query param. Build route count must not change.

---

## Commit summary (this spec)

- Spec doc committed (this file)
- Plan doc deferred to writing-plans skill after user reviews this spec

---

## Project-wide constraints (binding)

Per memory `feedback-commit-timestamps.md`: every commit appends `[YYYY-MM-DD HH.MM]`.
Per memory `no-prod-env-2026-06-21`: no push; all commits stay local.
Per memory `feedback-per-task-build-check.md`: per-task reviewers must run `npx next build`.
Per memory `project-uses-npm.md`: use `npx vitest run`, `npx next build`, `npx next dev` — no pnpm.
Per memory `dev-build-cache-stomp`: never run `npx next build` while `pnpm dev`/`npx next dev -p 4444` is alive.
</content>
</invoke>