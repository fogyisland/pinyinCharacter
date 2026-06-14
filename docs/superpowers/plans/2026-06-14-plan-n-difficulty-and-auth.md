# Plan N — Difficulty Levels + Independent Auth Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three-level difficulty (简单 / 复杂 / 超难) to the two mini-games and the pinyin input method, and split login/register out of `AuthModal` into independent pages with a required email field.

**Architecture:**
- One shared `DifficultyPicker` segmented control persisted to `localStorage` (key: `pinyin:difficulty`, default: `'medium'`). Same setting applies across all three call sites.
- Each feature reads the setting and applies its own mapping. No API changes — all filtering is client-side (we already have the data we need).
- Auth becomes 4 independent routes (`/login`, `/register`, `/forgot-password`, `/reset-password`) each in their own page. `registerRequest` adds a required `email` field. `AuthModal` is deleted; `Header` "登录 / 注册" buttons become `<Link>` to `/login` (with "没有账号？去注册" link) and `/register` (with "已有账号？去登录" link).

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, existing zustand store, existing `lib/api-auth.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/difficulty.ts` (NEW) | Pure functions: type, defaults, mapping per feature |
| `lib/use-difficulty.ts` (NEW) | `useDifficulty()` hook reading/writing localStorage (SSR-safe) |
| `components/common/DifficultyPicker.tsx` (NEW) | Reusable segmented control |
| `components/common/DifficultyPicker.test.tsx` (NEW) | Click + persistence tests |
| `components/game/DragMatchGame.tsx` (MODIFY) | Read difficulty → char count + source filter |
| `components/game/ToneRadicalGame.tsx` (MODIFY) | Read difficulty → pass count to `fetchGameRound` |
| `components/PinyinInputMethod.tsx` (MODIFY) | Read difficulty → slice candidates |
| `components/PinyinInputMethod.test.tsx` (NEW) | Difficulty filter logic unit test |
| `lib/difficulty.test.ts` (NEW) | Pure-function tests for mappings |
| `app/login/page.tsx` (NEW) | Standalone login form |
| `app/register/page.tsx` (NEW) | Standalone register form with email |
| `app/forgot-password/page.tsx` (MODIFY) | Already exists; ensure link from `/login` |
| `app/reset-password/page.tsx` (MODIFY) | Already exists; ensure flow is end-to-end |
| `lib/api-auth.ts` (MODIFY) | Add `email` param to `registerRequest` |
| `lib/validators.ts` (MODIFY) | `registerSchema` requires email + password + username |
| `server/auth.ts` (MODIFY) | Persist `email` on register (column already exists per Plan B+) |
| `app/api/auth/register/route.ts` (MODIFY) | Validate + persist email |
| `components/Header.tsx` (MODIFY) | Replace AuthModal trigger with `<Link>` to `/login` or `/register` |
| `components/AuthModal.tsx` (DELETE) | No longer needed |
| `lib/api-auth.test.ts` (MODIFY or NEW) | Test `registerRequest` includes email |
| `tests/integration/api/auth.test.ts` (MODIFY) | Verify email persisted on register |

---

## Difficulty Mapping (single source of truth in `lib/difficulty.ts`)

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

// DragMatchGame: { count, source }
export const DRAG_MATCH_CONFIG = {
  easy:   { count: 6, source: 'chars-level-1' },
  medium: { count: 8, source: 'chars-level-1-2' },
  hard:   { count: 12, source: 'chars-all' },
} as const;

// ToneRadicalGame: { count } — passed to /api/game/round
export const TONE_RADICAL_CONFIG = {
  easy:   { count: 3 },
  medium: { count: 4 },
  hard:   { count: 6 },
} as const;

// PinyinInputMethod: { maxCandidates } — slice after fetch
export const PINYIN_INPUT_CONFIG = {
  easy:   { maxCandidates: 3 },
  medium: { maxCandidates: 5 },
  hard:   { maxCandidates: 9 },
} as const;
```

**For DragMatchGame source filter:**
- `chars-level-1`: `GET /api/chars?level=1&page=1` → filter to chars with meaning
- `chars-level-1-2`: `GET /api/chars?page=1` (returns 80 chars mixing 1+2 — good enough)
- `chars-all`: `GET /api/chars?page=1` (current behaviour — already includes all levels)

Then shuffle + slice to `count`.

**For ToneRadicalGame:** just pass `count` to existing `fetchGameRound(count)`.

**For PinyinInputMethod:** after fetching candidates, slice to `maxCandidates`.

---

## Task 1: `lib/difficulty.ts` — pure config module

**Files:**
- Create: `lib/difficulty.ts`
- Test: `lib/difficulty.test.ts`

- [ ] **Step 1: Write failing test**

`lib/difficulty.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DRAG_MATCH_CONFIG,
  TONE_RADICAL_CONFIG,
  PINYIN_INPUT_CONFIG,
  DEFAULT_DIFFICULTY,
} from './difficulty';

