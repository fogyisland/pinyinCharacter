# TTS Pronunciation Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `lib/tts.ts:speak()` to the existing `lib/tts-cache.ts` Cache API layer, add opportunistic prefetch on dictionary pages, and surface admin-only cache management via `/admin/settings/audio`.

**Architecture:** Minimal-surface area change. Reuse the existing `lib/tts-cache.ts` (Cache API + SHA-256) — only ADD 3 helpers (`prefetchTts`, `clearTtsCache`, `getTtsCacheSize`). Modify 5 files total. The 8+ existing UI call sites of `<ReadAloudButton>` → `speak()` benefit automatically.

**Tech Stack:** Next.js 15 App Router, React 19, Cache API (browser), vitest + happy-dom for tests.

## Global Constraints

- Cache name stays `tts-v1`. Bumping to `tts-v2` is reserved for forced wipe; current spec does not bump.
- Cache key derivation: `SHA-256("${voice}|${text}")` — do NOT include `format` in the key (intentional, see spec §"Cache Key + Format Strategy").
- `lib/tts.ts:BATCH_MAX_CHARS = 500`. `lib/tts-cache.ts` may hardcode `500` for its own length cap with a comment referencing the speak() cap. (Don't export from tts.ts — they're coupled.)
- All helpers no-op gracefully when `caches` is unavailable (`isAvailable()` check, already exists).
- All fetch failures are best-effort swallowed in prefetch/clear/size paths; `speak()` keeps its existing throw-on-fail behavior.
- Project uses npm (per memory `project-uses-npm.md`); use `npx` and `--legacy-peer-deps` if installing anything.
- Existing 44/44 worksheet tests + 115/115 tts tests must remain green; add to existing coverage, don't replace.
- Commit message format: `<scope>: <subject>` with optional timestamp suffix `[YYYY-MM-DD HH.MM]` (per memory `feedback-commit-timestamps.md`).
- Local main is 93 commits ahead of origin/main — do NOT push (per memory `no-prod-env-2026-06-21`).
- `lib/tts.ts` uses BATCH_MAX_CHARS = 500 cap on `/api/tts` calls — prefetch respects the same cap (single-char inputs only; long inputs go through `speak()`).
- Default voice for char prefetch = `'female'` (matches `<ReadAloudButton>` default for non-male buttons). Male-voice entries (`char.char` button on dictionary detail) are NOT prefetched — only female (the common case).
- `useEffect` cleanup must cancel pending `requestIdleCallback` handles on unmount (otherwise we leak idle tasks across navigation).

---

## Task 1: Add 3 helpers to `lib/tts-cache.ts`

**Files:**
- Modify: `lib/tts-cache.ts` (add 3 functions after `putCachedTts`)
- Create: `tests/unit/lib/tts-cache.test.ts`

**Interfaces:**
- Produces:
  - `prefetchTts(voice: string, text: string): Promise<void>` — fire-and-forget warm; no-op if cached
  - `clearTtsCache(): Promise<void>` — deletes the named cache
  - `getTtsCacheSize(): Promise<{ count: number; bytes: number }>` — best-effort stats

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/lib/tts-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedTts,
  putCachedTts,
  prefetchTts,
  clearTtsCache,
  getTtsCacheSize,
} from '@/lib/tts-cache';

// Minimal Cache API polyfill for happy-dom (which doesn't ship `caches`).
// Backed by an in-memory Map<key, Blob>.
class FakeCache {
  private store = new Map<string, Blob>();
  async match(req: Request | string): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    const blob = this.store.get(url);
    return blob ? new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }) : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const url = typeof req === 'string' ? req : req.url;
    this.store.set(url, await res.blob());
  }
  async delete(req: Request | string): Promise<boolean> {
    const url = typeof req === 'string' ? req : req.url;
    return this.store.delete(url);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }
}

beforeEach(() => {
  const fake = new FakeCache();
  Object.defineProperty(globalThis, 'caches', {
    value: { open: async () => fake, delete: async () => true },
    configurable: true,
    writable: true,
  });
});

