import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { listPoems, buildSearchWhere } from '@/lib/poetry';

const fakePool = {
  query: vi.fn(),
  execute: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (getPool as any).mockReturnValue(fakePool);
});

describe('poetry pure helpers', () => {
  describe('buildSearchWhere', () => {
    it('returns empty for empty query', () => {
      expect(buildSearchWhere('')).toEqual({ where: '', params: [] });
    });

    it('LIKE-matches title, author, or title-first-char with %q%', () => {
      const r = buildSearchWhere('李白');
      expect(r.where).toBe('WHERE (title LIKE ? OR author LIKE ? OR title LIKE ?)');
      expect(r.params).toEqual(['%李白%', '%李白%', '%李%']);
    });

    it('trims whitespace', () => {
      expect(buildSearchWhere('  ')).toEqual({ where: '', params: [] });
    });
  });
});

describe('poetry listPoems', () => {
  it('returns items, total, page, pageSize', async () => {
    fakePool.query.mockResolvedValueOnce([
      [{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }],
    ]);
    fakePool.query.mockResolvedValueOnce([[{ total: 1 }]]);

    const r = await listPoems({ dynasty: 'tang' });

    expect(r).toEqual({
      items: [{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }],
      total: 1,
      page: 1,
      pageSize: 24,
    });
  });

  it('clamps page and pageSize', async () => {
    fakePool.query.mockResolvedValueOnce([[]]);
    fakePool.query.mockResolvedValueOnce([[{ total: 0 }]]);

    const r = await listPoems({ dynasty: 'tang', page: 0, pageSize: 9999 });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(24);
  });
});
