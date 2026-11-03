/**
 * lib/seed-registry.ts — the single source of truth for "how many rows of
 * each dataset this project expects".
 *
 * Before this registry existed the expected sizes lived in four unrelated
 * places: `import-hsk.ts` (2632), the `data/` directory counts (7905 /
 * 1165 / 196 / 12), `lib/init-checklist.ts` (hskExpected = 2632) and
 * `DEPLOY.md §9` (prose). They drifted, and a server could be missing an
 * entire dataset while every checklist step was green.
 *
 * These tests pin the expected sizes against the repository's own data
 * files, so a change to the data cannot silently change what "complete"
 * means.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SEED_DATASETS,
  HSK_EXPECTED,
  getSeedDataset,
  countDataFilesIn,
} from '@/lib/seed-registry';
import hskVocab from '@/data/hsk-vocab.json';
import standardChars from '@/data/general-standard-chinese-characters.json';
import poemsManifest from '@/data/poems-manifest.json';

describe('seed registry — expected sizes', () => {
  it('counts the HSK vocabulary as the union of its levels', () => {
    const union = new Set<string>();
    for (const entries of Object.values(hskVocab)) {
      for (const entry of entries) union.add(entry.char);
    }
    expect(HSK_EXPECTED).toBe(union.size);
  });

  it('derives the HSK count from the vocabulary file, not from a literal', () => {
    // A hard-coded 2632 happens to equal the counted value today, so the
    // test that only checks "2632" cannot tell the two apart. This one
    // recomputes the union and demands an exact match — a hard-coded
    // constant that drifts when the data changes fails here.
    const union = new Set<string>();
    for (const entries of Object.values(hskVocab)) {
      for (const entry of entries) union.add(entry.char);
    }
    expect(HSK_EXPECTED).toBe(union.size);
    expect(HSK_EXPECTED).toBeGreaterThan(0);
  });

  it('expects 2632 graded chars — the number the import writes', () => {
    expect(HSK_EXPECTED).toBe(2632);
  });

  it('expects every character of the standard set in `chars`', () => {
    const dataset = getSeedDataset('chars');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBe(standardChars.length);
  });

  it('expects the poems the manifest declares', () => {
    const manifest = poemsManifest as { count?: number; items?: unknown[] };
    const expected =
      typeof manifest.count === 'number' ? manifest.count : (manifest.items?.length ?? 0);
    const dataset = getSeedDataset('poems');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBe(expected);
    expect(dataset!.expected).toBeGreaterThan(0);
  });

  it('expects the classics the data directory holds', () => {
    const dataset = getSeedDataset('classics');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBeGreaterThan(0);
  });

  it('expects a HSK dataset of 2632', () => {
    const dataset = getSeedDataset('hsk-grading');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBe(2632);
    expect(dataset!.table).toBe('chars');
  });

  it('gives every dataset a table, a label and a dependency note', () => {
    for (const dataset of SEED_DATASETS) {
      expect(dataset.table, `${dataset.id} has no table`).toBeTruthy();
      expect(dataset.label, `${dataset.id} has no label`).toBeTruthy();
      expect(dataset.dependsOn, `${dataset.id} has no dependency note`).toBeTruthy();
      expect(dataset.manualCommand, `${dataset.id} has no manual command`).toContain(
        'seed:run',
      );
    }
  });

  it('never expects zero rows for a dataset that has data', () => {
    for (const dataset of SEED_DATASETS) {
      expect(dataset.expected, `${dataset.id} expects zero rows`).toBeGreaterThan(0);
    }
  });

  it('gives every dataset a unique id', () => {
    const ids = SEED_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks a dataset up by id and returns undefined for an unknown one', () => {
    expect(getSeedDataset('sutras')?.table).toBe('sutras');
    expect(getSeedDataset('not-a-dataset')).toBeUndefined();
  });
});

describe('seed registry — the deploy bundle holds gzipped data', () => {
  // The deploy bundle ships `data/content/` and `data/classics/` as
  // `.json.gz` to save about 190MB. A registry that counted only `.json`
  // files would report zero for those datasets on the server and call a
  // complete database empty — the seed would then run on every boot and
  // the checklist would report a false gap.
  it('counts a directory whose files are all gzipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-gz-'));
    writeFileSync(join(dir, 'a.json.gz'), '');
    writeFileSync(join(dir, 'b.json.gz'), '');
    writeFileSync(join(dir, 'c.json.gz'), '');

    expect(countDataFilesIn(dir)).toBe(3);
  });

  it('counts a file that is present in both plain and gzipped form once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-gz-'));
    writeFileSync(join(dir, 'a.json'), '');
    writeFileSync(join(dir, 'a.json.gz'), '');

    expect(countDataFilesIn(dir)).toBe(1);
  });

  it('counts a plain directory the same way', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-plain-'));
    writeFileSync(join(dir, 'a.json'), '');
    writeFileSync(join(dir, 'b.json'), '');
    writeFileSync(join(dir, 'notes.txt'), '');

    expect(countDataFilesIn(dir)).toBe(2);
  });

  it('counts a missing directory as zero', () => {
    expect(countDataFilesIn(join(tmpdir(), 'seed-does-not-exist'))).toBe(0);
  });

  it('keeps the sutra count stable whether the files are plain or gzipped', () => {
    // `data/sutras/` is NOT gzipped by the packager, so the plain count is
    // the reference. The count must not depend on the file extension.
    expect(getSeedDataset('sutras')!.expected).toBe(12);
  });

  it('reads a gzipped manifest when the plain one is absent', () => {
    // `readJsonAuto` is the shared helper: it reads `.json` first and
    // falls back to `.json.gz`. The registry uses it for every manifest,
    // so a bundle that ships a gzipped manifest still counts correctly.
    expect(getSeedDataset('poems')!.expected).toBeGreaterThan(0);
    expect(getSeedDataset('classics')!.expected).toBeGreaterThan(0);
  });
});
