// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getExamples, type ExampleTable } from '@/lib/char-examples';

/**
 * 例句 —— the words in a sentence.
 *
 * The dictionary page shows 组词（学生、老师、学校）; a learner also needs to
 * see each word USED. 「学生」 alone is a label; 「你是学生吗？」 shows how it
 * behaves. The data comes from Tatoeba (CC-BY), filtered to sentences that
 * have an English translation and contain only simplified characters.
 */

describe('getExamples', () => {
  const table = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'examples.json'), 'utf-8'),
  ) as ExampleTable;

  it('gives a sentence for 学生 with an English translation', () => {
    const entries = getExamples(table, '学生');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].zh).toContain('学生');
    expect(entries[0].en.length).toBeGreaterThan(0);
  });

  it('never shows a sentence that does not contain the word', () => {
    // A mismatch here would mean the index is wrong and the page would show
    // an unrelated sentence beside the word.
    const broken: string[] = [];
    for (const [word, entries] of Object.entries(table)) {
      for (const entry of entries) {
        if (!entry.zh.includes(word)) broken.push(`${word} / ${entry.zh}`);
      }
    }
    expect(broken.slice(0, 5), `${broken.length} mismatches`).toEqual([]);
    expect(broken).toHaveLength(0);
  });

  it('keeps every sentence within the readable window', () => {
    // The build keeps 6–30 characters: shorter is a fragment, longer is a
    // wall of text in a sidebar.
    for (const entries of Object.values(table)) {
      for (const entry of entries) {
        expect(entry.zh.length).toBeGreaterThanOrEqual(6);
        expect(entry.zh.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it('gives at most two sentences per word', () => {
    for (const entries of Object.values(table)) {
      expect(entries.length).toBeLessThanOrEqual(2);
    }
  });

  it('returns an empty list for a word with no sentence', () => {
    // Not every word has one: Tatoeba's Chinese corpus is 89k sentences, and
    // the build covers 61% of the 7171 组词 words.
    expect(getExamples(table, '龘')).toEqual([]);
  });

  it('ignores a single character, which is not a 组词', () => {
    // The dictionary page asks for a word, not a character; a single
    // character would match hundreds of sentences and none of them usefully.
    expect(getExamples(table, '学')).toEqual([]);
  });

  it('covers a useful share of the 组词 words', () => {
    expect(Object.keys(table).length).toBeGreaterThan(3000);
  });

  it('stays small enough to read at boot', () => {
    const raw = readFileSync(join(process.cwd(), 'data', 'examples.json'), 'utf-8');
    expect(raw.length).toBeLessThan(900 * 1024);
  });
});
