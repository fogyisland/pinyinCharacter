# TTS Pronunciation Cache — Design Spec

**Date:** 2026-07-02
**Status:** Approved, awaiting spec self-review
**Origin:** User feedback "字典中字的读音会缓存到本地，避免重复申请，这样也加速了播放的速度"

## Context

The app currently hits `/api/tts` on every pronunciation click via `lib/tts.ts:speak()`. Edge TTS takes 3-6s per batch — re-clicking the same char means re-synthesizing the same MP3, wasting time + Edge TTS quota.

A Cache API–based layer already exists (`lib/tts-cache.ts`) and is used by `SutraAudioPlayer` for sutra full-recitation. Single-char pronunciation (`speak()` → 8+ UI call sites: dictionary detail, pinyin page, rare char, etymology, poetry, sutra, stories) does NOT use it.

This spec wires `speak()` to the existing cache, adds opportunistic prefetch on dictionary pages, and surfaces admin-only cache management.

## Goal

1. `speak()` returns from local Cache API on second+ play of the same `(voice, text)` — sub-100ms vs 3-6s.
2. Dictionary list and detail pages opportunistically prefetch audio for visible / related chars while idle.
3. Admins can inspect and clear the cache from `/admin/settings/audio`.

## Non-Goals (YAGNI)

- Service Worker / true offline mode (Cache API persistence is enough)
- Per-char manual eviction (bumping cache name wipes atomically)
- Per-user cache size display in `/profile` (admin only per user choice)
- IndexedDB migration (Cache API handles hundreds of MB fine)
- Server-side audio caching (char audio is small; client cache is sufficient)
- New prefetch libraries (requestIdleCallback + setTimeout fallback only)

## Architecture

### Existing infrastructure (90% already in place)

- `lib/tts-cache.ts` — `getCachedTts(voice, text)`, `putCachedTts(voice, text, blob)`, `CACHE_NAME = 'tts-v1'`, key = `SHA-256("${voice}|${text}")`. Best-effort, no-op if `caches` unavailable.
- `app/api/tts/route.ts` — POST `{text, voice}` → audio/mpeg. No rate limit. Cache-Control: no-store (HTTP, doesn't affect Cache API).
- `SutraAudioPlayer.tsx:85-99` — already implements the cache → fetch → cache pattern for batches. Reference implementation.

### New code (4 touchpoints)

```
lib/tts.ts                                        # wire speak() to cache (Task 1)
lib/tts-cache.ts                                  # add prefetch/clear/size helpers (Task 2)
components/dictionary/DictionaryCharGridClient.tsx # list-page prefetch on mount (Task 3)
components/dictionary/DictionaryDetailTabs.tsx    # detail-page sibling prefetch + manual button (Task 4)
app/api/admin/tts-cache/route.ts                  # admin GET/DELETE endpoint (Task 5)
app/admin/settings/audio/page.tsx                 # extend with TTS cache card (Task 5)
```

## File-by-File Specification

### 1. `lib/tts.ts` — wire cache

**Change**: in `speak()`, replace the bare `fetch('/api/tts')` block (lines 80-91) with the 14-line pattern from `SutraAudioPlayer.tsx:85-99`:

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
  await putCachedTts(voice, batch, blob);  // best-effort
}
const url = URL.createObjectURL(blob);
// ... rest unchanged
```

The change is purely additive — if cache is unavailable, `getCachedTts` returns null and the original fetch path runs. No new error modes.

**Import to add at top**: `import { getCachedTts, putCachedTts } from './tts-cache';`

### 2. `lib/tts-cache.ts` — add 3 helpers

```ts
// Fire-and-forget prefetch. Doesn't play audio, just warms cache.
// Best-effort: any failure is swallowed.
export async function prefetchTts(voice: string, text: string): Promise<void> {
  if (!isAvailable()) return;
  if (!text || text.length > BATCH_MAX_CHARS) return;
  const cached = await getCachedTts(voice, text);
  if (cached) return;  // already there
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    await putCachedTts(voice, text, blob);
  } catch { /* network / quota errors are non-fatal */ }
}

