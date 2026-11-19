/**
 * The two cache layers of the font assets (Task 11).
 *
 * The site ships ~800 KB of locally-built woff2 subsets under
 * `public/font/web/<family>/`, plus three per-family stylesheets and
 * `fonts-manifest.json`. The subsets live at URLs whose bytes never change,
 * so they may be cached for a year with `immutable`; the stylesheets and the
 * manifest are rewritten on every apply, so they need a FINITE upper bound
 * (the release/cleanup rules depend on it).
 *
 * ⚠️ The two rules must be DISJOINT BY CONSTRUCTION. Next.js applies every
 * matching header route in order and a later match overwrites an earlier one,
 * so a blanket `/font/:path*` followed by the 30-day rule would happen to
 * produce the right header today — but that guarantee dies the moment a third
 * rule is added. The negative lookahead in the 30-day source is what makes
 * the two layers exclusive, and the "matches every font path with exactly
 * one rule" assertion below is the proof.
 *
 * ⚠️ The lookahead must reject BOTH `web/…` and the bare `web`: the release
 * directory is a real path (`public/font/web` is a directory, so a request
 * for `/font/web` gets Next's 404 page), and a lookahead that only excludes
 * the literal `web/` lets it fall through to the 30-day rule — the two
 * layers would overlap on exactly that one path.
 *
 * ⚠️ The matcher here is NEXT'S OWN, not the standalone `path-to-regexp`
 * package: this repository depends on `path-to-regexp@8`, whose v8 syntax
 * refuses `:path*` outright ("Missing parameter name at index 16"), while
 * Next 15.5 bundles its own v6-era fork under `next/dist/compiled/`. The
 * production behaviour is the bundled one, so the test uses the same code
 * path `headers()` uses: `getPathMatch` + `modifyRouteRegex`.
 *
 * ⚠️ That bundled fork's lexer rejects a NESTED `(` inside a custom pattern
 * ("Capturing groups are not allowed at N"), so the lookahead has to be a
 * top-level alternation (`(?!web/|web$)`) and not a nested group
 * (`(?!web($|/))` would not even compile — it would throw while the config
 * is being loaded, taking the whole app down).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { NextConfig } from 'next';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';

import nextConfig from '@/next.config';

const ROOT = resolve(__dirname, '..', '..', '..');

/** One header route of `next.config.ts`. */
type HeaderRule = Awaited<ReturnType<NonNullable<NextConfig['headers']>>>[number];

/** The Cache-Control of the immutable layer — the woff2 subsets. */
const YEAR = 'public, max-age=31536000, immutable';

/** The Cache-Control of the mutable layer — the stylesheets and the manifest. */
const MONTH = 'public, max-age=2592000';

/**
 * Next.js's own path matcher, built exactly the way `headers()` builds it.
 *
 * `next/dist/server/lib/router-utils/filesystem.js` -> `buildCustomRoute(
 * 'header', …)` calls `getPathMatch(source, { strict: true,
 * removeUnnamedParams: true, regexModifier: modifyRouteRegex, sensitive:
 * caseSensitive })`, and `modifyRouteRegex` rewrites the trailing `$` into
 * `(?:\/)?$`.
 *
 * ⚠️ The query string is NOT part of what Next matches: header routes are
 * matched against the PATHNAME. `?v=<manifest version>` is browser cache
 * busting and never reaches the matcher, so a path is asserted without it.
 */
function nextHeaderMatcher(source: string) {
  return getPathMatch(source, {
    strict: true,
    removeUnnamedParams: true,
    regexModifier: (regex) => modifyRouteRegex(regex, undefined),
    sensitive: false,
  });
}

/** The header routes of `next.config.ts`, in the order the config lists them. */
let headerRules: HeaderRule[] = [];

beforeAll(async () => {
  const build = nextConfig.headers;
  if (!build) {
    throw new Error('next.config.ts declares no headers() — the font cache layers are gone');
  }
  headerRules = await build();
});

/**
 * The rules that match `pathname`, in the order the config lists them.
 *
 * ⚠️ This counts the rules that set a Cache-Control, NOT the rules that
 * match. The config also carries a catch-all rule that sets the security
 * headers (X-Frame-Options and friends) on every path — it matches every
 * font path too, and it sets no Cache-Control.
 *
 * The exclusivity this file proves is about the CACHE layers: two rules
 * that both set a Cache-Control on the same path would mean the last one
 * silently wins, and the guarantee would rest on the order of the array
 * instead of on the sources. A rule that sets no Cache-Control cannot
 * compete for that value, so it does not break the guarantee.
 */
