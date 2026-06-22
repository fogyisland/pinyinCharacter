import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.resetModules(); process.env.NEXT_PUBLIC_SITE_URL = 'https://x.com'; });

describe('buildCreativeWork', () => {
  it('has required schema.org fields', async () => {
    const { buildCreativeWork } = await import('@/lib/seo/jsonld');
    const j = buildCreativeWork({ title: '静夜思', author: '李白', dynasty: 'tang', content: ['床前明月光'] });
    expect(j['@context']).toBe('https://schema.org');
    expect(j['@type']).toBe('CreativeWork');
    expect(j.name).toBe('静夜思');
    expect(j.author).toEqual({ '@type': 'Person', name: '李白' });
    expect(j.inLanguage).toBe('zh-CN');
    expect(j.text).toBe('床前明月光');
  });
});

describe('buildBook', () => {
  it('includes era as datePublished', async () => {
    const { buildBook } = await import('@/lib/seo/jsonld');
    const j = buildBook({ title: '论语', author: '孔子', era: '春秋' });
    expect(j['@type']).toBe('Book');
    expect(j.datePublished).toBe('春秋');
  });
  it('omits datePublished when era null', async () => {
    const { buildBook } = await import('@/lib/seo/jsonld');
    const j = buildBook({ title: '佚名', author: null, era: null });
    expect(j.datePublished).toBeUndefined();
  });
});

describe('buildDefinedTerm', () => {
  it('includes char as name', async () => {
    const { buildDefinedTerm } = await import('@/lib/seo/jsonld');
    const j = buildDefinedTerm({ char: '学', meaning: '学习' });
    expect(j['@type']).toBe('DefinedTerm');
    expect(j.name).toBe('学');
    expect(j.description).toBe('学习');
  });
});

describe('buildBreadcrumbList', () => {
  it('maps items to ListItem with absolute URL', async () => {
    const { buildBreadcrumbList } = await import('@/lib/seo/jsonld');
    const j = buildBreadcrumbList([{ name: '首页', url: '/' }, { name: '字典', url: '/chars' }]);
    expect(j.itemListElement.length).toBe(2);
    expect(j.itemListElement[0].item).toBe('https://x.com/');
    expect(j.itemListElement[1].position).toBe(2);
  });
});

describe('buildWebSite', () => {
  it('includes SearchAction with target template', async () => {
    const { buildWebSite } = await import('@/lib/seo/jsonld');
    const j = buildWebSite();
    expect(j.potentialAction['@type']).toBe('SearchAction');
    expect(j.potentialAction.target.urlTemplate).toContain('{search_term_string}');
  });
});
