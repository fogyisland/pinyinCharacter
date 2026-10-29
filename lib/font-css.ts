import 'server-only';
import manifest from '@/public/font/fonts-manifest.json';

/**
 * The generated font stylesheets.
 *
 * The font payload is split per family. `fonts-sans.css` is the only
 * render-blocking stylesheet — the body typeface draws every character of
 * every page — while `fonts-wenkai.css` and `fonts-serif.css` are loaded
 * with `media="print"` and promoted once they arrive, so they never block
 * the first paint.
 *
 * Inside a stylesheet every face belongs to ONE font-family name (`Noto Sans
 * SC`, `Noto Serif SC`, `LXGW WenKai TC`) and carries a precise
 * `unicode-range`. The ranges of the faces of a family are mutually
 * disjoint, so the browser picks exactly one file per character; a
 * character that falls in no range goes to the system font. Each family is
 * cut into a hot zone (the union of the page font profiles, in priority
 * order) plus frequency-ordered Ext blocks of six characters.
 *
 * Two levels of tokens keep the cache honest:
 *   - the `?v=` of a STYLESHEET URL is the manifest version — the hash of
 *     the three stylesheets;
 *   - the `?v=` of a WOFF2 URL is the token of its own family, written into
 *     the stylesheet when the subsets are built.
 *
 * Both change whenever the bytes change, so `Cache-Control: immutable` (see
 * the `headers()` rule in next.config.ts) can never serve a stale file.
 */
export interface FontCssLinks {
  /** Body typeface (--font-han-sans) — every character of every page. */
  sans: string;
  /** Brand typeface (--font-kai) — the header mark, the section titles. */
  wenkai: string;
  /** Serif accent typeface (--font-han-serif) — dictionary, story, admin. */
  serif: string;
}

export function getFontCssLinks(): FontCssLinks {
  const version = manifest.version;
  return {
    sans: `${manifest.files.sans}?v=${version}`,
    wenkai: `${manifest.files.wenkai}?v=${version}`,
    serif: `${manifest.files.serif}?v=${version}`,
  };
}