function matchingRules(pathname: string): HeaderRule[] {
  return headerRules.filter(
    (rule) =>
      nextHeaderMatcher(rule.source)(pathname) !== false &&
      rule.headers.some((header) => header.key === 'Cache-Control'),
  );
}

/** Every Cache-Control value of the given rules, in order. */
function cacheControlValues(rules: HeaderRule[]): string[] {
  return rules.flatMap((rule) =>
    rule.headers.filter((header) => header.key === 'Cache-Control').map((header) => header.value),
  );
}

/**
 * The font paths whose layer this task decides.
 *
 * The last two are the release directory itself, with and WITHOUT its
 * trailing slash: the directory belongs to the woff2 layer, and it is the
 * path a crawler or a mistyped URL hits first. The bare `/font/web` is the
 * hard case — a lookahead that only excludes the literal `web/` lets it fall
 * through to the 30-day rule, so the two layers would overlap on it.
 */
const FONT_PATHS = [
  '/font/web/sans/hot.woff2',
  '/font/web/r0a1b2c3d4e5f/sans/hot.woff2',
  '/font/fonts-sans.css',
  '/font/fonts-manifest.json',
  '/font/fonts-serif.css',
  '/font/web/',
  '/font/web',
] as const;

describe('the font cache headers are split into two exclusive layers', () => {
  it('keeps the woff2 subsets on the one-year immutable TTL', () => {
    // ⚠️ This is the failure mode the whole task exists to prevent: a blanket
    // 30-day TTL over /font/** would make a returning visitor download
    // ~800 KB of subsets again every month.
    const hits = matchingRules('/font/web/sans/hot.woff2');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('/font/web/:path*');
    expect(cacheControlValues(hits)).toEqual([YEAR]);
  });

  it('keeps the release directory on the one-year immutable TTL too', () => {
    // The admin pipeline writes the next version under /font/web/r<token>/,
    // so the woff2 layer must cover the release directories as well.
    const hits = matchingRules('/font/web/r0a1b2c3d4e5f/sans/hot.woff2');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('/font/web/:path*');
    expect(cacheControlValues(hits)).toEqual([YEAR]);
  });

  it('keeps the bare release directory out of the thirty-day layer', () => {
    // ⚠️ `/font/web` WITHOUT a trailing slash is the one path the old
    // lookahead `(?!web/)` let through: it has no slash after `web`, so the
    // 30-day rule matched it as well and the two layers overlapped. The
    // directory is a real path (Next answers it with its 404 page), so the
    // overlap is observable in the response headers of that 404.
    for (const pathname of ['/font/web', '/font/web/']) {
      const hits = matchingRules(pathname);
      expect(hits, `${pathname} must match exactly one header rule`).toHaveLength(1);
      expect(hits[0].source, `${pathname} belongs to the woff2 layer`).toBe('/font/web/:path*');
      expect(cacheControlValues(hits)).toEqual([YEAR]);
    }
  });

  it('does not let the lookahead swallow a sibling of the web directory', () => {
    // The lookahead must reject `web` and `web/…` ONLY. A path whose first
    // segment merely STARTS with `web` (a directory that happens to be named
    // `webx`) belongs to the mutable layer like any other /font/ asset.
    const hits = matchingRules('/font/webx/sans/hot.woff2');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('/font/:path((?!web/|web$).*)');
    expect(cacheControlValues(hits)).toEqual([MONTH]);
  });

  it('puts the stylesheets on the thirty-day TTL', () => {
    const hits = matchingRules('/font/fonts-sans.css');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('/font/:path((?!web/|web$).*)');
    expect(cacheControlValues(hits)).toEqual([MONTH]);
  });

  it('puts the manifest on the thirty-day TTL', () => {
    const hits = matchingRules('/font/fonts-manifest.json');
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe('/font/:path((?!web/|web$).*)');
    expect(cacheControlValues(hits)).toEqual([MONTH]);
  });

  it('never marks the mutable layer immutable', () => {
    // The stylesheets are rewritten on every apply — `immutable` there would
    // pin a stale stylesheet in the browser for a year.
    for (const pathname of ['/font/fonts-sans.css', '/font/fonts-manifest.json']) {
      for (const value of cacheControlValues(matchingRules(pathname))) {
        expect(value, `${pathname} must not be immutable`).not.toContain('immutable');
      }
    }
  });

  it('splits the two layers with a negative lookahead instead of relying on order', () => {
    const sources = headerRules.map((rule) => rule.source);
    expect(sources).toContain('/font/web/:path*');
    expect(sources).toContain('/font/:path((?!web/|web$).*)');
    // The catch-all that used to cover the whole /font/ tree must be gone:
    // it would match every font path and break the exclusivity below.
    expect(sources).not.toContain('/font/:path*');
  });

  it('matches every font path with exactly one CACHE rule', () => {
    // ⚠️ THIS is the proof that the two layers are disjoint. Next.js does
    // not merge header rules — it applies every matching one — so a path that
    // matched two rules would take the last one's value, and the guarantee
    // would rest on the order of the array instead of on the sources.
    //
    // ⚠️ "One rule" means one rule that sets a Cache-Control. The config
    // also carries a catch-all for the security headers; it matches every
    // font path as well, but it sets no Cache-Control and therefore cannot
    // compete for the value. See matchingRules() above.
    for (const pathname of FONT_PATHS) {
      expect(
        matchingRules(pathname).map((rule) => rule.source),
        `the path ${pathname} must match exactly one cache rule`,
      ).toHaveLength(1);
    }
  });

  it('leaves the hard-pen and stroke rules alone', () => {
    const sources = headerRules.map((rule) => rule.source);
    expect(sources).toContain('/fonts/:path*');
    expect(sources).toContain('/strokes/:path*');
    const monthRules = headerRules.filter((rule) => rule.source === '/fonts/:path*');
    expect(cacheControlValues(monthRules)).toEqual([MONTH]);
  });
});

