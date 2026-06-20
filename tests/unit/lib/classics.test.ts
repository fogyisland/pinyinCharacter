import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { listClassics, getClassicBySlug, countByCategory } from '@/lib/classics';

async function reset() {
  const pool = getPool();
  await pool.execute('DELETE FROM classics');
}

async function insertFixture(slug: string, title: string, category: string, chunks: unknown[], author: string | null = null, era: string | null = null) {
  const pool = getPool();
  await pool.execute(
    'INSERT INTO classics (slug, title, category, author, era, chunks) VALUES (?, ?, ?, ?, ?, ?)',
    [slug, title, category, author, era, JSON.stringify(chunks)]
  );
}

describe('listClassics', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [
      { id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [[]] },
      { id: 2, label: '为政第二', content: ['子曰为政以德。'], pinyin: [[]] },
    ], '孔子', '春秋');
    await insertFixture('dizigui', '弟子规', 'mengxue', [
      { id: 1, label: '总叙', content: ['弟子规圣人训。'], pinyin: [[]] },
    ]);
  });
  afterAll(async () => { await closePool(); });

  it('returns all classics when no filter', async () => {
    const r = await listClassics({});
    expect(r.total).toBe(2);
    expect(r.items.map(i => i.slug)).toEqual(['lunyu', 'dizigui']);
  });

  it('filters by category', async () => {
    const r = await listClassics({ category: 'four-books' });
    expect(r.items.map(i => i.slug)).toEqual(['lunyu']);
  });

  it('filters by q (title match)', async () => {
    const r = await listClassics({ q: '弟子' });
    expect(r.items.map(i => i.slug)).toEqual(['dizigui']);
  });

  it('paginates', async () => {
    const r = await listClassics({ page: 1, pageSize: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(2);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(1);
  });

  it('computes chunkCount from JSON_LENGTH', async () => {
    const r = await listClassics({});
    const lunyu = r.items.find(i => i.slug === 'lunyu')!;
    expect(lunyu.chunkCount).toBe(2);
  });

  it('computes charCount from chunk content (excludes punctuation)', async () => {
    const r = await listClassics({});
    const lunyu = r.items.find(i => i.slug === 'lunyu')!;
    // Fixture lines: '子曰学而时习之。' and '子曰为政以德。'
    // After stripPunct removes '。': 7 + 6 = 13 non-punct chars
    expect(lunyu.charCount).toBe(13);
  });
});

describe('getClassicBySlug', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [
      { id: 1, label: '学而第一', content: ['子曰学而时习之。', '有朋自远方来。'], pinyin: [[], []] },
    ], '孔子', '春秋');
  });
  afterAll(async () => { await closePool(); });

  it('returns full detail with chunks parsed', async () => {
    const c = await getClassicBySlug('lunyu');
    expect(c).not.toBeNull();
    expect(c!.title).toBe('论语');
    expect(c!.author).toBe('孔子');
    expect(c!.era).toBe('春秋');
    expect(c!.chunks).toHaveLength(1);
    expect(c!.chunks[0]!.label).toBe('学而第一');
    expect(c!.chunks[0]!.content).toEqual(['子曰学而时习之。', '有朋自远方来。']);
  });

  it('returns null for nonexistent slug', async () => {
    const c = await getClassicBySlug('nonexistent');
    expect(c).toBeNull();
  });

  it('assigns sequential chunk ids when missing', async () => {
    await reset();
    await insertFixture('shijing', '诗经', 'five-classics', [
      { label: '关雎', content: ['关关雎鸠。'], pinyin: [[]] },
      { label: '蒹葭', content: ['蒹葭苍苍。'], pinyin: [[]] },
    ]);
    const c = await getClassicBySlug('shijing');
    expect(c!.chunks.map(x => x.id)).toEqual([1, 2]);
  });
});

describe('countByCategory', () => {
  beforeEach(async () => {
    await reset();
    await insertFixture('lunyu', '论语', 'four-books', [{ id: 1, label: 'x', content: [], pinyin: [] }]);
    await insertFixture('dizigui', '弟子规', 'mengxue', [{ id: 1, label: 'x', content: [], pinyin: [] }]);
  });
  afterAll(async () => { await closePool(); });

  it('returns counts keyed by category', async () => {
    const counts = await countByCategory();
    expect(counts['four-books']).toBe(1);
    expect(counts.mengxue).toBe(1);
    expect(counts['five-classics']).toBe(0);
  });
});
