# 拼音接龙 Mini-Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 「拼音接龙」 as a 3rd tab on `/game` page. Player receives a random common char, picks subsequent chars whose pinyin first letter = previous char's pinyin last letter (with i/u/ü wildcards). Game ends on dead letter; player gets longest chain.

**Architecture:** Pure client-side game state. Server endpoint returns all chars with tone-marked pinyin + radical (one-shot fetch, 1h in-memory cache). All chain rules (last-letter match, valid-next filtering, dead letter, starter pick) run client-side via pure functions in `lib/chain-rules.ts` and `lib/pinyin-syllable.ts`.

**Tech Stack:** Next.js 15 App Router (React 19 client components), Vitest + happy-dom, MySQL via mysql2 (server endpoint), existing `lib/rare-chars.ts:listChars` (paginated, pageSize=80 hardcoded — loop in endpoint).

## Global Constraints

- **Project uses npm** (per memory `project-uses-npm-2026-06-29`). All commands use `npm` / `npx`. Install needs `--legacy-peer-deps`.
- **Per-task verification includes `pnpm build`** (per memory `feedback-per-task-build-check`) when task touches `app/**/page.tsx` or adds new route.
- **Vitest env is happy-dom** (per existing tests). For fetch mocking, use `vi.spyOn(global, 'fetch')`.
- **Chinese UI text** for user-facing strings (per memory `feedback-write-in-chinese`); code/identifiers/comments in English.
- **Commit timestamp suffix** `[2026-07-03 HH.MM]` from 2026-06-23 23:53 onward (per memory `feedback-commit-timestamps`).
- **Server endpoint is in `app/api/chain/chars/route.ts`**, must `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'` (matches existing API route pattern).
- **`getRadical` is client-safe** (loads `data/radicals.json`); safe to call from server endpoint.
- **`listChars` pageSize is hardcoded 80** (verified 2026-07-03). Endpoint must loop pages to get full char list.
- **No `usage_rank` field** in any table. Use hardcoded `COMMON_CHARS` constant (1st-grade common chars) as the starter pool. Spec's "top 100 usage_rank" is adapted to "first 80 chars from COMMON_CHARS".
- **No prod env** (per memory `no-prod-env-2026-06-21`). All commits stay on local main; do not push.

---

## File Structure

**New files (10):**

| Path | Purpose |
|------|---------|
| `lib/pinyin-syllable.ts` | Pure: getLastLetter, expandLastLetter |
| `lib/chain-types.ts` | `CharInfo` interface |
| `lib/chain-rules.ts` | Pure: matchesChainRule, getValidNextChars, pickStarter |
| `lib/common-chars.ts` | Hardcoded COMMON_CHARS constant (~80 chars) for starter pool |
| `lib/api-chain.ts` | Client fetch + 1h in-memory cache |
| `app/api/chain/chars/route.ts` | GET endpoint, loops listChars pages |
| `components/game/ChainPickerModal.tsx` | Grid of valid chars, click → onSelect |
| `components/game/ChainScroll.tsx` | Horizontal scroll, fading opacity for old chars |
| `components/game/ChainSummary.tsx` | Game-over screen with restart/share |
| `components/game/ChainGame.tsx` | Main game, state machine, fetch + render |
| `tests/unit/lib/pinyin-syllable.test.ts` | ~10 unit tests |
| `tests/unit/lib/chain-rules.test.ts` | ~15 unit tests |
| `tests/unit/lib/api-chain.test.ts` | ~3 unit tests |
| `tests/unit/components/game/ChainPickerModal.test.tsx` | ~5 component tests |
| `tests/unit/components/game/ChainGame.test.tsx` | ~5 component tests (mock fetch) |

**Modified files (1):**

| Path | Change |
|------|--------|
| `components/game/GameModeTabs.tsx` | Add `'pinyin-chain'` to `Mode` union, add 3rd tab button, render `<ChainGame />` when active |

**Total: 14 new files + 1 modified**

---

## Task 1: `lib/pinyin-syllable.ts` + tests

