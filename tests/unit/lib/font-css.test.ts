/**
 * lib/font-css.ts — the stylesheet links the layout renders.
 *
 * The manifest carries the file names and the version; the module turns
 * them into URLs. A mismatch between the two is what serves a stale
 * stylesheet, so it is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import manifest from '@/public/font/fonts-manifest.json';
import { getFontCssLinks } from '@/lib/font-css';

describe('getFontCssLinks', () => {
  it('gives every family a stylesheet that exists on disk', () => {
    const links = getFontCssLinks();
    for (const [name, url] of Object.entries(links)) {
      const path = join(process.cwd(), 'public', url.split('?')[0]);
      expect(existsSync(path), `${name} points at ${url}, which does not exist`).toBe(true);
    }
  });

  it('carries the manifest version on every URL', () => {
    const links = getFontCssLinks();
    for (const url of Object.values(links)) {
      expect(url).toContain(`?v=${manifest.version}`);
    }
  });

  it('gives the sans family a hot tier and an ext tier', () => {
    const links = getFontCssLinks();
    // The hot tier blocks the first paint; the ext tier does not. They
    // are two files, not one — a single stylesheet would put 2458 ext
    // faces in front of every first paint.
    expect(links.sans).toContain('-hot.css');
    expect(links.sansExt).toContain('-ext.css');
    expect(links.sans).not.toBe(links.sansExt);
  });

  it('keeps the manifest and the module in step', () => {
    // The manifest is the single source of truth. If the module hardcodes
    // a file name, the two drift and the browser gets a 404 for a
    // stylesheet the layout waits for.
    const raw = readFileSync(
      join(process.cwd(), 'public', 'font', 'fonts-manifest.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { files: Record<string, string> };
    const links = getFontCssLinks();
    for (const [key, url] of Object.entries(parsed.files)) {
      // The manifest holds the bare path; the module appends the version
      // token. Compare the paths, not the whole URL.
      expect(url).toBe(links[key as keyof typeof links].split('?')[0]);
    }
  });

  it('loads the ext tier without blocking the first paint', () => {
    // The layout is the only place that decides which stylesheet blocks
    // the first paint. Read it as text: rendering the root layout needs
    // a database and a request context, and what matters here is the
    // markup, not the render.
    const layout = readFileSync(
      join(process.cwd(), 'app', 'layout.tsx'),
      'utf8',
    );

    // The hot tier blocks — it draws every glyph of every page.
    expect(layout).toMatch(/<link\s+rel="stylesheet"\s+href=\{fontCss\.sans\}\s*\/>/);

    // The ext tier does not: it carries media="print", and the inline
    // script promotes it once it arrives.
    expect(extLinkTag(layout, 'sansExt')).toContain('media="print"');
    expect(layout).toContain('ASYNC_STYLESHEET_FLIP');
  });

  it('loads the ext tier of every family, not just the body typeface', () => {
    // The brand and serif faces are split the same way as the body
    // typeface. If their ext tiers are not linked, the brand mark and
    // the section titles fall back to the system font for every character
    // outside their hot tier — and nothing else would notice.
    const layout = readFileSync(
      join(process.cwd(), 'app', 'layout.tsx'),
      'utf8',
    );
    for (const key of ['sansExt', 'wenkaiExt', 'serifExt']) {
      expect(extLinkTag(layout, key), `${key} is not linked in app/layout.tsx`).toContain(
        'media="print"',
      );
    }
  });
});

/**
 * The `<link>` tag of an async stylesheet, from its `href` to its close.
 *
 * ⚠️ The window must END AT THE TAG, not at a fixed number of characters.
 * A 200-character window from the `sansExt` href reaches past the end of
 * that tag and into the NEXT one (`wenkai`), which also carries
 * `media="print"` — so removing the attribute from `sansExt` (or from
 * `wenkaiExt`) left the assertion green. Only the LAST ext link was
 * actually guarded, because nothing follows it.
 *
 * ⇒ The tag is closed at its own `/>`, and the assertion looks at that
 * tag alone.
 *
 * @param layout the markup of `app/layout.tsx`
 * @param key the `fontCss` key of the stylesheet (`sansExt`, `wenkaiExt`, …)
 * @returns the tag's text, from `<link` to `/>`
 */
function extLinkTag(layout: string, key: string): string {
  const href = `href={fontCss.${key}}`;
  const hrefIndex = layout.indexOf(href);
  expect(hrefIndex, `${key} is not linked in app/layout.tsx`).toBeGreaterThan(-1);

  // The tag opens before the href and closes after it.
  const openIndex = layout.lastIndexOf('<link', hrefIndex);
  expect(openIndex, `the ${key} link has no opening tag`).toBeGreaterThan(-1);

  const closeIndex = layout.indexOf('/>', hrefIndex);
  expect(closeIndex, `the ${key} link is not closed`).toBeGreaterThan(-1);

  return layout.slice(openIndex, closeIndex + 2);
}
