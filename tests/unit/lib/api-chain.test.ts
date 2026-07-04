import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
