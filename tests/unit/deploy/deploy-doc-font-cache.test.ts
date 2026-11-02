/**
 * The font cache layers in `DEPLOY.md` (Task 9, ruling R-207b).
 *
 * `DEPLOY.md` carries two nginx snippets — the "run it on this machine"
 * variant (§3.6) and the "full example" variant (§4). Both of them had a
 * single `location /font/` block with `expires 1y`, which is TWO defects:
 *
 *  1. **One layer.** `/font/fonts-*.css` and `/font/fonts-manifest.json` are
 *     rewritten on every apply, so pinning them for a year means a visitor
 *     keeps the OLD stylesheet for a year — and with it the old `?v=` token,
 *     so the new release never reaches them. That is the silent-rollback
 *     entry point this wave is about.
 *  2. **Two `Cache-Control` headers.** nginx's `expires 1y` emits an
 *     `Expires:` AND its own `Cache-Control: max-age=…`; stacking
 *     `add_header Cache-Control` on top of that produces TWO `Cache-Control`
 *     headers, and the browser's behaviour under that is not defined.
 *     The live site was measured with exactly ONE `Cache-Control`.
 *
 * ⇒ The two layers are: `/font/web/**` (the release directory `r<token>/…`,
 * content-addressed file names ⇒ the URL bytes never change) at one year
 * `immutable`, and everything else under `/font/` (the stylesheets and the
 * manifest) at 30 days.
 *
 * ⚠️ **`/font/` is a PREFIX of `/fonts/`.** `/fonts/` (with the s) is a
 * DIFFERENT path — `public/fonts/`, the 196 MB OFL brush fonts — and its TTL
 * is NOT part of this change. Every matcher below therefore anchors the WHOLE
 * line (`/^\s*location \/font\/\s*\{/`), never a plain `includes('location
 * /font/')`, which would also match the `/fonts/` line.
 *
 * ⚠️ **No hard-coded line numbers.** The blocks are found by matching, so a
 * re-flow of the document does not make this test red for the wrong reason.
 *
 * ⚠️ `next.config.ts` expresses the same two layers for Next.js itself, with
 * a NEGATIVE LOOKAHEAD (`/font/:path((?!web/|web$).*)`) because Next applies
 * every matching rule in order. nginx has no negative lookahead — it splits
 * the two layers by LONGEST PREFIX. ⇒ The two spellings reach the same
 * result by different means, and the nginx one must not be written with a
 * bracket group (`/font/(?!web/)` never matches at all).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');

/** The whole `DEPLOY.md`. */
const deploy = readFileSync(resolve(ROOT, 'DEPLOY.md'), 'utf8');

/** One nginx `location` block, as the text from its line to the next one. */
interface LocationBlock {
  /** The `location` path as written, e.g. `/font/web/`. */
  path: string;
  /** The full text of the block. */
  text: string;
  /** Where the block starts, in characters from the top of the file. */
  offset: number;
}

/**
 * Every nginx `location` block in a snippet, in the order they appear.
 *
 * ⚠️ The path is anchored: the regex requires the whole path to be the
 * quoted-or-bare token between `location` and `{`, so `/font/` never
 * swallows `/fonts/` and `/font/web/` never gets found as `/font/`.
 */
function locationBlocks(source: string): LocationBlock[] {
  const blocks: LocationBlock[] = [];
  const pattern = /^\s*location\s+(\S+)\s*\{/gm;
  let match = pattern.exec(source);
  while (match !== null) {
    const start = match.index;
    const next = pattern.exec(source);
    const end = next === null ? source.length : next.index;
    blocks.push({
      path: match[1],
      text: source.slice(start, end),
      offset: start,
    });
    match = next;
  }
  return blocks;
}

const blocks = locationBlocks(deploy);

/** The blocks of one path — there are two snippets, so there are two of each. */
function blocksOf(path: string): LocationBlock[] {
  return blocks.filter((block) => block.path === path);
}

describe('DEPLOY.md states the two font cache layers (R-207b)', () => {
  it('has exactly one /font/web/ block per snippet (two snippets in all)', () => {
    expect(blocksOf('/font/web/')).toHaveLength(2);
  });

  it('has exactly one /font/ block per snippet (two snippets in all)', () => {
    expect(blocksOf('/font/')).toHaveLength(2);
  });

  it('never lets a /font/ block keep the old one-year expires', () => {
    for (const path of ['/font/', '/font/web/']) {
      for (const block of blocksOf(path)) {
        expect(block.text).not.toContain('expires 1y');
        // `expires` at all — it emits a second Cache-Control on its own.
        expect(block.text).not.toMatch(/\bexpires\b/);
      }
    }
  });

  it('caches the release directory for a year with immutable', () => {
    for (const block of blocksOf('/font/web/')) {
      expect(block.text).toContain('max-age=31536000');
      expect(block.text).toContain('immutable');
    }
  });

  it('caches the mutable layer (stylesheets and manifest) for 30 days', () => {
    for (const block of blocksOf('/font/')) {
      expect(block.text).toContain('max-age=2592000');
      expect(block.text).not.toContain('immutable');
    }
  });

  it('sends the Cache-Control on error responses too (always;)', () => {
    for (const path of ['/font/', '/font/web/']) {
      for (const block of blocksOf(path)) {
        expect(block.text).toContain('always');
      }
    }
  });

  it('puts the long prefix first so a reader sees which layer is which', () => {
    // ⚠️ Only /font/web/ versus /font/ is compared. The position of
    // /fonts/ relative to /font/ is the document's writing order and carries
    // no meaning — nginx picks the LONGEST prefix, not the first line.
    for (const path of ['/font/', '/font/web/']) {
      const block = blocksOf(path)[0];
      expect(block).toBeDefined();
    }
    const web = blocksOf('/font/web/');
    const font = blocksOf('/font/');
    for (let index = 0; index < web.length; index += 1) {
      expect(web[index].offset).toBeLessThan(font[index].offset);
    }
  });

  it('does not write a bracketed path group — nginx has no negative lookahead', () => {
    // `/font/(?!web/)` would never match at all; the two layers are split by
    // the longest prefix instead.
    expect(deploy).not.toContain('/font/(?!');
    expect(deploy).not.toMatch(/location\s+\/font\/\(/);
  });
});

describe('DEPLOY.md leaves the other static trees alone (R-207g)', () => {
  // ⚠️ `/fonts/` (with the s) is `public/fonts/` — the 196 MB OFL brush
  // fonts. Their URLs never change, so a year with `immutable` is CORRECT
  // for them, and it is NOT part of this change. Same for `/strokes/` and
  // `/_next/static/`. Rewriting them "for consistency" would be a change
  // beyond the task's scope.
  it('keeps the one-year immutable cache of /fonts/', () => {
    const fonts = blocksOf('/fonts/');
    expect(fonts).toHaveLength(2);
    for (const block of fonts) {
      expect(block.text).toContain('expires 1y');
      expect(block.text).toContain('public, immutable');
    }
  });

  it('keeps the one-year immutable cache of /strokes/', () => {
    const strokes = blocksOf('/strokes/');
    expect(strokes).toHaveLength(2);
    for (const block of strokes) {
      expect(block.text).toContain('expires 1y');
    }
  });

  it('keeps the one-year immutable cache of /_next/static/', () => {
    const nextStatic = blocksOf('/_next/static/');
    expect(nextStatic).toHaveLength(2);
    for (const block of nextStatic) {
      expect(block.text).toContain('expires 1y');
    }
  });
});
