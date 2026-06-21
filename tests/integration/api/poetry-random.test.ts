import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRandomPoem = vi.fn();
const mockGetPoem = vi.fn();
const mockListPoems = vi.fn();

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

describe('GET /api/poetry/random', () => {
  it('returns 404 when no poems available', async () => {
    mockGetRandomPoem.mockResolvedValueOnce(null);
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it('returns a poem when present', async () => {
    mockGetRandomPoem.mockResolvedValueOnce({
      id: 1,
      title: '静夜思',
      author: '李白',
      dynasty: 'tang',
      form: null,
      content: ['床前明月光'],
      pinyin: [['chuáng']],
      appreciation: null,
    });
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('静夜思');
    expect(mockGetRandomPoem).toHaveBeenCalledTimes(1);
  });
});