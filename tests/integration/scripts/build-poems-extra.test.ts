import { describe, it, expect, vi } from 'vitest';

// Mock pool hoisted to module scope so script-under-test and assertions
// share the SAME vi.fn() instances (mock.calls inspection pattern).
const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
  closePool: vi.fn().mockResolvedValue(undefined),
}));

const mockScrape = {
  scrapePoemList: vi.fn(),
  scrapePoemPage: vi.fn(),
};

vi.mock('../../../lib/guwendao-scraper', () => mockScrape);

describe('buildPoemsExtra', () => {
  it('ingests yuefu poems with correct fields', async () => {
    mockScrape.scrapePoemList.mockReset();
    mockScrape.scrapePoemPage.mockReset();
    mockQuery.mockReset();
    mockExecute.mockReset();

    mockScrape.scrapePoemList.mockResolvedValueOnce(['aaa']);
    mockScrape.scrapePoemPage.mockResolvedValueOnce({
      title: '长歌行', author: '佚名', dynasty: '汉',
      paragraphs: ['青青园中葵', '朝露待日晞', '阳春布德泽', '万物生光辉'],
    });
    mockQuery.mockResolvedValue([[]]); // no existing row
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { buildPoemsExtra } = await import('../../../scripts/build-poems-extra');
    const n = await buildPoemsExtra({ onlyCategory: '汉乐府' });
    expect(n.inserted).toBe(1);
    const insertCall = mockExecute.mock.calls.find((c: any) => c[0].startsWith('INSERT INTO poems'));
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as unknown[];
    expect(insertParams).toContain('汉乐府');
    expect(insertParams).toContain('汉');
  });

  it('skips existing (dynasty, title, author) duplicates', async () => {
    mockScrape.scrapePoemList.mockReset();
    mockScrape.scrapePoemPage.mockReset();
    mockQuery.mockReset();
    mockExecute.mockReset();

    mockScrape.scrapePoemList.mockResolvedValueOnce(['aaa']);
    mockScrape.scrapePoemPage.mockResolvedValueOnce({
      title: 'X', author: 'Y', dynasty: '汉',
      paragraphs: ['1', '2', '3', '4'],
    });
    mockQuery.mockResolvedValueOnce([[{ id: 99 }]]); // existing row found
    const { buildPoemsExtra } = await import('../../../scripts/build-poems-extra');
    const n = await buildPoemsExtra({ onlyCategory: '汉乐府' });
    expect(n.inserted).toBe(0);
  });
});
