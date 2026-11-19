import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CharInfo } from '@/lib/chain-types';

describe('fetchChainChars', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset module cache by re-importing
    vi.resetModules();
  });

  it('fetches and caches the chars list', async () => {
    // 2026-07-05 (Task 12 I2): fetchChainChars now returns
    // { chars, hskFallback } envelope so ChainGame can render
    // <FallbackBanner />. Legacy bare-array responses are still
    // accepted (backward-compat) — hskFallback defaults to false.
    const sample: CharInfo[] = [{ char: '安', pinyin: 'ān', meaning: '', radical: '宀', tone: 1 }];
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as Response);

    const { fetchChainChars: fresh } = await import('@/lib/api-chain');
    const result = await fresh();
    expect(result.chars).toEqual(sample);
    expect(result.hskFallback).toBe(false);
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

  it('cache key changes when hskLevel differs', async () => {
    // @vitest-environment happy-dom
    // Mock fetch BEFORE first call so happy-dom doesn't try real network.
    // Brief §6.2 assumes fetch is already mocked; we install a stub here.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [],
    });
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

  it('surfaces hskFallback from new envelope shape (Task 12 I2)', async () => {
    // 2026-07-05 (Task 12 I2): when /api/chain/chars returns
    // { chars, hskFallback: true }, fetchChainChars forwards hskFallback
    // so ChainGame can render <FallbackBanner />.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ chars: [], hskFallback: true }),
    });
    const { fetchChainChars } = await import('@/lib/api-chain');
    const result = await fetchChainChars('chars-level-1-2', 5);
    expect(result.chars).toEqual([]);
    expect(result.hskFallback).toBe(true);
  });

  /**
   * A failed fetch must not be cached.
   *
   * `cache` holds the fetch PROMISE, and a rejection is a value like any
   * other — so one network blip used to make the key fail for the life of
   * the tab. 重试 could not work: the retry re-read the same rejected
   * promise.
   */
  it('does not cache a rejected fetch', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('the network is down');
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ chars: [{ char: '好', pinyin: 'hǎo' }], hskFallback: false }),
      };
    });
    const { fetchChainChars, __resetChainCache } = await import('@/lib/api-chain');
    __resetChainCache();

    await expect(fetchChainChars('chars-level-1', 1)).rejects.toThrow(/network/);
    // The retry must issue a REAL request, not read the rejected promise.
    const retried = await fetchChainChars('chars-level-1', 1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(retried.chars[0].char).toBe('好');
  });

  it('surfaces a failed pool from the envelope', async () => {
    // The route answers HTTP 200 with `failed: true` when its query threw.
    // That is not a thin tier, and the client has to be able to tell.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ chars: [], hskFallback: true, failed: true }),
    });
    const { fetchChainChars, __resetChainCache } = await import('@/lib/api-chain');
    __resetChainCache();
    const result = await fetchChainChars('chars-level-1', 2);
    expect(result.failed).toBe(true);
  });

  it('reports a successful pool as not failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ chars: [], hskFallback: false, failed: false }),
    });
    const { fetchChainChars, __resetChainCache } = await import('@/lib/api-chain');
    __resetChainCache();
    const result = await fetchChainChars('chars-level-1', 3);
    expect(result.failed).toBe(false);
  });

  it('treats a legacy bare array as not failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [{ char: '安', pinyin: 'ān', meaning: '', radical: '宀', tone: 1 }],
    });
    const { fetchChainChars, __resetChainCache } = await import('@/lib/api-chain');
    __resetChainCache();
    const result = await fetchChainChars('chars-level-1', 4);
    expect(result.failed).toBe(false);
  });
});