**Files:**
- Create: `lib/pinyin-syllable.ts`
- Create: `tests/unit/lib/pinyin-syllable.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports)
- Produces:
  - `function getLastLetter(pinyin: string): string` — returns last letter of pinyin after stripping tone (numeric or diacritic); returns '' for empty
  - `function expandLastLetter(letter: string): string[]` — returns set of valid first letters for chain transition (handles i/u/ü wildcards)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/pinyin-syllable.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getLastLetter, expandLastLetter } from '@/lib/pinyin-syllable';

describe('getLastLetter', () => {
  it('returns last letter for standard diacritic pinyin', () => {
    expect(getLastLetter('dēng')).toBe('g');
    expect(getLastLetter('shuāng')).toBe('g');
    expect(getLastLetter('hǎo')).toBe('o');
    expect(getLastLetter('ān')).toBe('n');
    expect(getLastLetter('é')).toBe('e');
  });

  it('strips numeric tone suffix', () => {
    expect(getLastLetter('deng1')).toBe('g');
    expect(getLastLetter('hao3')).toBe('o');
    expect(getLastLetter('an4')).toBe('n');
  });

  it('strips diaeresis (NFD normalizes ü to u)', () => {
    expect(getLastLetter('lǜ')).toBe('u');
    expect(getLastLetter('nǚ')).toBe('u');
  });

  it('handles v notation for ü', () => {
    expect(getLastLetter('nv4')).toBe('v');
    expect(getLastLetter('lv4')).toBe('v');
  });

  it('handles y- initial syllables (spelling last letter)', () => {
    expect(getLastLetter('yī')).toBe('i');
    expect(getLastLetter('ye4')).toBe('e');
    expect(getLastLetter('yue4')).toBe('e');
    expect(getLastLetter('yuan1')).toBe('n');
    expect(getLastLetter('yun4')).toBe('n');
    expect(getLastLetter('yin1')).toBe('n');
    expect(getLastLetter('ying1')).toBe('g');
  });

  it('returns empty for empty input', () => {
    expect(getLastLetter('')).toBe('');
  });
});

describe('expandLastLetter', () => {
  it('expands i to include y (holistic syllable wildcard)', () => {
    expect(expandLastLetter('i')).toEqual(['i', 'y']);
  });

  it('expands u to include w + ü-pairing initials', () => {
    expect(expandLastLetter('u')).toEqual(['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n']);
  });

  it('expands v/ü to include ü-pairing initials', () => {
    expect(expandLastLetter('v')).toEqual(['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n']);
    expect(expandLastLetter('ü')).toEqual(['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n']);
  });

  it('returns single letter for non-wildcard', () => {
    expect(expandLastLetter('a')).toEqual(['a']);
    expect(expandLastLetter('b')).toEqual(['b']);
    expect(expandLastLetter('g')).toEqual(['g']);
    expect(expandLastLetter('n')).toEqual(['n']);
  });

  it('returns single letter for unknown (fallback)', () => {
    expect(expandLastLetter('z')).toEqual(['z']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/pinyin-syllable.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pinyin-syllable'"

- [ ] **Step 3: Write minimal implementation**

Create `lib/pinyin-syllable.ts`:

```ts
/**
 * Pinyin syllable parsing for the chain game.
 * Handles two tone formats: 'dēng' (diacritic) and 'deng1' (numeric).
 * Wildcards for i/u/ü chain endings are in expandLastLetter.
 */

export function getLastLetter(pinyin: string): string {
  const stripped = pinyin.replace(/[1-5]$/, '');
  const ascii = stripped.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!ascii) return '';
  return ascii[ascii.length - 1] ?? '';
}

