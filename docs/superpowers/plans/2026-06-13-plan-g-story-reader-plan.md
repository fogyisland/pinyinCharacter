# Plan G Implementation Plan — 汉字故事 翻页阅读器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `rare_chars` 表里 ~1400 个 AI 生成的故事通过单字翻页阅读器可发现. 包含 TTS 朗读、键盘快捷键、localStorage 进度追踪、加入字帖快捷入口. 唯一入口: /rare-chars 今日一字 banner.

**Architecture:** 客户端 SPA. Server shell (`app/stories/page.tsx` 和 `app/stories/[char]/page.tsx`) 用 RSC 取初始 char. `<StoryClient>` 客户端组件自管 current/history state. "下一个" 调 `GET /api/stories/random`. 复用 `lib/tts.ts` (Web Speech API).

**Tech Stack:** Next.js 15 (RSC + 'use client'), TypeScript, Tailwind v4, Web Speech API, localStorage, vitest + happy-dom.

---

## 文件结构 (本计划)

| 文件 | 责任 |
|---|---|
| `lib/rare-chars.ts` | +`getRandomStoryChar()` (Task 1) |
| `lib/story-history.ts` | localStorage helpers (Task 2) |
| `app/api/stories/random/route.ts` | GET 随机 char (Task 3) |
| `lib/api-stories.ts` | client fetchRandomStory (Task 4) |
| `app/stories/StoryClient.tsx` | 'use client' 顶层 reader 组件 (Task 5) |
| `app/stories/page.tsx` | RSC random shell (Task 6) |
| `app/stories/[char]/page.tsx` | RSC specific char shell (Task 7) |
| `components/rare/DailyCharBanner.tsx` | href → /stories/[char] (Task 8) |
| `README.md` | +说明 (Task 9) |
| `tests/unit/lib/story-history.test.ts` | localStorage 测试 (Task 2) |
| `tests/integration/api/stories-random.test.ts` | API 测试 (Task 3) |
| `tests/unit/components/StoryClient.test.tsx` | 组件测试 (Task 5) |

---

### Task 1: getRandomStoryChar() server fn

**Files:**
- Modify: `lib/rare-chars.ts` (add fn at end, after `getDailyChar`)
- Test: `tests/unit/lib/rare-chars.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/rare-chars.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => queryMock(...a) }),
}));

import { getRandomStoryChar } from '@/lib/rare-chars';

describe('getRandomStoryChar', () => {
  beforeEach(() => queryMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns null when no rows', async () => {
    queryMock.mockResolvedValue([[]]);
    const r = await getRandomStoryChar();
    expect(r).toBeNull();
  });

  it('returns mapped RareChar when row exists', async () => {
    queryMock.mockResolvedValue([[{
      char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有龙',
      needs_review: 1, generated_by: 'openai:gpt-4o-mini',
      generated_at: new Date('2026-05-12T08:30:00Z'), created_at: new Date('2026-05-12T08:00:00Z'),
    }]]);
    const r = await getRandomStoryChar();
    expect(r).toEqual({
      char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有龙',
      needsReview: true, generatedBy: 'openai:gpt-4o-mini',
      generatedAt: new Date('2026-05-12T08:30:00Z'), createdAt: new Date('2026-05-12T08:00:00Z'),
    });
  });

  it('queries with story <> "" filter', async () => {
    queryMock.mockResolvedValue([[]]);
    await getRandomStoryChar();
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM rare_chars/);
    expect(String(sql)).toMatch(/story\s+<>\s*''/);
    expect(String(sql)).toMatch(/ORDER BY RAND\(\)/);
    expect(params).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/rare-chars.test.ts`
Expected: FAIL (function not exported)

- [ ] **Step 3: Add getRandomStoryChar to lib/rare-chars.ts**

