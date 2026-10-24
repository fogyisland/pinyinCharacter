/**
 * Type declarations for scripts/fonts/build-fonts-css.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the pure
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 */

/** One @font-face rule, with the subset comment that preceded it. */
export interface FontFaceItem {
  /** e.g. `/* cyrillic-ext *\/` — empty when the block had no comment. */
  comment: string;
  /** Bare family name, quotes stripped (e.g. `Noto Sans SC`). */
  family: string;
  /** e.g. `normal`. */
  style: string;
  /** e.g. `400` or a range like `400 700`. */
  weight: string;
  /** e.g. `swap`. */
  display: string;
  /** Font file URL, e.g. `/font/noto-sans-sc/xxx.woff2`. */
  src: string;
  /** e.g. `U+0000-00FF, U+0131, ...`. */
  unicodeRange: string;
}

/** Parse a Google Fonts stylesheet into @font-face items. */
export declare function parseCss(css: string): FontFaceItem[];

/** Serialise one @font-face block back to CSS text. */
export declare function serialize(item: FontFaceItem): string;

/** Collapse the weight declarations that share one font file. */
export declare function mergeWeights(items: FontFaceItem[]): FontFaceItem[];

/**
 * Group the rules per family and render one stylesheet per family.
 *
 * The map is keyed by file name (`fonts-sans.css`, …) and the value is the
 * complete stylesheet, header comment included.
 */
export declare function splitByFamily(items: FontFaceItem[]): Map<string, string>;
