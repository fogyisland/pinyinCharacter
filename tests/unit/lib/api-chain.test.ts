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
});