describe('tts-cache', () => {
  it('roundtrip: put then get returns the same blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
    await putCachedTts('female', '你好', blob);
    const got = await getCachedTts('female', '你好');
    expect(got).not.toBeNull();
    expect(await got!.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it('different voice => different cache entry (no collision)', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/mpeg' });
    await putCachedTts('female', '你', blob);
    const got = await getCachedTts('male', '你');
    expect(got).toBeNull();
  });

  it('prefetchTts: calls fetch on cache miss and stores the result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([9, 9])], { type: 'audio/mpeg' })),
    );
    await prefetchTts('female', '学');
    expect(fetchSpy).toHaveBeenCalledWith('/api/tts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '学', voice: 'female' }),
    }));
    const got = await getCachedTts('female', '学');
    expect(got).not.toBeNull();
    fetchSpy.mockRestore();
  });

  it('prefetchTts: does NOT call fetch when entry is already cached', async () => {
    await putCachedTts('female', '学', new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([9])], { type: 'audio/mpeg' })),
    );
    await prefetchTts('female', '学');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('prefetchTts: swallows fetch errors (does not throw)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    await expect(prefetchTts('female', '学')).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('prefetchTts: no-op for empty text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob()));
    await prefetchTts('female', '');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('prefetchTts: no-op for text > 500 chars (matches speak() batch cap)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob()));
    await prefetchTts('female', 'x'.repeat(501));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('clearTtsCache: removes all entries', async () => {
    await putCachedTts('female', '你', new Blob([new Uint8Array([1])]));
    await putCachedTts('female', '好', new Blob([new Uint8Array([2])]));
    await clearTtsCache();
    expect(await getCachedTts('female', '你')).toBeNull();
    expect(await getCachedTts('female', '好')).toBeNull();
  });

  it('getTtsCacheSize: returns count + bytes', async () => {
    await putCachedTts('female', '你', new Blob([new Uint8Array([1, 2, 3])]));
    await putCachedTts('female', '好', new Blob([new Uint8Array([4, 5, 6, 7])]));
    const size = await getTtsCacheSize();
    expect(size.count).toBe(2);
    expect(size.bytes).toBe(7);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts-cache.test.ts 2>&1 | tail -15`
Expected: FAIL — `prefetchTts`, `clearTtsCache`, `getTtsCacheSize` are not exported from `@/lib/tts-cache`.

- [ ] **Step 3: Implement the 3 helpers in `lib/tts-cache.ts`**

Append after `putCachedTts` (after line 57):

```ts
// Hardcoded to match lib/tts.ts:BATCH_MAX_CHARS (coupled cap — DO NOT export).
const PREFETCH_MAX_CHARS = 500;

/**
 * Fire-and-forget cache warm. Does not play audio. Skips if cached.
 * Silently swallows network / quota errors so callers don't have to guard.
 */
export async function prefetchTts(voice: string, text: string): Promise<void> {
  if (!isAvailable()) return;
  if (!text || text.length > PREFETCH_MAX_CHARS) return;
  const cached = await getCachedTts(voice, text);
  if (cached) return;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    await putCachedTts(voice, text, blob);
  } catch {
    /* network / quota / opaque CORS errors — non-fatal */
  }
}

/** Wipe the named cache. Used by admin DELETE endpoint. */
export async function clearTtsCache(): Promise<void> {
  if (!isAvailable()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* best-effort */
  }
}

/**
 * Best-effort count + total bytes for the named cache.
 * Walks every entry — may be slow for large caches. Returns 0/0 on any error.
 */
export async function getTtsCacheSize(): Promise<{ count: number; bytes: number }> {
  if (!isAvailable()) return { count: 0, bytes: 0 };
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let bytes = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (res) {
        const buf = await res.arrayBuffer();
        bytes += buf.byteLength;
      }
    }
    return { count: keys.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts-cache.test.ts 2>&1 | tail -8`
Expected: 9 tests pass.

- [ ] **Step 5: Verify no regressions in existing tts tests**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts.test.ts 2>&1 | tail -5`
Expected: all existing tts tests still pass.

- [ ] **Step 6: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter" && git add lib/tts-cache.ts tests/unit/lib/tts-cache.test.ts && git commit -m "feat(tts-cache): add prefetchTts, clearTtsCache, getTtsCacheSize helpers"
```

---

## Task 2: Wire `speak()` in `lib/tts.ts` to the cache

**Files:**
- Modify: `lib/tts.ts:78-92` (replace the bare fetch with the cache-then-fetch pattern)
- Modify: `tests/unit/lib/tts.test.ts` (add cache-mock + new cache-hit/miss tests)

**Interfaces:**
- Consumes: `getCachedTts(voice, text)`, `putCachedTts(voice, text, blob)` from `@/lib/tts-cache` (Task 1)
- No change to `speak()` signature or return type

- [ ] **Step 1: Read current `tests/unit/lib/tts.test.ts` to understand mock setup**

Read `tests/unit/lib/tts.test.ts`. Identify:
- The `FakeAudio` class (likely 20-30 lines)
- How `fetch` is mocked (probably `vi.spyOn(globalThis, 'fetch')`)
- The setup function (`beforeEach` block)

Add to the top of the file (after imports):

```ts
// Minimal Cache API polyfill — happy-dom doesn't ship `caches`.
class FakeCache {
  private store = new Map<string, Blob>();
  async match(req: Request | string): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    const blob = this.store.get(url);
    return blob ? new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }) : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const url = typeof req === 'string' ? req : req.url;
    this.store.set(url, await res.blob());
  }
  async delete(req: Request | string): Promise<boolean> {
    const url = typeof req === 'string' ? req : req.url;
    return this.store.delete(url);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }
}
```

Inside the existing `beforeEach` (or wrap the test setup), after the existing fake setup, add:

```ts
  // Install Cache API polyfill BEFORE the module under test runs.
  if (!('caches' in globalThis)) {
    const fake = new FakeCache();
    Object.defineProperty(globalThis, 'caches', {
      value: { open: async () => fake, delete: async () => true },
      configurable: true,
      writable: true,
    });
  }
