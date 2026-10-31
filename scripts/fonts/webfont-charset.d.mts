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
  /**
   * The LATIN tier of the family.
   *
   * It is a tier of its own: the Latin hot tier holds the Latin characters
   * the measured pages paint PLUS the 24 tone vowels of `lib/pinyin-tone.ts`
   * (never padded from the corpus, never truncated), and the Latin tail
   * holds the Latin characters of the repository scan, cut into blocks of
   * twelve.
   *
   * ⚠️ Every character of the tier is one the source fonts can really
   * draw: the tier is filtered by the glyph coverage in the PLAN layer,
   * because the `unicode-range` of a face is computed from the plan and the
   * subsetter drops a code point the font has no glyph for SILENTLY.
   *
   * ⚠️ It is OPTIONAL in the shape: a plan of a family that has no Latin
   * tier yet is a plan the renderer still understands (it draws the Chinese
   * blocks only), and every real build fills it in.
   */
  latin?: LatinTierPlan;
}

/**
 * The tier plan of one family that HAS a Latin tier.
 *
 * `loadFamilyCharsets` always builds one.
 */
export interface FamilyTierPlan extends TierPlan {
  latin: LatinTierPlan;
}

/** The Latin tier of one family. */
export interface LatinTierPlan {
  /** The Latin characters the pages paint, plus the 24 tone vowels. */
  hot: string[];
  /** The rest of the Latin characters, cut into blocks of twelve. */
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
  /**
   * The glyph coverage of the source fonts, per family.
   *
   * The build hands its own coverage over (it has read the fonts anyway);
   * without it the coverage is read from the staging directory, and a
   * checkout without the staging fonts gets an UNFILTERED Latin tier and a
   * loud warning.
   */
  coverage?: Record<FamilyName, Set<number>>;
  /**
   * The directory the instanced source fonts live in.
   * Defaults to `<root>/scripts/fonts/staging/web`.
   */
  stagingDir?: string;
}

/** One source font of a family, as the coverage rule reads it. */
export interface SourceFont {
  /** The name of the file, used in the error messages. */
  label?: string;
  /** The name of the file, when the caller calls it that. */
  fileName?: string;
  /** The path the font was read from. */
  path: string;
  /** The bytes of the font. */
  buffer: Buffer;
}

/** The code point ranges that count as Chinese for the font subsets. */
export declare const CJK_RANGES: Array<[number, number]>;

/** The code point ranges that count as Latin for the font subsets. */
export declare const LATIN_RANGES: Array<[number, number]>;

/** The number of characters one Latin Ext block holds. */
export declare const LATIN_EXT_BLOCK_CHARS: number;

/** The source font of every family, in weight order. */
export declare const FAMILY_SOURCE_FILES: Record<FamilyName, string[]>;

/** Where the instanced source fonts live. */
export declare const STAGING_DIR: string;

/** True when the string is exactly one Chinese character. */
export declare function isCjkChar(ch: string): boolean;

/** True when the string is exactly one Latin character. */
export declare function isLatinChar(ch: string): boolean;

/** True when the code point belongs to one of the Latin ranges. */
export declare function isLatinCodePoint(codePoint: number): boolean;

/**
 * Strip the comments of a source file, keeping the string literals.
 *
 * `fileName` picks the ScriptKind the file is parsed with: a `.tsx` file is
 * parsed as TSX and a `.ts` file as TS. It defaults to TSX because a wrong
 * guess has to fail safe — TSX keeps the comments a `.ts` file hides from
 * its first type assertion on (their characters can take hot tier slots,
 * not glyphs), while TS drops the JSX text behind a `//` in a `.tsx` file
 * (a missing glyph).
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

/**
 * The Latin characters the measured pages paint in one family, in seed order.
 *
 * The twin of `unionOfPages`: the same pages and the same ordering, but the
 * Latin characters instead of the Chinese ones. The Latin seed is the WHOLE
 * Latin hot tier — it is never padded from the corpus.
 */
export declare function unionOfLatinPages(
  pages: PageProfilePages,
  family: FamilyName,
): string[];

/**
 * The code points the source fonts of every family can draw.
 *
 * The coverage of a family is the INTERSECTION of the coverage of its
 * source fonts: the brand face has two files (400 and 700) and both faces
 * declare the same `unicode-range`, so a code point only one of them can
 * draw may not be in the plan at all.
 */
export declare function loadFamilyCoverage(options?: {
  root?: string;
  stagingDir?: string;
}): Record<FamilyName, Set<number>>;

/**
 * The code points a set of source fonts can draw: the intersection of their
 * coverages.
 *
 * This is THE rule of the pipeline: the build cuts the files with it and the
 * verifier scopes the unpainted Latin characters with it, so the two cannot
 * drift apart.
 */
export declare function coverageOfSources(sources: SourceFont[]): Set<number>;

/**
 * The 24 tone vowels of the site, read from the `TONE_MAP` of
 * `lib/pinyin-tone.ts`.
 *
 * The file is PARSED, not imported: these scripts are plain ESM and the
 * repository has no TypeScript loader for them.
 */
export declare function loadToneVowels(root?: string): string[];

/**
 * The seed of the Latin hot tier of one family: the Latin characters the
 * measured pages paint, plus the 24 tone vowels, ordered by code point.
 */
export declare function latinSeedOf(fixtureLatin: string, toneVowels: string[]): string[];

/**
 * Drop the Latin characters the source font cannot draw, and cut the tail
 * into new blocks of `extBlockChars` characters.
 */
export declare function filterLatinByCoverage(
  plan: { hot: string[]; extBlocks: ExtBlock[] },
  covered: Set<number>,
  extBlockChars?: number,
): LatinTierPlan;

/** Build the tier plan of every font family. */
export declare function loadFamilyCharsets(
  options?: CharsetOptions,
): Record<FamilyName, FamilyTierPlan>;
