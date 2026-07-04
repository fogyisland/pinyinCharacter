# HSK × Progressive Reveal Game Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-anchor `/game` mini-games on HSK 1-6 difficulty with 6-tier progressive reveal; char cells show fewer hints as the user advances; chain rule locks to strict last-letter (no 同音 wildcard).

**Architecture:** Add `chars.hsk_level` column + import HSK 1.0 vocab. New `lib/reveal.ts` types the model (`HskLevel`, `RevealElement`, `RevealConfig`, `getRevealConfig`). Both `/api/game/round` and `/api/chain/chars` accept `?hskLevel=N`, filter server-side, embed `revealConfig` in response. Game components thread the config down to cell-level components which conditionally render `PinyinToken`/`RadicalToken`/`MeaningToken`. Chain rule rolls back `expandLastLetter` to identity. HSK 2-6 ships with hardcoded fallback banner until data lands.

**Tech Stack:** Next.js 15.5.19, React 19, TypeScript 5.6, Vitest 2.x + happy-dom 15.x, mysql2, npm. No new deps.

## Global Constraints

- Project uses npm — use `npx vitest run`, `npx next build`, `npx next dev` (per memory `project-uses-npm.md`); never `pnpm`.
- No prod env (per memory `no-prod-env-2026-06-21`) — every commit stays local; do not `git push`.
- Commit message format: `<type>(<scope>): <subject> [YYYY-MM-DD HH.MM]` with **actual local time** (per memory `feedback-commit-timestamps.md`).
- Per-task reviewers must run `npx next build` (per memory `feedback-per-task-build-check.md`). Never run while `npx next dev -p 4444` is alive (per memory `dev-build-cache-stomp.md`); kill dev first.
- Component tests use `// @vitest-environment happy-dom` pragma + `cleanup()` in `beforeEach`; module-cached singletons (e.g. `lib/api-chain.ts` 1h cache) must be re-imported per test via `await import()` (per memory `component-test-pragma-cleanup.md`).
- New API routes default `Cache-Control: no-store` (per memory `feedback-cache-control-route-iterations.md`); even though these are existing routes gaining a query param, set the header on the same routes.
- TDD: red test → green impl → commit. Never merge a task with RED tests or unrebased commits.
- 128-route count from earlier plans is approximate; verify route count via `npx next build` output (current expectation ~173) — confirm no route additions/removals.

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `data/hsk-vocab.json` | HSK 1.0 public-domain vocab (≈150 words → ≈300 unique chars) keyed by level |
| `scripts/migrations/2026-07-04-hsk-level.sql` | `ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL; CREATE INDEX …` |
| `scripts/import-hsk.ts` | One-pass idempotent `INSERT … ON DUPLICATE KEY UPDATE` from JSON |
| `lib/reveal.ts` | `HskLevel`, `RevealElement`, `RevealConfig`, `REVEAL_BY_LEVEL`, `getRevealConfig(game, level)` |
| `tests/unit/lib/reveal.test.ts` | REVEAL_BY_LEVEL matrix + `getRevealConfig` per-game rules |
| `tests/integration/scripts/import-hsk.test.ts` | Verify HSK 1.0 chars imported + idempotent |
| `tests/integration/api/game-round.test.ts` | `?hskLevel=N` happy + zod reject + Cache-Control header |
| `tests/integration/api/chain-chars.test.ts` | Same coverage on chain endpoint |

### Modified (existing files)

| Path | Change |
|------|--------|
| `lib/pinyin-syllable.ts` | `expandLastLetter` → identity (rollback i/u/ü wildcards) |
| `tests/unit/lib/pinyin-syllable.test.ts` | Rewrite wildcard assertions → identity |
| `tests/unit/lib/chain-rules.test.ts` | Drop you→衣 type cross-spelling cases; keep last-letter-exact cases |
| `lib/difficulty.ts` | `HskLevel` type + `hskLevel` field on `GameConfig` + `sourceForHsk(level)` |
| `lib/use-difficulty.ts` | Persist `hskLevel` to localStorage alongside existing `difficulty` key |
| `tests/unit/lib/difficulty.test.ts` | Extend with `sourceForHsk` mapping tests |
| `lib/game-round.ts` | `buildRound(content, count, seed, mode, hskLevel)` filters by `chars.hsk_level` with fallback to `chars.level` |
| `tests/unit/lib/game-round.test.ts` | Extend with HSK filter tests |
| `app/api/game/round/route.ts` | zod-validate `hskLevel` 1-6; embed `revealConfig` in response; emit `Cache-Control: no-store` |
| `lib/api-chain.ts` | Cache key `(source, hskLevel)`; export `fetchChainChars(source, hskLevel)` |
| `tests/unit/lib/api-chain.test.ts` | Cache-key + hskLevel param tests; per-test re-import for module-cached state |
| `app/api/chain/chars/route.ts` | Accept `hskLevel`; filter + fallback; per-page try/catch (W2 fold-in); `Cache-Control: no-store` |
| `components/game/ChainGame.tsx` | Pass `hskLevel`; useEffect AbortController cleanup (W3 fold-in) |
| `tests/unit/components/game/ChainGame.test.tsx` | Tests for AbortController + reveal config threading |
| `components/game/GameModeTabs.tsx` | HSK 1-6 picker chip row; reads/writes `useDifficulty.hskLevel` |
| `components/game/FallbackBanner.tsx` | NEW — banner shown when server can't satisfy hskLevel filter |
| `components/game/ToneRadicalGame.tsx` | Local `hskLevel` state; fetch with param; on-demand bumps `mismatches` |
| `tests/unit/components/game/ToneRadicalGame.test.tsx` | Reveal threading + on-demand score bump |
| `components/game/ToneRadicalChar.tsx` | `revealConfig` props; conditional render of Pinyin/Radical/Meaning tokens; on-demand click |
| `components/game/DragMatchGame.tsx` | Same as ToneRadical wiring |
| `tests/unit/components/game/DragMatchGame.test.tsx` | Same coverage as ToneRadical |
| `components/game/CharDropZone.tsx` | Same as ToneRadicalChar |
| `components/game/ChainGame.tsx` (already modified above) | + reveal threading |
| `components/game/ChainScroll.tsx` | Reveal-aware char cell |
| `tests/unit/components/game/{ToneRadicalChar,CharDropZone,ChainScroll}.test.tsx` | with/without hints render + click reveals |
| `components/game/FallbackBanner.tsx` (new) | `「HSK N 字库尚在补充中…」` notice when hskLevel unavailable |

---

## Task 1: HSK data import — schema migration + import script + integration test

**Files:**
- Create: `data/hsk-vocab.json`
- Create: `scripts/migrations/2026-07-04-hsk-level.sql`
- Create: `scripts/import-hsk.ts`
- Create: `tests/integration/scripts/import-hsk.test.ts`

**Interfaces:**
- Consumes: `data/hsk-vocab.json` shape `{ "1": Array<{char, pinyin, meaning_zh, pos}> , ... }`
- Produces: `mysql2` connection loop calling `INSERT … ON DUPLICATE KEY UPDATE hsk_level=VALUES(hsk_level)`
- Exports a Node-runnable script invoked via `npx tsx scripts/import-hsk.ts`

- [ ] **Step 1.1: Author the migration file**

Create `scripts/migrations/2026-07-04-hsk-level.sql`:

```sql
-- Add HSK level column to chars table for /game difficulty tiers.
-- NULL means HSK data not yet assigned; clients fall back to chars.level.
ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL;
CREATE INDEX idx_chars_hsk_level ON chars (hsk_level);
```

