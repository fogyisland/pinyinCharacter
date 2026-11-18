/**
 * scripts/gzip-classics.ts — the classics corpus, stored gzipped.
 *
 * The corpus is 251 MB of JSON across 196 files and it is the largest
 * thing in the packed git repository. The read path ALREADY falls back to
 * `.json.gz` (lib/json-fs.ts's readJsonAuto), and the deploy bundle
 * ALREADY ships these files gzipped (scripts/copy-to-up.py's GZIP_DIRS) —
 * so the repository is the only place still carrying the plain form.
 *
 * These tests pin three things:
 *   - the round trip is byte-exact (the corpus must not change);
 *   - a file that already has a compressed twin is left alone;
 *   - the `.gitignore` un-ignore rule EXISTS — without it `git add` skips
 *     every file silently and the commit looks successful while shipping
 *     nothing. That is the hardest failure to notice, so it is pinned.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gzipClassics, decompressClassics } from '@/scripts/gzip-classics';

let root: string;
const temporaryRoots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gzip-classics-'));
  temporaryRoots.push(root);
  // ⚠️ The REAL shape: the script looks for `<repoRoot>/data/classics`, not
  // `<repoRoot>/classics`. The fixture has to be the real layout, or the
  // test would pass against a script that compresses the wrong directory.
  mkdirSync(join(root, 'data', 'classics'), { recursive: true });
});

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('gzipClassics', () => {
  it('writes a .json.gz beside every .json and removes the plain file', () => {
    writeFileSync(join(root, 'data', 'classics', 'a.json'), '{"chunks":[{"id":1}]}', 'utf8');
    writeFileSync(join(root, 'data', 'classics', 'b.json'), '{"chunks":[{"id":2}]}', 'utf8');

    const result = gzipClassics(root);

    expect(result.compressed).toBe(2);
    expect(existsSync(join(root, 'data', 'classics', 'a.json'))).toBe(false);
    expect(existsSync(join(root, 'data', 'classics', 'a.json.gz'))).toBe(true);
    expect(existsSync(join(root, 'data', 'classics', 'b.json.gz'))).toBe(true);
  });

  it('round-trips the bytes exactly', () => {
    const payload = JSON.stringify({ chunks: [{ id: 1, label: '第一' }] });
    writeFileSync(join(root, 'data', 'classics', 'a.json'), payload, 'utf8');

    gzipClassics(root);
    decompressClassics(root);

    expect(readFileSync(join(root, 'data', 'classics', 'a.json'), 'utf8')).toBe(payload);
  });

  it('leaves a file that already has a .gz alone', () => {
    writeFileSync(join(root, 'data', 'classics', 'a.json'), '{}', 'utf8');
    writeFileSync(join(root, 'data', 'classics', 'b.json.gz'), 'not gzip', 'utf8');

    const result = gzipClassics(root);

    // b.json.gz was never a .json, so it is not a candidate at all.
    expect(result.compressed).toBe(1);
    expect(readFileSync(join(root, 'data', 'classics', 'b.json.gz'), 'utf8')).toBe('not gzip');
  });

  it('does not compress a file whose compressed twin already exists', () => {
    // The plain file and its twin are BOTH there — the state a half-run
    // script leaves behind. Re-compressing would overwrite the twin, and
    // the bytes of the plain file might be older than the twin's.
    writeFileSync(join(root, 'data', 'classics', 'a.json'), 'plain', 'utf8');
    writeFileSync(join(root, 'data', 'classics', 'a.json.gz'), 'already compressed', 'utf8');

    const result = gzipClassics(root);

    expect(result.compressed).toBe(0);
    expect(readFileSync(join(root, 'data', 'classics', 'a.json.gz'), 'utf8')).toBe('already compressed');
    // The plain file stays — it is not the script's business to delete a
    // file it did not compress.
    expect(existsSync(join(root, 'data', 'classics', 'a.json'))).toBe(true);
  });

  it('reports the bytes it replaced', () => {
    // ⚠️ The payload has to be big enough for gzip to win. The gzip
    // HEADER alone is 20+ bytes, so a 21-byte JSON comes OUT BIGGER than
    // it went in — and the real corpus (196 files, 251 MB) has no such
    // file. Asserting "the compressed form is smaller" on a 21-byte
    // payload would be asserting something false about gzip.
    const payload = JSON.stringify({
      chunks: Array.from({ length: 50 }, (_, index) => ({
        id: index + 1,
        title: `第${index + 1}章`,
        text: '天地玄黄，宇宙洪荒，日月盈昃，辰宿列张。',
      })),
    });
    writeFileSync(join(root, 'data', 'classics', 'a.json'), payload, 'utf8');

    const result = gzipClassics(root);

    expect(result.bytesIn).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(result.bytesOut).toBeGreaterThan(0);
    expect(result.bytesOut).toBeLessThan(result.bytesIn);
  });

  it('says nothing when the classics directory is not there', () => {
    // A repository that has no classics at all is not an error — the
    // script has nothing to do and must not throw.
    const empty = mkdtempSync(join(tmpdir(), 'gzip-classics-empty-'));
    temporaryRoots.push(empty);

    const result = gzipClassics(empty);

    expect(result.compressed).toBe(0);
    expect(result.bytesIn).toBe(0);
    expect(result.bytesOut).toBe(0);
  });
});

describe('decompressClassics', () => {
  it('expands every .json.gz back into a plain .json', () => {
    writeFileSync(join(root, 'data', 'classics', 'a.json'), '{"chunks":[{"id":1}]}', 'utf8');
    writeFileSync(join(root, 'data', 'classics', 'b.json'), '{"chunks":[{"id":2}]}', 'utf8');

    gzipClassics(root);
    const count = decompressClassics(root);

    expect(count).toBe(2);
    expect(existsSync(join(root, 'data', 'classics', 'a.json'))).toBe(true);
    expect(existsSync(join(root, 'data', 'classics', 'a.json.gz'))).toBe(false);
  });

  it('leaves a plain file that already exists alone', () => {
    // Both forms present: the plain one wins and the compressed twin
    // stays where it is — deleting it would lose bytes.
    writeFileSync(join(root, 'data', 'classics', 'a.json'), 'plain', 'utf8');
    writeFileSync(join(root, 'data', 'classics', 'a.json.gz'), 'compressed', 'utf8');

    const count = decompressClassics(root);

    expect(count).toBe(0);
    expect(readFileSync(join(root, 'data', 'classics', 'a.json'), 'utf8')).toBe('plain');
    expect(readFileSync(join(root, 'data', 'classics', 'a.json.gz'), 'utf8')).toBe('compressed');
  });
});

describe('the .gitignore rule', () => {
  it('un-ignores the compressed classics in .gitignore', () => {
    // Without the `!data/classics/*.json.gz` rule `git add data/classics`
    // silently skips every file and the commit looks successful while
    // shipping nothing. The next clone has no classics at all.
    const ignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    expect(ignore).toContain('!data/classics/*.json.gz');
  });

  it('keeps the blanket *.gz rule that the exception hangs off', () => {
    // The exception only works if it comes AFTER the blanket rule — in one
    // .gitignore the LAST matching rule wins. If the blanket rule were
    // moved below the exception, every other .gz in the repository (the
    // precompress-assets sidecars) would start being tracked.
    //
    // ⚠️ The line endings of .gitignore are CRLF on this machine, so the
    // comparison is made on the NORMALISED text — a stray `\r` between the
    // rule and the newline would make a naive indexOf() miss a rule that
    // is really there.
    const ignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8').replace(/\r\n/g, '\n');
    const blanket = ignore.indexOf('\n*.gz\n');
    const exception = ignore.indexOf('!data/classics/*.json.gz');
    expect(blanket).toBeGreaterThan(-1);
    expect(exception).toBeGreaterThan(-1);
    expect(exception).toBeGreaterThan(blanket);
  });
});