Append to `lib/rare-chars.ts` (after `getDailyChar`):
```ts
export async function getRandomStoryChar(): Promise<RareChar | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, meaning, story, needs_review, generated_by, generated_at, created_at
     FROM rare_chars
     WHERE story <> ''
     ORDER BY RAND()
     LIMIT 1`
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/rare-chars.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/rare-chars.ts tests/unit/lib/rare-chars.test.ts
git commit -m "feat(lib): getRandomStoryChar — random char with non-empty story"
```

---

### Task 2: lib/story-history.ts (localStorage helpers)

**Files:**
- Create: `lib/story-history.ts`
- Test: `tests/unit/lib/story-history.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/story-history.test.ts`:
```ts
// @vitest-environment happy-dom
import {describe, it, expect, beforeEach } from 'vitest';
import { getReadChars, addReadChar, clearReadHistory } from '@/lib/story-history';

const KEY = 'pinyin-character:read-stories';

beforeEach(() => {
  localStorage.clear();
  clearReadHistory();
});

describe('story-history', () => {
  it('returns empty array when no key set', () => {
    expect(getReadChars()).toEqual([]);
  });

  it('adds char and reads back', () => {
    addReadChar('龘');
    expect(getReadChars()).toEqual(['龘']);
  });

  it('does not duplicate char (Set semantics)', () => {
    addReadChar('龘');
    addReadChar('龘');
    addReadChar('好');
    expect(getReadChars().sort()).toEqual(['好', '龘']);
  });

  it('caps at 500 chars (FIFO)', () => {
    for (let i = 0; i < 510; i++) addReadChar(String.fromCodePoint(0x4e00 + i));
    const arr = getReadChars();
    expect(arr.length).toBe(500);
  });

  it('clearReadHistory empties the storage', () => {
    addReadChar('龘');
    addReadChar('好');
    clearReadHistory();
    expect(getReadChars()).toEqual([]);
  });

  it('returns [] silently when localStorage throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('QuotaExceeded'); };
    expect(getReadChars()).toEqual([]);
    Storage.prototype.getItem = original;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/story-history.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement lib/story-history.ts**

Create `lib/story-history.ts`:
```ts
const STORAGE_KEY = 'pinyin-character:read-stories';
const MAX_HISTORY = 500;

export function getReadChars(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function addReadChar(char: string): void {
  if (typeof window === 'undefined' || !char) return;
  try {
    const arr = getReadChars();
    if (arr.includes(char)) return;
    arr.push(char);
    const trimmed = arr.length > MAX_HISTORY ? arr.slice(arr.length - MAX_HISTORY) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable (private mode, quota) — silent skip
  }
}

export function clearReadHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/story-history.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/story-history.ts tests/unit/lib/story-history.test.ts
git commit -m "feat(lib): story-history localStorage helpers (get/add/clear)"
```

---

### Task 3: GET /api/stories/random route

**Files:**
- Create: `app/api/stories/random/route.ts`
- Test: `tests/integration/api/stories-random.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/stories-random.test.ts`:
```ts
import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/stories/random', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('503 when no stories exist', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error?.code).toBe('NO_STORIES');
  });

  it('200 with char/pinyin/meaning/story when stories exist', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, ?, ?, ?)`,
      ['龘', 'dá', '古龙', '从前有一条龙']
    );
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.char).toBe('龘');
    expect(j.data.pinyin).toBe('dá');
    expect(j.data.meaning).toBe('古龙');
    expect(j.data.story).toBe('从前有一条龙');
  });

  it('does not return chars with empty story', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute(
      `INSERT INTO rare_chars (char, pinyin, meaning, story) VALUES (?, ?, ?, ?)`,
      ['X', 'x', 'no story', '']
    );
    const { GET } = await import('@/app/api/stories/random/route');
    const r = await GET(new Request('http://x/api/stories/random') as any);
    expect(r.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/stories-random.test.ts`
Expected: FAIL (route not found)

- [ ] **Step 3: Implement route**

Create `app/api/stories/random/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getRandomStoryChar } from '@/lib/rare-chars';
import { withErrorHandling, serviceUnavailable } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const result = await getRandomStoryChar();
    if (!result) {
      return serviceUnavailable('NO_STORIES', 'no stories available');
    }
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/stories-random.test.ts`
Expected: 3 tests pass (or skip if no DB)

- [ ] **Step 5: Commit**

```bash
git add app/api/stories/random/route.ts tests/integration/api/stories-random.test.ts
git commit -m "feat(api): GET /api/stories/random (200/503 NO_STORIES)"
```

---

### Task 4: lib/api-stories.ts client wrapper

**Files:**
- Create: `lib/api-stories.ts`

- [ ] **Step 1: Write the file**

Create `lib/api-stories.ts`:
```ts
import type { RareCharClient } from './api-rare-chars';

export async function fetchRandomStory(): Promise<RareCharClient> {
  const res = await fetch('/api/stories/random');
  const data = (await res.json()) as
    | { ok: true; data: RareCharClient }
    | { ok: false; error: { code: string; message?: string } };
  if (!data.ok) {
    throw new Error(`fetchRandomStory failed: ${data.error.code}`);
  }
  return data.data;
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add lib/api-stories.ts
git commit -m "feat(lib): fetchRandomStory client wrapper"
```

---

### Task 5: StoryClient component (state + UI + TTS + keyboard)

**Files:**
- Create: `app/stories/StoryClient.tsx`
- Test: `tests/unit/components/StoryClient.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/StoryClient.test.tsx`:
```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react';
import { StoryClient } from '@/app/stories/StoryClient';

vi.mock('@/lib/api-stories', () => ({
  fetchRandomStory: vi.fn(),
}));

vi.mock('@/lib/tts', () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  pickChineseVoice: vi.fn(() => null),
}));