- [ ] **Step 1.2: Run the migration against the local dev DB**

```bash
mysql piyin_dev < scripts/migrations/2026-07-04-hsk-level.sql
```

Expected: command exits 0. Verify:

```bash
mysql piyin_dev -e "DESCRIBE chars" | grep hsk_level
```

Expected output includes a line `hsk_level tinyint(4) YES`.

- [ ] **Step 1.3: Author `data/hsk-vocab.json` with HSK 1.0 entries**

Download the public-domain HSK 1.0 vocab list. A canonical source is the open git project `gospel/biaori` or `gtyang/hsk-vocabulary` (search GitHub for "HSK 1.0 vocabulary json"). The JSON must follow this shape, with **only level "1" populated** in this round (other levels empty arrays):

```json
{
  "1": [
    { "char": "你", "pinyin": "nǐ", "meaning_zh": "你", "pos": "pron" },
    { "char": "好", "pinyin": "hǎo", "meaning_zh": "好", "pos": "adj" },
    { "char": "我", "pinyin": "wǒ", "meaning_zh": "我", "pos": "pron" }
  ],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": []
}
```

Round 1 ships with **all 150 HSK 1 words** (≈300 unique chars when deduplicated). The implementer must verify the count by post-processing: `cat data/hsk-vocab.json | jq '[.[\"1\"][].char] | unique | length'`. Expectation: ≥ 250 unique chars.

- [ ] **Step 1.4: Write the import script with RED test first**

Write the test `tests/integration/scripts/import-hsk.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/piyin_dev';
const JSON_PATH = resolve(__dirname, '../../../data/hsk-vocab.json');

describe('import-hsk', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB_URL);
    // Ensure the column is present; if migration hasn't run, this throws.
    await conn.query("SELECT hsk_level FROM chars LIMIT 1");
  });

  afterAll(async () => { await conn.end(); });

  it('round-trips HSK 1.0 entries idempotently', async () => {
    const { runImport } = await import('../../../scripts/import-hsk');
    await runImport();

    const vocab = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
    const expected = new Set(
      vocab['1'].map((v: { char: string }) => v.char).filter((c: string, i: number, a: string[]) => a.indexOf(c) === i)
    );

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT char FROM chars WHERE hsk_level = 1"
    );
    const imported = new Set(rows.map((r) => r.char));
    expect(imported.size).toBe(expected.size);
    // Sample assertions — every char in vocab should be present.
    for (const c of expected) expect(imported.has(c)).toBe(true);

    // Re-run is idempotent: row count unchanged.
    const before = rows.length;
    await runImport();
    const [rows2] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT char FROM chars WHERE hsk_level = 1"
    );
    expect(rows2.length).toBe(before);
  });
});
```

Run:

```bash
npx vitest run tests/integration/scripts/import-hsk.test.ts
```

