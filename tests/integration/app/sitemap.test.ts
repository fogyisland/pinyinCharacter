import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
const mockReadFilePromises = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: (...a: any[]) => mockReadDir(...a),
  existsSync: vi.fn().mockReturnValue(true),
}));
// Production code uses 'fs/promises' (lib/poetry/loader) and the sitemap
// uses 'node:fs/promises' — the loader comment in lib/poetry/loader.ts says
// vitest's mock registry does NOT dedupe these specifiers, so mock both.
vi.mock('fs/promises', () => ({
  readFile: (...a: any[]) => mockReadFilePromises(...a),
}));
vi.mock('node:fs/promises', () => ({
  readFile: (...a: any[]) => mockReadFilePromises(...a),
}));

const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: vi.fn() }),
}));

describe('sub-sitemap routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('poetry.xml emits <urlset> with each manifest item', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-22T00:00:00Z', count: 2,
      items: [{ id: 1, title: 'a', author: 'b', dynasty: 'tang' }, { id: 2, title: 'c', author: 'd', dynasty: 'tang' }],
    }));
    const { GET } = await import('@/app/sitemap/poetry.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('<urlset');
    expect(text).toContain('https://x.com/poetry/1');
    expect(text).toContain('https://x.com/poetry/2');
  });

  it('ancient.xml emits <urlset> with each manifest book', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockReturnValueOnce(JSON.stringify({
      version: 1, updatedAt: '2026-06-22T00:00:00Z', books: [{ slug: 'lunyu' }, { slug: 'daxue' }],
    }));
    const { GET } = await import('@/app/sitemap/ancient.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/ancient/lunyu');
    expect(text).toContain('https://x.com/ancient/daxue');
  });

  it('chars.xml queries chars table and emits each char', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockReturnValueOnce(JSON.stringify({ generatedAt: '2026-06-17T00:00:00Z' }));
    mockQuery.mockResolvedValueOnce([[{ char: '学' }, { char: '习' }]]);
    const { GET } = await import('@/app/sitemap/chars.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('学'));
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('习'));
    // lastmod comes from content-manifest, not new Date()
    expect(text).toContain('<lastmod>2026-06-17');
  });

  it('chars.xml falls back to new Date() when content-manifest is missing', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFile.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    mockQuery.mockResolvedValueOnce([[{ char: '甲' }]]);
    const { GET } = await import('@/app/sitemap/chars.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('甲'));
    // The fallback should still produce a valid ISO date
    expect(text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
  });
});

describe('root sitemap (app/sitemap.ts)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits sutra entries with /sutra/<slug> URLs and created_at lastmod', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFilePromises.mockResolvedValue(JSON.stringify({
      version: 1, updatedAt: '2026-06-15T00:00:00Z', count: 0, items: [],
    }));
    mockReadFile.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('classics-manifest.json')) {
        return JSON.stringify({ updatedAt: '2026-06-22T00:00:00Z', books: [] });
      }
      if (typeof p === 'string' && p.includes('content-manifest.json')) {
        return JSON.stringify({ generatedAt: '2026-06-17T00:00:00Z' });
      }
      throw new Error(`unmocked read: ${p}`);
    });
    mockQuery.mockResolvedValueOnce([[
      { id: 15, slug: 'jingang', created_at: new Date('2026-06-10T00:00:00Z') },
      { id: 17, slug: 'amituo', created_at: new Date('2026-06-11T00:00:00Z') },
    ]]);
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();
    const sutra15 = entries.find(e => e.url.endsWith('/sutra/jingang'));
    const sutra17 = entries.find(e => e.url.endsWith('/sutra/amituo'));
    expect(sutra15).toBeDefined();
    expect(sutra17).toBeDefined();
    // lastModified should be the created_at, NOT a fresh new Date()
    expect(new Date(sutra15!.lastModified as any).toISOString()).toBe('2026-06-10T00:00:00.000Z');
    expect(new Date(sutra17!.lastModified as any).toISOString()).toBe('2026-06-11T00:00:00.000Z');
  });

  it('emits classic entries with manifest.updatedAt lastmod (not new Date)', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    // loadManifest (poems) reads via fs/promises
    mockReadFilePromises.mockResolvedValue(JSON.stringify({
      version: 1, updatedAt: '2026-06-15T00:00:00Z', count: 0, items: [],
    }));
    // sitemap.ts uses readFileSync (node:fs) for classics + content
    mockReadFile.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('classics-manifest.json')) {
        return JSON.stringify({
          updatedAt: '2026-06-22T05:09:59.623Z',
          books: [{ slug: 'lunyu' }, { slug: 'daxue' }],
        });
      }
      if (typeof p === 'string' && p.includes('content-manifest.json')) {
        return JSON.stringify({ generatedAt: '2026-06-17T00:00:00Z' });
      }
      throw new Error(`unmocked read: ${p}`);
    });
    mockQuery.mockResolvedValueOnce([[]]);
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();
    const lunyu = entries.find(e => e.url.endsWith('/ancient/lunyu'));
    expect(lunyu).toBeDefined();
    expect(new Date(lunyu!.lastModified as any).toISOString()).toBe('2026-06-22T05:09:59.623Z');
  });

  it('static routes use content-manifest.generatedAt (not new Date) for lastmod', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com';
    mockReadFilePromises.mockResolvedValue(JSON.stringify({
      version: 1, updatedAt: '2026-06-15T00:00:00Z', count: 0, items: [],
    }));
    mockReadFile.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('classics-manifest.json')) {
        return JSON.stringify({ updatedAt: '2026-06-22T00:00:00Z', books: [] });
      }
      if (typeof p === 'string' && p.includes('content-manifest.json')) {
        return JSON.stringify({ generatedAt: '2026-06-17T16:10:58.056Z' });
      }
      throw new Error(`unmocked read: ${p}`);
    });
    mockQuery.mockResolvedValueOnce([[]]);
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();
    const home = entries.find(e => e.url.endsWith('/'));
    const dict = entries.find(e => e.url.endsWith('/dictionary'));
    expect(home).toBeDefined();
    expect(dict).toBeDefined();
    expect(new Date(home!.lastModified as any).toISOString()).toBe('2026-06-17T16:10:58.056Z');
    expect(new Date(dict!.lastModified as any).toISOString()).toBe('2026-06-17T16:10:58.056Z');
  });
});