// Wipe the cache by deleting the named cache.
// Browser LRU handles under-quota pressure; this is for explicit user action.
export async function clearTtsCache(): Promise<void> {
  if (!isAvailable()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch { /* best-effort */ }
}

// Best-effort entry count + estimated size (bytes).
// Iterates the entire cache; may take a few seconds for large caches.
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

`BATCH_MAX_CHARS` is not exported from `lib/tts.ts`; either export it or hardcode `500` in `tts-cache.ts` with a comment referencing the speak() cap. (Hardcode is fine — they're a coupled cap.)

### 3. `components/dictionary/DictionaryCharGridClient.tsx` — list-page prefetch

**Add** after the existing imports:

```tsx
import { prefetchTts } from '@/lib/tts-cache';
import { BATCH_MAX_CHARS } from '@/lib/tts';  // OR hardcode 500

const LIST_PREFETCH_CAP = 24;

useEffect(() => {
  // Idle-callback prefetch; falls back to setTimeout on browsers without rIC.
  const schedule = (cb: () => void) =>
    'requestIdleCallback' in window
      ? (window as any).requestIdleCallback(cb, { timeout: 2500 })
      : setTimeout(cb, 250);

  const targets = chars
    .slice(0, LIST_PREFETCH_CAP)
    .map(c => c.char)
    .filter(t => t.length > 0 && t.length <= BATCH_MAX_CHARS);

  const cancel = targets.map((text, i) =>
    schedule(() => { prefetchTts('female', text).catch(() => {}); })
  );
  return () => cancel.forEach(handle => {
    if ('cancelIdleCallback' in window) (window as any).cancelIdleCallback?.(handle);
    else clearTimeout(handle);
  });
}, [chars]);
```

The prefetch fires once per `chars` array change. `prefetchTts` is no-op for chars already cached, so re-visits are free.

**Why `requestIdleCallback`**: dictionary list pages are content-heavy (50-200 char tiles); idle time prevents jank.

### 4. `components/dictionary/DictionaryDetailTabs.tsx` — detail-page sibling prefetch + button

**Add** a manual button next to the existing ReadAloudButton:

```tsx
// New file: components/dictionary/DetailPrefetchButton.tsx
'use client';
import { useState } from 'react';
import { prefetchTts } from '@/lib/tts-cache';
import { useToastStore } from '@/lib/toast-store';

interface Props {
  relatedChars: string[];  // chars sharing the same radical (capped at 20 by parent)
}

export function DetailPrefetchButton({ relatedChars }: Props) {
  const pushToast = useToastStore(s => s.push);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    let done = 0;
    for (const text of relatedChars) {
      await prefetchTts('female', text).catch(() => {});
      done++;
    }
    setLoading(false);
    pushToast('success', `已预取 ${done} 个字的读音`);
  }

  return (
    <button type="button" onClick={handleClick} disabled={loading || relatedChars.length === 0}
      className="rounded border border-ink/30 px-3 py-1 text-sm hover:bg-paper-deep disabled:opacity-50">
      {loading ? '预取中…' : `预取同部首 (${relatedChars.length})`}
    </button>
  );
}
```

**Sibling prefetch (auto)**: in `DictionaryDetailTabs`, after the main detail loads, schedule `prefetchTts('female', char)` for the first 6 chars in `relatedChars`. Same `requestIdleCallback` pattern as list page.

**Related chars source**: parent (the detail page server component or a new API endpoint `/api/dictionary/[char]/related`) returns up to 20 chars sharing the radical. If the API doesn't exist yet, scope this to **manual button only** and skip auto-sibling prefetch — see Risks #1.

### 5. `app/api/admin/tts-cache/route.ts` (NEW) + admin page extension

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifySession } from '@/lib/auth';
import { getTtsCacheSize, clearTtsCache } from '@/lib/tts-cache';

export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('pinyin_session')?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.isAdmin) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  const size = await getTtsCacheSize();
  return NextResponse.json({ ok: true, data: size });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  await clearTtsCache();
  return NextResponse.json({ ok: true });
}
```

**Extend `app/admin/settings/audio/page.tsx`**: add a card "TTS 音频缓存" with `{ count, mb }` display + "清除缓存" button calling DELETE. Show loading spinner during fetch; show "已清除" toast on success.

The `getTtsCacheSize()` may be slow for large caches — wrap in 5s timeout via `AbortController` + `Promise.race` to prevent the admin UI from hanging.

## Cache Lifecycle

- **Miss path**: `speak()` → `getCachedTts` returns null → fetch `/api/tts` → `putCachedTts` → play
- **Hit path**: `speak()` → `getCachedTts` returns blob → `URL.createObjectURL(blob)` → play (no network)
- **Prefetch path**: `useEffect` schedules idle callback → `prefetchTts` checks cache → if miss, fetch + store
- **Clear path**: admin DELETE → `caches.delete('tts-v1')` → next access is miss, repopulates

## Cache Key + Format Strategy

- **Key**: `SHA-256("${voice}|${text}")` — matches existing implementation
- **Audio format**: NOT in key. Site-wide `/admin/tts` `audio_format` change is naturally handled: next fetch stores new format, replaces old entry on subsequent overwrite.
- **No TTL**: Cache API uses browser LRU under quota pressure. No explicit eviction code.
- **Cache version bump**: change `CACHE_NAME = 'tts-v1'` to `'tts-v2'` to wipe atomically. Used only when forced (e.g., schema change). Current spec doesn't require this.

## Error Handling

- `caches` unavailable (SSR, jsdom, old browsers): `isAvailable()` returns false → all helpers no-op
- `fetch /api/tts` fails: throw from `speak()` (existing behavior); prefetch swallows
- `putCachedTts` quota exceeded: existing code swallows (best-effort)
- Admin endpoint: 403 if not admin, 200 + size on GET, 200 on DELETE
- `getTtsCacheSize` slow: 5s timeout in admin page UI

## Testing Strategy

### Unit tests

**`tests/unit/lib/tts.test.ts`** (modify existing):
- Mock `global.caches` with an in-memory Map-backed implementation
- Verify `speak()` calls `getCachedTts` before fetch
- Verify `speak()` calls `putCachedTts` after fetch
- Verify cached playback doesn't call fetch
- Verify non-cached playback still works (regression — don't break current tests)

**`tests/unit/lib/tts-cache.test.ts`** (NEW, ~80 lines):
- `getCachedTts` returns null when cache empty / unavailable
- `putCachedTts` roundtrip with `getCachedTts`
- `prefetchTts` calls fetch on miss, no-ops on hit
- `prefetchTts` swallows fetch errors
- `clearTtsCache` deletes the named cache
- `getTtsCacheSize` returns count + bytes

**`tests/unit/api/admin/tts-cache.test.ts`** (NEW, ~60 lines):
- GET without auth → 403
- GET with admin → returns size
- DELETE without auth → 403
- DELETE with admin → clears cache

### Integration smoke (manual, post-deploy)

- Open `/dictionary/你`, click ReadAloud → audio plays (cache miss, fetch fires)
- Click ReadAloud again → audio plays INSTANTLY (cache hit, no network)
- Open DevTools → Application → Cache Storage → `tts-v1` → see entries
- Open `/dict` with 50+ chars → DevTools Network shows prefetch requests for first 24 chars (idle-time)
- Open `/admin/settings/audio` → see TTS cache card with count → click 清除 → count drops to 0

## Risks

1. **No `/api/dictionary/[char]/related` exists today**. If the API is missing at implementation time, Task 4 auto-sibling prefetch must be skipped — only the manual button ships (with `relatedChars` empty array → button disabled).
2. **Cache API quota ≈ 6% of disk**. Heavy users (1000+ char dictionary browsing) may accumulate 50-100MB. List prefetch cap (24 chars × ~10KB each ≈ 240KB) keeps this bounded.
3. **Private/incognito mode**: `caches` may be ephemeral. `isAvailable()` already returns false in some private modes, falling back to fetch-every-time. Acceptable degradation.
4. **audio_format site config change mid-cache**: not invalidated. Next fetch stores new format; old entries overwrite naturally on key match. Acceptable.
5. **SutraAudioPlayer shares `tts-v1`**: char audio (text='女') and sutra batch (text='女 色 声 香 味 触 法 500chars...') have different keys, no collision. Both groups benefit from same cache.
6. **happy-dom doesn't implement `caches`**: must mock `global.caches` in `tts.test.ts`. Test must run in jsdom-like env where Cache API isn't real.

## Open Questions for Implementation Phase

- Do we need to export `BATCH_MAX_CHARS` from `lib/tts.ts`? Or hardcode `500` in `tts-cache.ts`? (Decision: hardcode + comment, since they're coupled.)
- Auto-sibling prefetch in detail page: ship or defer? (Decision: defer if `/api/dictionary/[char]/related` doesn't exist; ship if it does or if implementation creates it.)
- Should `prefetchTts` use the same batching logic as `speak()` (split on `\n`, cap at 500 chars)? (Decision: NO — prefetch is for single chars only; long inputs go through `speak()` directly.)