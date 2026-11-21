// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCharWords, type WordTable } from '@/lib/char-words';

/**
 * The 组词 reader and the shipped table.
 *
 * A learner in an HSK class studies WORDS, not characters: 「学」 matters
 * because of 学生 and 学习. The dictionary page had no way to show that, and
 * the data to do it was sitting unused.
 */

describe('getCharWords', () => {
  const table = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'char-words.json'), 'utf-8'),
  ) as WordTable;

  it('gives the words a learner meets 学 in', () => {
    const words = getCharWords(table, '学').map((entry) => entry.word);
    expect(words.length).toBeGreaterThan(3);
    // The words a teacher would write on the board.
    expect(words).toContain('学生');
    expect(words).toContain('学校');
    expect(words).toContain('学习');
  });

  it('carries the reading of each word', () => {
    const entry = getCharWords(table, '学').find((word) => word.word === '学习');
    expect(entry?.pinyin).toBe('xué xí');
  });

  it('returns an empty list for a character with no words', () => {
    // Not every character has words at the shipped frequency floor; the
    // page must hide the section rather than print a blank heading.
    expect(getCharWords(table, '龘')).toEqual([]);
  });

  it('returns an empty list for a multi-character "character"', () => {
    expect(getCharWords(table, '学习')).toEqual([]);
  });

  it('ranks the most common word first', () => {
    const words = getCharWords(table, '大');
    expect(words[0]?.word).toBe('大学');
  });

  it('covers the common characters', () => {
    // A table that only knew the rare ones would be useless.
    const chars = Object.keys(table).length;
    expect(chars).toBeGreaterThan(2000);
    expect(getCharWords(table, '水').length).toBeGreaterThan(3);
    expect(getCharWords(table, '中').length).toBeGreaterThan(3);
  });
});
