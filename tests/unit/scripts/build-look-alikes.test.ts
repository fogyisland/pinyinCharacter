// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareChar, type Stroke } from '@/lib/look-alike';
import { buildTableJson, loadLevel1Chars } from '@/scripts/build-look-alikes';

/**
 * The 形近字 table builder.
 *
 * The build is a scan of 3500 characters, so its own logic is pinned here
 * with a tiny corpus — the full run is verified by the table test
 * (`tests/unit/lib/look-alikes-data.test.ts`) and by the build script's own
 * output.
 */

function strokesOf(char: string): Stroke[] {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'strokes', `${char}.json`), 'utf-8'),
  ) as { medians: Stroke[] };
  return raw.medians;
}

describe('buildTableJson', () => {
  it('writes plain character names, not objects', () => {
    const corpus = ['未', '末'].map((char) => prepareChar(char, strokesOf(char)));
    const { table } = buildTableJson(corpus);
    // The data file must stay small and readable: names only.
    expect(table['未']).toContain('末');
    expect(Array.isArray(table['未'])).toBe(true);
    expect(typeof table['未'][0]).toBe('string');
  });

  it('reports the counts the build log prints', () => {
    const corpus = ['未', '末', '木'].map((char) => prepareChar(char, strokesOf(char)));
    const result = buildTableJson(corpus);
    expect(result.characters).toBeGreaterThan(0);
    expect(result.entries).toBeGreaterThan(0);
    // Three characters → three unordered pairs.
    expect(result.pairsConsidered).toBe(3);
  });

  it('omits a character with no look-alikes instead of storing an empty list', () => {
    // 山 has no near neighbour among 水/川; an empty array in the file
    // would grow it for nothing.
    const corpus = ['山', '水', '川'].map((char) => prepareChar(char, strokesOf(char)));
    const result = buildTableJson(corpus);
    for (const list of Object.values(result.table)) {
      expect(list.length).toBeGreaterThan(0);
    }
  });
});

describe('loadLevel1Chars', () => {
  // Reads 3500 stroke files from disk: ~6 s. Under a full parallel suite the
  // default 5 s timeout fires, so the time is declared here rather than
  // discovered as a flake.
  it('loads a decent number of 一级字 with stroke data', { timeout: 30_000 }, () => {
    const chars = loadLevel1Chars();
    expect(chars.length).toBeGreaterThan(3000);
    for (const entry of chars.slice(0, 5)) {
      expect(entry.strokes.length).toBeGreaterThan(0);
    }
  });

  it('does not include characters outside the 一级字', () => {
    // 耒 is a level-2 character at index 3563; it must not take part, or
    // 未's list fills with characters a learner never meets.
    const chars = loadLevel1Chars();
    const names = new Set(chars.map((entry) => entry.char));
    expect(names.has('耒')).toBe(false);
    expect(names.has('未')).toBe(true);
  });
});