```

(If the existing file uses a different setup pattern, match it — copy the same shape as the new tests for `tests/unit/lib/tts-cache.test.ts`.)

Add 3 new test cases inside the existing describe block:

```ts
  it('uses cached blob on second speak() of same text (no second fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })),
    );
    await speak('女');
    fetchSpy.mockClear();
    await speak('女');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('stores fetched blob in cache after first speak()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })),
    );
    await speak('女');
    // After this speak(), re-importing getCachedTts should find the entry.
    const { getCachedTts } = await import('@/lib/tts-cache');
    const blob = await getCachedTts('female', '女');
    expect(blob).not.toBeNull();
    fetchSpy.mockRestore();
  });

  it('falls back to fetch when cache returns null (regression: no behavioral change)', async () => {
    // With the polyfill installed but empty, cache always misses. speak() must still fetch.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })),
    );
    await speak('学');
    expect(fetchSpy).toHaveBeenCalledWith('/api/tts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '学', voice: 'female' }),
    }));
    fetchSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the modified test file, verify the 3 new tests fail**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts.test.ts 2>&1 | tail -20`
Expected: 3 new tests FAIL with "Cannot read properties of undefined (reading 'open')" or "caches is not defined" — confirming speak() does not yet use the cache.

- [ ] **Step 3: Wire `speak()` to cache in `lib/tts.ts`**

At the top of `lib/tts.ts`, add import:

```ts
import { getCachedTts, putCachedTts } from './tts-cache';
```

Replace lines 78-91 (the bare `let res: Response; ... if (!res.ok) { throw ... } const blob = await res.blob();` block) with:

```ts
    let blob: Blob | null = await getCachedTts(voice, batch);
    if (!blob) {
      let res: Response;
      try {
        res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: batch, voice }),
        });
      } catch (e) {
        throw new Error(`TTS network error: ${(e as Error).message}`);
      }
      if (!res.ok) {
        throw new Error(`TTS failed: HTTP ${res.status}`);
      }
      blob = await res.blob();
      // Best-effort cache write — quota / private-mode failures don't break playback.
      await putCachedTts(voice, batch, blob);
    }
    const url = URL.createObjectURL(blob);
```

The line `const url = URL.createObjectURL(blob);` was previously at line 92 — DELETE it from there since it's now produced from the (possibly cached) blob.

- [ ] **Step 4: Run test, verify all pass**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts.test.ts 2>&1 | tail -5`
Expected: all tts tests pass (existing + 3 new).

