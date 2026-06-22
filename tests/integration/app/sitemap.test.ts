import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: (...a: any[]) => mockReadDir(...a),
  existsSync: vi.fn().mockReturnValue(true),
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
    mockQuery.mockResolvedValueOnce([[{ char: '学' }, { char: '习' }]]);
    const { GET } = await import('@/app/sitemap/chars.xml/route');
    const res = await GET();
    const text = await res.text();
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('学'));
    expect(text).toContain('https://x.com/dictionary/' + encodeURIComponent('习'));
  });
});
