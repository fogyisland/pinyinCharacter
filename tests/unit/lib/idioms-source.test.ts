/**
 * The 出处 field on the idiom dataset.
 *
 * The /idioms page is positioned as "从出处读懂成语", so an entry without a
 * source is a broken promise to the reader. These tests pin the shipped data,
 * the reviewed batches it is built from, and both paths that carry the field
 * forward (the rebuild script and the importer's file reader) — all without
 * touching a database.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const IDIOMS_PATH = join(ROOT, 'data', 'idioms.json');
const BATCH_DIR = join(ROOT, 'data', 'idiom-batches');
const PENDING_SOURCE = '出处待考';

interface SourceRow {
  word: string;
  pinyin: string;
  meaning: string;
  level: number;
  category: string;
  source: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function batchFiles(): string[] {
  return readdirSync(BATCH_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(BATCH_DIR, name));
}

const idioms = readJson<SourceRow[]>(IDIOMS_PATH);

describe('idioms.json sources', () => {
  it('holds 378 unique idioms, each with a non-empty source', () => {
    expect(idioms).toHaveLength(378);
    expect(new Set(idioms.map((row) => row.word)).size).toBe(378);
    for (const row of idioms) {
      expect(typeof row.source).toBe('string');
      expect(row.source.trim().length).toBeGreaterThan(0);
    }
  });

  it('holds at least 300 reviewed attributions rather than placeholders', () => {
    const reviewed = idioms.filter((row) => row.source !== PENDING_SOURCE);
    expect(reviewed.length).toBeGreaterThanOrEqual(300);
  });

  it('names the classical source of well-known allusions', () => {
    const byWord = new Map(idioms.map((row) => [row.word, row.source]));
    expect(byWord.get('百发百中')).toBe('《战国策·西周策》');
    expect(byWord.get('锲而不舍')).toBe('《荀子·劝学》');
    expect(byWord.get('卧薪尝胆')).toBe('《史记·越王勾践世家》');
    expect(byWord.get('破釜沉舟')).toBe('《史记·项羽本纪》');
  });
});

describe('idiom batches', () => {
  it('has one reviewed entry per word, aligned with idioms.json', () => {
    const canonical = new Map(idioms.map((row) => [row.word, row]));
    const seen = new Set<string>();
    for (const file of batchFiles()) {
      for (const row of readJson<SourceRow[]>(file)) {
        expect(seen.has(row.word), `duplicate word ${row.word} in ${file}`).toBe(false);
        seen.add(row.word);
        expect(row).toEqual(canonical.get(row.word));
      }
    }
    expect(seen.size).toBe(idioms.length);
  });
});

describe('source survives regeneration and import', () => {
  it('buildIdiomFile carries each source through from the batches', async () => {
    const { buildIdiomFile } = await import('@/scripts/build-idioms');
    const { rows } = buildIdiomFile(batchFiles());
    const byWord = new Map(idioms.map((row) => [row.word, row.source]));
    expect(rows).toHaveLength(idioms.length);
    for (const row of rows) {
      expect(row.source).toBe(byWord.get(row.word));
    }
  });

  it('readIdiomRows carries each source through from the shipped file', async () => {
    const { readIdiomRows } = await import('@/scripts/import-idioms');
    const rows = readIdiomRows(IDIOMS_PATH);
    const byWord = new Map(idioms.map((row) => [row.word, row.source]));
    expect(rows).toHaveLength(idioms.length);
    for (const row of rows) {
      expect(row.source).toBe(byWord.get(row.word));
    }
  });
});
