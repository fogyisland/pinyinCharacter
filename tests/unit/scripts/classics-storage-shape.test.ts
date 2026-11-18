/**
 * The classics corpus is stored GZIPPED in the repository since 2026-11-18
 * (see `scripts/gzip-classics.ts`). Everything that walks
 * `data/classics/` has to accept BOTH storage shapes — `.json` and
 * `.json.gz` — or it silently sees an EMPTY directory.
 *
 * These tests pin the two shapes that hurt the most when they are wrong:
 *
 *   - the FONT charset scan, because a wrong charset ships a font that
 *     cannot draw the classics (10 970 characters) and NOTHING turns red;
 *   - the MANIFEST rebuild, because an empty manifest seeds an empty
 *     `classics` table and the site looks complete while holding nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { corpusJsonFiles } from '../../../scripts/fonts/corpus-files.mjs';
import { buildManifestFromDisk } from '../../../scripts/build-classics';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'classics-shape-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A minimal book, in the shape the manifest builder reads. */
const BOOK = {
  slug: 'demo',
  title: '示例',
  category: 'other',
  author: null,
  era: null,
  source: 'test',
  bookId: 'demo',
  bookTitle: '示例',
  // `content` is an array of PARAGRAPHS and each paragraph is an array of
  // lines — that is the shape `countChars` walks.
  chunks: [{ id: 1, label: '第一章', content: [['天地玄黄，宇宙洪荒。']], pinyin: [[]] }],
};

describe('the corpus file list', () => {
  it('sees a gzipped corpus where the plain files used to be', () => {
    // ⚠️ THE regression this file exists for: on 2026-11-18 the classics
    // corpus became `.json.gz` in the repository, and a `*.json`-only
    // filter found ZERO of the 196 files.
    writeFileSync(join(dir, 'a.json.gz'), gzipSync(Buffer.from(JSON.stringify(BOOK), 'utf8')));
    expect(corpusJsonFiles(dir)).toEqual(['a.json.gz']);
    expect(existsSync(join(dir, 'a.json'))).toBe(false);
  });
});

describe('buildManifestFromDisk', () => {
  it('builds an entry for a gzipped book', () => {
    // The manifest is what seeds the `classics` table (see
    // scripts/init-db.ts). A rebuild that skipped the gzipped books would
    // produce an EMPTY manifest and an empty table — the site would look
    // complete while holding nothing.
    writeFileSync(join(dir, 'demo.json.gz'), gzipSync(Buffer.from(JSON.stringify(BOOK), 'utf8')));

    const manifest = buildManifestFromDisk(dir);

    expect(manifest.books).toHaveLength(1);
    expect(manifest.books[0].slug).toBe('demo');
    expect(manifest.books[0].chapterCount).toBe(1);
  });

  it('builds an entry for a plain book too', () => {
    writeFileSync(join(dir, 'demo.json'), JSON.stringify(BOOK), 'utf8');

    const manifest = buildManifestFromDisk(dir);

    expect(manifest.books).toHaveLength(1);
    expect(manifest.books[0].slug).toBe('demo');
  });

  it('builds one entry per book when the corpus mixes both shapes', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...BOOK, slug: 'a' }), 'utf8');
    writeFileSync(
      join(dir, 'b.json.gz'),
      gzipSync(Buffer.from(JSON.stringify({ ...BOOK, slug: 'b' }), 'utf8')),
    );

    const manifest = buildManifestFromDisk(dir);

    expect(manifest.books.map((book) => book.slug).sort()).toEqual(['a', 'b']);
  });

  it('points the jsonFile field at the file that is really there', () => {
    // The manifest names the file the runtime will read. On the gzipped
    // corpus the name has to carry the `.gz`, or the reader looks for a
    // plain file that is not there.
    writeFileSync(join(dir, 'demo.json.gz'), gzipSync(Buffer.from(JSON.stringify(BOOK), 'utf8')));

    const manifest = buildManifestFromDisk(dir);

    expect(manifest.books[0].jsonFile).toBe('data/classics/demo.json.gz');
  });
});
