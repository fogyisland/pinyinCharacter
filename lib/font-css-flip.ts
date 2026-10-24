/**
 * The inline script that promotes the non-blocking font stylesheets.
 *
 * A stylesheet with a non-matching media query is still downloaded, but it
 * does not block rendering — which is exactly what we want for the two
 * optional typefaces (the brand mark and the serif accent). The catch is
 * that the browser has to be told when to start applying them, and that has
 * to happen without waiting for React to hydrate (the fonts are visible long
 * before hydration finishes).
 *
 * This is the classic async-CSS pattern: the link starts as `print`, and the
 * inline script promotes it to `all` on load. `el.sheet` is already set when
 * the stylesheet came from the cache, so the promotion is instant in that
 * case.
 *
 * It lives in its own module — rather than next to `getFontCssLinks()` —
 * because it has to be importable from a test: `lib/font-css.ts` is marked
 * `server-only` (it reads the generated manifest), and that marker throws
 * when the module is imported outside a React Server Component.
 */
export const ASYNC_STYLESHEET_FLIP = `(function(){var l=document.querySelectorAll('link[rel="stylesheet"][media="print"]');for(var i=0;i<l.length;i++){(function(el){if(el.sheet){el.media="all";}else{el.addEventListener("load",function(){el.media="all";});}})(l[i]);}})();`;
