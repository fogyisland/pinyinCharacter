// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildWordTable, type WordSources } from '@/scripts/build-char-words';

/**
 * The 组词 table builder's own logic, without the network.
 *
 * The table answers one question for the dictionary page: which words does
 * a learner meet this character in? A wrong build would fill 学 with 学院
 * and 大学 (fine) but also with every two-character string that happens to
 * contain it, which is noise. The floor, the cap and the ordering are
 * pinned here.
 */

/** A tiny corpus: two words per character, different frequencies. */
function sources(words: Array<[string, string, number]>): WordSources {
  const freqs = new Map<string, number>();
  const pinyins = new Map<string, string>();
  for (const [word, pinyin, freq] of words) {
    freqs.set(word, freq);
    pinyins.set(word, pinyin);
  }
  return { freqs, pinyins };
}

describe('buildWordTable', () => {
  it('files every word under each of its characters', () => {
    const table = buildWordTable(sources([['大学', 'dà xué', 5000]]), { minFreq: 100, cap: 10 });
    expect(table['大']?.map((e) => e.word)).toEqual(['大学']);
    expect(table['学']?.map((e) => e.word)).toEqual(['大学']);
  });

  it('ranks the most common word first', () => {
    const table = buildWordTable(
      sources([
        ['学院', 'xué yuàn', 3000],
        ['学习', 'xué xí', 9000],
      ]),
      { minFreq: 100, cap: 10 },
    );
    expect(table['学']?.map((e) => e.word)).toEqual(['学习', '学院']);
  });

  it('drops words below the frequency floor', () => {
    const table = buildWordTable(
      sources([
        ['学习', 'xué xí', 9000],
        ['学乖', 'xué guāi', 50],
      ]),
      { minFreq: 100, cap: 10 },
    );
    expect(table['学']?.map((e) => e.word)).toEqual(['学习']);
  });

  it('caps the list per character', () => {
    const entries: Array<[string, string, number]> = [];
    for (let i = 0; i < 20; i += 1) {
      entries.push([`学${String.fromCharCode(0x4e00 + i)}`, 'xué x', 1000 + i]);
    }
    const table = buildWordTable(sources(entries), { minFreq: 100, cap: 3 });
    expect(table['学']).toHaveLength(3);
  });

  it('ignores single characters: they are not 组词', () => {
    const table = buildWordTable(sources([['学', 'xué', 30000]]), { minFreq: 100, cap: 10 });
    expect(table['学']).toBeUndefined();
  });

  it('ignores words longer than four characters', () => {
    const table = buildWordTable(
      sources([['中华人民共和国', 'zhōng huá rén mín gòng hé guó', 5000]]),
      { minFreq: 100, cap: 10 },
    );
    expect(Object.keys(table)).toHaveLength(0);
  });

  it('keeps the toned pinyin of the word', () => {
    const table = buildWordTable(sources([['学习', 'xué xí', 9000]]), { minFreq: 100, cap: 10 });
    expect(table['学']?.[0]?.pinyin).toBe('xué xí');
  });

  it('drops a word whose syllable count does not match its characters', () => {
    // A misaligned line in the corpus would attach a wrong reading to the
    // word; better to lose the word than print a wrong pinyin on the page.
    const table = buildWordTable(sources([['学习', 'xué', 9000]]), { minFreq: 100, cap: 10 });
    expect(table['学']).toBeUndefined();
  });
});