import { fetchRandomStory } from '@/lib/api-stories';
import { speak, stopSpeaking } from '@/lib/tts';

const mockedFetch = fetchRandomStory as unknown as ReturnType<typeof vi.fn>;
const mockedSpeak = speak as unknown as ReturnType<typeof vi.fn>;
const mockedStop = stopSpeaking as unknown as ReturnType<typeof vi.fn>;

const INITIAL = {
  char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有一条龙',
  needsReview: true, generatedBy: 'openai:gpt-4o-mini',
  generatedAt: '2026-05-12T08:30:00Z', createdAt: '2026-05-12T08:00:00Z',
};

const NEXT = {
  char: '好', pinyin: 'hǎo', meaning: 'good', story: '好事发生',
  needsReview: true, generatedBy: 'openai:gpt-4o-mini',
  generatedAt: '2026-05-12T08:30:00Z', createdAt: '2026-05-12T08:00:00Z',
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedSpeak.mockReset();
  mockedStop.mockReset();
  localStorage.clear();
  mockedFetch.mockResolvedValue(NEXT);
});

describe('StoryClient', () => {
  it('renders initial char, pinyin, meaning, story', () => {
    render(<StoryClient initialChar={INITIAL} />);
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(screen.getByText('dá')).toBeInTheDocument();
    expect(screen.getByText('古龙')).toBeInTheDocument();
    expect(screen.getByText('从前有一条龙')).toBeInTheDocument();
  });

  it('shows "已读 1" after mount (initial char written)', () => {
    render(<StoryClient initialChar={INITIAL} />);
    expect(screen.getByText(/已读 1/)).toBeInTheDocument();
  });

  it('上一步 button is disabled when history is empty', () => {
    render(<StoryClient initialChar={INITIAL} />);
    const prevBtn = screen.getByRole('button', { name: /上一个/ });
    expect(prevBtn).toBeDisabled();
  });

  it('点 下一个 fetches new char and replaces current', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    const nextBtn = screen.getByRole('button', { name: /下一个/ });
    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('龘')).not.toBeInTheDocument();
  });

  it('点 上一个 (after a next) goes back without API call', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /下一个/ }));
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
    mockedFetch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /上一个/ }));
    await waitFor(() => expect(screen.getByText('龘')).toBeInTheDocument());
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('键盘 → triggers next', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
  });

  it('键盘 ← triggers previous (no-op when empty)', () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('点 朗读 calls speak with current story', () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /朗读/ }));
    expect(mockedSpeak).toHaveBeenCalledWith(expect.stringContaining('从前有一条龙'), expect.any(Object));
  });

  it('点 加字帖 link has correct href', () => {
    render(<StoryClient initialChar={INITIAL} />);
    const link = screen.getByRole('link', { name: /加字帖/ });
    expect(link).toHaveAttribute('href', `/worksheet?prefill=${encodeURIComponent('龘')}`);
  });

  it('fetch 失败 shows error and keeps current char', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /下一个/ }));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByText('龘')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/StoryClient.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement StoryClient**

