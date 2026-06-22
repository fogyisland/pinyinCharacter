// tests/integration/scripts/build-pianwen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

const mockScraper = {
  fetchChapterList: vi.fn(),
  scrapeChapterContent: vi.fn(),
};
vi.mock('../../../lib/guwendao-scraper', () => mockScraper);

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockReadDir = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...a: any[]) => mockWriteFile(...a),
  readFileSync: (...a: any[]) => mockReadFile(...a),
  readdirSync: (...a: any[]) => mockReadDir(...a),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 1000 }),
}));

describe('buildPianwen', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls fetchChapterList + scrapeChapterContent + writes JSON + INSERT', async () => {
    mockScraper.fetchChapterList.mockResolvedValueOnce(['c1', 'c2']);
    mockScraper.scrapeChapterContent
      .mockResolvedValueOnce({ title: '一东', paragraphs: ['天上双星会', '人间此夜同'] })
      .mockResolvedValueOnce({ title: '二冬', paragraphs: ['春光正好', '花影重重'] });
    mockQuery.mockResolvedValue([[]]);
    mockReadDir.mockReturnValue([]);
    mockReadFile.mockImplementation((p: string) => {
      if (p.endsWith('classics-manifest.json')) {
        return JSON.stringify({ version: 1, updatedAt: '2026-06-22', books: [] });
      }
      return '{}';
    });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { buildPianwen } = await import('../../../scripts/build-pianwen');
    const r = await buildPianwen();
    expect(r.chapters).toBe(2);
    expect(mockScraper.fetchChapterList).toHaveBeenCalledWith('427c5eea5943');
    expect(mockExecute.mock.calls.some((c: any) => c[0].startsWith('INSERT INTO classics'))).toBe(true);
  });
});