/**
 * Type declarations for scripts/fonts/webfont-charset.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 */

/** The three webfont families the site ships. */
export type FamilyName = 'sans' | 'serif' | 'wenkai';

/**
 * One source of characters.
 *
 * `chars` is any iterable of single characters — the corpus scan yields one
 * character at a time, the unit test passes plain arrays.
 */
export interface CharSource {
  /** Where the characters come from, e.g. `content` or `source-code`. */
  id: string;
  /** How much every occurrence of a character is worth. */
  weight: number;
  /** The characters of this source. */
  chars: Iterable<string>;
}

/** A charset with the score of every character. */
export interface ScoredCharset {
  /** The characters, by descending score, ties broken by ascending code point. */
  ordered: string[];
  /** The score of every character. */
  score: Map<string, number>;
}

/**
 * One block of the Ext tier.
 *
 * A block holds a fixed number of CHARACTERS taken from the frequency
 * order, so the characters of a block are scattered over the code point
 * space: the block has no code point span, and its `unicode-range` is the
 * exact union of the characters it carries.
 */
export interface ExtBlock {
  /** The block number, starting at 1 and contiguous. */
  index: number;
  /** The characters of the block, in frequency order. */
  chars: string[];
}

/** The tier plan of one family. */
export interface TierPlan {
  /**
   * The hot tier: the seeded characters first, then the most used ones.
   *
   * The seed is the union of the characters the measured pages paint in
   * the family; it is never truncated, so the tier can be longer than
   * `tier1Size`.
   */
  hot: string[];
  /** The rest, cut into blocks of a fixed character count. */
  extBlocks: ExtBlock[];
}

/**
 * The sizes of the tiers of one family.
 *
 * The defaults are per family, not global:
 *
 * | family | `tier1Size` (hot tier characters) | `extBlockChars` (characters per Ext block) |
 * |---|---|---|
 * | `sans` | 300 | 6 |
 * | `serif` | 300 | 6 |
 * | `wenkai` | 300 | 6 |
 *
 * `tier1Size` is a FLOOR, not a cap: the seeded characters are all kept,
 * so the hot tier grows when the seed is longer.
 *
 * An override whose value is `undefined` or `null` means "no override" and
 * falls back to the family default.
 */
export interface TierOptions {
  /**
   * The size of the hot tier — a FLOOR, not a cap.
   *
   * The seeded characters are never truncated, so the hot tier holds MORE
   * than this many characters when the seed is longer.
   */
  tier1Size?: number;
  /** How many characters one Ext block holds. */
  extBlockChars?: number;
  /**
   * The characters the hot tier is seeded with.
   *
   * They go in first, in this order, and they are never truncated. The
   * default is the union of the characters the measured pages paint in the
   * family (see `loadFamilyCharsets`).
   */
  hotChars?: string[];
}

/** The options of the charset builder. */
export interface CharsetOptions {
  /** The repository root the corpora are read from. Defaults to the repo. */
  root?: string;
  /**
   * The path of the page profile fixture that seeds the hot tier.
   * Defaults to `<root>/data/font-page-profiles.json`.
   */
  pageProfiles?: string;
  /** The tier options of a single family, overriding the defaults. */
  families?: Partial<Record<FamilyName, TierOptions>>;
}

/** The code point ranges that count as Chinese for the font subsets. */
export declare const CJK_RANGES: Array<[number, number]>;

/** True when the string is exactly one Chinese character. */
export declare function isCjkChar(ch: string): boolean;

/**
 * Strip the comments of a source file, keeping the string literals.
 *
 * `fileName` picks the ScriptKind the file is parsed with: a `.tsx` file is
 * parsed as TSX and a `.ts` file as TS. It defaults to a TSX name, which
 * understands both JSX and plain TypeScript.
 */
export declare function stripSourceComments(text: string, fileName?: string): string;

/** Score every character of every source. */
export declare function scoreCharacters(sources: CharSource[]): ScoredCharset;

/** Split a scored charset into the hot tier and the Ext blocks. */
export declare function planTiers(scored: ScoredCharset, options?: TierOptions): TierPlan;

/** Render the CSS `unicode-range` of a character list. */
export declare function unicodeRange(chars: string[]): string;

/**
 * The page profile fixture: the characters every page paints, per family.
 *
 * The key is the path of the page (`/`, `/dictionary`, …) and the value
 * holds the painted characters of each family. A family a page does not
 * paint in is left out.
 */
export interface PageProfilePages {
  [page: string]: Partial<Record<FamilyName, string>>;
}

/**
 * The characters the measured pages paint in one family, in seed order.
 *
 * The union of the characters of ALL pages, ordered by the number of pages
 * that painted them (descending) and by ascending code point for the ties.
 * Only Chinese characters are kept.
 */
export declare function unionOfPages(pages: PageProfilePages, family: FamilyName): string[];

/** Build the tier plan of every font family. */
export declare function loadFamilyCharsets(options?: CharsetOptions): Record<FamilyName, TierPlan>;
