// @vitest-environment happy-dom
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
  private static keyOf(req: Request | string): string {
    const raw = typeof req === 'string' ? req : req.url;
    // happy-dom's new Request('/path').url resolves to 'http://localhost:3000/path'.
    // Strip the origin so synthetic cache keys ('/tts-cache/<hash>') round-trip.
    try {
      const u = new URL(raw, 'http://localhost');
      return u.pathname;
    } catch {
      return raw;
    }
  }
  async match(req: Request | string): Promise<Response | undefined> {
    const url = FakeCache.keyOf(req);
    const blob = this.store.get(url);
    return blob ? new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }) : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const url = FakeCache.keyOf(req);
    this.store.set(url, await res.blob());
  }
  async delete(req: Request | string): Promise<boolean> {
    const url = FakeCache.keyOf(req);
    return this.store.delete(url);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  const fake = new FakeCache();
  Object.defineProperty(globalThis, 'caches', {
    value: {
      open: async () => fake,
      delete: async () => { fake.clear(); return true; },
    },
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