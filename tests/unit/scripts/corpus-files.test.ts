/**
 * scripts/fonts/corpus-files.mjs — the corpus files, in both storage shapes.
 *
 * The classics corpus is stored gzipped in the repository since
 * 2026-11-18. The font pipeline's corpus scanner used to look at
 * `*.json` only, so it found ZERO of the 196 classics files and silently
 * dropped the 10 970 distinct CJK characters they hold — a font that
 * cannot draw the classics, shipped without a single red test.
 *
 * These tests pin the fix: the file list must carry BOTH shapes, and a
 * file present in both must be listed once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { corpusJsonFiles, corpusJsonPaths } from '../../../scripts/fonts/corpus-files.mjs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'corpus-files-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('corpusJsonFiles', () => {
  it('lists a plain JSON file', () => {
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    expect(corpusJsonFiles(dir)).toEqual(['a.json']);
  });

  it('lists a gzipped JSON file', () => {
    // ⚠️ The shape the classics corpus has in the repository since
    // 2026-11-18. A scanner that only knows `*.json` finds nothing here.
    writeFileSync(join(dir, 'a.json.gz'), gzipSync(Buffer.from('{}', 'utf8')));
    expect(corpusJsonFiles(dir)).toEqual(['a.json.gz']);
  });

  it('lists both shapes side by side', () => {
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'b.json.gz'), gzipSync(Buffer.from('{}', 'utf8')));
    expect(corpusJsonFiles(dir)).toEqual(['a.json', 'b.json.gz']);
  });

  it('lists a file that exists in both shapes once', () => {
    // The plain form is the one a human edits, so it wins — the
    // compressed twin is a stale copy of it. Listing both would count
    // the same book twice.
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'a.json.gz'), gzipSync(Buffer.from('{}', 'utf8')));
    expect(corpusJsonFiles(dir)).toEqual(['a.json']);
  });

  it('ignores a file that is not JSON at all', () => {
    writeFileSync(join(dir, 'notes.txt'), 'hello', 'utf8');
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    expect(corpusJsonFiles(dir)).toEqual(['a.json']);
  });

  it('returns an empty list for a directory that is not there', () => {
    // A corpus the repository does not have is not an error — the caller
    // skips it with a note.
    expect(corpusJsonFiles(join(dir, 'nope'))).toEqual([]);
  });

  it('sorts the list, so a scan is reproducible', () => {
    writeFileSync(join(dir, 'c.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'b.json'), '{}', 'utf8');
    expect(corpusJsonFiles(dir)).toEqual(['a.json', 'b.json', 'c.json']);
  });
});

describe('corpusJsonPaths', () => {
  it('joins every name onto the directory', () => {
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'b.json.gz'), gzipSync(Buffer.from('{}', 'utf8')));
    expect(corpusJsonPaths(dir)).toEqual([join(dir, 'a.json'), join(dir, 'b.json.gz')]);
  });
});
