import { describe, it, expect, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('guwendao scraper primitives', () => {
  it('fetchChapterList returns array of chapter ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/guwen/bookv_abc.aspx">1</a><a href="/guwen/bookv_def.aspx">2</a></html>',
    });
    const { fetchChapterList } = await import('@/lib/guwendao-scraper');
    const ids = await fetchChapterList('xxx');
    expect(ids).toEqual(['abc', 'def']);
  });

  it('scrapePoemList for yuefu parses shiwenv_ links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/shiwenv_aaa.aspx">poem1</a><a href="/shiwenv_bbb.aspx">poem2</a></html>',
    });
    const { scrapePoemList } = await import('@/lib/guwendao-scraper');
    const ids = await scrapePoemList('yuefu');
    expect(ids).toEqual(['aaa', 'bbb']);
  });

  it('scrapePoemPage extracts title, author, dynasty, paragraphs', async () => {
    // First call: /shiwenv_xxx.aspx (title/author/dynasty parsing).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>静夜思</h1>
        <div class="sons"><div class="cont"><a href="...">李白</a>·唐</div></div>
        </body></html>
      `,
    });
    // Second call: scrapeChapterContent is reused for paragraph parsing.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <div class="contson"><p>床前明月光，</p><p>疑是地上霜。</p><p>举头望明月，</p><p>低头思故乡。</p></div>
        </body></html>
      `,
    });
    const { scrapePoemPage } = await import('@/lib/guwendao-scraper');
    const r = await scrapePoemPage('xxx');
    expect(r.title).toBe('静夜思');
    expect(r.author).toBe('李白');
    expect(r.dynasty).toBe('唐');
    expect(r.paragraphs).toEqual(['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
  });
});
