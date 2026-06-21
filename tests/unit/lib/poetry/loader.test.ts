import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('loadManifest', () => {
  it('reads manifest once and caches subsequent calls', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 1, updatedAt: '2026-06-21', count: 1,
      items: [{ id: 1, title: 'A', author: 'X', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 }] }));
    const { loadManifest, invalidateManifestCache } = await import('@/lib/poetry/loader');
    invalidateManifestCache();
    const a = await loadManifest();
    const b = await loadManifest();
    expect(a).toBe(b);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('throws helpful error when manifest missing', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { loadManifest, invalidateManifestCache } = await import('@/lib/poetry/loader');
    invalidateManifestCache();
    await expect(loadManifest()).rejects.toThrow(/manifest/i);
  });
});

describe('loadPoem', () => {
  it('returns null on ENOENT', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { loadPoem } = await import('@/lib/poetry/loader');
    expect(await loadPoem(99999)).toBeNull();
  });

  it('returns parsed PoemDetail on success', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      id: 1, title: '静夜思', author: '李白', dynasty: '唐', category: 'tang', form: '五绝',
      content: ['床前明月光，'], pinyin: [['chuáng']], appreciation: null, source: 's',
    }));
    const { loadPoem } = await import('@/lib/poetry/loader');
    const p = await loadPoem(1);
    expect(p).toMatchObject({ id: 1, title: '静夜思', form: '五绝' });
  });
});