Expected: FAIL — `Cannot find module '../../../scripts/import-hsk'` (function doesn't exist yet).

- [ ] **Step 1.5: Implement `scripts/import-hsk.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/piyin_dev';
const JSON_PATH = resolve(__dirname, '../data/hsk-vocab.json');

type VocabEntry = { char: string; pinyin: string; meaning_zh: string; pos: string };
type Vocab = Record<'1' | '2' | '3' | '4' | '5' | '6', VocabEntry[]>;

export async function runImport(): Promise<void> {
  const raw = readFileSync(JSON_PATH, 'utf8');
  const vocab: Vocab = JSON.parse(raw);
  const conn = await mysql.createConnection(DB_URL);

  try {
    for (const level of ['1', '2', '3', '4', '5', '6'] as const) {
      const entries = vocab[level];
      if (entries.length === 0) continue;
      const lvl = Number(level);
      for (const e of entries) {
        // INSERT…ON DUPLICATE KEY UPDATE keyed on PK (char).
        await conn.execute(
          'INSERT INTO chars (char, hsk_level) VALUES (?, ?) ON DUPLICATE KEY UPDATE hsk_level = VALUES(hsk_level)',
          [e.char, lvl]
        );
      }
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  runImport()
    .then(() => { console.log('import-hsk: done'); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 1.6: Run the test to verify GREEN**

```bash
npx vitest run tests/integration/scripts/import-hsk.test.ts
```

Expected: PASS. Output: `1 passed (1)`.

- [ ] **Step 1.7: Commit**

```bash
git add scripts/migrations/2026-07-04-hsk-level.sql data/hsk-vocab.json scripts/import-hsk.ts tests/integration/scripts/import-hsk.test.ts
git commit -m "feat(hsk-data): import HSK 1.0 vocab into chars.hsk_level [YYYY-MM-DD HH.MM]"
```

(Use actual local time — `date "+%Y-%m-%d %H:%M"`.)

---

## Task 2: lib/reveal.ts — reveal model types and helpers

**Files:**
- Create: `lib/reveal.ts`
- Create: `tests/unit/lib/reveal.test.ts`

**Interfaces:**
- Produces types `RevealElement`, `HskLevel`, `GameMode`, `RevealConfig` consumed by Tasks 5, 6, 8, 9, 10.
- Function `getRevealConfig(game, level): RevealConfig` consumed by all 3 game components.

- [ ] **Step 2.1: Write the failing test `tests/unit/lib/reveal.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { getRevealConfig, REVEAL_BY_LEVEL } from '@/lib/reveal';

describe('reveal model', () => {
  it('REVEAL_BY_LEVEL has HSK 1 = full (pinyin+meaning+radical)', () => {
    expect(REVEAL_BY_LEVEL[1].cellHints).toEqual(['pinyin', 'meaning', 'radical']);
    expect(REVEAL_BY_LEVEL[1].allowOnDemandHints).toBe(false);
  });

  it('REVEAL_BY_LEVEL has HSK 6 = empty cell, on-demand allowed', () => {
    expect(REVEAL_BY_LEVEL[6].cellHints).toEqual([]);
    expect(REVEAL_BY_LEVEL[6].allowOnDemandHints).toBe(true);
  });

  it('chain game filters radical out of cellHints', () => {
    const cfg = getRevealConfig('chain', 1);
    expect(cfg.cellHints).not.toContain('radical');
    expect(cfg.onDemandPenalty).toBe(0);
  });

  it('drag-match keeps pinyin/meaning but drops radical', () => {
    const cfg = getRevealConfig('drag-match', 1);
    expect(cfg.cellHints).toContain('pinyin');
    expect(cfg.cellHints).toContain('meaning');
    expect(cfg.cellHints).not.toContain('radical');
  });

  it('tone-radical keeps radical in cellHints at HSK 1', () => {
    const cfg = getRevealConfig('tone-radical', 1);
    expect(cfg.cellHints).toContain('radical');
    expect(cfg.onDemandPenalty).toBe(1);
  });

  it('HSK 1-3 disallow on-demand, HSK 4-6 allow', () => {
    expect(getRevealConfig('tone-radical', 1).allowOnDemandHints).toBe(false);
    expect(getRevealConfig('tone-radical', 3).allowOnDemandHints).toBe(false);
    expect(getRevealConfig('tone-radical', 4).allowOnDemandHints).toBe(true);
    expect(getRevealConfig('tone-radical', 6).allowOnDemandHints).toBe(true);
  });
});
```

Run:

```bash
npx vitest run tests/unit/lib/reveal.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/reveal'`.

- [ ] **Step 2.2: Implement `lib/reveal.ts`**

```ts
export type RevealElement = 'pinyin' | 'radical' | 'meaning';
export type HskLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type GameMode = 'tone-radical' | 'drag-match' | 'chain';

export type RevealConfig = {
  cellHints: ReadonlyArray<RevealElement>;
  allowOnDemandHints: boolean;
  onDemandPenalty: number;
};

export const REVEAL_BY_LEVEL: Record<
  HskLevel,
  Pick<RevealConfig, 'cellHints' | 'allowOnDemandHints'>
> = {
  1: { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false },
  2: { cellHints: ['pinyin', 'meaning'],            allowOnDemandHints: false },
  3: { cellHints: ['pinyin'],                       allowOnDemandHints: false },
  4: { cellHints: ['pinyin'],                       allowOnDemandHints: true  },
  5: { cellHints: [],                               allowOnDemandHints: true  },
  6: { cellHints: [],                               allowOnDemandHints: true  },
};

const NO_RADICAL_GAMES: ReadonlySet<GameMode> = new Set(['drag-match', 'chain']);
const PENALTY_BY_GAME: Record<GameMode, number> = {
  'tone-radical': 1,
  'drag-match': 1,
  'chain': 0,
};

export function getRevealConfig(game: GameMode, level: HskLevel): RevealConfig {
  const base = REVEAL_BY_LEVEL[level];
  const filtered: RevealElement[] = NO_RADICAL_GAMES.has(game)
    ? base.cellHints.filter((el) => el !== 'radical')
    : [...base.cellHints];
  return {
    cellHints: filtered,
    allowOnDemandHints: base.allowOnDemandHints,
    onDemandPenalty: PENALTY_BY_GAME[game],
  };
}
```

- [ ] **Step 2.3: Run the test to verify GREEN**

```bash
npx vitest run tests/unit/lib/reveal.test.ts
```

Expected: PASS. `6 passed`.

- [ ] **Step 2.4: Commit**

```bash
git add lib/reveal.ts tests/unit/lib/reveal.test.ts
git commit -m "feat(reveal): add lib/reveal.ts model + getRevealConfig per game [YYYY-MM-DD HH.MM]"
```

---

## Task 3: Chain rule rollback — strict last-letter, drop wildcard

**Files:**
- Modify: `lib/pinyin-syllable.ts:15-20`
- Modify: `tests/unit/lib/pinyin-syllable.test.ts`
- Modify: `tests/unit/lib/chain-rules.test.ts`

**Interfaces:**
- Consumes: `getLastLetter`, `expandLastLetter` from `lib/pinyin-syllable.ts` (used by `lib/chain-rules.ts`).
- Produces: `expandLastLetter(letter)` returns `[letter]` only. `isValidNext` and downstream unchanged.

- [ ] **Step 3.1: Audit existing tests for cross-spelling bridging**

Read `tests/unit/lib/pinyin-syllable.test.ts` and `tests/unit/lib/chain-rules.test.ts` end-to-end. Identify cases that rely on:
- `expandLastLetter('i')` returning `['i', 'y']`
- `expandLastLetter('u')` returning `['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n']`
- `expandLastLetter('v')` or `'ü'` returning the extended sets
- Chain tests where `你 → 衣` (you→yi, last-letter `i`→first-letter `y`) is asserted valid

Record the exact line numbers and case descriptions; you'll rewrite them.

- [ ] **Step 3.2: Rewrite `tests/unit/lib/pinyin-syllable.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect } from 'vitest';
import { getLastLetter, expandLastLetter } from '@/lib/pinyin-syllable';

describe('pinyin-syllable', () => {
  describe('getLastLetter', () => {
    it('strips trailing numeric tone then returns last letter lowercased', () => {
      expect(getLastLetter('nǐ')).toBe('i');
      expect(getLastLetter('dēng1')).toBe('g');
      expect(getLastLetter('lü')).toBe('ü');
      expect(getLastLetter('guo')).toBe('o');
    });
    it('returns empty for empty input', () => {
      expect(getLastLetter('')).toBe('');
    });
  });

  describe('expandLastLetter (strict, no wildcard)', () => {
    it('identity mapping: i stays i', () => {
      expect(expandLastLetter('i')).toEqual(['i']);
    });
    it('identity mapping: u stays u', () => {
      expect(expandLastLetter('u')).toEqual(['u']);
    });
    it('identity mapping: ü stays ü', () => {
      expect(expandLastLetter('ü')).toEqual(['ü']);
    });
    it('identity mapping: any other letter', () => {
      expect(expandLastLetter('a')).toEqual(['a']);
      expect(expandLastLetter('g')).toEqual(['g']);
    });
  });
});
```

- [ ] **Step 3.3: Rewrite `tests/unit/lib/chain-rules.test.ts` — strict cases only**

Keep cases that don't rely on cross-spelling bridging. Delete any case that asserts `你 → 衣` is valid (last-letter `i` → first-letter `y`) — that's now invalid. Replace with the assertion `你 → 期` valid (i → i) and `你 → 衣` invalid (i ≠ y).

Open the file and rewrite the cross-spelling cases inline. Example replacement pattern (apply to ALL `你 → 衣`-style assertions):

```ts
  // Strict last-letter: 你 (nǐ, last 'i') only chains to chars with first letter 'i'.
  it('你 chains to 期 (qī, first i) — strict last-letter match', () => {
    expect(matchesChainRule('nǐ', 'qī')).toBe(true);
  });

  it('你 does NOT chain to 衣 (yī, first y) — different spelling, same sound', () => {
    expect(matchesChainRule('nǐ', 'yī')).toBe(false);
  });

  it('姑 (gū, last u) does NOT chain to 女 (nǚ, first n) — even though ü is u-glide', () => {
    expect(matchesChainRule('gū', 'nǚ')).toBe(false);
  });
```

- [ ] **Step 3.4: Run the test to verify RED (old behavior)**

```bash
npx vitest run tests/unit/lib/pinyin-syllable.test.ts tests/unit/lib/chain-rules.test.ts
```

Expected: `expandLastLetter` tests FAIL — old impl returns `['i','y']` instead of `['i']`. Other tests on `getLastLetter` PASS (untouched).

- [ ] **Step 3.5: Implement the rollback in `lib/pinyin-syllable.ts`**

Replace lines 15-20 with:

```ts
export function expandLastLetter(letter: string): string[] {
  return [letter];
}
```

- [ ] **Step 3.6: Run tests to verify GREEN**

```bash
npx vitest run tests/unit/lib/pinyin-syllable.test.ts tests/unit/lib/chain-rules.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3.7: Run full suite to gauge collateral damage**

```bash
npx vitest run
```

If other tests fail (e.g. `api-chain.test.ts`, `ChainGame.test.tsx`), audit each. They likely had assertions tied to wildcard behavior; rewrite or delete. Don't add wildcards back. **Acceptable to ship this task with `npx tsc --noEmit` clean even if 2-3 unrelated tests need rewrites** — file those rewrites in the next task that touches them.

- [ ] **Step 3.8: Commit**

```bash
git add lib/pinyin-syllable.ts tests/unit/lib/pinyin-syllable.test.ts tests/unit/lib/chain-rules.test.ts
git commit -m "fix(chain): strict last-letter rule, drop i/u/ü wildcard [YYYY-MM-DD HH.MM]"
```

---

## Task 4: lib/difficulty.ts + useDifficulty — HSK mapping + persistence

**Files:**
- Modify: `lib/difficulty.ts`
- Modify: `lib/use-difficulty.ts`
- Modify: `tests/unit/lib/difficulty.test.ts`

**Interfaces:**
- Produces `HskLevel`, `sourceForHsk(level)`, and `hskLevel` field on `GameConfig`.
- `useDifficulty()` hook returns `{ difficulty, hskLevel, setDifficulty, setHskLevel }`.

- [ ] **Step 4.1: Read existing files for structure**

Open `lib/difficulty.ts` and `lib/use-difficulty.ts`. Identify `GameConfig` shape, the existing `CharSource` enum, and the localStorage key. Don't refactor; extend.

- [ ] **Step 4.2: Add failing tests to `tests/unit/lib/difficulty.test.ts`**

Append a new describe block:

```ts
import { sourceForHsk, type HskLevel } from '@/lib/difficulty';

describe('sourceForHsk', () => {
  it('HSK 1 maps to chars-level-1 (smallest pool)', () => {
    expect(sourceForHsk(1)).toBe('chars-level-1');
  });
  it('HSK 2-3 map to chars-level-1-2 (mid pool)', () => {
    expect(sourceForHsk(2)).toBe('chars-level-1-2');
    expect(sourceForHsk(3)).toBe('chars-level-1-2');
  });
  it('HSK 4-6 map to chars-all (full pool, fallback)', () => {
    expect(sourceForHsk(4)).toBe('chars-all');
    expect(sourceForHsk(5)).toBe('chars-all');
    expect(sourceForHsk(6)).toBe('chars-all');
  });
  it('rejects invalid levels at type level (compile-time)', () => {
    // @ts-expect-error — invalid hsk level
    sourceForHsk(99);
  });
});
```

Run:

```bash
npx vitest run tests/unit/lib/difficulty.test.ts
```

Expected: FAIL — `sourceForHsk` not exported.

- [ ] **Step 4.3: Add types and helper to `lib/difficulty.ts`**

Append (do NOT rewrite — preserve existing `CharSource` and existing functions):

```ts
import type { HskLevel as _HskLevel } from './reveal';
// HskLevel re-export kept loose: importers can also import from lib/reveal directly.
export type HskLevel = _HskLevel;

export function sourceForHsk(level: HskLevel): CharSource {
  if (level === 1) return 'chars-level-1';
  if (level === 2 || level === 3) return 'chars-level-1-2';
  return 'chars-all';
}

// GameConfig extended: add optional hskLevel (with sensible default).
declare module './difficulty' {
  export interface GameConfig {
    hskLevel?: HskLevel;
  }
}
```

(If `GameConfig` is a `type`/`interface` rather than a module-augmentation target, edit the interface directly to add `hskLevel?: HskLevel`.)

- [ ] **Step 4.4: Extend `lib/use-difficulty.ts`**

Add a parallel `hskLevel` state alongside the existing `difficulty` state. Persist to `localStorage['pinyin_hsk_level']`. Default to `1`.

Read the existing hook's structure and modify:

```ts
// At top of use-difficulty.ts:
import type { HskLevel } from './difficulty';

// Add inside the hook:
const [hskLevel, setHskLevelState] = useState<HskLevel>(() => {
  if (typeof window === 'undefined') return 1;
  const raw = window.localStorage.getItem('pinyin_hsk_level');
  const parsed = raw ? Number(raw) : 1;
  if (parsed >= 1 && parsed <= 6) return parsed as HskLevel;
  return 1;
});

const setHskLevel = (next: HskLevel) => {
  setHskLevelState(next);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('pinyin_hsk_level', String(next));
  }
};