- [ ] **Step 5: Verify worksheet + tts-cache tests still pass**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/lib/tts.test.ts tests/unit/lib/tts-cache.test.ts tests/unit/components/sutra/ 2>&1 | tail -8`
Expected: all green (tts.test.ts + tts-cache.test.ts + SutraAudioPlayer still passes — it uses different code path).

- [ ] **Step 6: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter" && git add lib/tts.ts tests/unit/lib/tts.test.ts && git commit -m "feat(tts): wire speak() to Cache API via lib/tts-cache (avoid re-fetch)"
```

---

## Task 3: List-page prefetch in `DictionaryCharGridClient`

**Files:**
- Modify: `components/dictionary/DictionaryCharGridClient.tsx` (add useEffect)
- No test (pure UI hook; manual smoke only)

**Interfaces:**
- Consumes: `prefetchTts(voice, text)` from `@/lib/tts-cache` (Task 1)
- Const: `LIST_PREFETCH_CAP = 24` (per spec §C)

- [ ] **Step 1: Read `components/dictionary/DictionaryCharGridClient.tsx` (already done in plan phase)**

The current component is a server-rendered client component. Has `chars` prop. No `useEffect` yet.

- [ ] **Step 2: Add `useEffect` import**

At the top of `DictionaryCharGridClient.tsx`, change:

```ts
import { useState } from 'react';
```

to:

```ts
import { useEffect, useState } from 'react';
```

Add a new import after the existing `useToastStore` line:

```ts
import { prefetchTts } from '@/lib/tts-cache';

const LIST_PREFETCH_CAP = 24;
```

- [ ] **Step 3: Add the prefetch effect inside the component**

Insert this block **after** the `const handleAdd = ...` definition and **before** the `if (chars.length === 0)` early-return:

```tsx
  // Idle-callback prefetch: warm cache for the first LIST_PREFETCH_CAP chars
  // so click-to-play is instant. Skips chars already cached (prefetchTts no-ops).
  // requestIdleCallback keeps it off the main thread; falls back to setTimeout.
  useEffect(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    const cic = (window as unknown as { cancelIdleCallback?: (handle: number) => void })
      .cancelIdleCallback;

    const schedule = (cb: () => void): number | undefined =>
      ric ? ric(cb, { timeout: 2500 }) : (setTimeout(cb, 250) as unknown as number);
    const cancel = (handle: number | undefined): void => {
      if (handle === undefined) return;
      if (cic) cic(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    };

    const targets = chars
      .slice(0, LIST_PREFETCH_CAP)
      .map((c) => c.char)
      .filter((t) => t.length > 0);

    const handles = targets.map((text) =>
      schedule(() => {
        prefetchTts('female', text).catch(() => {});
      }),
    );

    return () => {
      handles.forEach(cancel);
    };
  }, [chars]);
```

The `prefetchTts('female', text)` call uses voice='female' per Global Constraint (only female char audios are prefetched; male is rare). If user wants male too later, can be parameterized via a prop.

- [ ] **Step 4: Run tsc to verify no type errors**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -10`
Expected: clean (no output).

- [ ] **Step 5: Verify dev server doesn't blow up on the dictionary page**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4444/dictionary" 2>&1`
Expected: `200`.

- [ ] **Step 6: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter" && git add components/dictionary/DictionaryCharGridClient.tsx && git commit -m "feat(dictionary): prefetch first 24 char audios on list page mount"
```

---

## Task 4: Detail-page prefetch (auto) + manual button (new component)

**Files:**
- Create: `components/dictionary/DetailPrefetchButton.tsx`
- Modify: `components/dictionary/DictionaryDetailTabs.tsx` (import + render button + auto-prefetch effect)
- Create: `tests/unit/components/dictionary/DetailPrefetchButton.test.tsx`

**Interfaces:**
- Consumes: `prefetchTts(voice, text)` (Task 1), `useToastStore` (existing pattern)
- Props: `{ relatedChars: string[]; cap?: number }` (button shows count; prefetches up to `cap`, default 20)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/dictionary/DetailPrefetchButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DetailPrefetchButton } from '@/components/dictionary/DetailPrefetchButton';

vi.mock('@/lib/tts-cache', () => ({
  prefetchTts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/toast-store', () => ({
  useToastStore: (sel: (s: { push: (k: string, m: string) => void }) => unknown) =>
    sel({ push: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DetailPrefetchButton', () => {
  it('renders a button with the related count', () => {
    render(<DetailPrefetchButton relatedChars={['女', '好', '学']} />);
    expect(screen.getByRole('button', { name: /预取同部首 \(3\)/ })).toBeInTheDocument();
  });

  it('clicking the button calls prefetchTts for each char (in order)', async () => {
    const tts = await import('@/lib/tts-cache');
    render(<DetailPrefetchButton relatedChars={['女', '好']} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(tts.prefetchTts).toHaveBeenCalledTimes(2);
    });
    expect(tts.prefetchTts).toHaveBeenNthCalledWith(1, 'female', '女');
    expect(tts.prefetchTts).toHaveBeenNthCalledWith(2, 'female', '好');
  });

  it('disables the button when relatedChars is empty', () => {
    render(<DetailPrefetchButton relatedChars={[]} />);
    const btn = screen.getByRole('button', { name: /预取同部首 \(0\)/ });
    expect(btn).toBeDisabled();
  });

  it('respects the cap prop (does not prefetch more than cap chars)', async () => {
    const tts = await import('@/lib/tts-cache');
    render(<DetailPrefetchButton relatedChars={['a', 'b', 'c', 'd', 'e']} cap={2} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(tts.prefetchTts).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/components/dictionary/DetailPrefetchButton.test.tsx 2>&1 | tail -10`