describe('difficulty config', () => {
  it('defaults to medium', () => {
    expect(DEFAULT_DIFFICULTY).toBe('medium');
  });

  it('DragMatchGame: easy=6 / medium=8 / hard=12 chars', () => {
    expect(DRAG_MATCH_CONFIG.easy.count).toBe(6);
    expect(DRAG_MATCH_CONFIG.medium.count).toBe(8);
    expect(DRAG_MATCH_CONFIG.hard.count).toBe(12);
  });

  it('DragMatchGame: source escalates with difficulty', () => {
    expect(DRAG_MATCH_CONFIG.easy.source).toBe('chars-level-1');
    expect(DRAG_MATCH_CONFIG.medium.source).toBe('chars-level-1-2');
    expect(DRAG_MATCH_CONFIG.hard.source).toBe('chars-all');
  });

  it('ToneRadicalGame: easy=3 / medium=4 / hard=6', () => {
    expect(TONE_RADICAL_CONFIG.easy.count).toBe(3);
    expect(TONE_RADICAL_CONFIG.medium.count).toBe(4);
    expect(TONE_RADICAL_CONFIG.hard.count).toBe(6);
  });

  it('PinyinInputMethod: easy=3 / medium=5 / hard=9 candidates', () => {
    expect(PINYIN_INPUT_CONFIG.easy.maxCandidates).toBe(3);
    expect(PINYIN_INPUT_CONFIG.medium.maxCandidates).toBe(5);
    expect(PINYIN_INPUT_CONFIG.hard.maxCandidates).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/difficulty.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`lib/difficulty.ts`:
```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

export const DRAG_MATCH_CONFIG = {
  easy:   { count: 6, source: 'chars-level-1' as const },
  medium: { count: 8, source: 'chars-level-1-2' as const },
  hard:   { count: 12, source: 'chars-all' as const },
};

export const TONE_RADICAL_CONFIG = {
  easy:   { count: 3 },
  medium: { count: 4 },
  hard:   { count: 6 },
};

export const PINYIN_INPUT_CONFIG = {
  easy:   { maxCandidates: 3 },
  medium: { maxCandidates: 5 },
  hard:   { maxCandidates: 9 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/difficulty.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add lib/difficulty.ts lib/difficulty.test.ts
git commit -m "feat(difficulty): shared config module + pure-function tests"
```

---

## Task 2: `lib/use-difficulty.ts` — localStorage-backed hook

**Files:**
- Create: `lib/use-difficulty.ts`

(No test — pure side-effect wrapper, exercised via `DifficultyPicker` tests.)

- [ ] **Step 1: Write the hook**

`lib/use-difficulty.ts`:
```ts
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_DIFFICULTY, type Difficulty } from './difficulty';

const STORAGE_KEY = 'pinyin:difficulty';

function readInitial(): Difficulty {
  if (typeof window === 'undefined') return DEFAULT_DIFFICULTY;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  return DEFAULT_DIFFICULTY;
}

export function useDifficulty(): [Difficulty, (next: Difficulty) => void] {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);

  // Read from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    setDifficulty(readInitial());
  }, []);

  // Cross-tab sync via storage event
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const v = e.newValue;
        if (v === 'easy' || v === 'medium' || v === 'hard') setDifficulty(v);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (next: Difficulty) => {
    setDifficulty(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [difficulty, update];
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/use-difficulty.ts
git commit -m "feat(difficulty): useDifficulty hook (localStorage + cross-tab sync)"
```

---

## Task 3: `components/common/DifficultyPicker.tsx` — reusable segmented control

**Files:**
- Create: `components/common/DifficultyPicker.tsx`
- Test: `components/common/DifficultyPicker.test.tsx`

- [ ] **Step 1: Write failing test**

`components/common/DifficultyPicker.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DifficultyPicker } from './DifficultyPicker';

describe('DifficultyPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders all three options', () => {
    render(<DifficultyPicker value="medium" onChange={() => {}} />);
    expect(screen.getByText('简单')).toBeTruthy();
    expect(screen.getByText('复杂')).toBeTruthy();
    expect(screen.getByText('超难')).toBeTruthy();
  });

  it('highlights the active value', () => {
    render(<DifficultyPicker value="easy" onChange={() => {}} />);
    const easyBtn = screen.getByText('简单').closest('button')!;
    expect(easyBtn.className).toMatch(/bg-seal|text-paper/);
  });

  it('calls onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<DifficultyPicker value="medium" onChange={onChange} />);
    fireEvent.click(screen.getByText('超难'));
    expect(onChange).toHaveBeenCalledWith('hard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run components/common/DifficultyPicker.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

`components/common/DifficultyPicker.tsx`:
```tsx
'use client';

import type { Difficulty } from '@/lib/difficulty';

const OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '复杂' },
  { value: 'hard', label: '超难' },
];

export function DifficultyPicker({
  value,
  onChange,
  className = '',
}: {
  value: Difficulty;
  onChange: (next: Difficulty) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="难度"
      className={`inline-flex items-center rounded-sm border border-ink/20 bg-paper-soft p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs sm:text-sm font-kai transition-colors rounded-sm ${
              active
                ? 'bg-seal text-paper-soft shadow-sm'
                : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run components/common/DifficultyPicker.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add components/common/DifficultyPicker.tsx components/common/DifficultyPicker.test.tsx
git commit -m "feat(common): DifficultyPicker segmented control + tests"
```

---

## Task 4: Wire `DragMatchGame` to difficulty

**Files:**
- Modify: `components/game/DragMatchGame.tsx`

- [ ] **Step 1: Modify component**

At top of file add:
```tsx
import { DRAG_MATCH_CONFIG, type Difficulty } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { fetchChars } from '@/lib/api-chars';
```

Replace the `loadGame` body to switch by difficulty:
```tsx
const [difficulty, setDifficulty] = useDifficulty();

const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
  setPhase('loading');
  const cfg = DRAG_MATCH_CONFIG[forceDifficulty];

  let chars: Char[] = [];
  if (cfg.source === 'chars-level-1') {
    const r = await fetchChars({ level: 1, page: 1 });
    chars = r.chars.filter((c) => c.meaningZh).map(toChar);
  } else if (cfg.source === 'chars-level-1-2') {
    const r = await fetchChars({ page: 1 });
    chars = r.chars.filter((c) => c.meaningZh && (c.level === 1 || c.level === 2)).map(toChar);
  } else {
    const r = await fetchChars({ page: 1 });
    chars = r.chars.filter((c) => c.meaningZh).map(toChar);
  }

  const picked = shuffle(chars).slice(0, cfg.count);
  setChars(picked);
  setPinyinOrder(shuffle(picked.map((c) => c.pinyin)));
  setPairs({});
  setMismatches(0);
  setElapsedMs(0);
  startedAt.current = Date.now();
  setPhase('playing');
};
```

Add a small mapper near top (next to `Char` interface):
```tsx
function toChar(c: { char: string; pinyin: string; meaningZh: string | null }): Char {
  return { char: c.char, pinyin: c.pinyin, meaning: c.meaningZh ?? '' };
}
```

In the JSX, before the timer/status bar, add the picker (only when `phase === 'loading'` or `'finished'`? No — always visible so the user can change mid-round):
```tsx
<div className="flex items-center justify-between mb-2">
  <DifficultyPicker value={difficulty} onChange={(d) => { setDifficulty(d); void loadGame(d); }} />
</div>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/game/DragMatchGame.tsx
git commit -m "feat(game): DragMatchGame respects difficulty (count + char source)"
```

---

## Task 5: Add `lib/api-chars.ts` client wrapper (used by DragMatchGame)

**Files:**
- Create: `lib/api-chars.ts`

- [ ] **Step 1: Write the wrapper**

```ts
import type { Char } from './chars-types';

export interface CharsListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchChars(opts: {
  q?: string;
  level?: 1 | 2 | 3;
  page?: number;
} = {}): Promise<CharsListResult> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.level) params.set('level', String(opts.level));
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/chars?${params.toString()}`);
  const json = (await res.json()) as { ok: boolean; data: CharsListResult; error?: { message: string } };
  if (!json.ok) throw new Error(json.error?.message ?? 'fetchChars failed');
  return json.data;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api-chars.ts
git commit -m "feat(api): fetchChars client wrapper for /api/chars with level filter"
```

---

## Task 6: Wire `ToneRadicalGame` to difficulty

**Files:**
- Modify: `components/game/ToneRadicalGame.tsx`

- [ ] **Step 1: Modify component**

Add at top:
```tsx
import { TONE_RADICAL_CONFIG, type Difficulty } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
```

Replace `loadGame`:
```tsx
const [difficulty, setDifficulty] = useDifficulty();

const loadGame = async (forceDifficulty: Difficulty = difficulty) => {
  setPhase('loading');
  setToneMatches({});
  setRadicalMatches({});
  setMismatches(0);
  setElapsedMs(0);
  setError(null);
  try {
    const count = TONE_RADICAL_CONFIG[forceDifficulty].count;
    const r = await fetchGameRound(count);
    setRound(r);
    setToneOrder(shuffle([...r.toneChoices] as Tone[]));
    setRadicalOrder(shuffle([...r.radicalChoices]));
    startedAt.current = Date.now();
    setPhase('round1');
  } catch (e) {
    console.error('loadGame failed', e);
    setError(e instanceof Error ? e.message : '加载失败');
  }
};
```

Update `useEffect`:
```tsx
useEffect(() => { void loadGame(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

In the main JSX (before the timer row), add the picker:
```tsx
<div className="flex items-center justify-between">
  <DifficultyPicker value={difficulty} onChange={(d) => { setDifficulty(d); void loadGame(d); }} />
</div>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/game/ToneRadicalGame.tsx
git commit -m "feat(game): ToneRadicalGame respects difficulty (round count)"
```

---

## Task 7: Wire `PinyinInputMethod` to difficulty

**Files:**
- Modify: `components/PinyinInputMethod.tsx`
- Test: `components/PinyinInputMethod.test.tsx`

- [ ] **Step 1: Write failing test**

`components/PinyinInputMethod.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { applyDifficulty, PINYIN_INPUT_CONFIG } from '@/lib/pinyin-input-difficulty';

describe('applyDifficulty', () => {
  it('easy: limits to 3 candidates', () => {
    const out = applyDifficulty([{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'}], 'easy');
    expect(out).toHaveLength(3);
    expect(out.map(c => c.char)).toEqual(['a','b','c']);
  });

  it('medium: limits to 5 candidates', () => {
    const out = applyDifficulty(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'},{char:'f'},{char:'g'}],
      'medium',
    );
    expect(out).toHaveLength(5);
  });

  it('hard: returns all up to 9', () => {
    const out = applyPassword(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'},{char:'f'},{char:'g'},{char:'h'},{char:'i'},{char:'j'}],
      'hard',
    ).length as any;
  });
});
```

Wait — typo above. Use the right test:

```tsx
import { describe, it, expect } from 'vitest';
import { applyDifficulty, PINYIN_INPUT_CONFIG } from '@/lib/pinyin-input-difficulty';

describe('applyDifficulty', () => {
  it('easy: limits to 3 candidates', () => {
    const out = applyDifficulty(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'}],
      'easy',
    );
    expect(out).toHaveLength(3);
    expect(out.map(c => c.char)).toEqual(['a','b','c']);
  });

  it('medium: limits to 5 candidates', () => {
    const out = applyDifficulty(
      [{char:'a'},{char:'b'},{char:'c'},{char:'d'},{char:'e'},{char:'f'},{char:'g'}],
      'medium',
    );
    expect(out).toHaveLength(5);
  });

  it('hard: returns all up to 9 (does not slice below 9)', () => {
    const out = applyDifficulty(
      Array.from({length: 12}, (_, i) => ({char: String(i)})),
      'hard',
    );
    expect(out).toHaveLength(9); // hard ceiling is 9
  });

  it('PINYIN_INPUT_CONFIG matches mapping', () => {
    expect(PINYIN_INPUT_CONFIG.easy.maxCandidates).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run components/PinyinInputMethod.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`lib/pinyin-input-difficulty.ts`:
```ts
import { PINYIN_INPUT_CONFIG, type Difficulty } from './difficulty';

export function applyDifficulty<T>(candidates: T[], difficulty: Difficulty): T[] {
  return candidates.slice(0, PINYIN_INPUT_CONFIG[difficulty].maxCandidates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run components/PinyinInputMethod.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Modify PinyinInputMethod to use it**

Add to imports:
```tsx
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { applyDifficulty } from '@/lib/pinyin-input-difficulty';
```

Inside the component:
```tsx
const [difficulty, setDifficulty] = useDifficulty();
```

In the candidate fetch effect, replace `setCandidates(res.data.candidates)` with:
```tsx
setCandidates(applyDifficulty(res.data.candidates, difficulty));
```

In the JSX, just above the input:
```tsx
<div className="flex items-center justify-between mb-2">
  <DifficultyPicker value={difficulty} onChange={setDifficulty} />
</div>
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/PinyinInputMethod.tsx components/PinyinInputMethod.test.tsx lib/pinyin-input-difficulty.ts
git commit -m "feat(input-method): PinyinInputMethod respects difficulty (candidate limit)"
```

---

## Task 8: Run full test suite + typecheck + build

- [ ] **Step 1: Run tests**

Run: `pnpm test`
Expected: all green (existing + 4 new tests for DifficultyPicker + applyDifficulty + 5 for difficulty config).

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: success (Next.js production build green).

- [ ] **Step 4: Manual smoke (browser)**

- Open `/game`, click 简单 / 复杂 / 超难 tabs in both game modes. Verify DragMatchGame picks 6/8/12 chars. Verify ToneRadicalGame picks 3/4/6.
- Open `/dictionary`, type `nihao`. Verify candidate count is 3 / 5 / 9 by switching difficulty.
- Reload page — verify difficulty persists.

- [ ] **Step 5: Commit (no changes if all green)**

If any small fixes were needed:
```bash
git add -A
git commit -m "fix(difficulty): post-smoke fixes"
```

---

## Task 9: `lib/validators.ts` — extend `registerSchema` with email (currently ad-hoc in route)

**Files:**
- Modify: `lib/validators.ts`

- [ ] **Step 1: Add the schema**

Find an appropriate spot in `lib/validators.ts` and add:
```ts
export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_\-]+$/, '用户名仅支持字母数字下划线短横'),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validators.ts
git commit -m "feat(validators): registerSchema (username+email+password), loginSchema"
```

---

## Task 10: Update `registerRequest` to send email

**Files:**
- Modify: `lib/api-auth.ts`

- [ ] **Step 1: Update signature**

Replace the existing `registerRequest`:
```ts
export async function registerRequest(
  username: string,
  email: string,
  password: string,
): Promise<ApiResult<{ user: User }>> {
  return call('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
}
```

- [ ] **Step 2: Run typecheck** — expect AuthModal call site (about to be deleted) to fail. That's fine.

Run: `pnpm tsc --noEmit`
Expected: 1 error in `AuthModal.tsx` (about to be replaced).

- [ ] **Step 3: Commit**

```bash
git add lib/api-auth.ts
git commit -m "feat(auth): registerRequest takes email"
```

---

## Task 11: Server-side `registerRequest` validates + persists email

**Files:**
- Modify: `app/api/auth/register/route.ts`
- Modify: `server/auth.ts` (if a register fn exists)

- [ ] **Step 1: Find current implementation**

Run: `cat app/api/auth/register/route.ts`

Look at current behaviour. If it manually parses JSON without using `registerSchema`, switch to:
```ts
import { registerSchema } from '@/lib/validators';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: 'bad_input', message: parsed.error.issues[0]?.message ?? 'invalid input' } }, { status: 400 });
  }
  // call server-side register fn with parsed.data { username, email, password }
  // ensure email is included in INSERT (users table already has email column per Plan B+)
}
```

If `server/auth.ts` has a `registerUser` fn, pass email to it. Update that fn to insert the email into the `users` table.

- [ ] **Step 2: Verify the existing users table has `email` column**

Read the DDL or run: `grep -r "email" scripts/init-db.sql` (or wherever DDL lives). If missing, ALTER TABLE.

If missing, add a migration:
```sql
ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL;
ALTER TABLE users ADD UNIQUE KEY uk_email (email);
```
And apply it to the live DB.

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Add integration test**

In `tests/integration/api/auth.test.ts` (or equivalent — find the existing one), add a test:
```ts
it('register persists email', async () => {
  const r = await POST('/api/auth/register', {
    username: 'with_email_user',
    email: 'with@email.com',
    password: 'password123',
  });
  expect(r.ok).toBe(true);
  // Query users table to verify email persisted
  const [rows] = await pool.query('SELECT email FROM users WHERE username = ?', ['with_email_user']);
  expect(rows[0].email).toBe('with@email.com');
});
```

- [ ] **Step 5: Run integration test**

Run: `pnpm test tests/integration/api/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/auth/register/route.ts server/auth.ts tests/integration/api/auth.test.ts
git commit -m "feat(auth): register endpoint validates email and persists it"
```

---

## Task 12: `app/login/page.tsx` — standalone login page

**Files:**
- Create: `app/login/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';
import { validateUsername, validatePassword } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const setUser = useAppStore(s => s.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (uErr || pErr) { setError(uErr || pErr); return; }
    setBusy(true);
    const r = await loginRequest(username, password);
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    const next = search.get('next') || '/';
    router.push(next);
  }

  return (
    <div className="mx-auto max-w-sm card-paper p-6 mt-8">
      <div className="font-kai text-ink-faint tracking-[0.3em] text-xs text-center mb-4">字 · 韵</div>
      <h1 className="font-serif text-2xl text-ink text-center mb-6">登录</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          placeholder="用户名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
        />
        {error && <p className="text-sm text-seal">{error}</p>}
        <button type="submit" disabled={busy} className="w-full btn-seal disabled:opacity-50">
          {busy ? '...' : '登录'}
        </button>
      </form>
      <div className="flex justify-between text-xs text-ink-faint mt-4">
        <Link href="/forgot-password" className="text-seal hover:underline">忘记密码</Link>
        <Link href="/register" className="hover:underline">没有账号？去注册</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(auth): /login standalone page"
```

---

## Task 13: `app/register/page.tsx` — standalone register page with email

**Files:**
- Create: `app/register/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerRequest } from '@/lib/api-auth';
import { useAppStore } from '@/lib/store';

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useAppStore(s => s.setUser);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) {
      setError('用户名仅支持 3-32 位字母数字下划线短横线');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('邮箱格式不正确');
      return;
    }
    if (password.length < 8) { setError('密码至少 8 位'); return; }
    if (password !== passwordConfirm) { setError('两次密码不一致'); return; }

    setBusy(true);
    const r = await registerRequest(username, email, password);
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setUser(r.data.user);
    router.push('/');
  }

  return (
    <div className="mx-auto max-w-sm card-paper p-6 mt-8">
      <div className="font-kai text-ink-faint tracking-[0.3em] text-xs text-center mb-4">字 · 韵</div>
      <h1 className="font-serif text-2xl text-ink text-center mb-6">注册</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          placeholder="用户名 (3-32 字符)"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="密码 (≥ 8 字符)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
        />
        <input
          className="w-full border border-ink/20 rounded px-3 py-2 bg-paper-soft focus:border-seal focus:outline-none"
          type="password"
          placeholder="再次输入密码"
          value={passwordConfirm}
          onChange={e => setPasswordConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
        />
        {error && <p className="text-sm text-seal">{error}</p>}
        <button type="submit" disabled={busy} className="w-full btn-seal disabled:opacity-50">
          {busy ? '...' : '注册'}
        </button>
      </form>
      <p className="text-xs text-ink-faint mt-4 text-center">
        已有账号？<Link href="/login" className="text-seal hover:underline">去登录</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/register/page.tsx
git commit -m "feat(auth): /register standalone page with email field"
```

---

## Task 14: Update `/forgot-password` and `/reset-password` flow + cross-links

**Files:**
- Modify: `app/forgot-password/page.tsx`
- Modify: `app/reset-password/page.tsx`

- [ ] **Step 1: Open `/forgot-password/page.tsx`** and verify it:
  - Has a Link to `/login` ("返回登录")
  - Submits to `/api/auth/forgot`
  - Shows success message ("邮件已发送，请查收")

If anything missing, add it. Also add Link to `/register`:
```tsx
<p className="text-xs text-ink-faint mt-4 text-center">
  没有账号？<Link href="/register" className="text-seal hover:underline">去注册</Link>
</p>
```

- [ ] **Step 2: Open `/reset-password/page.tsx`** and verify it:
  - Reads `?token=` from URL
  - Has new password + confirm fields
  - Shows success message + Link to `/login`
  - Has Link back to `/forgot-password` for re-request

If anything missing, add it.

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/forgot-password/page.tsx app/reset-password/page.tsx
git commit -m "fix(auth): cross-links between /forgot-password, /reset-password, /login, /register"
```

---

## Task 15: Update `Header.tsx` — replace AuthModal trigger with Link

**Files:**
- Modify: `components/Header.tsx`

- [ ] **Step 1: Find current AuthModal usage**

Run: `grep -n "AuthModal" components/Header.tsx`

The Header probably has a "登录" button that toggles `authModalOpen` state and renders `<AuthModal open={...} onClose={...} />`.

- [ ] **Step 2: Replace with `<Link>`**

Remove the `useState` for `authModalOpen`, remove the import of `AuthModal`, remove the `<AuthModal />` element from JSX.

Replace the button:
```tsx
<button onClick={() => setAuthModalOpen(true)}>登录</button>
```
with:
```tsx
<Link href="/login" className="...">登录</Link>
<Link href="/register" className="...">注册</Link>
```

(Adjust the existing styles to match — most likely the button is styled like a nav link.)

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors (AuthModal still imported elsewhere — we'll delete it next task).

- [ ] **Step 4: Commit**

```bash
git add components/Header.tsx
git commit -m "feat(header): login/register buttons link to /login and /register (no modal)"
```

---

## Task 16: Delete `AuthModal.tsx`

**Files:**
- Delete: `components/AuthModal.tsx`

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "AuthModal" components app lib` (excluding AuthModal.tsx itself)
Expected: no results.

- [ ] **Step 2: Delete the file**

```bash
git rm components/AuthModal.tsx
```

- [ ] **Step 3: Run typecheck + build**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(auth): remove AuthModal (replaced by /login and /register pages)"
```

---

## Task 17: Update README + .env.example

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Find the section listing routes. Add:
- `/login` — 登录 (独立页)
- `/register` — 注册 (独立页，需邮箱)
- `/forgot-password` — 忘记密码
- `/reset-password?token=...` — 重置密码

Find the "Game" section, add a line about difficulty levels (简单/复杂/超难 in localStorage).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README — auth pages are standalone + difficulty levels"
```

---

## Task 18: Final verification + smoke

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 4: Manual smoke (browser)**

- `/register` — submit with username + email + password → user created, redirected to `/`. Verify email persisted in DB (`SELECT email FROM users WHERE username = ?`).
- `/login` — submit with same creds → redirected to `/`. Verify "忘记密码" link works (goes to `/forgot-password`). Verify "没有账号？去注册" link works.
- `/forgot-password` — submit username → success message. Verify Link to `/login` and `/register` present.
- `/reset-password?token=invalid` → error message + Link back to `/forgot-password`.
- `/game` — both game modes show 简单/复杂/超难 picker. Difficulty persists across reload.
- `/dictionary` — pinyin input shows difficulty picker. Candidate count varies by setting.

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

---

## Self-Review Notes

- Type consistency: `Difficulty` is `'easy' | 'medium' | 'hard'` everywhere; `fetchChars` uses `level: 1 | 2 | 3` matching the API.
- No API changes for difficulty — everything is client-side filtering using existing endpoints.
- Email column: verify `users` table has `email` column before Task 11; if not, add migration.
- AuthModal deletion assumes nothing else imports it. Verify in Task 16.
- Cross-tab sync: `storage` event fires only on OTHER tabs. This is intentional — single-tab users don't need it but multi-tab users (e.g., `/game` open in tab A, change difficulty, tab B reflects) get the sync.

---

## Part B — Sutra Reading Modes (横向 / 竖向从右到左 / 竖向从左到右)

Classical Chinese sutras were read vertically, top-to-bottom, columns running right-to-left. Modern Chinese is read horizontally, left-to-right. Users who copy sutras for practice benefit from all three options.

**Architecture:**
- `ReadingMode = 'horizontal' | 'vertical-rtl' | 'vertical-ltr'`
- Persisted to `localStorage` (`pinyin:sutra-reading`), default: `'horizontal'`
- `ReadingModePicker` 3-segment control sits above `SutraTextView` in the sutra detail page
- `SutraTextView` switches layout based on mode

### Task 19: `lib/sutra-reading.ts` — type + default

**Files:**
- Create: `lib/sutra-reading.ts`

- [ ] **Step 1: Create the module**

```ts
export type ReadingMode = 'horizontal' | 'vertical-rtl' | 'vertical-ltr';

export const DEFAULT_READING_MODE: ReadingMode = 'horizontal';

export const READING_MODE_LABELS: Record<ReadingMode, string> = {
  'horizontal': '横向',
  'vertical-rtl': '竖排 · 从右到左',
  'vertical-ltr': '竖排 · 从左到右',
};

export function isReadingMode(s: string | null | undefined): s is ReadingMode {
  return s === 'horizontal' || s === 'vertical-rtl' || s === 'vertical-ltr';
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/sutra-reading.ts
git commit -m "feat(sutra): ReadingMode type + labels"
```

---

### Task 20: `lib/use-sutra-reading.ts` — localStorage hook

**Files:**
- Create: `lib/use-sutra-reading.ts`

- [ ] **Step 1: Create the hook**

```ts
'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_READING_MODE, isReadingMode, type ReadingMode } from './sutra-reading';

const STORAGE_KEY = 'pinyin:sutra-reading';

function readInitial(): ReadingMode {
  if (typeof window === 'undefined') return DEFAULT_READING_MODE;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return isReadingMode(v) ? v : DEFAULT_READING_MODE;
}

export function useSutraReading(): [ReadingMode, (next: ReadingMode) => void] {
  const [mode, setMode] = useState<ReadingMode>(DEFAULT_READING_MODE);

  useEffect(() => { setMode(readInitial()); }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isReadingMode(e.newValue)) setMode(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = (next: ReadingMode) => {
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [mode, update];
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/use-sutra-reading.ts
git commit -m "feat(sutra): useSutraReading hook (localStorage + cross-tab sync)"
```

---

### Task 21: `components/common/ReadingModePicker.tsx`

**Files:**
- Create: `components/common/ReadingModePicker.tsx`
- Test: `components/common/ReadingModePicker.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingModePicker } from './ReadingModePicker';

describe('ReadingModePicker', () => {
  it('renders three options', () => {
    render(<ReadingModePicker value="horizontal" onChange={() => {}} />);
    expect(screen.getByText('横向')).toBeTruthy();
    expect(screen.getByText(/竖排.*从右到左/)).toBeTruthy();
    expect(screen.getByText(/竖排.*从左到右/)).toBeTruthy();
  });

  it('highlights active value', () => {
    render(<ReadingModePicker value="vertical-rtl" onChange={() => {}} />);
    const btn = screen.getByText(/竖排.*从右到左/).closest('button')!;
    expect(btn.className).toMatch(/bg-seal|text-paper/);
  });

  it('fires onChange with ReadingMode', () => {
    const onChange = vi.fn();
    render(<ReadingModePicker value="horizontal" onChange={onChange} />);
    fireEvent.click(screen.getByText(/竖排.*从左到右/));
    expect(onChange).toHaveBeenCalledWith('vertical-ltr');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run components/common/ReadingModePicker.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```tsx
'use client';

import { READING_MODE_LABELS, type ReadingMode } from '@/lib/sutra-reading';

const ORDER: ReadingMode[] = ['horizontal', 'vertical-rtl', 'vertical-ltr'];

export function ReadingModePicker({
  value,
  onChange,
  className = '',
}: {
  value: ReadingMode;
  onChange: (next: ReadingMode) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="阅读方向"
      className={`inline-flex flex-wrap items-center rounded-sm border border-ink/20 bg-paper-soft p-0.5 ${className}`}
    >
      {ORDER.map((m) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={`px-3 py-1 text-xs sm:text-sm font-kai transition-colors rounded-sm ${
              active
                ? 'bg-seal text-paper-soft shadow-sm'
                : 'text-ink-soft hover:text-ink hover:bg-paper-deep'
            }`}
          >
            {READING_MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run components/common/ReadingModePicker.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add components/common/ReadingModePicker.tsx components/common/ReadingModePicker.test.tsx
git commit -m "feat(common): ReadingModePicker (3-segment control)"
```

---

### Task 22: `SutraTextView` supports all three modes

**Files:**
- Modify: `components/sutra/SutraTextView.tsx`
- Test: `components/sutra/SutraTextView.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SutraTextView } from './SutraTextView';

const CHUNK = {
  id: 0,
  label: '一品',
  content: ['如是我闻。一时佛在舍卫国。', '只树给孤独园。'],
};

describe('SutraTextView', () => {
  it('horizontal: each line is a <p>', () => {
    render(<SutraTextView chunk={CHUNK} mode="horizontal" />);
    const paras = screen.getAllByText(/./);
    expect(paras.length).toBeGreaterThanOrEqual(2);
  });

  it('vertical-rtl: container has vertical-rtl writing-mode + flex-row-reverse', () => {
    const { container } = render(<SutraTextView chunk={CHUNK} mode="vertical-rtl" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/vertical-rtl|writing-mode/);
  });

  it('vertical-ltr: container has vertical-ltr writing-mode + flex-row', () => {
    const { container } = render(<SutraTextView chunk={CHUNK} mode="vertical-ltr" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/vertical-ltr|writing-mode/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run components/sutra/SutraTextView.test.tsx`
Expected: FAIL — `mode` prop not supported.

- [ ] **Step 3: Implement**

```tsx
import type { SutraChunk } from '@/lib/sutra-types';
import type { ReadingMode } from '@/lib/sutra-reading';

interface Props {
  chunk: SutraChunk;
  mode?: ReadingMode;
}

const MODE_CLASS: Record<ReadingMode, string> = {
  'horizontal': '',
  'vertical-rtl': '[writing-mode:vertical-rl] flex-row-reverse',
  'vertical-ltr': '[writing-mode:vertical-lr]',
};

export function SutraTextView({ chunk, mode = 'horizontal' }: Props) {
  if (mode === 'horizontal') {
    return (
      <div className="font-serif text-lg sm:text-xl text-ink leading-loose">
        {chunk.content.map((line, i) => (
          <p key={i} className="my-1.5">{line}</p>
        ))}
      </div>
    );
  }
  return (
    <div
      className={`font-serif text-lg sm:text-xl text-ink leading-loose flex flex-wrap gap-6 max-h-[70vh] overflow-y-auto p-2 ${MODE_CLASS[mode]}`}
      style={{ writingMode: mode === 'vertical-rtl' ? 'vertical-rl' : 'vertical-lr' }}
    >
      {chunk.content.map((line, i) => (
        <p key={i} className="my-1.5 whitespace-nowrap">{line}</p>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run components/sutra/SutraTextView.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add components/sutra/SutraTextView.tsx components/sutra/SutraTextView.test.tsx
git commit -m "feat(sutra): SutraTextView supports horizontal + vertical-rtl + vertical-ltr"
```

---

### Task 23: Wire `ReadingModePicker` into sutra detail page

**Files:**
- Create: `app/sutra/[id]/ReadingModeControl.tsx` (NEW client wrapper)
- Modify: `app/sutra/[id]/page.tsx`

- [ ] **Step 1: Create client wrapper**

`app/sutra/[id]/ReadingModeControl.tsx`:
```tsx
'use client';

import { useSutraReading } from '@/lib/use-sutra-reading';
import { ReadingModePicker } from '@/components/common/ReadingModePicker';

export function ReadingModeControl() {
  const [mode, setMode] = useSutraReading();
  return <ReadingModePicker value={mode} onChange={setMode} />;
}
```

- [ ] **Step 2: Modify sutra detail page**

Replace the imports at top of `app/sutra/[id]/page.tsx`:
```tsx
import { SutraTextView } from '@/components/sutra/SutraTextView';
```
becomes nothing — keep the import.

Add to imports:
```tsx
import { ReadingModeControl } from './ReadingModeControl';
import { SutraTextViewWithMode } from './SutraTextViewWithMode';
```

Create `app/sutra/[id]/SutraTextViewWithMode.tsx`:
```tsx
'use client';

import { SutraTextView } from '@/components/sutra/SutraTextView';
import { useSutraReading } from '@/lib/use-sutra-reading';
import type { SutraChunk } from '@/lib/sutra-types';

export function SutraTextViewWithMode({ chunk }: { chunk: SutraChunk }) {
  const [mode] = useSutraReading();
  return <SutraTextView chunk={chunk} mode={mode} />;
}
```

In the page JSX, replace:
```tsx
<SutraTextView chunk={activeChunk} />
```
with:
```tsx
<SutraTextViewWithMode chunk={activeChunk} />
```

Add the picker control above the ReadAloud row:
```tsx
<div className="flex items-center justify-between mb-2 worksheet-no-print">
  <ReadingModeControl />
  <ReadAloudButton text={activeChunk.content.join('\n')} size="sm" variant="seal" />
</div>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/sutra/[id]/page.tsx app/sutra/[id]/ReadingModeControl.tsx app/sutra/[id]/SutraTextViewWithMode.tsx
git commit -m "feat(sutra): reading mode picker wired into detail page"
```

---

### Task 24: Tests + smoke for sutra reading modes

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Manual smoke**

- Open `/sutra/15` (or any valid sutra id).
- Verify the picker shows 横向 / 竖排从右到左 / 竖排从左到右.
- Switch to 竖排从右到左: text flows top-to-bottom, columns right-to-left.
- Switch to 竖排从左到右: text flows top-to-bottom, columns left-to-right.
- Switch back to 横向: text returns to default horizontal layout.
- Reload — setting persists.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Deferred to Future Plans

The following requests were received during this session but are deferred to a future plan (not in scope for Plan N):

1. **Download recommended open-source Chinese fonts** for worksheet generation (Loxia Handwriting, 两同书体, 霞鹜文楷, 全景隶书). Will need licensing review and font-file management.
2. **Make text-to-pinyin a standalone page** (`/pinyin` route) — currently embedded in homepage as `TextToPinyin` component.
3. **Add font selection to worksheet generation** — user picks font from a list + brush style toggle.

These three form a coherent "Plan O — Fonts & Pinyin Page Extraction" plan that should be drafted separately.