return { difficulty, hskLevel, setDifficulty, setHskLevel };
```

- [ ] **Step 4.5: Run tests to verify GREEN**

```bash
npx vitest run tests/unit/lib/difficulty.test.ts
```

Expected: PASS. `4 passed` (in the new describe block) — pre-existing tests unchanged.

- [ ] **Step 4.6: Commit**

```bash
git add lib/difficulty.ts lib/use-difficulty.ts tests/unit/lib/difficulty.test.ts
git commit -m "feat(difficulty): HSK 1-6 mapping + useDifficulty persists hskLevel [YYYY-MM-DD HH.MM]"
```

---

## Task 5: lib/game-round.ts + /api/game/round — server filter + revealConfig embed

**Files:**
- Modify: `lib/game-round.ts`
- Modify: `app/api/game/round/route.ts`
- Modify: `tests/unit/lib/game-round.test.ts`
- Create: `tests/integration/api/game-round.test.ts`

**Interfaces:**
- Consumes: `HskLevel`, `getRevealConfig` from earlier tasks.
- Produces: `buildRound(content, count, seed, mode, hskLevel)` — same signature + hskLevel param.
- API route accepts `?hskLevel=N`, embeds `{ chars, revealConfig: { cellHints, allowOnDemandHints, onDemandPenalty } }` in response, sets `Cache-Control: no-store`.

- [ ] **Step 5.1: Add RED tests to `tests/unit/lib/game-round.test.ts`**

Append:

```ts
import type { HskLevel } from '@/lib/difficulty';

it('filters chars by hsk_level when provided', async () => {
  const chars: CharInfo[] = [
    { char: '你', level: 1, hsk_level: 1, /* ... */ },
    { char: '好', level: 1, hsk_level: 1, /* ... */ },
    { char: '罕', level: 2, hsk_level: null, /* ... */ },  // fallback
  ] as any;

  const round = await buildRound(chars, 1, 42, 'tone', 1);
  expect(round.chars.map((c: any) => c.char)).toEqual(['你']);  // or '好' depending on shuffle
  // Strict assertion: only chars with hsk_level === 1 included.
  expect(round.chars.every((c: any) => c.hsk_level === 1)).toBe(true);
});

it('falls back to chars.level when hsk_level is null', async () => {
  const chars: CharInfo[] = [
    { char: '罕', level: 2, hsk_level: null, /* ... */ },
    { char: '你', level: 1, hsk_level: 1, /* ... */ },
  ] as any;
  // No hskLevel param → null → fall back to existing level behavior.
  const round = await buildRound(chars, 5, 42, 'tone');
  expect(round.chars.length).toBeGreaterThan(0);
});
```

- [ ] **Step 5.2: Modify `lib/game-round.ts:buildRound` signature**

Locate the existing `buildRound` function. Change the signature:

```ts
// Before
export function buildRound(content: CharInfo[], count: number, seed: number, mode: string): Promise<RoundType>;

// After
export function buildRound(
  content: CharInfo[],
  count: number,
  seed: number,
  mode: 'tone' | 'radical' | 'pinyin',
  hskLevel?: HskLevel | null,  // null = no HSK filter, fall back to level
): Promise<RoundType>;
```

Inside the function, add a pre-filter step before pagination:

```ts
const filtered = hskLevel != null
  ? content.filter((c) => c.hsk_level === hskLevel)
  : content;  // fallback to existing level-based logic
```

If `filtered.length === 0`, fall back to `chars.level` filtering (existing behavior). Don't crash.

- [ ] **Step 5.3: Run the test to verify GREEN**

```bash
npx vitest run tests/unit/lib/game-round.test.ts
```

Expected: PASS.

- [ ] **Step 5.4: Modify `app/api/game/round/route.ts`**

Add zod validation + embed revealConfig. Read the existing route file first to see its shape:

```ts
// Add at top
import { z } from 'zod';
import { getRevealConfig, type GameMode } from '@/lib/reveal';
import type { HskLevel } from '@/lib/difficulty';

const QuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(6),
  seed: z.coerce.number().int().default(() => Math.floor(Math.random() * 1e9)),
  source: z.enum(['chars-level-1', 'chars-level-1-2', 'chars-all']).default('chars-level-1-2'),
  mode: z.enum(['tone', 'radical', 'pinyin']).default('tone'),
  hskLevel: z.coerce.number().int().min(1).max(6).optional(),
});

// Map the per-round mode to a GameMode for reveal config.
// tone-radical game covers tone + radical modes; drag-match covers pinyin.
// (DragMatchGame uses /api/chars directly — separate substep below.)
const gameModeKeyForMode: Record<'tone' | 'radical' | 'pinyin', GameMode> = {
  tone: 'tone-radical',
  radical: 'tone-radical',
  pinyin: 'drag-match',
};

// In the route handler, after buildRound:
const hskLevel = parsed.data.hskLevel as HskLevel | undefined;
const revealConfig = getRevealConfig(gameModeKeyForMode[parsed.data.mode], hskLevel ?? 1);

return Response.json(
  { chars, revealConfig },
  {
    headers: {
      'Cache-Control': 'no-store',
    },
  }
);
```

- [ ] **Step 5.5: Add `?hskLevel=N` filter to `/api/chars/route.ts`**

`DragMatchGame` actually pulls from this endpoint (not `/api/game/round`). Read the file. Add zod hskLevel param to existing schema. In the SQL/page-list, add `AND (hsk_level = ? OR (? IS NULL AND level = ?))` filter, where the second `level` is the fallback path. Emit `Cache-Control: no-store`.

**Diff sketch** (apply after reading the existing route):

```ts
// Existing schema gains:
const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100).default(1),
  source: z.enum(['chars-level-1', 'chars-level-1-2', 'chars-all']).default('chars-level-1-2'),
  hskLevel: z.coerce.number().int().min(1).max(6).optional(),
});

// Existing listChars call gains an hskLevel argument:
// listChars(page, source, hskLevel) — modify lib/chars.ts helper to accept hskLevel.
// When hskLevel is undefined, behavior unchanged. When set, filter rows by hsk_level === N.
return Response.json(rows, {
  headers: { 'Cache-Control': 'no-store' },
});
```

`lib/chars.ts` (the helper used by `/api/chars/route.ts`) — read first; if it doesn't accept hskLevel, add an optional parameter and an internal `WHERE hsk_level = ?` clause when set.

- [ ] **Step 5.5: Create `tests/integration/api/game-round.test.ts`**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4444';

describe('GET /api/game/round', () => {
  it('accepts ?hskLevel=1 and embeds revealConfig', async () => {
    const res = await fetch(`${BASE}/api/game/round?count=3&mode=tone&hskLevel=1&source=chars-level-1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = await res.json();
    expect(data.revealConfig).toBeDefined();
    expect(data.revealConfig.cellHints).toContain('pinyin');
  });

  it('rejects ?hskLevel=99 via zod', async () => {
    const res = await fetch(`${BASE}/api/game/round?hskLevel=99`);
    expect(res.status).toBe(400);
  });
});
```

NOTE: This test requires dev server running. If not in CI, mark `it.skip` for now and run manually after `npx next dev -p 4444`. Mark a follow-up integration test once dev environment is provisioned.

- [ ] **Step 5.6: Verify route still works**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5.7: Commit**

```bash
git add lib/game-round.ts app/api/game/round/route.ts tests/unit/lib/game-round.test.ts tests/integration/api/game-round.test.ts
git commit -m "feat(api): game/round accepts hskLevel + embeds revealConfig [YYYY-MM-DD HH.MM]"
```

---

## Task 6: Chain endpoint + client cache + W2/W3 fold-ins

**Files:**
- Modify: `app/api/chain/chars/route.ts`
- Modify: `lib/api-chain.ts`
- Modify: `components/game/ChainGame.tsx`
- Modify: `tests/unit/lib/api-chain.test.ts`
- Create or extend: `tests/integration/api/chain-chars.test.ts`
- Modify: `tests/unit/components/game/ChainGame.test.tsx`

**Interfaces:**
- `fetchChainChars(source, hskLevel)` — cache key includes hskLevel.
- API route accepts `?hskLevel=N`, filters + per-page try/catch (W2), `Cache-Control: no-store`.
- `ChainGame.tsx` useEffect AbortController cleanup (W3).

- [ ] **Step 6.1: Read existing files**

`lib/api-chain.ts` (cache singleton + `fetchChainChars`), `app/api/chain/chars/route.ts` (the 100-page loop), `components/game/ChainGame.tsx:23` useEffect for initial fetch.

- [ ] **Step 6.2: Add RED test for cache key extension**

Append to `tests/unit/lib/api-chain.test.ts`:

```ts
it('cache key changes when hskLevel differs', async () => {
  // @vitest-environment happy-dom
  const { fetchChainChars, __resetChainCache } = await import('@/lib/api-chain');
  __resetChainCache();

  // First fetch with no hskLevel.
  await fetchChainChars('chars-level-1-2');
  // Fetch with hskLevel=3 should be a cache miss → new fetch.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ chars: [] }),
  });
  await fetchChainChars('chars-level-1-2', 3);
  expect(global.fetch).toHaveBeenCalled();
});
```

Note: This test requires `__resetChainCache` export — add to the implementation (see Step 6.4).

Run:

```bash
npx vitest run tests/unit/lib/api-chain.test.ts
```

Expected: FAIL — `__resetChainCache` missing or fetch not called.

- [ ] **Step 6.3: Update `app/api/chain/chars/route.ts`**

Add zod hskLevel param + per-page try/catch (W2 fold-in):

```ts
const QuerySchema = z.object({
  source: z.enum(['chars-level-1', 'chars-level-1-2', 'chars-all']).default('chars-level-1-2'),
  hskLevel: z.coerce.number().int().min(1).max(6).optional(),
});

// Inside the existing 100-page loop, wrap each page in try/catch:
for (const page of pages) {
  try {
    const rows = await listChars(page);
    if (hskLevel != null) {
      chars.push(...rows.filter((c) => c.hsk_level === hskLevel));
    } else {
      chars.push(...rows);
    }
  } catch (err) {
    console.error(`[chain/chars] page ${page} failed:`, err);
    // Continue with whatever we've gathered so far. Don't fail the whole route.
  }
}

return Response.json(
  { chars },
  { headers: { 'Cache-Control': 'no-store' } }
);
```

- [ ] **Step 6.4: Update `lib/api-chain.ts`**

Extend cache key + signature:

```ts
import type { HskLevel } from './difficulty';

type CacheKey = string;  // `${source}::hsk${level ?? 0}`
const cache = new Map<CacheKey, Promise<ChainChar[]>>();