Expected: FAIL — `DetailPrefetchButton` is not exported from `@/components/dictionary/DetailPrefetchButton`.

- [ ] **Step 3: Create the component**

Create `components/dictionary/DetailPrefetchButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { prefetchTts } from '@/lib/tts-cache';
import { useToastStore } from '@/lib/toast-store';

interface Props {
  relatedChars: string[];
  cap?: number;
}

export function DetailPrefetchButton({ relatedChars, cap = 20 }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (relatedChars.length === 0) return;
    setLoading(true);
    const targets = relatedChars.slice(0, cap);
    let done = 0;
    for (const text of targets) {
      await prefetchTts('female', text).catch(() => {});
      done++;
    }
    setLoading(false);
    pushToast('success', `已预取 ${done} 个字的读音`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || relatedChars.length === 0}
      className="rounded border border-ink/30 px-3 py-1 text-sm hover:bg-paper-deep disabled:opacity-50"
    >
      {loading ? '预取中…' : `预取同部首 (${relatedChars.length})`}
    </button>
  );
}
```

- [ ] **Step 4: Run test, verify all pass**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/components/dictionary/DetailPrefetchButton.test.tsx 2>&1 | tail -5`
Expected: 4 tests pass.

- [ ] **Step 5: Wire button + auto-prefetch into `DictionaryDetailTabs.tsx`**

Read current `DictionaryDetailTabs.tsx` (already done — CharWithRelated has `relatedByRadical: Char[]`).

Apply these changes to `components/dictionary/DictionaryDetailTabs.tsx`:

**Change 1 — convert to client component**. Add `'use client';` at the top. Add `useEffect` import:

```ts
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { CharWithRelated } from '@/lib/chars-types';
import { StrokeOrderCard } from './StrokeOrderCard';
import { DictionaryDetailAddToWorksheet } from './DictionaryDetailAddToWorksheet';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { DetailPrefetchButton } from './DetailPrefetchButton';
import { prefetchTts } from '@/lib/tts-cache';
```

**Change 2 — add auto-prefetch effect**. Insert this block inside the component, right after the `return (` line's component body — actually BEFORE the return. Add right after `export function DictionaryDetailTabs({ char }: { char: CharWithRelated }) {`:

```tsx
  // Auto-prefetch audios for the first 6 chars sharing the radical. Skips
  // cached entries (prefetchTts no-ops). Cancelled on unmount.
  useEffect(() => {
    const targets = char.relatedByRadical.slice(0, 6).map((c) => c.char);
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void })
      .cancelIdleCallback;
    const schedule = (cb: () => void): number | undefined =>
      ric ? ric(cb, { timeout: 2500 }) : (setTimeout(cb, 250) as unknown as number);
    const cancel = (handle: number | undefined): void => {
      if (handle === undefined) return;
      if (cic) cic(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    };
    const handles = targets.map((text) =>
      schedule(() => { prefetchTts('female', text).catch(() => {}); }),
    );
    return () => handles.forEach(cancel);
  }, [char.relatedByRadical]);
```

**Change 3 — render the manual button** inside the existing `<span className="ml-auto flex items-center gap-2 pb-1">` block, BEFORE the two `<ReadAloudButton>` elements:

```tsx
          <DetailPrefetchButton relatedChars={char.relatedByRadical.map((c) => c.char)} cap={20} />
```

If `char.relatedByRadical` is empty, the button is disabled (handled inside the component).

- [ ] **Step 6: Run tsc + detail-page dev verify**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4444/dictionary/你" 2>&1`
Expected: `200`.

- [ ] **Step 7: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter" && git add components/dictionary/DetailPrefetchButton.tsx components/dictionary/DictionaryDetailTabs.tsx tests/unit/components/dictionary/DetailPrefetchButton.test.tsx && git commit -m "feat(dictionary): detail-page auto-prefetch + manual 预取同部首 button"
```

---

## Task 5: Admin endpoint + admin page card

**Files:**
- Create: `app/api/admin/tts-cache/route.ts` (GET + DELETE)
- Create: `tests/unit/api/admin/tts-cache.test.ts`
- Modify: `app/admin/settings/audio/page.tsx` (add a TTS cache card)

**Interfaces:**
- Consumes: `getTtsCacheSize`, `clearTtsCache` (Task 1)
- `GET /api/admin/tts-cache` → `{ ok: true, data: { count: number; bytes: number } }`
- `DELETE /api/admin/tts-cache` → `{ ok: true }`
- 403 if not admin (existing auth pattern)

- [ ] **Step 1: Read `app/admin/settings/audio/page.tsx` and the existing admin route pattern**

Read `app/admin/settings/audio/page.tsx`. Identify the existing card layout (likely `card-paper`).

Read one existing admin route (e.g., `app/api/admin/audio/route.ts`) to confirm:
- Cookie name: `pinyin_session`
- `verifySession` import
- `session.isAdmin` check

- [ ] **Step 2: Write the failing test**

Create `tests/unit/api/admin/tts-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    get: (name: string) => cookieStore.has(name)
      ? { name, value: cookieStore.get(name)! }
      : undefined,
  }),
}));

vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(async (token: string) => {
    if (token === 'admin-token') return { userId: 1, isAdmin: true };
    if (token === 'user-token') return { userId: 2, isAdmin: false };
    return null;
  }),
  SESSION_COOKIE_NAME: 'pinyin_session',
}));

vi.mock('@/lib/tts-cache', () => ({
  getTtsCacheSize: vi.fn(async () => ({ count: 7, bytes: 12345 })),
  clearTtsCache: vi.fn(async () => {}),
}));

import { GET, DELETE } from '@/app/api/admin/tts-cache/route';

beforeEach(() => {
  cookieStore.clear();
  vi.clearAllMocks();
});

function makeReq(): Request {
  return new Request('http://localhost/api/admin/tts-cache', { method: 'GET' });
}

describe('admin tts-cache route', () => {
  it('GET without session → 403', async () => {
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('GET with non-admin session → 403', async () => {
    cookieStore.set('pinyin_session', 'user-token');
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('GET with admin session → returns { count, bytes }', async () => {
    cookieStore.set('pinyin_session', 'admin-token');
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { count: 7, bytes: 12345 } });
  });

  it('DELETE without session → 403', async () => {
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('DELETE with admin session → clears cache + returns ok', async () => {
    cookieStore.set('pinyin_session', 'admin-token');
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    const ttsCache = await import('@/lib/tts-cache');
    expect(ttsCache.clearTtsCache).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/api/admin/tts-cache.test.ts 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '@/app/api/admin/tts-cache/route'`.

- [ ] **Step 4: Create the route handler**

Create `app/api/admin/tts-cache/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getTtsCacheSize, clearTtsCache } from '@/lib/tts-cache';

export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.isAdmin) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const size = await getTtsCacheSize();
  return NextResponse.json({ ok: true, data: size });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  await clearTtsCache();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test, verify all pass**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/api/admin/tts-cache.test.ts 2>&1 | tail -5`
Expected: 5 tests pass.

- [ ] **Step 6: Add the TTS cache card to `app/admin/settings/audio/page.tsx`**

Read current `app/admin/settings/audio/page.tsx`. The page is a server component (per existing audio plan).

Convert the page so it can host a client-side card. If it's already a server component, leave it that way and add a `<TtsCacheCard />` client component as a child.

Create `app/admin/settings/audio/TtsCacheCard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function TtsCacheCard() {
  const [count, setCount] = useState<number | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const res = await fetch('/api/admin/tts-cache');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setCount(body.data.count);
      setBytes(body.data.bytes);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleClear() {
    if (!confirm('确认清除全部 TTS 音频缓存？下次播放将重新合成。')) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/tts-cache', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-paper p-4 mt-4">
      <h2 className="text-sm font-semibold text-ink mb-2">TTS 音频缓存</h2>
      <p className="text-xs text-ink-soft mb-3">
        客户端缓存 (Cache API · tts-v1)。每个用户的缓存相互独立，仅统计当前浏览器。
      </p>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {count === null ? (
        <p className="text-xs text-ink-faint">加载中…</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-ink">
            <span className="font-medium">{count}</span> 条 · <span className="font-medium">{formatBytes(bytes ?? 0)}</span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="rounded border border-seal text-seal px-3 py-1 text-sm hover:bg-seal/10 disabled:opacity-50"
          >
            {busy ? '清除中…' : '清除缓存'}
          </button>
        </div>
      )}
    </div>
  );
}
```

Modify `app/admin/settings/audio/page.tsx`: add the import at the top and render `<TtsCacheCard />` somewhere inside the existing layout (after the existing audio settings card). Exact placement depends on the current page structure — place it as the last child element of the main container.

- [ ] **Step 7: Run tsc + dev verify**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -10`
Expected: clean.

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4444/admin/settings/audio" 2>&1`
Expected: `200` or `302` (redirect to login if not admin).

- [ ] **Step 8: Commit**

```bash
cd "E:/ToolDevelop/PinYinCharacter" && git add app/api/admin/tts-cache/route.ts app/admin/settings/audio/page.tsx app/admin/settings/audio/TtsCacheCard.tsx tests/unit/api/admin/tts-cache.test.ts && git commit -m "feat(admin): TTS cache GET/DELETE endpoint + /admin/settings/audio card"
```

---

## Final Verification (after all 5 tasks complete)

- [ ] **Step 1: Full regression**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/vitest run tests/unit/ 2>&1 | tail -8`
Expected: all green (existing + new tests; 2 pre-existing DATABASE_URL integration fails still skipped).

- [ ] **Step 2: TypeScript clean**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Next.js build**

Per memory `dev-build-cache-stomp`: dev server is alive on port 4444. Do NOT run `npx next build` while dev is running (corrupts .next/). Skip this step in dev mode, run only on a fresh terminal after stopping dev. If dev is stopped: `cd "E:/ToolDevelop/PinYinCharacter" && npx next build 2>&1 | tail -10` → exit 0, all routes preserved.

- [ ] **Step 4: Manual smoke**

- Open `/dictionary/你`, click ReadAloud → audio plays (cache miss)
- Click ReadAloud again → instant (cache hit)
- Open DevTools → Application → Cache Storage → `tts-v1` → entries present
- Open `/dictionary` list → DevTools Network shows `/api/tts` requests for first ~24 chars (idle-time prefetch)
- Login as admin, open `/admin/settings/audio` → see TTS cache card with count → click 清除 → count drops to 0

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| `speak()` uses Cache API | Task 2 |
| `speak()` returns blob from cache on hit | Task 2 |
| `speak()` writes to cache on miss | Task 2 |
| `prefetchTts(voice, text)` helper | Task 1 |
| `clearTtsCache()` helper | Task 1 |
| `getTtsCacheSize()` helper | Task 1 |
| Dictionary list page prefetch (cap 24) | Task 3 |
| Dictionary detail auto-prefetch (first 6 relatedByRadical) | Task 4 |
| Dictionary detail manual button (cap 20) | Task 4 |
| `GET /api/admin/tts-cache` | Task 5 |
| `DELETE /api/admin/tts-cache` | Task 5 |
| `/admin/settings/audio` cache card | Task 5 |
| Tests for cache roundtrip | Task 1 |
| Tests for `speak()` cache integration | Task 2 |
| Tests for DetailPrefetchButton | Task 4 |
| Tests for admin route | Task 5 |
| Manual smoke verification | Final |

All 16 requirements covered. No gaps.