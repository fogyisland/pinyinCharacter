// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockReaddir = vi.fn();
vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, readdir: mockReaddir },
  readFile: mockReadFile, readdir: mockReaddir,
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('checkPoemsManifest', () => {
  it('ok when manifest matches files', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-21', count: 2,
      items: [
        { id: 1, title: 'A', author: 'X', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 },
        { id: 2, title: 'B', author: 'Y', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 },
      ],
    }));
    mockReaddir.mockResolvedValueOnce(['1.json', '2.json', 'poems-manifest.json']);
    const { checkPoemsManifest } = await import('@/scripts/check-poems-manifest');
    const r = await checkPoemsManifest();
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags missing file', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-21', count: 2,
      items: [
        { id: 1, title: 'A', author: 'X', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 },
        { id: 2, title: 'B', author: 'Y', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 },
      ],
    }));
    mockReaddir.mockResolvedValueOnce(['1.json']); // 2.json missing
    const { checkPoemsManifest } = await import('@/scripts/check-poems-manifest');
    const r = await checkPoemsManifest();
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/file for id 2 missing/);
  });

  it('flags orphan file', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-21', count: 1,
      items: [{ id: 1, title: 'A', author: 'X', dynasty: '唐', category: 'tang', form: '五绝', contentLineCount: 4 }],
    }));
    mockReaddir.mockResolvedValueOnce(['1.json', '99.json']); // 99.json not in manifest
    const { checkPoemsManifest } = await import('@/scripts/check-poems-manifest');
    const r = await checkPoemsManifest();
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/orphan file 99\.json/);
  });
});