import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the poetry barrel BEFORE importing the route handler.
// We use vi.fn() hoisted refs so individual tests can configure per-call
// return values via mockResolvedValueOnce.
const mockListPoems = vi.fn();
const mockGetPoem = vi.fn();
const mockGetRandomPoem = vi.fn();

vi.mock('@/lib/poetry', () => ({
  listPoems: (...args: unknown[]) => mockListPoems(...args),
  getPoem: (...args: unknown[]) => mockGetPoem(...args),
  getRandomPoem: (...args: unknown[]) => mockGetRandomPoem(...args),
  listForms: vi.fn(),
  listDynasties: vi.fn(),
  loadManifest: vi.fn(),
  loadPoem: vi.fn(),
  invalidateManifestCache: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function req(url: string): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/poetry', () => {
  it('returns 200 with items array', async () => {
    mockListPoems.mockResolvedValueOnce({
      items: [{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: null }],
      total: 1,
      page: 1,
      pageSize: 24,
    });
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(req('http://x/api/poetry?dynasty=tang'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.items).toHaveLength(1);
    expect(j.data.items[0].title).toBe('静夜思');
  });

  it('passes dynasty / q / page through to listPoems', async () => {
    mockListPoems.mockResolvedValueOnce({
      items: [], total: 0, page: 2, pageSize: 24,
    });
    const { GET } = await import('@/app/api/poetry/route');
    await GET(req('http://x/api/poetry?dynasty=song&q=test&page=2'));
    expect(mockListPoems).toHaveBeenCalledWith(
      expect.objectContaining({ dynasty: 'song', q: 'test', page: 2 }),
    );
  });

  it('returns empty list when no matches', async () => {
    mockListPoems.mockResolvedValueOnce({
      items: [], total: 0, page: 1, pageSize: 24,
    });
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(req('http://x/api/poetry?dynasty=tang'));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.items).toEqual([]);
    expect(j.data.total).toBe(0);
  });

  it('rejects unknown dynasty with 400', async () => {
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(req('http://x/api/poetry?dynasty=yuan'));
    expect(r.status).toBe(400);
    expect(mockListPoems).not.toHaveBeenCalled();
  });
});