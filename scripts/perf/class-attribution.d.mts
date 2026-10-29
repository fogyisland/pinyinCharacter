/**
 * Type declarations for scripts/perf/class-attribution.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 *
 * The rule it encodes is the one the page profile fixture
 * (`data/font-page-profiles.json`) and the per page font payload measurement
 * (`scripts/perf/font-load.mjs`) MUST share: `font-family` inherits, so an
 * element is painted in the face of its own `font-*` class, or in the face
 * it inherits from its parent, or in the default face of `body` (sans).
 */

import type { FamilyName } from '../fonts/webfont-charset.mjs';

/**
 * The characters a page paints in one family.
 *
 * The key is the family the characters are painted in; the value holds every
 * distinct Chinese character the page paints in that family.
 */
export type FamilyCharsets = Record<FamilyName, Set<string>>;

/**
 * The class names of an attribute string.
 *
 * An attribute string without a `class` attribute yields an empty list.
 */
export declare function classTokens(attrs: string): string[];

/**
 * Remove the content of the `<script>` and `<style>` blocks.
 *
 * The Chinese inside them is not page text: it is code and CSS.
 */
export declare function stripScriptsAndStyles(html: string): string;

/**
 * Remove the HTML comments.
 *
 * The Chinese inside them is not page text either. The comments Next.js
 * emits between adjacent text nodes (`<!-- -->`) carry no character, but a
 * human written comment may carry a lot.
 */
export declare function stripComments(html: string): string;

/**
 * The face an element is painted in.
 *
 * The element's own `font-*` class wins; without one the face is inherited
 * from the parent.
 */
export declare function familyOfAttrs(attrs: string, parentFamily: FamilyName): FamilyName;

/**
 * Attribute every Chinese character of an HTML document to its face.
 *
 * The document is walked with a stack, so the face of a text node is the
 * face of the element that contains it, inherited down the tree. The
 * content of `<head>` is not page text and is skipped.
 */
export declare function collectFamilyCharsets(html: string): FamilyCharsets;