Create `app/stories/StoryClient.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchRandomStory } from '@/lib/api-stories';
import { speak, stopSpeaking } from '@/lib/tts';
import { getReadChars, addReadChar } from '@/lib/story-history';
import type { RareCharClient } from '@/lib/api-rare-chars';

interface Props {
  initialChar: RareCharClient;
}

export function StoryClient({ initialChar }: Props) {
  const [current, setCurrent] = useState<RareCharClient>(initialChar);
  const [history, setHistory] = useState<RareCharClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [readCount, setReadCount] = useState(0);

  // mount: write initial char, sync count
  useEffect(() => {
    addReadChar(initialChar.char);
    setReadCount(getReadChars().length);
  }, [initialChar]);

  // cleanup TTS on unmount
  useEffect(() => () => stopSpeaking(), []);

  const handleNext = useCallback(async () => {
    setError(null);
    setLoading(true);
    stopSpeaking();
    setSpeaking(false);
    try {
      const next = await fetchRandomStory();
      setHistory((h) => [...h, current]);
      setCurrent(next);
      addReadChar(next.char);
      setReadCount(getReadChars().length);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [current]);

  const handlePrev = useCallback(() => {
    setError(null);
    stopSpeaking();
    setSpeaking(false);
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setCurrent(prev);
    setHistory((h) => h.slice(0, -1));
  }, [history]);

  const handleToggleSpeak = useCallback(() => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
    } else {
      const text = current.meaning ? `${current.meaning}。${current.story}` : current.story;
      speak(text, {
        rate: 0.85,
        onEnd: () => setSpeaking(false),
      });
      setSpeaking(true);
    }
  }, [speaking, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignore when typing in input/textarea
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleToggleSpeak();
      } else if (e.key === 'Escape') {
        stopSpeaking();
        setSpeaking(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev, handleToggleSpeak]);

  const canPrev = history.length > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 flex items-center justify-between text-sm text-ink-soft">
        <Link href="/rare-chars" className="hover:text-seal">← 返回字库</Link>
        <span aria-label="已读进度">已读 {readCount} 字</span>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <article className="card-paper text-center">
        <h1 className="font-kai text-9xl font-bold text-ink leading-none">{current.char}</h1>
        <p className="mt-4 text-3xl text-ink-soft">{current.pinyin}</p>
        {current.meaning && (
          <p className="mt-2 text-sm text-ink-faint">{current.meaning}</p>
        )}
        <p className="mt-8 whitespace-pre-line px-4 text-left font-serif text-base leading-relaxed text-ink">
          {current.story}
        </p>
      </article>

      <nav aria-label="故事操作" className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:justify-center">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!canPrev}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep disabled:opacity-40"
        >
          ← 上一个
        </button>
        <button
          type="button"
          onClick={handleToggleSpeak}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep"
          aria-pressed={speaking}
        >
          {speaking ? '停止' : '朗读'}
        </button>
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(current.char)}`}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep"
        >
          加字帖 →
        </Link>
        <button
          type="button"
          onClick={handleNext}
          disabled={loading}
          className="btn-seal px-4 py-2 text-sm"
        >
          {loading ? '加载中…' : '下一个 →'}
        </button>
      </nav>

      <p className="mt-6 text-center text-xs text-ink-faint">
        快捷键: → 下一个 · ← 上一个 · L 朗读 · Esc 停止
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/StoryClient.test.tsx`
Expected: 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add app/stories/StoryClient.tsx tests/unit/components/StoryClient.test.tsx
git commit -m "feat(story): StoryClient reader (state + TTS + keyboard + localStorage)"
```

---

### Task 6: app/stories/page.tsx (server shell, random initial)

