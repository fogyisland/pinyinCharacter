import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getPoem, getRandomPoem, listPoems, buildSearchWhere } from '@/lib/poetry';

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

describe('getPoem', () => {
  it('returns null when no row', async () => {
    fakePool.execute.mockResolvedValueOnce([[]]);
    const r = await getPoem(999);
    expect(r).toBeNull();
  });

  it('parses JSON content + pinyin', async () => {
    fakePool.execute.mockResolvedValueOnce([
      [{
        id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句',
        content: JSON.stringify(['床前明月光', '疑是地上霜']),
        pinyin: JSON.stringify([['chuáng', 'qián'], ['yí', 'shì']]),
        appreciation: '好诗',
      }],
    ]);
    const r = await getPoem(1);
    expect(r).toEqual({
      id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句',
      content: ['床前明月光', '疑是地上霜'],
      pinyin: [['chuáng', 'qián'], ['yí', 'shì']],
      appreciation: '好诗',
    });
  });
});

describe('getRandomPoem', () => {
  it('returns null when empty', async () => {
    fakePool.query.mockResolvedValueOnce([[]]);
    const r = await getRandomPoem();
    expect(r).toBeNull();
  });

  it('returns a parsed poem', async () => {
    fakePool.query.mockResolvedValueOnce([
      [{
        id: 5, title: '春晓', author: '孟浩然', dynasty: 'tang', form: '五言绝句',
        content: JSON.stringify(['春眠不觉晓']),
        pinyin: JSON.stringify([['chūn', 'mián']]),
        appreciation: null,
      }],
    ]);
    const r = await getRandomPoem();
    expect(r?.id).toBe(5);
    expect(r?.appreciation).toBeNull();
  });
});
