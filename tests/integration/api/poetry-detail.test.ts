import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetPoem = vi.fn();
const mockListPoems = vi.fn();
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

describe('GET /api/poetry/[id]', () => {
  it('returns 404 when poem not found', async () => {
    mockGetPoem.mockResolvedValueOnce(null);
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(
      req('http://x/api/poetry/99999'),
      { params: Promise.resolve({ id: '99999' }) },
    );
    expect(r.status).toBe(404);
  });

  it('returns parsed detail for existing id', async () => {
    mockGetPoem.mockResolvedValueOnce({
      id: 1,
      title: '静夜思',
      author: '李白',
      dynasty: 'tang',
      form: '五言绝句',
      content: ['床前明月光', '疑是地上霜'],
      pinyin: [['chuáng', 'qián'], ['yí', 'shì']],
      appreciation: '此诗写秋夜',
    });
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(
      req('http://x/api/poetry/1'),
      { params: Promise.resolve({ id: '1' }) },
    );
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('静夜思');
    expect(j.data.content).toEqual(['床前明月光', '疑是地上霜']);
    expect(j.data.pinyin).toEqual([['chuáng', 'qián'], ['yí', 'shì']]);
    expect(j.data.appreciation).toBe('此诗写秋夜');
    expect(mockGetPoem).toHaveBeenCalledWith(1);
  });

  it('rejects non-numeric id with 400', async () => {
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(
      req('http://x/api/poetry/abc'),
      { params: Promise.resolve({ id: 'abc' }) },
    );
    expect(r.status).toBe(400);
    expect(mockGetPoem).not.toHaveBeenCalled();
  });
});