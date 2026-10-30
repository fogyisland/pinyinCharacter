/**
 * The stylesheet URLs the browser actually requests.
 *
 * getFontCssLinks() is the only place where the manifest becomes a URL, and
 * nothing else checks it: the other font test only greps the SOURCE of
 * app/layout.tsx, which cannot tell a correct URL from a wrong one. A
 * dropped `?v=`, a family pointing at another family's stylesheet or a
 * hard-coded version would all still resolve — and /font/ is served
 * `immutable` for a year, so the browser would go on using the stale
 * stylesheet, whose unicode-ranges no longer cover the glyphs the page
 * draws.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getFontCssLinks } from '@/lib/font-css';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../../public/font/fonts-manifest.json'), 'utf8'),
) as { version: string; files: Record<string, string> };

describe('getFontCssLinks', () => {
  it('versions every stylesheet URL with the manifest version', () => {
    const links = getFontCssLinks();
    expect(links.sans).toBe(`${manifest.files.sans}?v=${manifest.version}`);
    expect(links.serif).toBe(`${manifest.files.serif}?v=${manifest.version}`);
    expect(links.wenkai).toBe(`${manifest.files.wenkai}?v=${manifest.version}`);
  });
});
