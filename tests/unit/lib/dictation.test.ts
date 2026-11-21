import { describe, it, expect } from 'vitest';
import {
  parseCustomList,
  annotatePinyin,
  paginate,
  itemsFromIdioms,
  itemsFromHsk,
  type DictationItem,
} from '@/lib/dictation';

/**
 * The item layer of the dictation tool.
 *
 * An item is one word the teacher dictates: 1-4 characters (a single
 * character, a word or a four-character idiom), its pinyin and the
 * characters laid into the cells of the paper.
 *
 * These tests read the REAL idiom and HSK tables (data/idioms.json,
 * data/hsk-vocab.json), so the sourcing is pinned against the shipped
 * data and not against a mock.
 */

/** An item for the tests that only care about pinyin handling. */
function item(word: string, pinyin = ''): DictationItem {
  return { word, pinyin, chars: Array.from(word) };
}

describe('parseCustomList', () => {
  it('splits on commas, spaces and newlines', () => {
    const { items } = parseCustomList('你好 世界,长大\n书');
    expect(items.map((i) => i.word)).toEqual(['你好', '世界', '长大', '书']);
  });

  it('keeps items of 1 to 4 characters', () => {
    const { items, rejected } = parseCustomList('一 你好 长大 昂首挺胸');
    expect(items.map((i) => i.word)).toEqual(['一', '你好', '长大', '昂首挺胸']);
    expect(rejected).toEqual([]);
    for (const i of items) expect(i.chars.length).toBeLessThanOrEqual(4);
  });

  it('drops items longer than 4 characters and reports them', () => {
    const { items, rejected } = parseCustomList('你好,中华人民共和国');
    expect(items.map((i) => i.word)).toEqual(['你好']);
    // The dropped word is reported so the form can show it — never a
    // silent truncation the teacher discovers on the printed sheet.
    expect(rejected).toEqual(['中华人民共和国']);
  });

  it('counts characters, not UTF-16 units, when judging the length', () => {
    // A supplementary-plane character is 2 UTF-16 units but 1 character;
    // four of them are still a valid item.
    const rare = '\u{20000}\u{20001}\u{20002}\u{20003}';
    const { items, rejected } = parseCustomList(rare);
    expect(rejected).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].chars).toHaveLength(4);
  });

  it('dedupes repeated words, keeping the first', () => {
    const { items } = parseCustomList('你好 你好 世界 你好');
    expect(items.map((i) => i.word)).toEqual(['你好', '世界']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseCustomList('')).toEqual({ items: [], rejected: [] });
    expect(parseCustomList('  , \n ')).toEqual({ items: [], rejected: [] });
  });
});

describe('annotatePinyin', () => {
  it('fills empty pinyin from the dictionary', async () => {
    const out = await annotatePinyin([item('你好'), item('书本')]);
    expect(out[0].pinyin).toBe('nǐ hǎo');
    expect(out[1].pinyin).toBe('shū běn');
  });

  it('keeps an edited pinyin untouched', async () => {
    // The teacher is the authority on a polyphonic character; whatever
    // they typed must survive the machine's reading. The batch also
    // carries an unannotated item so the fill path actually runs — a
    // batch of only edited items never reaches the dictionary.
    const out = await annotatePinyin([item('长大', 'cháng dà'), item('你好')]);
    expect(out[0].pinyin).toBe('cháng dà');
    expect(out[1].pinyin).toBe('nǐ hǎo');
  });
});

describe('paginate', () => {
  it('packs 10 items per page by default', () => {
    const pages = paginate(Array.from({ length: 10 }, (_, i) => i));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(10);
  });

  it('keeps the order across pages', () => {
    const pages = paginate(Array.from({ length: 12 }, (_, i) => i));
    expect(pages.flat()).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('puts the tail on its own page', () => {
    const pages = paginate(Array.from({ length: 12 }, (_, i) => i));
    expect(pages).toHaveLength(2);
    expect(pages[1]).toHaveLength(2);
  });
});

describe('itemsFromIdioms', () => {
  it('produces 4-character items with pinyin from the real idiom table', () => {
    const items = itemsFromIdioms();
    expect(items.length).toBeGreaterThan(300);
    for (const i of items) {
      expect(i.chars).toHaveLength(4);
      expect(i.pinyin).not.toBe('');
    }
  });

  it('filters by level when asked', () => {
    const level1 = itemsFromIdioms(1);
    expect(level1.length).toBeGreaterThan(0);
    for (const i of level1) expect(i.word.length).toBe(4);
  });
});

describe('itemsFromHsk', () => {
  it('produces single-character items from the level pool', () => {
    const items = itemsFromHsk(1, 5, 42);
    expect(items).toHaveLength(5);
    for (const i of items) expect(i.chars).toHaveLength(1);
  });

  it('is reproducible from its seed', () => {
    expect(itemsFromHsk(1, 5, 42)).toEqual(itemsFromHsk(1, 5, 42));
  });

  it('never returns more items than the pool holds', () => {
    const items = itemsFromHsk(1, 9999, 1);
    expect(items.length).toBeGreaterThan(100);
    expect(new Set(items.map((i) => i.word)).size).toBe(items.length);
  });
});
