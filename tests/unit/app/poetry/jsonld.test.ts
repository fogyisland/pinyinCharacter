import { describe, it, expect } from 'vitest';

describe('buildPoemJsonLd', () => {
  it('produces CreativeWork with author and text', async () => {
    const { buildPoemJsonLd } = await import('@/app/poetry/[id]/jsonld');
    const p = { id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五绝',
      content: ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。'],
      pinyin: [], appreciation: null } as any;
    const ld = buildPoemJsonLd(p);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('CreativeWork');
    expect(ld.name).toBe('静夜思');
    expect(ld.author).toMatchObject({ '@type': 'Person', name: '李白' });
    expect(ld.text).toContain('床前明月光');
  });
});