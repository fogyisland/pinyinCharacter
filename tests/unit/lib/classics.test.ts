import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockManifest = {
  version: 1 as const,
  updatedAt: '2026-06-21',
  books: [
    {
      slug: 'lunyu',
      title: '论语',
      source: 'chinese-poetry/chinese-poetry@master',
      category: 'four-books' as const,
      author: '孔子',
      era: '春秋',
      chapterCount: 2,
      charCount: 13,
      jsonFile: 'data/classics/lunyu.json',
      jsonBytes: 1024,
    },
    {
      slug: 'dizigui',
      title: '弟子规',
      source: 'chinese-poetry/chinese-poetry@master',
      category: 'mengxue' as const,
      author: '李毓秀',
      era: '清',
      chapterCount: 1,
      charCount: 7,
      jsonFile: 'data/classics/dizigui.json',
      jsonBytes: 512,
    },
    {
      slug: 'erya',
      title: '尔雅',
      source: 'guwendao.net/尔雅',
      category: 'five-classics' as const,
      author: null,
      era: '战国',
      chapterCount: 19,
      charCount: 16990,
      jsonFile: 'data/classics/erya.json',
      jsonBytes: 345204,
    },
  ],
};

const lunyuFile = {
  slug: 'lunyu',
  title: '论语',
  category: 'four-books' as const,
  author: '孔子',
  era: '春秋',
  source: 'chinese-poetry/chinese-poetry@master',
  bookId: 'lunyu',
  bookTitle: '论语',
  chapterRange: { from: 1, to: 2 },
  chunks: [
    { id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [[]] },
    { id: 2, label: '为政第二', content: ['子曰为政以德。'], pinyin: [[]] },
  ],
};

const mockLoadManifest = vi.fn().mockResolvedValue(mockManifest);
const mockLoadClassicFile = vi.fn();
vi.mock('@/lib/classics/loader', () => ({
  loadManifest: () => mockLoadManifest(),
  loadClassicFile: (slug: string) => mockLoadClassicFile(slug),
  invalidateManifestCache: vi.fn(),
}));

describe('listClassics', () => {
  beforeEach(() => {
    mockLoadManifest.mockClear();
    mockLoadClassicFile.mockClear();
  });

  it('returns all classics when no filter', async () => {
    const { listClassics } = await import('@/lib/classics/queries');
    const r = await listClassics({});
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.slug)).toEqual(['lunyu', 'dizigui', 'erya']);
  });

  it('filters by category', async () => {
    const { listClassics } = await import('@/lib/classics/queries');
    const r = await listClassics({ category: 'four-books' });
    expect(r.items.map((i) => i.slug)).toEqual(['lunyu']);
  });

  it('filters by q (title match)', async () => {
    const { listClassics } = await import('@/lib/classics/queries');
    const r = await listClassics({ q: '弟子' });
    expect(r.items.map((i) => i.slug)).toEqual(['dizigui']);
  });

  it('paginates', async () => {
    const { listClassics } = await import('@/lib/classics/queries');
    const r = await listClassics({ page: 1, pageSize: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.slug).toBe('lunyu');
    expect(r.total).toBe(3);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(1);
  });

  it('passes chunkCount and charCount through from manifest', async () => {
    const { listClassics } = await import('@/lib/classics/queries');
    const r = await listClassics({});
    const lunyu = r.items.find((i) => i.slug === 'lunyu')!;
    expect(lunyu.chunkCount).toBe(2);
    expect(lunyu.charCount).toBe(13);
  });
});

describe('getClassicBySlug', () => {
  beforeEach(() => {
    mockLoadManifest.mockClear();
    mockLoadClassicFile.mockClear();
  });

  it('returns full detail with chunks parsed', async () => {
    mockLoadClassicFile.mockResolvedValueOnce(lunyuFile);
    const { getClassicBySlug } = await import('@/lib/classics/queries');
    const c = await getClassicBySlug('lunyu');
    expect(c).not.toBeNull();
    expect(c!.title).toBe('论语');
    expect(c!.author).toBe('孔子');
    expect(c!.era).toBe('春秋');
    expect(c!.chunks).toHaveLength(2);
    expect(c!.chunks[0]!.label).toBe('学而第一');
    expect(c!.chunks[0]!.content).toEqual(['子曰学而时习之。']);
  });

  it('returns null for nonexistent slug', async () => {
    mockLoadClassicFile.mockResolvedValueOnce(null);
    const { getClassicBySlug } = await import('@/lib/classics/queries');
    const c = await getClassicBySlug('nonexistent');
    expect(c).toBeNull();
  });

  it('assigns sequential chunk ids when missing', async () => {
    mockLoadClassicFile.mockResolvedValueOnce({
      ...lunyuFile,
      chunks: [
        { label: '关雎', content: ['关关雎鸠。'], pinyin: [[]] },
        { label: '蒹葭', content: ['蒹葭苍苍。'], pinyin: [[]] },
      ],
    });
    const { getClassicBySlug } = await import('@/lib/classics/queries');
    const c = await getClassicBySlug('shijing');
    expect(c!.chunks.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('countByCategory', () => {
  beforeEach(() => {
    mockLoadManifest.mockClear();
    mockLoadClassicFile.mockClear();
  });

  it('returns counts keyed by category', async () => {
    const { countByCategory } = await import('@/lib/classics/queries');
    const counts = await countByCategory();
    expect(counts['four-books']).toBe(1);
    expect(counts.mengxue).toBe(1);
    expect(counts['five-classics']).toBe(1);
    expect(counts.philosophy).toBe(0);
    expect(counts.history).toBe(0);
    expect(counts.other).toBe(0);
  });
});