describe('the nginx template mirrors the two layers', () => {
  const nginxConf = readFileSync(resolve(ROOT, 'deploy', 'nginx.ziyun.pudafo.com.conf'), 'utf8');

  /**
   * The body of a `location` block, with the `#` comments stripped.
   *
   * ⚠️ The comments are stripped because a comment that merely QUOTES a
   * forbidden spelling (e.g. a note explaining why `expires` is not used)
   * would otherwise make the assertion below fail on a perfectly correct
   * config. Only the directives are judged.
   */
  function nginxBlock(marker: string): string {
    const start = nginxConf.indexOf(marker);
    expect(start, `the nginx template has no "${marker}" block`).toBeGreaterThan(-1);
    const open = nginxConf.indexOf('{', start);
    const close = nginxConf.indexOf('}', open);
    expect(close, `the "${marker}" block is never closed`).toBeGreaterThan(open);
    return nginxConf.slice(open + 1, close).replace(/#[^\n]*/g, '');
  }

  /** How many times `needle` occurs in `text`. */
  function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  it('gives the woff2 tier a one-year immutable Cache-Control', () => {
    const block = nginxBlock('location /font/web/ {');
    expect(block).toContain('add_header Cache-Control "public, max-age=31536000, immutable" always;');
    expect(block).toContain('alias /opt/pinyin-character/public/font/web/;');
  });

  it('gives the mutable tier a thirty-day Cache-Control', () => {
    const block = nginxBlock('location /font/ {');
    expect(block).toContain('add_header Cache-Control "public, max-age=2592000" always;');
    expect(block).toContain('alias /opt/pinyin-character/public/font/;');
  });

  it('uses no `expires` in either font block', () => {
    // `expires` emits a Cache-Control of its own, so keeping it next to
    // `add_header Cache-Control` would send TWO Cache-Control headers —
    // which contradicts the "one Cache-Control" fact the deploy manual
    // measured on the live server.
    expect(nginxBlock('location /font/web/ {')).not.toContain('expires');
    expect(nginxBlock('location /font/ {')).not.toContain('expires');
  });

  it('emits exactly one Cache-Control per font block', () => {
    expect(occurrences(nginxBlock('location /font/web/ {'), 'Cache-Control')).toBe(1);
    expect(occurrences(nginxBlock('location /font/ {'), 'Cache-Control')).toBe(1);
  });

  it('marks the mutable layer always, so a 4xx carries the header too', () => {
    // Without `always`, nginx drops the header on 404 and 5xx responses.
    for (const block of [nginxBlock('location /font/web/ {'), nginxBlock('location /font/ {')]) {
      expect(block).toMatch(/add_header Cache-Control "[^"]+" always;/);
    }
  });

  it('puts the long prefix before the short one', () => {
    const web = nginxConf.indexOf('location /font/web/ {');
    const short = nginxConf.indexOf('location /font/ {');
    expect(web).toBeGreaterThan(-1);
    expect(short).toBeGreaterThan(-1);
    expect(web).toBeLessThan(short);
  });
});
