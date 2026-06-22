import { describe, it, expect, vi } from 'vitest';

const mockManifest = {
  version: 1 as const,
  updatedAt: '2026-06-21',
  count: 3,
  items: [
    { id: 1, title: '静夜思', author: '李白', dynasty: 'tang', category: 'tang', form: '五绝', contentLineCount: 4 },
    { id: 2, title: '登鹳雀楼', author: '王之涣', dynasty: 'tang', category: 'tang', form: '五绝', contentLineCount: 4 },
    { id: 3, title: '春晓', author: '孟浩然', dynasty: 'tang', category: 'tang', form: '五绝', contentLineCount: 4 },
  ],
};

const mockLoadManifest = vi.fn().mockResolvedValue(mockManifest);
const mockLoadPoem = vi.fn();
vi.mock('@/lib/poetry/loader', () => ({
  loadManifest: () => mockLoadManifest(),
  loadPoem: (id: number) => mockLoadPoem(id),
  invalidateManifestCache: vi.fn(),
}));

describe('listPoems', () => {
  it('filters by dynasty and paginates', async () => {
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', page: 1, pageSize: 2 });
    expect(r.total).toBe(3);
    expect(r.items).toHaveLength(2);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(2);
  });

  it('filters by form', async () => {
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', form: '五绝' });
    expect(r.total).toBe(3);
    expect(r.items.map(i => i.id)).toEqual([1, 2, 3]);
  });

  it('returns empty for form with no matches', async () => {
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', form: '七律' });
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
  });

  it('searches title/author/first-char for q', async () => {
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', q: '李白' });
    expect(r.total).toBe(1);
    expect(r.items[0].title).toBe('静夜思');
  });

  it('clamps page and pageSize', async () => {
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', page: 0, pageSize: 99999 });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBeLessThanOrEqual(100);
  });
});

describe('getPoem', () => {
  it('loads via loader', async () => {
    mockLoadPoem.mockResolvedValueOnce({ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五绝', content: ['床前明月光，'], pinyin: [], appreciation: null });
    const { getPoem } = await import('@/lib/poetry/queries');
    const p = await getPoem(1);
    expect(p?.title).toBe('静夜思');
    expect(mockLoadPoem).toHaveBeenCalledWith(1);
  });
});

describe('getRandomPoem', () => {
  it('returns one item matching filters', async () => {
    mockLoadPoem.mockResolvedValue({ id: 1, title: 'A', author: 'X', dynasty: 'tang', form: '五绝',
      content: ['a'], pinyin: [['a']], appreciation: null });
    const { getRandomPoem } = await import('@/lib/poetry/queries');
    const p = await getRandomPoem({ dynasty: 'tang' });
    expect(p).not.toBeNull();
    expect(p?.dynasty).toBe('tang');
  });
});

describe('listForms', () => {
  it('aggregates form counts descending', async () => {
    const { listForms } = await import('@/lib/poetry/queries');
    const r = await listForms();
    expect(r).toEqual([{ form: '五绝', count: 3 }]);
  });
});

describe('listDynasties', () => {
  it('returns distinct dynasties', async () => {
    const { listDynasties } = await import('@/lib/poetry/queries');
    const r = await listDynasties();
    expect(r).toEqual(['tang']);
  });
});

describe('getAvailableForms', () => {
  it('returns SHI_FORMS for 诗类 categories (tang, 汉乐府, 古诗十九首, 魏, 骈文)', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('tang')).toEqual(expect.arrayContaining(['五绝', '七绝', '五律', '七律', '五言古风', '七言古风', '杂言古风', '乐府']));
    expect(await getAvailableForms('汉乐府')).toEqual(expect.arrayContaining(['五绝', '乐府']));
    expect(await getAvailableForms('骈文')).toEqual(expect.arrayContaining(['五绝']));
  });

  it('returns top N forms from manifest for song', async () => {
    mockLoadManifest.mockResolvedValueOnce({
      version: 1,
      updatedAt: '2026-06-22',
      count: 4,
      items: [
        { id: 1, title: 'a', author: 'x', dynasty: 'song', category: null, form: '水调歌头', contentLineCount: 4 },
        { id: 2, title: 'b', author: 'x', dynasty: 'song', category: null, form: '水调歌头', contentLineCount: 4 },
        { id: 3, title: 'c', author: 'x', dynasty: 'song', category: null, form: '浣溪沙', contentLineCount: 4 },
        { id: 4, title: 'd', author: 'x', dynasty: 'song', category: null, form: null, contentLineCount: 4 },
      ],
    });
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    const forms = await getAvailableForms('song');
    expect(forms).toContain('水调歌头');
    expect(forms).toContain('浣溪沙');
    expect(forms[0]).toBe('水调歌头');
  });

  it('returns 元曲 fixed forms for yuan', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('yuan')).toEqual(['小令', '套数']);
  });

  it('returns empty for unknown category', async () => {
    const { getAvailableForms } = await import('@/lib/poetry/queries');
    expect(await getAvailableForms('unknown_xyz')).toEqual([]);
  });
});

describe('listPoems with category filter', () => {
  it('filters by category when provided', async () => {
    mockLoadManifest.mockResolvedValueOnce({
      version: 1,
      updatedAt: '2026-06-22',
      count: 4,
      items: [
        { id: 1, dynasty: 'tang', category: null, form: '五绝', title: 'a', author: 'x', contentLineCount: 4 },
        { id: 2, dynasty: 'song', category: null, form: '水调歌头', title: 'b', author: 'x', contentLineCount: 4 },
        { id: 3, dynasty: '汉', category: null, form: '五言古风', title: 'c', author: 'x', contentLineCount: 4 },
        { id: 4, dynasty: 'song', category: null, form: '浣溪沙', title: 'd', author: 'x', contentLineCount: 4 },
      ],
    });
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', category: 'tang' });
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.id).toBe(1);
  });

  it('filters by forms (CSV array)', async () => {
    mockLoadManifest.mockResolvedValueOnce({
      version: 1,
      updatedAt: '2026-06-22',
      count: 4,
      items: [
        { id: 1, dynasty: 'tang', category: null, form: '五绝', title: 'a', author: 'x', contentLineCount: 4 },
        { id: 2, dynasty: 'tang', category: null, form: '七绝', title: 'b', author: 'x', contentLineCount: 4 },
        { id: 3, dynasty: 'tang', category: null, form: '五律', title: 'c', author: 'x', contentLineCount: 4 },
        { id: 4, dynasty: 'tang', category: null, form: '七律', title: 'd', author: 'x', contentLineCount: 4 },
      ],
    });
    const { listPoems } = await import('@/lib/poetry/queries');
    const r = await listPoems({ dynasty: 'tang', forms: ['五绝', '七绝'] });
    expect(r.items.map(i => i.id)).toEqual([1, 2]);
  });
});