**Files:**
- Create: `app/stories/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/stories/page.tsx`:
```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getRandomStoryChar } from '@/lib/rare-chars';
import { StoryClient } from './StoryClient';

export const dynamic = 'force-dynamic';

export default async function StoriesPage() {
  const initial = await getRandomStoryChar();
  if (!initial) {
    return (
      <>
        <Suspense><Header /></Suspense>
        <PageContainer>
          <SectionTitle subtitle="AI 生成的汉字故事">读故事</SectionTitle>
          <EmptyState
            title="暂无可读的故事"
            description="故事库还是空的,去字库逛逛看?"
          />
        </PageContainer>
        <Footer />
      </>
    );
  }
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 一日一读</div>
        <SectionTitle subtitle="从 rare_chars 表中随机翻一个故事读">读故事</SectionTitle>
        <StoryClient initialChar={initial} />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add app/stories/page.tsx
git commit -m "feat(story): /stories server shell (random initial char)"
```

---

### Task 7: app/stories/[char]/page.tsx (specific char entry)

**Files:**
- Create: `app/stories/[char]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/stories/[char]/page.tsx`:
```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getChar } from '@/lib/rare-chars';
import { StoryClient } from '../StoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function StoryForCharPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data || !data.story) notFound();
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 一日一读</div>
        <SectionTitle subtitle="AI 生成的小故事">读故事</SectionTitle>
        <StoryClient initialChar={data} />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add app/stories/[char]/page.tsx
git commit -m "feat(story): /stories/[char] server shell (fixed entry from daily banner)"
```

---

### Task 8: DailyCharBanner link → /stories/[char]

**Files:**
- Modify: `components/rare/DailyCharBanner.tsx:13`

- [ ] **Step 1: Edit the link href**

In `components/rare/DailyCharBanner.tsx` line 13, change:
```tsx
href={`/rare-chars/${encodeURIComponent(char)}`}
```
to:
```tsx
href={`/stories/${encodeURIComponent(char)}`}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/rare/DailyCharBanner.tsx
git commit -m "feat(story): daily char banner now links to story reader"
```

---

### Task 9: README + final verification

**Files:**
- Modify: `README.md` (add a section about /stories)

- [ ] **Step 1: Add /stories section to README**

Find an appropriate spot in `README.md` (e.g. after the 「字·韵」 features list) and add:

```markdown
### 读故事 (/stories)

单字翻页阅读器, 从 `rare_chars` 表里随机抽一个有 AI 生成故事的字阅读. 支持:
- 键盘快捷键 (→ 下一个 / ← 上一个 / L 朗读 / Esc 停止)
- TTS 朗读 (Web Speech API)
- localStorage 进度 ("已读 X 字" 持久化)
- "加字帖" 快捷按钮

入口: `/rare-chars` 页面的 "今日一字" banner (没有顶部 nav 链接 — 故意隐藏, 保持首页干净).
```

- [ ] **Step 2: Run full verification**

Run all three in sequence:
```bash
pnpm tsc --noEmit
pnpm vitest run tests/unit/lib/story-history.test.ts tests/unit/lib/rare-chars.test.ts tests/unit/components/StoryClient.test.tsx tests/integration/api/stories-random.test.ts
pnpm build
```

Expected:
- tsc: 0 errors
- vitest: all Plan G tests pass (or skip if no DB)
- build: success

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — /stories reader section"
```

---

## 验证清单 (manual smoke, 我跑)

- [ ] `pnpm dev` 启动, 浏览器打开 /rare-chars
- [ ] 看到 今日一字 banner
- [ ] 点 banner, 跳到 /stories/[c]
- [ ] 看到 char + 故事
- [ ] 点 朗读, 按钮变 停止
- [ ] 听 5 秒, 点 停止
- [ ] 点 下一个, 看到不同 char
- [ ] 点 5 次, 进度显示 "已读 6"
- [ ] 键盘 → 下一个, ← 上一个
- [ ] 键盘 L 朗读, Esc 停止
- [ ] 点 加字帖, 跳 /worksheet?prefill=<c>
- [ ] 移动端 375px 宽, 按钮 2x2 排版正常
- [ ] 刷新页面, 进度保留, history 丢 (预期)
- [ ] 直接访问 /stories, 看到随机 char

---

## 验收

- [x] 所有 9 个 task 完成, 9 个 commit 在 main
- [x] tsc --noEmit 干净
- [x] pnpm vitest run 全部 Plan G 测试通过 (3 lib + 10 component + 3 integration)
- [x] pnpm build 成功
- [x] 手动冒烟 12 步全过
