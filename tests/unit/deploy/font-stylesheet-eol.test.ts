/**
 * The font stylesheets must survive a checkout on every platform.
 *
 * ## WHY
 *
 * The manifest's `version` IS the cache-buster of the stylesheet URLs:
 * `lib/font-css.ts` appends `?v=<manifest version>` to every
 * `fonts-*.css` URL, and the version is the sha256 of the stylesheets'
 * contents (`scripts/fonts/build-webfont-subsets.mjs`'s
 * `manifestVersion()`).
 *
 * ⇒ If a stylesheet's BYTES change without the version changing, the
 * browser keeps the old CSS — the URL is unchanged, so the 30-day cache
 * layer serves the previous file and nobody ever sees the new one. The
 * page draws with the wrong font rules until the cache expires.
 *
 * ## THE DEFECT THIS PINS
 *
 * The stylesheets were stored with LF endings, and `.gitattributes` said
 * so — but it said it about the OLD file names:
 *
 *     public/font/fonts-sans.css   text eol=lf
 *     public/font/fonts-serif.css  text eol=lf
 *     public/font/fonts-wenkai.css text eol=lf
 *
 * The ext tier split (commit 0c08b0587) renamed every one of them:
 *
 *     fonts-sans.css   →  fonts-sans-hot.css  +  fonts-sans-ext.css
 *     fonts-serif.css  →  fonts-serif-hot.css +  fonts-serif-ext.css
 *     fonts-wenkai.css →  fonts-wenkai-hot.css+  fonts-wenkai-ext.css
 *
 * and the `.gitattributes` rules were NOT updated. A gitattributes
 * pattern that matches no file is not a harmless leftover: it means the
 * six live stylesheets have NO eol pin, so on a machine with
 * `core.autocrlf=true` (the default on Windows) git rewrites their LF
 * endings to CRLF on checkout.
 *
 * That rewrite is INVISIBLE:
 *
 *   - `git status` reports the files as clean, because autocrlf
 *     normalizes them back to LF on the way in — the working tree
 *     matches the index by git's own definition;
 *   - the blob in the commit is still LF, so the repository is not
 *     "corrupted";
 *   - but the working tree's bytes no longer hash to the manifest's
 *     version, so the stylesheet and its cache-buster disagree.
 *
 * On the production Linux server (LF checkout) nothing is wrong — which
 * is why this stayed hidden. On a Windows developer machine the
 * stylesheet the browser gets is not the stylesheet the manifest names.
 *
 * ## WHAT THE TEST CHECKS
 *
 * That every stylesheet the manifest names has an eol pin in
 * `.gitattributes` that still matches its CURRENT name. The check is on
 * the RULES, not on the machine's `core.autocrlf` — the test must fail
 * on a machine whose checkout happens to be LF, or it would only fail for
 * the people who already noticed the bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

/** The stylesheets the manifest names, as paths relative to `public/`. */
function manifestStylesheets(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'public', 'font', 'fonts-manifest.json'), 'utf8'),
  ) as { files?: Record<string, string> };
  const files = manifest.files ?? {};
  // The manifest's values are URL paths (`/font/fonts-sans-hot.css`); the
  // repository's files live under `public/`, and `.gitattributes` patterns
  // are relative to the repository root — so the paths are rooted at
  // `public/` here, which is the form git resolves attributes against.
  return [
    ...new Set(
      Object.values(files).map((url) => `public/${url.replace(/^\/+/, '')}`),
    ),
  ].sort();
}

/**
 * The gitattributes patterns that pin the line endings of a path.
 *
 * Only the `eol=lf` attribute matters here: it is what makes git write
 * LF into the working tree regardless of `core.autocrlf`. A pattern
 * without a leading slash matches at ANY depth, so
 * `public/font/fonts-sans-hot.css text eol=lf` matches the file.
 */
function eolPins(): string[] {
  const raw = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
  const pins: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // `pattern attr1 attr2` — the attributes are space separated.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    if (parts.slice(1).some((attr) => attr === 'eol=lf')) pins.push(parts[0]);
  }
  return pins;
}

/**
 * The `eol` attribute git actually resolves for a path.
 *
 * ⚠️ The matching rules of `.gitattributes` are git's own — a leading
 * slash anchors a pattern to the repository root, a pattern with a slash
 * in it matches relative to the .gitattributes' directory, and a pattern
 * without one matches at any depth. Hand-rolling that is how a test ends
 * up green for the wrong reason, so git is asked instead:
 * `git check-attr` IS the implementation of the matching.
 *
 * @param path the path, relative to the repository root
 * @returns `lf`, `crlf`, `unspecified`, or `unset`
 */
function resolvedEol(path: string): string {
  const out = execFileSync('git', ['check-attr', 'eol', '--', path], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // `<path>: eol: lf`
  const match = /:\s*eol:\s*(\S+)\s*$/.exec(out.trim());
  return match ? match[1] : 'unspecified';
}

describe('the font stylesheets survive a checkout on every platform', () => {
  it('the manifest names six stylesheets', () => {
    // If this ever changes, the rest of the file's expectations change
    // with it — and a rule that quietly stopped matching would be
    // exactly the bug this file exists to catch.
    expect(manifestStylesheets()).toHaveLength(6);
  });

  it('every stylesheet the manifest names has an eol=lf pin', () => {
    const unpinned = manifestStylesheets().filter((path) => resolvedEol(path) !== 'lf');

    expect(unpinned).toEqual([]);
  });

  it('no eol pin names a file that does not exist', () => {
    // A pattern that matches nothing is not a harmless leftover — it is
    // a rule that was supposed to protect a file and now protects
    // nothing. This is the shape the split left behind.
    const pins = eolPins();
    const stale = pins.filter((pattern) => {
      if (!pattern.includes('/')) return false; // a bare name is fine
      const fileName = pattern.split(/\s+/)[0];
      try {
        readFileSync(join(ROOT, fileName));
        return false;
      } catch {
        return true;
      }
    });

    expect(stale).toEqual([]);
  });

  it('the working tree stylesheets hash to the manifest version', () => {
    // The end-to-end statement of the same invariant: the bytes the
    // browser will fetch, and the token that busts their cache, agree.
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'public', 'font', 'fonts-manifest.json'), 'utf8'),
    ) as { version?: string };

    const stylesheets = manifestStylesheets().map((path) => ({
      name: path.slice(path.lastIndexOf('/') + 1),
      content: readFileSync(join(ROOT, path), 'utf8'),
    }));

    const hash = createHash('sha256');
    for (const sheet of [...stylesheets].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      hash.update(sheet.content);
    }
    const version = hash.digest('hex').slice(0, 12);

    expect(version).toBe(manifest.version);
  });
});