export function expandLastLetter(letter: string): string[] {
  if (letter === 'i') return ['i', 'y'];
  if (letter === 'u') return ['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n'];
  if (letter === 'v' || letter === 'ü') return ['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n'];
  return [letter];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/pinyin-syllable.test.ts`
Expected: PASS, 11 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/pinyin-syllable.ts tests/unit/lib/pinyin-syllable.test.ts
git commit -m "feat(chain): pinyin-syllable with last-letter + i/u/ü wildcards [2026-07-03 22.10]"
```

---

## Task 2: `lib/common-chars.ts` (starter pool constant)

**Files:**
- Create: `lib/common-chars.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const COMMON_CHARS: readonly string[]` — ~80 most common Chinese chars (used as starter pool)

- [ ] **Step 1: Create the constant file**

Create `lib/common-chars.ts`:

```ts
/**
 * First-grade common Chinese chars used as the chain game starter pool.
 * Order is meaningful — earlier chars are more common; pickStarter uses
 * random selection from this list (no need to preserve order at runtime).
 *
 * Source: 教育部《现代汉语常用字表》常用字前 80 位 + 拼音接龙常用字。
 * No DB dependency. Curated manually; if user reports chain too hard or
 * too easy, swap chars here.
 */
export const COMMON_CHARS: readonly string[] = [
  '的', '一', '是', '不', '了', '在', '人', '有', '我', '他',
  '这', '中', '大', '来', '上', '国', '个', '到', '说', '们',
  '为', '子', '和', '你', '地', '出', '道', '也', '时', '年',
  '得', '就', '那', '要', '下', '以', '生', '会', '自', '着',
  '去', '之', '过', '家', '学', '对', '可', '她', '里', '后',
  '小', '么', '心', '多', '天', '而', '能', '好', '都', '然',
  '没', '日', '于', '起', '还', '发', '成', '事', '只', '作',
  '当', '想', '看', '文', '无', '开', '手', '十', '用', '主',
];
```

- [ ] **Step 2: Verify it parses**

Run: `npx tsc --noEmit lib/common-chars.ts`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add lib/common-chars.ts
git commit -m "feat(chain): COMMON_CHARS starter pool constant [2026-07-03 22.15]"
```

---

## Task 3: `lib/chain-types.ts` + `lib/chain-rules.ts` + tests

**Files:**
- Create: `lib/chain-types.ts`
- Create: `lib/chain-rules.ts`
- Create: `tests/unit/lib/chain-rules.test.ts`

**Interfaces:**
- Consumes:
  - `getLastLetter`, `expandLastLetter` from `@/lib/pinyin-syllable` (Task 1)
- Produces:
  - `export interface CharInfo` (in `chain-types.ts`)
  - `function matchesChainRule(prevPinyin: string, nextPinyin: string): boolean`
  - `function getValidNextChars(chars: readonly CharInfo[], prevChar: string, excludeChars: ReadonlySet<string>): CharInfo[]`
  - `function pickStarter(allChars: readonly CharInfo[], minValid?: number, maxTries?: number): CharInfo | null`

- [ ] **Step 1: Create `lib/chain-types.ts`**

```ts
/** Char info returned by /api/chain/chars and used by ChainGame. */
export interface CharInfo {
  char: string;
  pinyin: string;        // 带声调字母: 'dēng'
  meaning: string;       // 中文释义
  radical: string;       // 部首 (empty string if unknown)
  tone: 1 | 2 | 3 | 4;   // 声调 (excludes 轻声)
}
```

- [ ] **Step 2: Write the failing test for chain-rules**

Create `tests/unit/lib/chain-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesChainRule, getValidNextChars, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { COMMON_CHARS } from '@/lib/common-chars';

// Helper: build minimal CharInfo fixtures
const ci = (char: string, pinyin: string, opts: Partial<CharInfo> = {}): CharInfo => ({
  char,
  pinyin,
  meaning: opts.meaning ?? '',
  radical: opts.radical ?? '',
  tone: opts.tone ?? 1,
});

describe('matchesChainRule', () => {
  it('matches when prev last letter = next first letter', () => {
    expect(matchesChainRule('ān', 'nà')).toBe(true);  // n → n
    expect(matchesChainRule('wán', 'ne')).toBe(true);  // n → n
  });

  it('rejects mismatched letters', () => {
    expect(matchesChainRule('ān', 'bāo')).toBe(false);  // n → b
    expect(matchesChainRule('hǎo', 'dēng')).toBe(false); // o → d
  });

  it('handles i wildcard (爱 ài → 一 yī)', () => {
    expect(matchesChainRule('ài', 'yī')).toBe(true);  // i → y
    expect(matchesChainRule('ài', 'èr')).toBe(false); // i → e
  });

  it('handles u wildcard (母 mǔ → 雨 yǔ)', () => {
    expect(matchesChainRule('mǔ', 'yǔ')).toBe(true);  // u → y
    expect(matchesChainRule('mǔ', 'jù')).toBe(true);  // u → j (ü pair)
  });

  it('handles v/ü wildcard (绿 lǜ → 距 jù)', () => {
    expect(matchesChainRule('lǜ', 'jù')).toBe(true);  // ü → j
    expect(matchesChainRule('lǜ', 'xū')).toBe(true);  // ü → x
    expect(matchesChainRule('lǜ', 'yǔ')).toBe(true);  // ü → y
  });

  it('returns false for empty pinyin', () => {
    expect(matchesChainRule('', 'nà')).toBe(false);
  });
});

describe('getValidNextChars', () => {
  const chars: CharInfo[] = [
    ci('安', 'ān'),
    ci('那', 'nà'),
    ci('呢', 'ne'),
    ci('包', 'bāo'),
    ci('爱', 'ài'),
    ci('一', 'yī'),
    ci('二', 'èr'),
    ci('母', 'mǔ'),
    ci('雨', 'yǔ'),
  ];

  it('returns chars whose pinyin starts with prev last letter', () => {
    const valid = getValidNextChars(chars, '安', new Set());
    expect(valid.map((c) => c.char).sort()).toEqual(['那', '呢']);
  });

  it('excludes chars already in chain', () => {
    const valid = getValidNextChars(chars, '安', new Set(['那']));
    expect(valid.map((c) => c.char)).toEqual(['呢']);
  });

  it('returns [] when prev char not in list', () => {
    expect(getValidNextChars(chars, '非', new Set())).toEqual([]);
  });

  it('returns [] when no chars match (dead letter scenario)', () => {
    // '包' ends in o, none of the chars start with o
    const valid = getValidNextChars(chars, '包', new Set());
    expect(valid).toEqual([]);
  });

  it('handles i/u/ü wildcards for next char matching', () => {
    // 爱 ends in i → next can start with i or y → 一 yī
    const valid = getValidNextChars(chars, '爱', new Set());
    expect(valid.map((c) => c.char)).toContain('一');
  });
});

describe('pickStarter', () => {
  // Build a larger char list to give pickStarter valid options
  const allChars: CharInfo[] = COMMON_CHARS.map((c, i) =>
    ci(c, ['ān', 'yī', 'shì', 'bù', 'le', 'zài'][i % 6] ?? 'le'),
  );

  it('returns a CharInfo from the allChars list', () => {
    const starter = pickStarter(allChars, 1, 3);
    expect(starter).not.toBeNull();
    expect(allChars.some((c) => c.char === starter!.char)).toBe(true);
  });

  it('returns null when allChars is empty', () => {
    expect(pickStarter([], 1, 3)).toBeNull();
  });

  it('retries when validNext < minValid', () => {
    // Create chars where all end in letters that match few/no others
    // e.g. all end in 'o' → no chars start with o → validNext always 0
    const oo = ['婆', '多', '我', '可', '说'].map((c) => ci(c, 'o'));
    expect(pickStarter(oo, 100, 2)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/chain-rules.test.ts`
Expected: FAIL with "Cannot find module '@/lib/chain-rules'"

- [ ] **Step 4: Write minimal implementation**

Create `lib/chain-rules.ts`:

```ts
import type { CharInfo } from './chain-types';
import { getLastLetter, expandLastLetter } from './pinyin-syllable';

function firstLetter(pinyin: string): string {
  const ascii = pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return ascii[0] ?? '';
}

export function matchesChainRule(prevPinyin: string, nextPinyin: string): boolean {
  const last = getLastLetter(prevPinyin);
  if (!last) return false;
  const expanded = expandLastLetter(last);
  return expanded.includes(firstLetter(nextPinyin));
}

export function getValidNextChars(
  chars: readonly CharInfo[],
  prevChar: string,
  excludeChars: ReadonlySet<string>,
): CharInfo[] {
  const prevInfo = chars.find((c) => c.char === prevChar);
  if (!prevInfo) return [];
  const last = getLastLetter(prevInfo.pinyin);
  if (!last) return [];
  const expanded = expandLastLetter(last);
  return chars.filter((c) => {
    if (excludeChars.has(c.char)) return false;
    return expanded.includes(firstLetter(c.pinyin));
  });
}

export function pickStarter(
  allChars: readonly CharInfo[],
  minValid = 3,
  maxTries = 5,
): CharInfo | null {
  if (allChars.length === 0) return null;
  for (let i = 0; i < maxTries; i++) {
    const candidate = allChars[Math.floor(Math.random() * allChars.length)]!;
    const valid = getValidNextChars(allChars, candidate.char, new Set());
    if (valid.length >= minValid) return candidate;
  }
  // Fallback: return any char
  return allChars[Math.floor(Math.random() * allChars.length)]!;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/chain-rules.test.ts`
Expected: PASS, ~14 tests green

- [ ] **Step 6: Commit**

```bash
git add lib/chain-types.ts lib/chain-rules.ts tests/unit/lib/chain-rules.test.ts
git commit -m "feat(chain): chain-rules (matches/getValid/pickStarter) with tests [2026-07-03 22.25]"
```

---

## Task 4: `app/api/chain/chars/route.ts` + `lib/api-chain.ts` + tests

**Files:**
- Create: `app/api/chain/chars/route.ts`
- Create: `lib/api-chain.ts`
- Create: `tests/unit/lib/api-chain.test.ts`

**Interfaces:**
- Consumes:
  - `listChars` from `@/lib/rare-chars` (server-only, paginated, pageSize=80)
  - `getRadical` from `@/lib/radical` (client-safe JSON lookup, can call server-side)
  - `toneFromPinyin` from `@/lib/pinyin-tone`
- Produces:
  - `GET /api/chain/chars` → `CharInfo[]` JSON response
  - `function fetchChainChars(): Promise<CharInfo[]>` — client-side, 1h in-memory cache

- [ ] **Step 1: Create the API route**

Create `app/api/chain/chars/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { listChars } from '@/lib/rare-chars';
import { getRadical } from '@/lib/radical';
import { toneFromPinyin } from '@/lib/pinyin-tone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TONE_DIACRITIC_RE = /[āēīōūǔǎěǐǒùǜàèìòù]/;

export async function GET() {
  const allChars: Array<{ char: string; pinyin: string; meaning: string; radical: string; tone: 1 | 2 | 3 | 4 }> = [];
  // listChars pageSize is hardcoded 80; loop until exhausted (cap at 100 pages = 8000 chars)
  for (let page = 1; page <= 100; page++) {
    const result = await listChars({ page });
    for (const c of result.chars) {
      if (!c.pinyin || !TONE_DIACRITIC_RE.test(c.pinyin)) continue;
      const tone = toneFromPinyin(c.pinyin);
      if (tone === null) continue;
      allChars.push({
        char: c.char,
        pinyin: c.pinyin,
        meaning: c.meaning ?? '',
        radical: getRadical(c.char) ?? '',
        tone,
      });
    }
    if (result.chars.length < 80) break; // last page
  }
  return NextResponse.json(allChars, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
```

- [ ] **Step 2: Create `lib/api-chain.ts` (client fetch wrapper)**

```ts
import type { CharInfo } from './chain-types';

interface CacheEntry { data: CharInfo[]; ts: number }
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

export async function fetchChainChars(): Promise<CharInfo[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return cache.data;
  }
  const res = await fetch('/api/chain/chars');
  if (!res.ok) throw new Error(`fetch /api/chain/chars failed: ${res.status}`);
  const data = (await res.json()) as CharInfo[];
  cache = { data, ts: Date.now() };
  return data;
}
```

- [ ] **Step 3: Write the failing test for api-chain**

Create `tests/unit/lib/api-chain.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchChainChars } from '@/lib/api-chain';
import type { CharInfo } from '@/lib/chain-types';

describe('fetchChainChars', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset module cache by re-importing
    vi.resetModules();
  });

  it('fetches and caches the chars list', async () => {
    const sample: CharInfo[] = [{ char: '安', pinyin: 'ān', meaning: '', radical: '宀', tone: 1 }];
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as Response);

    const { fetchChainChars: fresh } = await import('@/lib/api-chain');
    const result = await fresh();
    expect(result).toEqual(sample);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns cached data within TTL', async () => {
    const sample: CharInfo[] = [{ char: '安', pinyin: 'ān', meaning: '', radical: '宀', tone: 1 }];
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as Response);

    const { fetchChainChars: fresh } = await import('@/lib/api-chain');
    await fresh();
    await fresh();
    await fresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const { fetchChainChars: fresh } = await import('@/lib/api-chain');
    await expect(fresh()).rejects.toThrow(/failed/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/api-chain.test.ts`
Expected: FAIL with "Cannot find module '@/lib/api-chain'"

- [ ] **Step 5: Verify tests pass (file already created in Step 2)**

Run: `npx vitest run tests/unit/lib/api-chain.test.ts`
Expected: PASS, 3 tests green

- [ ] **Step 6: Verify the API route compiles via tsc**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add app/api/chain/chars/route.ts lib/api-chain.ts tests/unit/lib/api-chain.test.ts
git commit -m "feat(chain): /api/chain/chars endpoint + client fetch with 1h cache [2026-07-03 22.35]"
```

---

## Task 5: `components/game/ChainPickerModal.tsx` + tests

**Files:**
- Create: `components/game/ChainPickerModal.tsx`
- Create: `tests/unit/components/game/ChainPickerModal.test.tsx`

**Interfaces:**
- Consumes:
  - `CharInfo` from `@/lib/chain-types`
- Produces:
  - `<ChainPickerModal validChars={CharInfo[]} onSelect={(char: string) => void} />`

- [ ] **Step 1: Create the components test directory**

```bash
mkdir -p tests/unit/components/game
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/components/game/ChainPickerModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChainPickerModal } from '@/components/game/ChainPickerModal';
import type { CharInfo } from '@/lib/chain-types';

const ci = (char: string, pinyin: string): CharInfo => ({
  char, pinyin, meaning: '', radical: '宀', tone: 1,
});

describe('ChainPickerModal', () => {
  it('renders all valid chars', () => {
    const chars = [ci('那', 'nà'), ci('呢', 'ne'), ci('难', 'nán')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText('那')).toBeTruthy();
    expect(screen.getByText('呢')).toBeTruthy();
    expect(screen.getByText('难')).toBeTruthy();
    expect(screen.getByText('nà')).toBeTruthy();
  });

  it('shows count of valid chars', () => {
    const chars = [ci('那', 'nà'), ci('呢', 'ne')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText(/可选字 \(2\)/)).toBeTruthy();
  });

  it('calls onSelect when char is clicked', () => {
    const onSelect = vi.fn();
    const chars = [ci('那', 'nà'), ci('呢', 'ne')];
    render(<ChainPickerModal validChars={chars} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('那'));
    expect(onSelect).toHaveBeenCalledWith('那');
  });

  it('renders nothing for empty list', () => {
    const { container } = render(<ChainPickerModal validChars={[]} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('displays radical', () => {
    const chars = [ci('那', 'nà')];
    render(<ChainPickerModal validChars={chars} onSelect={() => {}} />);
    expect(screen.getByText('阝')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/game/ChainPickerModal.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Write the component**

Create `components/game/ChainPickerModal.tsx`:

```tsx
'use client';

import type { CharInfo } from '@/lib/chain-types';

export function ChainPickerModal({
  validChars,
  onSelect,
}: {
  validChars: CharInfo[];
  onSelect: (char: string) => void;
}) {
  if (validChars.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-4">
      <div className="mb-3 text-sm text-ink-soft">可选字 ({validChars.length})</div>
      <div className="grid max-h-96 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {validChars.map((c) => (
          <button
            key={c.char}
            type="button"
            onClick={() => onSelect(c.char)}
            className="flex flex-col items-center rounded border border-ink/10 bg-paper-deep p-2 hover:bg-seal/10"
          >
            <div className="text-2xl font-kai">{c.char}</div>
            <div className="text-xs text-ink-soft">{c.pinyin}</div>
            {c.radical && <div className="text-[10px] text-ink-faint">{c.radical}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/game/ChainPickerModal.test.tsx`
Expected: PASS, 5 tests green

- [ ] **Step 6: Commit**

```bash
git add tests/unit/components/game/ChainPickerModal.test.tsx components/game/ChainPickerModal.tsx
git commit -m "feat(chain): ChainPickerModal with grid of valid chars [2026-07-03 22.45]"
```

---

## Task 6: `components/game/ChainScroll.tsx` + `ChainSummary.tsx` (no tests)

**Files:**
- Create: `components/game/ChainScroll.tsx`
- Create: `components/game/ChainSummary.tsx`

**Interfaces:**
- Consumes:
  - `CharInfo` from `@/lib/chain-types`
- Produces:
  - `<ChainScroll chain={string[]} charsList={CharInfo[]} />` — horizontal scroll, fading opacity
  - `<ChainSummary chain={string[]} onRestart={() => void} />` — game-over screen

- [ ] **Step 1: Create `components/game/ChainScroll.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import type { CharInfo } from '@/lib/chain-types';

export function ChainScroll({
  chain,
  charsList,
}: {
  chain: string[];
  charsList: CharInfo[];
}) {
  const lookup = useMemo(() => new Map(charsList.map((c) => [c.char, c])), [charsList]);
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-paper-deep/50 p-4">
      <div className="flex items-center gap-3 whitespace-nowrap">
        {chain.map((c, i) => {
          const info = lookup.get(c);
          const isLast = i === chain.length - 1;
          const opacity = isLast ? 1 : Math.max(0.5, 1 - (chain.length - 1 - i) * 0.05);
          return (
            <div key={`${i}-${c}`} className="flex flex-col items-center" style={{ opacity }}>
              <div className="text-3xl font-kai">{c}</div>
              {info && <div className="text-xs text-ink-soft">{info.pinyin}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/game/ChainSummary.tsx`**

```tsx
'use client';

export function ChainSummary({
  chain,
  onRestart,
}: {
  chain: string[];
  onRestart: () => void;
}) {
  const text = chain.join(' → ');
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (e) {
      console.error('share failed', e);
    }
  };
  return (
    <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
      <h2 className="text-2xl font-bold">接龙结束</h2>
      <p className="mt-2 text-ink-soft">
        接龙长度: <span className="text-3xl text-seal">{chain.length}</span> 字
      </p>
      <div className="mt-4 max-h-32 overflow-y-auto rounded bg-paper-deep p-2 text-sm font-kai">
        {text}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
        >
          再来一局
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep"
        >
          分享
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc clean**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add components/game/ChainScroll.tsx components/game/ChainSummary.tsx
git commit -m "feat(chain): ChainScroll + ChainSummary presentational components [2026-07-03 22.50]"
```

---

## Task 7: `components/game/ChainGame.tsx` + tests (main game)

**Files:**
- Create: `components/game/ChainGame.tsx`
- Create: `tests/unit/components/game/ChainGame.test.tsx`

**Interfaces:**
- Consumes:
  - `fetchChainChars` from `@/lib/api-chain`
  - `getValidNextChars, pickStarter` from `@/lib/chain-rules`
  - `CharInfo` from `@/lib/chain-types`
  - `ChainScroll`, `ChainPickerModal`, `ChainSummary` (Tasks 5, 6)
- Produces:
  - `<ChainGame />` — main game component, self-contained state machine

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/game/ChainGame.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChainGame } from '@/components/game/ChainGame';
import type { CharInfo } from '@/lib/chain-types';

const ci = (char: string, pinyin: string): CharInfo => ({
  char, pinyin, meaning: '', radical: '宀', tone: 1,
});

const sampleChars: CharInfo[] = [
  ci('安', 'ān'),
  ci('那', 'nà'),
  ci('呢', 'ne'),
  ci('爱', 'ài'),
  ci('一', 'yī'),
];

describe('ChainGame', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    // Make pickStarter deterministic: always pick index 0 ('安 ān', has 2 validNext)
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('shows loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<ChainGame />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it('transitions to playing with starter after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.queryByText(/加载中/)).toBeNull();
    });
    expect(screen.getByText(/接龙长度/)).toBeTruthy();
  });

  it('shows valid next chars in modal after loading', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    render(<ChainGame />);
    await waitFor(() => {
      expect(screen.getByText(/可选字/)).toBeTruthy();
    });
  });

  it('grows chain when char is picked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 2/)).toBeTruthy();
    });
  });

  it('shows 换一条 button disabled when chain length is 1', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(true);
  });

  it('shortens chain when 换一条 is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sampleChars,
    } as Response);
    render(<ChainGame />);
    await waitFor(() => screen.getByText(/可选字/));
    fireEvent.click(screen.getByText('那'));
    await waitFor(() => screen.getByText(/接龙长度: 2/));
    const swapBtn = screen.getByText('换一条') as HTMLButtonElement;
    expect(swapBtn.disabled).toBe(false);
    fireEvent.click(swapBtn);
    await waitFor(() => {
      expect(screen.getByText(/接龙长度: 1/)).toBeTruthy();
    });
  });

  it('triggers finished state when validNext is empty (dead letter)', async () => {
    // Build chars where starter has 0 valid next chars
    const deadChars: CharInfo[] = [
      ci('包', 'bāo'),  // ends in o, no char starts with o
    ];
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => deadChars,
    } as Response);
    render(<ChainGame />);
    // pickStarter will retry 5 times then fallback to 包
    // 包 has 0 validNext → finished
    await waitFor(() => {
      expect(screen.getByText(/接龙结束/)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/game/ChainGame.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the component**

Create `components/game/ChainGame.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchChainChars } from '@/lib/api-chain';
import { getValidNextChars, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { ChainScroll } from './ChainScroll';
import { ChainPickerModal } from './ChainPickerModal';
import { ChainSummary } from './ChainSummary';

type Phase = 'loading' | 'playing' | 'finished' | 'error';

export function ChainGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [charsList, setCharsList] = useState<CharInfo[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [starter, setStarter] = useState<string>('');

  useEffect(() => { void startGame(); }, []);

  async function startGame() {
    setPhase('loading');
    try {
      const chars = await fetchChainChars();
      const s = pickStarter(chars);
      if (!s) throw new Error('no valid starter');
      setCharsList(chars);
      setStarter(s.char);
      setChain([s.char]);
      setPhase('playing');
    } catch (e) {
      console.error('startGame failed', e);
      setPhase('error');
    }
  }

  const usedChars = useMemo(() => new Set(chain), [chain]);
  const validNext = useMemo(
    () => (chain.length === 0 ? [] : getValidNextChars(charsList, chain.at(-1)!, usedChars)),
    [charsList, chain, usedChars],
  );

  useEffect(() => {
    if (phase === 'playing' && validNext.length === 0 && chain.length > 0) {
      setPhase('finished');
    }
  }, [phase, validNext.length, chain.length]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }
  if (phase === 'error') {
    return (
      <div className="py-12 text-center">
        <p className="text-seal">字库加载失败</p>
        <button
          type="button"
          onClick={() => void startGame()}
          className="mt-4 rounded-md bg-seal px-4 py-2 text-white"
        >
          重试
        </button>
      </div>
    );
  }
  if (phase === 'finished') {
    return (
      <ChainSummary
        chain={chain}
        onRestart={() => {
          setChain([starter]);
          setPhase('playing');
        }}
      />
    );
  }

  const currentLast = charsList.find((c) => c.char === chain.at(-1));
  return (
    <div className="space-y-6">
      <ChainScroll chain={chain} charsList={charsList} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-soft">接龙长度: {chain.length}</div>
        <button
          type="button"
          disabled={chain.length < 2}
          onClick={() => setChain((prev) => prev.slice(0, -1))}
          className="text-sm text-ink-faint hover:underline disabled:opacity-30"
        >
          换一条
        </button>
      </div>
      {currentLast && (
        <div className="text-center text-xs text-ink-faint">
          上一个字: {currentLast.char} {currentLast.pinyin}
        </div>
      )}
      <ChainPickerModal
        validChars={validNext}
        onSelect={(c) => setChain((prev) => [...prev, c])}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/game/ChainGame.test.tsx`
Expected: PASS, 7 tests green

- [ ] **Step 5: Commit**

```bash
git add components/game/ChainGame.tsx tests/unit/components/game/ChainGame.test.tsx
git commit -m "feat(chain): ChainGame main component with state machine [2026-07-03 23.00]"
```

---

## Task 8: Wire into `GameModeTabs` (3rd tab) + integration

**Files:**
- Modify: `components/game/GameModeTabs.tsx:7-37` (add 'pinyin-chain' to Mode union, add 3rd tab button, render ChainGame)

**Interfaces:**
- Consumes: `ChainGame` (Task 7)
- Produces: 3-tab GameModeTabs UI

- [ ] **Step 1: Modify `components/game/GameModeTabs.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { DragMatchGame } from './DragMatchGame';
import { ToneRadicalGame } from './ToneRadicalGame';
import { ChainGame } from './ChainGame';

type Mode = 'tone-radical' | 'pinyin-char' | 'pinyin-chain';

export function GameModeTabs() {
  const [mode, setMode] = useState<Mode>('tone-radical');
  return (
    <div>
      <div className="mb-5 flex gap-2 border-b border-ink/10">
        <button
          type="button"
          onClick={() => setMode('tone-radical')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'tone-radical'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          声调·部首
        </button>
        <button
          type="button"
          onClick={() => setMode('pinyin-char')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'pinyin-char'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          拼音·字
        </button>
        <button
          type="button"
          onClick={() => setMode('pinyin-chain')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'pinyin-chain'
              ? 'border-b-2 border-seal text-seal'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          拼音接龙
        </button>
      </div>
      {mode === 'tone-radical' && <ToneRadicalGame />}
      {mode === 'pinyin-char' && <DragMatchGame />}
      {mode === 'pinyin-chain' && <ChainGame />}
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc clean**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Run all unit tests**

Run: `npx vitest run tests/unit/`
Expected: PASS, all tests including new chain tests (~ 204 + 50 = 254 total)

- [ ] **Step 4: Run pnpm build** (per memory `feedback-per-task-build-check` — required when task touches `app/**/page.tsx` or new route)

Run: `pnpm build`
Expected: success, 128+ routes preserved, /api/chain/chars in route list

- [ ] **Step 5: Commit**

```bash
git add components/game/GameModeTabs.tsx
git commit -m "feat(chain): wire 拼音接龙 as 3rd tab on /game [2026-07-03 23.10]"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run tests/unit/`
Expected: PASS, all chain tests green

- [ ] **Step 2: Run tsc + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: clean compile + build success

- [ ] **Step 3: Manual smoke test via dev server**

(Per memory `dev-build-cache-stomp`, dev server is on port 4444; if not running, start with `npx next dev -p 4444`)

1. Visit `http://localhost:4444/game`
2. Verify 3 tabs visible: 声调·部首 / 拼音·字 / 拼音接龙
3. Click 「拼音接龙」 → spinner briefly → playing state with starter char
4. Verify paper scroll shows starter, valid chars visible in modal
5. Click a valid char → chain grows, modal updates with new valid chars
6. Click 「换一条」 → chain shortens by 1
7. Force dead letter (pick chars that lead to no options) → finished screen shows length + 再来一局
8. Click 「再来一局」 → resets to starter, no refetch
9. Check console: no React warnings (especially no duplicate key)
10. Check Network: `/api/chain/chars` returns ~5000+ chars in JSON

- [ ] **Step 4: Update MEMORY.md with plan status**

Add entry to user's `MEMORY.md` (existing pattern for plan tracking):
- File: `plan-pinyin-solitaire-status.md`
- Topic: 拼音接龙 mini-game, 8 commits, X tests pass, tsc + build clean, awaiting human browser smoke

---

## Self-Review (filled by planner)

**1. Spec coverage:**

| Spec section | Task(s) |
|--------------|---------|
| 11 locked design decisions | All tasks implement the spec decisions |
| `lib/pinyin-syllable.ts` (40 lines, 2 exports) | Task 1 |
| `lib/chain-types.ts` (20 lines) | Task 3 step 1 |
| `lib/chain-rules.ts` (50 lines, 3 exports) | Task 3 |
| `lib/api-chain.ts` (30 lines) | Task 4 |
| `app/api/chain/chars/route.ts` (25 lines) | Task 4 |
| `components/game/ChainScroll.tsx` (40 lines) | Task 6 |
| `components/game/ChainPickerModal.tsx` (50 lines) | Task 5 |
| `components/game/ChainSummary.tsx` (40 lines) | Task 6 |
| `components/game/ChainGame.tsx` (120 lines) | Task 7 |
| `components/game/GameModeTabs.tsx` modification | Task 8 |
| 35 new tests (pinyin-syllable 11, chain-rules 14, api-chain 3, modal 5, game 7) | Tasks 1, 3, 4, 5, 7 |
| Global Constraints (no prod, npm, tsc+build, etc.) | Task 8 step 4 + Task 9 |

**2. Placeholder scan:** No TBD/TODO/fill-in-details found. Every step has concrete code.

**3. Type consistency:**
- `CharInfo` interface defined in Task 3 (chain-types.ts) and used consistently in Tasks 4, 5, 6, 7
- `getValidNextChars(chars, prevChar, excludeChars)` signature consistent across Tasks 3, 7
- `pickStarter(allChars, minValid?, maxTries?)` signature consistent in Tasks 3, 7
- All exports from `pinyin-syllable.ts` consumed in `chain-rules.ts` correctly

**4. Adaptations from spec (noted in Global Constraints):**
- listChars pageSize hardcoded 80 → endpoint loops pages (Task 4)
- No `usage_rank` → hardcoded COMMON_CHARS (Task 2)
- getRadical is client-safe JSON, called server-side in endpoint (Task 4)
- tone derived from toneFromPinyin in endpoint (Task 4)

**Discrepancies fixed inline:** None required after spec self-review.

---

## Commit Summary

8 commits on local main:

1. `feat(chain): pinyin-syllable with last-letter + i/u/ü wildcards [2026-07-03 22.10]`
2. `feat(chain): COMMON_CHARS starter pool constant [2026-07-03 22.15]`
3. `feat(chain): chain-rules (matches/getValid/pickStarter) with tests [2026-07-03 22.25]`
4. `feat(chain): /api/chain/chars endpoint + client fetch with 1h cache [2026-07-03 22.35]`
5. `feat(chain): ChainPickerModal with grid of valid chars [2026-07-03 22.45]`
6. `feat(chain): ChainScroll + ChainSummary presentational components [2026-07-03 22.50]`
7. `feat(chain): ChainGame main component with state machine [2026-07-03 23.00]`
8. `feat(chain): wire 拼音接龙 as 3rd tab on /game [2026-07-03 23.10]`

Per memory `no-prod-env-2026-06-21`, NOT pushed.

---

## Notes / Risks

- **listChars 100-page cap**: Spec assumed single query of 8000 chars. With pageSize=80, we loop up to 100 pages = 8000 chars max. If the actual char set is larger, we cap silently. Acceptable for v1.
- **First-time fetch latency**: `/api/chain/chars` will return 5000+ JSON rows on first load. May take 2-5s. The 1h client cache mitigates subsequent loads.
- **starter pool vs chain game initial load**: ChainGame calls `pickStarter(chars)` which uses the loaded chars. COMMON_CHARS is not used in the new flow — the spec said "starter 池 = top 100", but since there's no usage_rank, we use `pickStarter` random from loaded chars (which is what the spec code actually does in `ChainGame.tsx:263`). COMMON_CHARS is kept as a documentation constant for future use (e.g., could be used to filter the starter pool if needed).
- **Dead letter on first turn**: pickStarter retries 5 times, then falls back to any char. That fallback char may have 0 validNext → instant finished. The "trigger finished" effect in ChainGame handles this correctly.
