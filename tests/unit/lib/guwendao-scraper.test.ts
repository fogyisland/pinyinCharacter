import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('guwendao scraper primitives', () => {
  it('fetchChapterList returns array of chapter ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/guwen/bookv_abc.aspx">1</a><a href="/guwen/bookv_def.aspx">2</a></html>',
    });
    const { fetchChapterList } = await import('@/lib/guwendao-scraper');
    const ids = await fetchChapterList('xxx');
    expect(ids).toEqual(['abc', 'def']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('scrapePoemList for yuefu parses shiwenv_ links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/shiwenv_aaa.aspx">poem1</a><a href="/shiwenv_bbb.aspx">poem2</a></html>',
    });
    const { scrapePoemList } = await import('@/lib/guwendao-scraper');
    const ids = await scrapePoemList('yuefu');
    expect(ids).toEqual(['aaa', 'bbb']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('scrapePoemPage makes a single fetch and extracts title, author, dynasty, paragraphs', async () => {
    // Only one fetch: /shiwenv_xxx.aspx carries everything we need
    // (title in <h1>, author+dynasty in the sons block, paragraphs in contson).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>静夜思</h1>
        <div class="sons"><div class="cont"><a href="...">李白</a>·唐</div></div>
        <div class="contson"><p>床前明月光，</p><p>疑是地上霜。</p><p>举头望明月，</p><p>低头思故乡。</p></div>
        </body></html>
      `,
    });
    const { scrapePoemPage } = await import('@/lib/guwendao-scraper');
    const r = await scrapePoemPage('xxx');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.guwendao.net/shiwenv_xxx.aspx',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(r.title).toBe('静夜思');
    expect(r.author).toBe('李白');
    expect(r.dynasty).toBe('唐');
    expect(r.paragraphs).toEqual(['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
  });

  it('parseChapterHtml decodes &nbsp; and &ldquo;/&rdquo; entities in paragraphs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>测试</h1>
        <div class="contson"><p>&ldquo;床前&hellip;&nbsp;明月光，&rdquo;</p><p>疑&mdash;是地上霜。</p></div>
        </body></html>
      `,
    });
    const { scrapeChapterContent } = await import('@/lib/guwendao-scraper');
    const r = await scrapeChapterContent('b', 'c');
    expect(r.title).toBe('测试');
    // &ldquo; and &rdquo; → ", &hellip; → …, &nbsp; → regular space, &mdash; → —
    expect(r.paragraphs).toEqual(['"床前… 明月光，"', '疑—是地上霜。']);
  });

  it('parsePoemHtml extracts 东汉 dynasty from <h1>…</h1>·东汉 pattern', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>迢迢牵牛星</h1>·东汉<div class="cont">...</div>
        <div class="contson"><p>迢迢牵牛星，皎皎河汉女。</p></div>
        </body></html>
      `,
    });
    const { scrapePoemPage } = await import('@/lib/guwendao-scraper');
    const r = await scrapePoemPage('gushi19-1');
    expect(r.title).toBe('迢迢牵牛星');
    expect(r.dynasty).toBe('东汉');
    expect(r.paragraphs).toEqual(['迢迢牵牛星，皎皎河汉女。']);
  });
});
