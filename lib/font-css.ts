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

/**
 * Flip the `media="print"` stylesheets to `media="all"` once they arrive.
 *
 * A stylesheet with a non-matching media query is still downloaded, but it
 * does not block rendering — which is exactly what we want for the two
 * optional typefaces. The catch is that the browser has to be told when to
 * start applying them, and that has to happen without waiting for React to
 * hydrate (the fonts are visible long before hydration finishes).
 *
 * This is the classic async-CSS pattern: the link starts as `print`, and the
 * inline script promotes it to `all` on load. `el.sheet` is already set when
 * the stylesheet came from the cache, so the promotion is instant in that
 * case.
 */
export const ASYNC_STYLESHEET_FLIP = `(function(){var l=document.querySelectorAll('link[rel="stylesheet"][media="print"]');for(var i=0;i<l.length;i++){(function(el){if(el.sheet){el.media="all";}else{el.addEventListener("load",function(){el.media="all";});}})(l[i]);}})();`;
