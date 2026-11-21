// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  compareChars,
  findLookAlikes,
  prepareChar,
  MEAN_LIMIT,
  MAX_LIMIT,
} from '@/lib/look-alike';
import { lookAlikesOf, strokesOf } from '@/lib/look-alike-data';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dictionary page's comparison: a real character vs its shipped
 * look-alikes, on real stroke data.
 *
 * This is the composition the page performs — the table decides WHICH pairs
 * to show, `compareChars` decides HOW similar they are and which stroke
 * differs. The tests check that the two agree: a pair the table lists must
 * also pass the live rule.
 */
describe('the page comparison', () => {
  it('lists look-alikes for a character a teacher would teach', () => {
    expect(lookAlikesOf('未')).toContain('末');
    expect(lookAlikesOf('己')).toContain('已');
    expect(lookAlikesOf('土')).toContain('士');
  });

  it('every shipped pair also passes the live rule', () => {
    // If the build's rule and the runtime rule ever drift apart, the page
    // would show a pair the card immediately calls "不是形近字".
    const broken: string[] = [];
    for (const [char, list] of Object.entries({
      未: lookAlikesOf('未'),
      己: lookAlikesOf('己'),
      土: lookAlikesOf('土'),
      大: lookAlikesOf('大'),
      木: lookAlikesOf('木'),
      日: lookAlikesOf('日'),
    })) {
      const strokes = strokesOf(char);
      if (!strokes) continue;
      for (const other of list) {
        const otherStrokes = strokesOf(other);
        if (!otherStrokes) {
          broken.push(`${char}/${other}: no stroke data`);
          continue;
        }
        const comparison = compareChars(
          prepareChar(char, strokes),
          prepareChar(other, otherStrokes),
        );
        if (!comparison?.isLookAlike) broken.push(`${char}/${other}`);
      }
    }
    expect(broken, `pairs the live rule rejects: ${broken.join(', ')}`).toEqual([]);
  });

  it('reports where the difference is for the canonical 未/末 pair', () => {
    const a = strokesOf('未');
    const b = strokesOf('末');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const comparison = compareChars(prepareChar('未', a!), prepareChar('末', b!));
    expect(comparison?.isLookAlike).toBe(true);
    expect(comparison?.mean).toBeLessThanOrEqual(MEAN_LIMIT);
    // The difference IS the pair's point, so it must be visible.
    expect(comparison?.max).toBeGreaterThanOrEqual(MAX_LIMIT);
    expect(comparison?.diffStrokeA).toBeGreaterThanOrEqual(0);
  });

  it('finds real look-alikes when the page searches on demand', () => {
    // The dictionary page can compare two characters the learner picks,
    // not only the shipped pairs.
    const target = strokesOf('大');
    const candidates = ['太', '犬', '天', '夫', '水', '山']
      .map((char) => {
        const strokes = strokesOf(char);
        return strokes ? prepareChar(char, strokes) : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const found = findLookAlikes(prepareChar('大', target!), candidates);
    const names = found.map((entry) => entry.char);
    expect(names).toContain('太');
    expect(names).toContain('犬');
    expect(names).not.toContain('水');
  });

  it('returns nothing for a rare character with no data', () => {
    expect(lookAlikesOf('龘')).toEqual([]);
    expect(strokesOf('龘')).toBeNull();
  });

  it('keeps the shipped table small enough to read at boot', () => {
    const raw = readFileSync(join(process.cwd(), 'data', 'look-alikes.json'), 'utf-8');
    expect(raw.length).toBeLessThan(120 * 1024);
  });
});