export async function fetchChainChars(
  source: CharSource,
  hskLevel?: HskLevel,
): Promise<ChainChar[]> {
  const key = `${source}::hsk${hskLevel ?? 0}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(`/api/chain/chars?source=${source}&hskLevel=${hskLevel ?? ''}`)
      .then((r) => r.json())
      .then((d: { chars: ChainChar[] }) => d.chars));
  }
  return cache.get(key)!;
}

export function __resetChainCache(): void { cache.clear(); }
```

- [ ] **Step 6.5: Update `components/game/ChainGame.tsx` useEffect (W3 fold-in)**

```ts
useEffect(() => {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const list = await fetchChainChars(source, hskLevel);
      if (!ctrl.signal.aborted) {
        setChars(list);
      }
    } catch (e) {
      // surface error to existing UI state
    }
  })();
  return () => ctrl.abort();
}, [source, hskLevel]);
```

- [ ] **Step 6.6: Run tests**

```bash
npx vitest run tests/unit/lib/api-chain.test.ts tests/unit/components/game/ChainGame.test.tsx
```

Expected: PASS (existing tests still work; new tests in §6.2 + §6.5 green).

- [ ] **Step 6.7: Commit**

```bash
git add app/api/chain/chars/route.ts lib/api-chain.ts components/game/ChainGame.tsx tests/unit/lib/api-chain.test.ts tests/unit/components/game/ChainGame.test.tsx
git commit -m "feat(chain): hskLevel filter + W2 try/catch + W3 abort + no-store [YYYY-MM-DD HH.MM]"
```

---

## Task 7: GameModeTabs — HSK picker chip row + FallbackBanner

**Files:**
- Modify: `components/game/GameModeTabs.tsx`
- Create: `components/game/FallbackBanner.tsx` (new per spec §3)
- Add (or extend test): `tests/unit/components/game/GameModeTabs.test.tsx`
- Create: `tests/unit/components/game/FallbackBanner.test.tsx`

**Interfaces:**
- Consumes `useDifficulty()` hook from Task 4.
- Renders 6 chips, persists selection via `setHskLevel`.
- `FallbackBanner` shows when `chars.hsk_level IS NULL` after fallback; reads from a probe endpoint or is driven by the round response metadata.

- [ ] **Step 7.1: Add RED test**

If `GameModeTabs.test.tsx` exists, append:

```ts
// @vitest-environment happy-dom
import { cleanup } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';

beforeEach(() => cleanup());

it('renders HSK 1-6 chips and reflects current selection', async () => {
  vi.mock('@/lib/use-difficulty', () => ({
    useDifficulty: () => ({
      difficulty: 'medium',
      hskLevel: 3 as HskLevel,
      setDifficulty: vi.fn(),
      setHskLevel: vi.fn(),
    }),
  }));
  const { GameModeTabs } = await import('@/components/game/GameModeTabs');
  const { render, screen } = await import('@testing-library/react');
  render(<GameModeTabs />);
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    expect(screen.getByRole('button', { name: `HSK ${lvl}` })).toBeTruthy();
  }
});
```

If the file does not exist, create it with the standard happy-dom pragma + cleanup boilerplate.

- [ ] **Step 7.2: Add chip row to `GameModeTabs.tsx`**

Read the existing file. Find the section that lists game tabs and **add a chip row above** it:

```tsx
import { useDifficulty } from '@/lib/use-difficulty';
import type { HskLevel } from '@/lib/difficulty';

// Inside GameModeTabs component body:
const { hskLevel, setHskLevel } = useDifficulty();

const HSKS: HskLevel[] = [1, 2, 3, 4, 5, 6];

return (
  <div>
    <div role="group" aria-label="HSK level" className="flex gap-2 mb-3">
      {HSKS.map((lvl) => (
        <button
          key={lvl}
          type="button"
          onClick={() => setHskLevel(lvl)}
          aria-pressed={lvl === hskLevel}
          className={`rounded border px-2 py-1 text-sm ${
            lvl === hskLevel
              ? 'bg-seal text-white border-seal'
              : 'bg-paper-deep border-ink/30 hover:bg-paper'
          }`}
        >
          HSK {lvl}
        </button>
      ))}
    </div>
    {/* existing tab buttons, etc. */}
  </div>
);
```

- [ ] **Step 7.3: Create `components/game/FallbackBanner.tsx`**

Read the file shape (new). It receives `hskLevel: HskLevel` and `available: boolean`. When `available` is false (server indicates no chars in this HSK bucket), it renders the banner:

```tsx
'use client';
import type { HskLevel } from '@/lib/difficulty';

type Props = {
  hskLevel: HskLevel;
  available: boolean;
};

export function FallbackBanner({ hskLevel, available }: Props) {
  if (available) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      HSK {hskLevel} 字库尚在补充中—当前以 HSK {Math.max(1, hskLevel - 1)} 字池代替
    </div>
  );
}
```

The `available` prop is supplied by the game components after fetching (server returns `{ hskFallback: true }` metadata when filter returns empty). Tasks 5 and 6 must extend the API response shape to include this flag — note in their step.

- [ ] **Step 7.4: Add RED test for FallbackBanner**

```tsx
// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { beforeEach, it, expect } from 'vitest';

beforeEach(() => cleanup());

it('renders the fallback message when unavailable', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(<FallbackBanner hskLevel={5} available={false} />);
  expect(getByRole('status').textContent).toContain('HSK 5');
  expect(getByRole('status').textContent).toContain('HSK 4');
});

it('renders nothing when available', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { container } = render(<FallbackBanner hskLevel={5} available={true} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 7.5: Run tests to verify GREEN**

```bash
npx vitest run tests/unit/components/game/GameModeTabs.test.tsx tests/unit/components/game/FallbackBanner.test.tsx
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add components/game/GameModeTabs.tsx components/game/FallbackBanner.tsx tests/unit/components/game/GameModeTabs.test.tsx tests/unit/components/game/FallbackBanner.test.tsx
git commit -m "feat(tabs): GameModeTabs HSK 1-6 picker + FallbackBanner [YYYY-MM-DD HH.MM]"
```

---

## Task 8: ToneRadicalGame + ToneRadicalChar — reveal + on-demand

**Files:**
- Modify: `components/game/ToneRadicalGame.tsx`
- Modify: `components/game/ToneRadicalChar.tsx`
- Modify (or add): `tests/unit/components/game/ToneRadicalGame.test.tsx`
- Modify (or add): `tests/unit/components/game/ToneRadicalChar.test.tsx`

**Interfaces:**
- Consumes `getRevealConfig`, `ToneRadicalChar` props extended with `revealConfig`, `onDemandReveal`.

- [ ] **Step 8.1: Add RED tests**

`tests/unit/components/game/ToneRadicalChar.test.tsx` (new if absent):

```tsx
// @vitest-environment happy-dom
import { cleanup, render, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';

beforeEach(() => cleanup());

it('renders all hints at HSK 1', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const { container } = render(
    <ToneRadicalChar char="你" revealConfig={cfg as any} onDemandReveal={vi.fn()} />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="meaning"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="radical"]')).toBeTruthy();
});

it('hides all hints at HSK 6; allows click-to-reveal', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const onDemand = vi.fn();
  const { container, getByLabelText } = render(
    <ToneRadicalChar char="你" revealConfig={cfg as any} onDemandReveal={onDemand} />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
  expect(onDemand).toHaveBeenCalledWith('pinyin');
});

it('at HSK 1 (allowOnDemandHints=false) no click-to-reveal button is shown', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: ['pinyin'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const { queryByLabelText } = render(
    <ToneRadicalChar char="你" revealConfig={cfg as any} onDemandReveal={vi.fn()} />
  );
  expect(queryByLabelText('显示拼音')).toBeNull();
});
```

- [ ] **Step 8.2: Run the test to verify RED**

```bash
npx vitest run tests/unit/components/game/ToneRadicalChar.test.tsx
```

Expected: FAIL — `revealConfig` prop not yet implemented.

- [ ] **Step 8.3: Update `ToneRadicalChar.tsx`**

Read the file, add props and conditional rendering:

```tsx
'use client';
import { useState, type ReactNode } from 'react';
import type { RevealConfig, RevealElement } from '@/lib/reveal';
import { PinyinToken } from './PinyinToken';
import { RadicalToken } from './RadicalToken';
import { MeaningToken } from './MeaningToken';

type Props = {
  char: string;
  pinyin?: string;
  radical?: string;
  meaning?: string;
  revealConfig: RevealConfig;
  onDemandReveal: (el: RevealElement) => void;
};

const HINT_LABEL: Record<RevealElement, string> = {
  pinyin: '显示拼音',
  radical: '显示部首',
  meaning: '显示含义',
};

export function ToneRadicalChar({ char, pinyin, radical, meaning, revealConfig, onDemandReveal }: Props) {
  const [revealed, setRevealed] = useState<Set<RevealElement>>(new Set());

  const isVisible = (el: RevealElement) =>
    revealConfig.cellHints.includes(el) || revealed.has(el);

  const handleClick = (el: RevealElement) => {
    if (!revealConfig.allowOnDemandHints) return;
    setRevealed((s) => new Set(s).add(el));
    onDemandReveal(el);
  };

  const renderToken = (el: RevealElement, content: ReactNode): ReactNode =>
    isVisible(el) ? (
      <span data-hint={el}>{content}</span>
    ) : revealConfig.allowOnDemandHints ? (
      <button
        type="button"
        aria-label={HINT_LABEL[el]}
        className="rounded border border-ink/30 px-1 text-xs text-ink-faint"
        onClick={() => handleClick(el)}
      >
        ?
      </button>
    ) : null;

  return (
    <div className="tone-radical-char flex flex-col items-center">
      <span className="text-3xl">{char}</span>
      <div className="text-xs mt-1 flex gap-2">
        {renderToken('pinyin', <PinyinToken pinyin={pinyin ?? ''} />)}
        {renderToken('meaning', <MeaningToken meaning={meaning ?? ''} />)}
        {renderToken('radical', <RadicalToken radical={radical ?? ''} />)}
      </div>
    </div>
  );
}
```

(If `MeaningToken` doesn't exist in your codebase, use a plain `<span>` instead — the spec doesn't mandate that component.)

- [ ] **Step 8.4: Update `ToneRadicalGame.tsx`**

Thread the reveal config + on-demand handler:

```tsx
import { useDifficulty } from '@/lib/use-difficulty';
import { getRevealConfig, type RevealElement } from '@/lib/reveal';

// In the component:
const { hskLevel } = useDifficulty();
const revealConfig = useMemo(() => getRevealConfig('tone-radical', hskLevel), [hskLevel]);

const handleDemand = useCallback((el: RevealElement) => {
  setMismatches((m) => m + revealConfig.onDemandPenalty);
}, [revealConfig.onDemandPenalty]);

// Pass to ToneRadicalChar:
<ToneRadicalChar char={cell.char} revealConfig={revealConfig} onDemandReveal={handleDemand} />
```

- [ ] **Step 8.5: Run tests**

```bash
npx vitest run tests/unit/components/game/ToneRadicalChar.test.tsx tests/unit/components/game/ToneRadicalGame.test.tsx
```

Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add components/game/ToneRadicalGame.tsx components/game/ToneRadicalChar.tsx tests/unit/components/game/ToneRadicalChar.test.tsx tests/unit/components/game/ToneRadicalGame.test.tsx
git commit -m "feat(tone-game): revealConfig threaded + on-demand bumps mismatches [YYYY-MM-DD HH.MM]"
```

---

## Task 9: DragMatchGame + CharDropZone — same pattern as Task 8

**Files:**
- Modify: `components/game/DragMatchGame.tsx` — fetch with `?hskLevel=N` from `/api/chars` (per Task 5.5), thread reveal config, on-demand bumps `mismatches`
- Modify: `components/game/CharDropZone.tsx` — same shape as `ToneRadicalChar` (revealConfig prop, conditional render of Pinyin/Meaning tokens; NO radical element for drag-match)
- Modify (or add): `tests/unit/components/game/DragMatchGame.test.tsx`
- Modify (or add): `tests/unit/components/game/CharDropZone.test.tsx`

- [ ] **Step 9.1: Add RED test for `CharDropZone` reveal behavior**

`tests/unit/components/game/CharDropZone.test.tsx` (new if absent):

```tsx
// @vitest-environment happy-dom
import { cleanup, render, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';

beforeEach(() => cleanup());

it('shows pinyin + meaning at HSK 1 (no radical in drag-match)', async () => {
  const { CharDropZone } = await import('@/components/game/CharDropZone');
  const cfg = { cellHints: ['pinyin', 'meaning'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const { container } = render(
    <CharDropZone char="你" pinyin="nǐ" meaning="you" revealConfig={cfg as any} onDemandReveal={vi.fn()} />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="meaning"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="radical"]')).toBeFalsy();
});

it('hides everything at HSK 6; click-to-reveal only when allowOnDemandHints', async () => {
  const { CharDropZone } = await import('@/components/game/CharDropZone');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const onDemand = vi.fn();
  const { container, getByLabelText } = render(
    <CharDropZone char="你" pinyin="nǐ" revealConfig={cfg as any} onDemandReveal={onDemand} />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
  expect(onDemand).toHaveBeenCalledWith('pinyin');
});
```

Run:

```bash
npx vitest run tests/unit/components/game/CharDropZone.test.tsx
```

Expected: FAIL — `revealConfig` prop not implemented.

- [ ] **Step 9.2: Update `CharDropZone.tsx`**

Apply the same shape as `ToneRadicalChar` from Step 8.3 but without `radical`:

```tsx
'use client';
import { useState, type ReactNode } from 'react';
import type { RevealConfig, RevealElement } from '@/lib/reveal';
import { PinyinToken } from './PinyinToken';
import { MeaningToken } from './MeaningToken';

type Props = {
  char: string;
  pinyin?: string;
  meaning?: string;
  revealConfig: RevealConfig;
  onDemandReveal: (el: RevealElement) => void;
};

const HINT_LABEL: Record<RevealElement, string> = {
  pinyin: '显示拼音',
  meaning: '显示含义',
  radical: '显示部首',
};

export function CharDropZone({ char, pinyin, meaning, revealConfig, onDemandReveal }: Props) {
  const [revealed, setRevealed] = useState<Set<RevealElement>>(new Set());

  const isVisible = (el: RevealElement) =>
    revealConfig.cellHints.includes(el) || revealed.has(el);

  const handleClick = (el: RevealElement) => {
    if (!revealConfig.allowOnDemandHints) return;
    setRevealed((s) => new Set(s).add(el));
    onDemandReveal(el);
  };

  const renderToken = (el: RevealElement, content: ReactNode): ReactNode =>
    isVisible(el) ? (
      <span data-hint={el}>{content}</span>
    ) : revealConfig.allowOnDemandHints ? (
      <button
        type="button"
        aria-label={HINT_LABEL[el]}
        className="rounded border border-ink/30 px-1 text-xs text-ink-faint"
        onClick={() => handleClick(el)}
      >
        ?
      </button>
    ) : null;

  return (
    <div className="char-drop-zone flex flex-col items-center">
      <span className="text-3xl">{char}</span>
      <div className="text-xs mt-1 flex gap-2">
        {renderToken('pinyin', <PinyinToken pinyin={pinyin ?? ''} />)}
        {renderToken('meaning', <MeaningToken meaning={meaning ?? ''} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.3: Update `DragMatchGame.tsx`**

Fetch with `?hskLevel=N` and thread the reveal config. The existing implementation calls `/api/chars?page=1` directly — switch to passing hskLevel via the param added in Task 5.5:

```tsx
import { useDifficulty } from '@/lib/use-difficulty';
import { getRevealConfig, type RevealElement } from '@/lib/reveal';

// Inside the component:
const { hskLevel } = useDifficulty();
const revealConfig = useMemo(() => getRevealConfig('drag-match', hskLevel), [hskLevel]);

const handleDemand = useCallback((el: RevealElement) => {
  setMismatches((m) => m + revealConfig.onDemandPenalty);
}, [revealConfig.onDemandPenalty]);

// Fetch with hskLevel:
const res = await fetch(`/api/chars?source=${source}&hskLevel=${hskLevel}&page=1`);

// Pass to CharDropZone:
<CharDropZone char={cell.char} pinyin={cell.pinyin} meaning={cell.meaning_zh}
              revealConfig={revealConfig} onDemandReveal={handleDemand} />
```

- [ ] **Step 9.4: Run tests to verify GREEN**

```bash
npx vitest run tests/unit/components/game/CharDropZone.test.tsx tests/unit/components/game/DragMatchGame.test.tsx
```

Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add components/game/DragMatchGame.tsx components/game/CharDropZone.tsx tests/unit/components/game/CharDropZone.test.tsx tests/unit/components/game/DragMatchGame.test.tsx
git commit -m "feat(drag-game): revealConfig threaded + on-demand bumps mismatches [YYYY-MM-DD HH.MM]"
```

---

## Task 10: ChainGame + ChainScroll — reveal config + free on-demand

**Files:**
- Modify: `components/game/ChainGame.tsx` (already updated in Task 6 for AbortController; thread reveal here)
- Modify: `components/game/ChainScroll.tsx`
- Modify (or add): `tests/unit/components/game/ChainScroll.test.tsx`

**Interfaces:** Same as Tasks 8/9 but `getRevealConfig('chain', hskLevel)` (`onDemandPenalty=0`).

- [ ] **Step 10.1: Add RED test for ChainScroll reveal behavior**

```tsx
// @vitest-environment happy-dom
it('renders only the char cell at HSK 6 with click-to-reveal buttons', async () => {
  cleanup();
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 0 };
  const { container, getByLabelText } = render(
    <ChainScroll chars={[{ char: '你' } as any]} revealConfig={cfg as any} onDemandReveal={vi.fn()} />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
});
```

- [ ] **Step 10.2: Mirror Task 8's pattern for ChainScroll**

`getRevealConfig('chain', hskLevel)` — `onDemandPenalty: 0`, **no score bump** since chain has no score. The handler is `(el) => void onDemandReveal(el)` with NO state-set to mismatches.

- [ ] **Step 10.3: Update `ChainGame.tsx` to thread the config**

```tsx
const revealConfig = useMemo(() => getRevealConfig('chain', hskLevel), [hskLevel]);
const handleDemand = useCallback((el: RevealElement) => { /* no-op for chain */ }, []);
<ChainScroll chars={chars} revealConfig={revealConfig} onDemandReveal={handleDemand} />
```

- [ ] **Step 10.4: Run tests**

```bash
npx vitest run tests/unit/components/game/ChainScroll.test.tsx tests/unit/components/game/ChainGame.test.tsx
```

Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git commit -m "feat(chain-game): revealConfig threaded + free on-demand (no penalty) [YYYY-MM-DD HH.MM]"
```

---

## Task 11: Verification gates + smoke prep

**Files:** none modified; only verification commands.

- [ ] **Step 11.1: Run full unit test suite**

```bash
npx vitest run
```

Expected: All green. Zero regressions beyond intentional chain-rule rollback rewrites (Tasks 3 + downstream tests).

- [ ] **Step 11.2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: exit 0. No errors.

- [ ] **Step 11.3: Run Next.js build (per-task-review requirement)**

**Prereq:** Kill any running dev server first:

```bash
# If `npx next dev -p 4444` is alive, kill it: Ctrl+C, or:
ps aux | grep "next dev" | grep -v grep | awk '{print $2}' | xargs -r kill
sleep 2
```

Then:

```bash
npx next build
```

Expected: Build succeeds. Verify route count matches pre-task baseline (no additions, no removals).

- [ ] **Step 11.4: Optional manual smoke (4 paths)**

Start dev server:

```bash
npx next dev -p 4444 &
```

Then in browser:

1. Visit `/game`. **HSK 1 chip** selected by default. Click **HSK 6**. Verify char cells show only glyphs; click cell → reveals hint.
2. Visit any round of ToneRadical/DragMatch. Verify reveal config matches HSK level.
3. Visit chain game. Strict last-letter: 你 → 期 continues; 你 → 衣 does NOT.
4. Visit HSK 4 (hsk_level NOT yet in DB). Verify fallback banner appears; round still playable.

- [ ] **Step 11.5: No commit — Task 11 produces no code changes**

If Task 11 reveals issues, fix them in their source tasks.

---

## Verification summary

After all 11 tasks:

- `npx vitest run` — all green (including task 3's chain-rule rewrite and the new reveal/HSK tests)
- `npx tsc --noEmit` — clean
- `npx next build` — success; route count preserved
- Manual smoke: HSK 1 full reveal / HSK 6 hint reveal / strict chain rule / fallback banner

---

## Commit summary (11 commits on local main, not pushed)

1. `feat(hsk-data): import HSK 1.0 vocab into chars.hsk_level [HH.MM]`
2. `feat(reveal): add lib/reveal.ts model + getRevealConfig per game [HH.MM]`
3. `fix(chain): strict last-letter rule, drop i/u/ü wildcard [HH.MM]`
4. `feat(difficulty): HSK 1-6 mapping + useDifficulty persists hskLevel [HH.MM]`
5. `feat(api): game/round accepts hskLevel + embeds revealConfig [HH.MM]`
6. `feat(chain): hskLevel filter + W2 try/catch + W3 abort + no-store [HH.MM]`
7. `feat(tabs): GameModeTabs HSK 1-6 picker chip row [HH.MM]`
8. `feat(tone-game): revealConfig threaded + on-demand bumps mismatches [HH.MM]`
9. `feat(drag-game): revealConfig threaded + on-demand bumps mismatches [HH.MM]`
10. `feat(chain-game): revealConfig threaded + free on-demand (no penalty) [HH.MM]`
11. *(verification task; no commit unless fixes needed)*

---

## Risks / Notes for subagent implementers

- **HSK 1 char pool is small (~300 chars)**. If chain game's `pickStarter` repeatedly fails to find a starter with ≥3 valid next chars (because strict last-letter narrows valid-next severely), the existing 5-retry fallback returns random. Acceptable; only escalate if smoke test can't reach any chain round.
- **Old chain tests rely on cross-spelling**. Task 3 rewrites them; subsequent Tasks 6, 10 may also touch chain tests — re-grep for `you→衣`, `nǐ→yī`, `姑→女` style cases.
- **`expandLastLetter` keeps existing import sites** (it's used by `chain-rules.ts` and `api-chain.ts` only — both updated). Don't break the import; identity return is fine.
- **`useDifficulty`'s `hskLevel` is read by 3 games** — make sure components using it are wrapped in `'use client'` (ChainGame already is).
- **No new routes** — only `?hskLevel=N` query param added to existing endpoints. Route count from `npx next build` should match baseline (verified per task).
- **Integration tests** (`tests/integration/api/*.test.ts`) require dev server. Skippable if not in CI; mark `.skip` and note "run manually after `npx next dev -p 4444`" in a follow-up.
- **The `lib/difficulty.ts` schema augmentation** in Task 4.3 uses module augmentation (`declare module`) which only works if `GameConfig` is an interface. If it's a type alias, edit the alias directly.
</content>
</invoke>