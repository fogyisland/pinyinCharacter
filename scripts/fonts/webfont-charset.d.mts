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
 * A block holds every character of one code point WINDOW — the window of a
 * character is `floor(codePoint / extBlockSize)` — so two blocks never
 * overlap and the `unicode-range` of a block is the exact union of the code
 * points it carries.
 */
export interface ExtBlock {
  /** The block number, starting at 1 and contiguous. */
  index: number;
  /** The characters of the block. */
  chars: string[];
  /** The smallest code point actually present in the block. */
  lo: number;
  /** The largest code point actually present in the block. */
  hi: number;
}

/** The tier plan of one family. */
export interface TierPlan {
  /** The most used characters — the hot tier. */
  hot: string[];
  /** The rest, cut into code point windows. */
  extBlocks: ExtBlock[];
}

/** The sizes of the tiers of one family. */
export interface TierOptions {
  /** How many characters the hot tier holds. Defaults to 300. */
  tier1Size?: number;
  /** How many code points one Ext window spans. Defaults to 16. */
  extBlockSize?: number;
}

/** The options of the charset builder. */
export interface CharsetOptions {
  /** The repository root the corpora are read from. Defaults to the repo. */
  root?: string;
  /** The tier options of a single family, overriding the defaults. */
  families?: Partial<Record<FamilyName, TierOptions>>;
}

/** The code point ranges that count as Chinese for the font subsets. */
export declare const CJK_RANGES: Array<[number, number]>;

/** True when the string is exactly one Chinese character. */
export declare function isCjkChar(ch: string): boolean;

/** Score every character of every source. */
export declare function scoreCharacters(sources: CharSource[]): ScoredCharset;

/** Split a scored charset into the hot tier and the code point windows. */
export declare function planTiers(scored: ScoredCharset, options?: TierOptions): TierPlan;

/** Render the CSS `unicode-range` of a character list. */
export declare function unicodeRange(chars: string[]): string;

/** Build the tier plan of every font family. */
export declare function loadFamilyCharsets(options?: CharsetOptions): Record<FamilyName, TierPlan>;
