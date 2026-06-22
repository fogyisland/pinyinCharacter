import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the classics barrel BEFORE importing the route handler.
const mockListClassics = vi.fn();
const mockGetClassicBySlug = vi.fn();
const mockCountByCategory = vi.fn();
const mockLoadManifest = vi.fn();
const mockLoadClassicFile = vi.fn();

vi.mock('@/lib/classics', () => ({
  listClassics: (...args: unknown[]) => mockListClassics(...args),
  getClassicBySlug: (...args: unknown[]) => mockGetClassicBySlug(...args),
  countByCategory: (...args: unknown[]) => mockCountByCategory(...args),
  loadManifest: () => mockLoadManifest(),
  loadClassicFile: (slug: string) => mockLoadClassicFile(slug),
  invalidateManifestCache: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function req(url: string): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/classics', () => {
  it('returns 200 with items array', async () => {
    mockListClassics.mockResolvedValueOnce({
      items: [{ id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋', chunkCount: 20, charCount: 12000 }],
      total: 1,
      page: 1,
      pageSize: 12,
    });
    const { GET } = await import('@/app/api/classics/route');
    const r = await GET(req('http://x/api/classics'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.items).toHaveLength(1);
    expect(j.data.items[0].slug).toBe('lunyu');
  });

  it('passes category / q / page through to listClassics', async () => {
    mockListClassics.mockResolvedValueOnce({
      items: [], total: 0, page: 2, pageSize: 24,
    });
    const { GET } = await import('@/app/api/classics/route');
    const r = await GET(req('http://x/api/classics?category=philosophy&q=论&page=2&pageSize=24'));
    expect(r.status).toBe(200);
    expect(mockListClassics).toHaveBeenCalledWith({ category: 'philosophy', q: '论', page: 2, pageSize: 24 });
  });

  it('rejects invalid category', async () => {
    const { GET } = await import('@/app/api/classics/route');
    const r = await GET(req('http://x/api/classics?category=bogus'));
    expect(r.status).toBe(400);
    expect(mockListClassics).not.toHaveBeenCalled();
  });
});

describe('GET /api/classics/[slug]', () => {
  it('returns 200 with detail when found', async () => {
    mockGetClassicBySlug.mockResolvedValueOnce({
      id: 0,
      slug: 'lunyu',
      title: '论语',
      category: 'four-books',
      author: '孔子',
      era: '春秋',
      chunks: [{ id: 1, label: '学而第一', content: ['子曰。'], pinyin: [[]] }],
    });
    const { GET } = await import('@/app/api/classics/[slug]/route');
    const r = await GET(req('http://x/api/classics/lunyu'), { params: Promise.resolve({ slug: 'lunyu' }) });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.title).toBe('论语');
    expect(j.data.chunks).toHaveLength(1);
  });

  it('404 when slug missing', async () => {
    mockGetClassicBySlug.mockResolvedValueOnce(null);
    const { GET } = await import('@/app/api/classics/[slug]/route');
    const r = await GET(req('http://x/api/classics/nope'), { params: Promise.resolve({ slug: 'nope' }) });
    expect(r.status).toBe(404);
  });
});