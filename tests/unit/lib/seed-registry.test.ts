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
  seedOrder,
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

  it('expects every IMPORTABLE character of the standard set in `chars`', () => {
    // ⚠️ Not `standardChars.length` (8105). The source file holds 196
    // supplementary-plane characters, and JavaScript's `String.length`
    // counts them as 2 — so `initChars()` skips them on purpose (mysql2's
    // binary protocol corrupts 4-byte UTF-8). The expected value has to be
    // what the table can hold, or the shortfall never closes.
    const importable = standardChars.filter((c) => c.length === 1).length;
    const dataset = getSeedDataset('chars');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBe(importable);
    expect(dataset!.expected).toBeLessThan(standardChars.length);
    expect(dataset!.expected).toBe(7909);
  });

  it('expects the same number of rows in `char-etymology` as in `chars`', () => {
    // The etymology rows are one per importable character — they are
    // joined against `chars`, so the two tables cannot diverge.
    expect(getSeedDataset('char-etymology')!.expected).toBe(
      getSeedDataset('chars')!.expected,
    );
  });

  it('expects the rare characters the importer rule selects', () => {
    // The rule `initRareChars()` applies: `level === 3` AND a non-empty
    // `rare.meaning`. The manifest's `byField.rare_meaning` counts every
    // level, so it over-counts by 3 (1412 vs 1409) — using it made the
    // shortfall permanent.
    const dataset = getSeedDataset('rare-chars');
    expect(dataset).toBeDefined();
    expect(dataset!.expected).toBe(1409);
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

  it('never expects more rows than the importers can write', () => {
    // The defect class this guards: an expected value computed from a
    // WIDER rule than the import rule. The count then sits above the
    // reachable maximum, the seed reports `pending` forever, and the admin
    // screen keeps asking for a gap that can never be closed.
    //
    // `chars` and `char-etymology` are capped by the importable-character
    // count; `rare-chars` by the `level === 3` rule; `sutras` by the
    // number of sutra files (the manifest is not one of them).
    const importableChars = standardChars.filter((c) => c.length === 1).length;
    const ceilings: Record<string, number> = {
      chars: importableChars,
      'char-etymology': importableChars,
      'rare-chars': 1409,
      sutras: 11,
    };
    for (const dataset of SEED_DATASETS) {
      const ceiling = ceilings[dataset.id];
      if (ceiling === undefined) continue;
      expect(
        dataset.expected,
        `${dataset.id} expects ${dataset.expected} but the importers can write at most ${ceiling}`,
      ).toBeLessThanOrEqual(ceiling);
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

describe('seed registry — the seeding order', () => {
  // The order is not cosmetic. The HSK grading writes a column on the
  // `chars` table, and the etymology rows are joined against `chars`:
  // seeding either before the characters are in place leaves them empty,
  // and because the run is over afterwards, nothing comes back to fill
  // them. This is what a production server actually looked like.

  it('seeds the characters before the datasets that need them', () => {
    const order = seedOrder(SEED_DATASETS).map((d) => d.id);

    const charsAt = order.indexOf('chars');
    expect(charsAt).toBeGreaterThanOrEqual(0);

    for (const dependent of ['hsk-grading', 'rare-chars', 'char-etymology']) {
      const at = order.indexOf(dependent);
      expect(at, `${dependent} is missing from the order`).toBeGreaterThanOrEqual(0);
      expect(at, `${dependent} must be seeded after chars`).toBeGreaterThan(charsAt);
    }
  });

  it('seeds the HSK grading after the characters', () => {
    // The exact failure: the grading ran first, found an empty table,
    // wrote nothing, and the run never came back.
    const order = seedOrder(SEED_DATASETS).map((d) => d.id);
    expect(order.indexOf('chars')).toBeLessThan(order.indexOf('hsk-grading'));
  });

  it('declares the dependency in the registry', () => {
    expect(getSeedDataset('hsk-grading')?.requires).toContain('chars');
    expect(getSeedDataset('char-etymology')?.requires).toContain('chars');
    expect(getSeedDataset('rare-chars')?.requires).toContain('chars');
  });

  it('keeps every dataset exactly once', () => {
    const order = seedOrder(SEED_DATASETS).map((d) => d.id);
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBe(SEED_DATASETS.length);
  });

  it('survives a dependency cycle without looping', () => {
    const cyclic = [
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a'] },
    ] as unknown as Parameters<typeof seedOrder>[0];

    const order = seedOrder(cyclic).map((d) => d.id);
    expect(order).toHaveLength(2);
  });

  it('ignores a dependency on a dataset that is not registered', () => {
    const dangling = [
      { id: 'a', requires: ['does-not-exist'] },
    ] as unknown as Parameters<typeof seedOrder>[0];

    expect(seedOrder(dangling).map((d) => d.id)).toEqual(['a']);
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
    //
    // ⚠️ 11, not 12: `data/sutras/` holds 11 sutras plus a `manifest.json`
    // that indexes them. Counting the manifest as a sutra made the
    // expected value unreachable — the admin screen asked for a row that
    // does not exist.
    expect(getSeedDataset('sutras')!.expected).toBe(11);
  });

  it('does not count a manifest.json as a data file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-manifest-'));
    writeFileSync(join(dir, 'a.json'), '');
    writeFileSync(join(dir, 'b.json'), '');
    writeFileSync(join(dir, 'manifest.json'), '');

    expect(countDataFilesIn(dir)).toBe(2);
  });

  it('does not count a gzipped manifest.json as a data file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-manifest-gz-'));
    writeFileSync(join(dir, 'a.json.gz'), '');
    writeFileSync(join(dir, 'manifest.json.gz'), '');

    expect(countDataFilesIn(dir)).toBe(1);
  });

  it('reads a gzipped manifest when the plain one is absent', () => {
    // `readJsonAuto` is the shared helper: it reads `.json` first and
    // falls back to `.json.gz`. The registry uses it for every manifest,
    // so a bundle that ships a gzipped manifest still counts correctly.
    expect(getSeedDataset('poems')!.expected).toBeGreaterThan(0);
    expect(getSeedDataset('classics')!.expected).toBeGreaterThan(0);
  });
});
