/**
 * The client for the couplets — `lib/api-duiyun.ts`.
 *
 * The important rule: a FAILED envelope is not cached. The game has a retry
 * button, and a cached failure would make the retry button a no-op — the
 * player would press it and read the same error forever.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('fetchDuiyunPairs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('reads the pairs out of the envelope', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          {
            upper: '天',
            lower: '地',
            upperPinyin: ['tiān'],
            lowerPinyin: ['dì'],
            rhyme: '一东',
            book: '笠翁对韵',
          },
        ],
        failed: false,
      }),
    } as Response);

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    const result = await fresh();
    expect(result.pairs.map((p) => p.upper)).toEqual(['天']);
    expect(result.failed).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches a successful answer', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [], failed: false }),
    } as Response);

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    await fresh();
    await fresh();
    await fresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed answer, so a retry really retries', async () => {
    // 这一条钉住「失败的信封不缓存」。缓存了的话，界面的「重试」按钮就是
    // 个摆设 —— 玩家按下去，读到的还是同一个失败。
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [], failed: true }),
    } as Response);

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    const first = await fresh();
    expect(first.failed).toBe(true);
    const second = await fresh();
    expect(second.failed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejected request either', async () => {
    const spy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    await expect(fresh()).rejects.toThrow(/network down/);
    await expect(fresh()).rejects.toThrow(/network down/);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    await expect(fresh()).rejects.toThrow(/failed/);
  });

  it('asks for a different set when the limit changes', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [], failed: false }),
    } as Response);

    const { fetchDuiyunPairs: fresh } = await import('@/lib/api-duiyun');
    await fresh();
    await fresh(5);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0]).toContain('limit=5');
  });
});
