import 'server-only';
import manifest from '@/public/font/fonts-manifest.json';

/**
 * The generated font stylesheets.
 *
 * public/font/fonts.css used to be linked from the root layout as one
 * render-blocking stylesheet: 462 KB raw / ~136 KB gzipped, 432 @font-face
 * rules, on EVERY page. The rules are now split per family so a page only
 * pays for the typefaces it draws with, and the two non-critical families
 * are fetched without blocking the first paint.
 *
 * The `?v=` query carries the content hash from the manifest, which lets the
 * whole /font/ tree be served with `Cache-Control: immutable` without ever
 * going stale (see the `headers()` rule in next.config.ts).
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
