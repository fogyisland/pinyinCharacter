// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The shipped 形近字 table.
 *
 * `data/look-alikes.json` is the build product of
 * `scripts/build-look-alikes.ts`. These tests read the real file, so a
 * regression in the rule (or in the build) shows up as a missing pair that
 * a teacher would definitely teach.
 */
describe('the shipped look-alike table', () => {
  /**
   * The data file is plain names; the numbers are recomputed live by
   * `lib/look-alike.ts` for the two characters on screen.
   */
  const table = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'look-alikes.json'), 'utf-8'),
  ) as Record<string, string[]>;

  /** Pairs any Chinese teacher would write on the board. */
  const TEACHER_PAIRS: Array<[string, string]> = [
    ['未', '末'],
    ['己', '已'],
    ['己', '巳'],
    ['土', '士'],
    ['大', '太'],
    ['大', '犬'],
    ['木', '本'],
    ['干', '千'],
    ['日', '曰'],
    ['天', '夫'],
    ['人', '入'],
    ['刀', '力'],
    ['白', '自'],
    ['目', '日'],
    ['王', '玉'],
    ['石', '右'],
    ['中', '申'],
  ];

  it('contains every pair a teacher would teach', () => {
    const missed: string[] = [];
    for (const [a, b] of TEACHER_PAIRS) {
      if (!table[a]?.includes(b)) missed.push(`${a}/${b}`);
    }
    expect(missed, `missing: ${missed.join(', ')}`).toEqual([]);
  });

  it('is symmetric: if 未 lists 末, 末 lists 未', () => {
    const broken: string[] = [];
    for (const [char, list] of Object.entries(table)) {
      for (const other of list) {
        if (!table[other]?.includes(char)) broken.push(`${char}→${other} but not back`);
      }
    }
    expect(broken.slice(0, 5), `${broken.length} asymmetric entries`).toEqual([]);
    expect(broken).toHaveLength(0);
  });

  it('never lists a character as its own look-alike', () => {
    for (const [char, list] of Object.entries(table)) {
      expect(list).not.toContain(char);
    }
  });

  it('covers a useful share of the 一级字', () => {
    expect(Object.keys(table).length).toBeGreaterThan(1500);
  });

  it('keeps the lists short enough to read', () => {
    // A twelve-item list is already long; a 40-item list is a concordance.
    for (const list of Object.values(table)) {
      expect(list.length).toBeLessThanOrEqual(12);
    }
  });

  it('stays a plain name table so the file remains small', () => {
    // The comparison numbers live in lib/look-alike.ts and are recomputed
    // for the two characters on screen; the data file is names only.
    const raw = readFileSync(join(process.cwd(), 'data', 'look-alikes.json'), 'utf-8');
    expect(raw.length).toBeLessThan(120 * 1024);
    for (const list of Object.values(table)) {
      expect(typeof list[0]).toBe('string');
    }
  });
});
