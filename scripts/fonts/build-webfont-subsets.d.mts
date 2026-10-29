/**
 * Type declarations for scripts/fonts/build-webfont-subsets.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 *
 * The tier plan it consumes comes from scripts/fonts/webfont-charset.mjs,
 * so its types come from there too — one plan, one type, no second copy
 * that can drift.
 */
import type { FamilyName, TierPlan } from './webfont-charset.mjs';

/**
 * One family the site ships.
 *
 * `label` is the font-family name and it NEVER changes: app/globals.css and
 * lib/font-css.ts depend on 'Noto Sans SC', 'Noto Serif SC' and
 * 'LXGW WenKai TC' exactly.
 *
 * `sources` are the instanced source fonts, in weight order: the first one
 * carries the first weight of `weights`. The two body faces are variable
 * (one source file, one face per block, `font-weight: 400 700`); the brand
 * face is static (one source file per weight, one face per block AND
 * weight).
 */
export interface FamilySpec {
  /** The key the family is known by: 'sans', 'serif' or 'wenkai'. */
  key: FamilyName;
  /** The font-family name the stylesheet declares. */
  label: string;
  /** The stylesheet of the family, e.g. 'fonts-sans.css'. */
  css: string;
  /** The directory of the subsets, below public/font/web. */
  dir: string;
  /** What the family is for, written into the header of the stylesheet. */
  purpose: string;
  /** The instanced source fonts, in weight order. */
  sources: string[];
  /** The weights the stylesheet declares, in order. */
  weights: string[];
  /** True when one file carries the whole weight axis of the family. */
  variable: boolean;
  /**
   * The number of characters the hot tier is PLANNED to hold.
   *
   * It documents the plan, it does not drive the slicing: a seeded tier may
   * be longer, and the plan itself decides how long the hot tier really is.
   */
  hotSize: number;
  /**
   * How many characters one Ext block holds.
   *
   * It must match the per family default of scripts/fonts/webfont-charset.mjs:
   * the plan is filtered by the real glyph coverage and the tail is cut
   * into NEW blocks, so the width is this script's own number.
   */
  extBlockChars: number;
  /** The licence file of the family, in the staging directory. */
  license: string;
}

/**
 * One block of a family.
 *
 * The hot tier has no number; an Ext block carries its number, which is
 * contiguous and starts at 1.
 */
export type BlockRef = { kind: 'hot' } | { kind: 'ext'; index: number };

/** One @font-face rule. */
export interface FaceSpec {
  /** The family the face belongs to. */
  family: FamilySpec;
  /** The weight the face declares, e.g. '400 700' or '700'. */
  weight: string;
  /** The file of the face, e.g. 'ext-003.woff2'. */
  file: string;
  /** The characters the face carries — its unicode-range is their union. */
  chars: string[];
  /**
   * The version token of the family (R18).
   *
   * It is REQUIRED: the subset files are served `immutable` for a year
   * under a stable name, so without a token in the URL the browser would
   * keep the old file after the corpus changed.
   *
   * Its shape is twelve lowercase hex characters — the token travels in the
   * query string of every URL of the family.
   */
  version: string;
}

/**
 * The hasher of the version token of one family.
 *
 * The bytes are fed in as they are written, so nothing has to be read back
 * from the disk to compute the token.
 */
export interface VersionHasher {
  /** Feed one file into the hash: its name first, then its bytes. */
  update(fileName: string, bytes: Buffer): void;
  /** The token: twelve lowercase hex characters. */
  digest(): string;
}

/** What one built family cost. */
export interface FamilyReport {
  /** The key of the family. */
  key: FamilyName;
  /** The number of characters the family covers. */
  chars: number;
  /** The number of blocks of the family: the hot tier plus the Ext blocks. */
  blocks: number;
  /** The number of Ext blocks of the family. */
  extBlocks: number;
  /** The number of subset files that were written. */
  files: number;
  /** The bytes of the subset files. */
  bytes: number;
  /** The version token of the family, twelve lowercase hex characters. */
  version: string;
  /** The bytes of the stylesheet. */
  cssBytes: number;
  /** The bytes of the gzipped stylesheet. */
  cssGzipBytes: number;
  /** The stylesheet itself. */
  css: string;
}

/** What the whole build cost. */
export interface BuildReport {
  /** The content hash of the stylesheets. */
  version: string;
  /** What every family cost. */
  families: FamilyReport[];
  /** The totals over every family. */
  total: {
    /** The number of characters of every family together. */
    chars: number;
    /** The number of Ext blocks of every family together. */
    extBlocks: number;
    /** The number of blocks of every family together, the hot tiers included. */
    totalBlocks: number;
    /** The number of subset files of every family together. */
    files: number;
    /** The bytes of the subset files of every family together. */
    bytes: number;
    /** The bytes of the stylesheets of every family together. */
    cssBytes: number;
    /** The bytes of the gzipped stylesheets of every family together. */
    cssGzipBytes: number;
  };
}

/** The options of a build. */
export interface BuildOptions {
  /**
   * The directory the source fonts and the licences are read from.
   *
   * It defaults to STAGING_DIR. It is injectable so the failure path of a
   * missing source font can be tested without touching the real staging
   * directory.
   */
  stagingDir?: string;
}

/** The three families the site ships. */
export declare const FAMILIES: FamilySpec[];

/** Where the subset files are written: <repo>/public/font/web. */
export declare const OUT_ROOT: string;

/** Where the source fonts and the licences are read from. */
export declare const STAGING_DIR: string;

/** The file names one block is cut into. */
export declare function blockFileNames(family: FamilySpec, block: BlockRef): string[];

/**
 * The hasher of the version token of one family (R18).
 */
export declare function createVersionHasher(): VersionHasher;

/**
 * Drop the characters the font cannot draw, and cut the tail into new
 * blocks of `extBlockChars` characters.
 */
export declare function filterPlanByCoverage(
  plan: TierPlan,
  covered: Set<number>,
  extBlockChars: number,
): TierPlan;

/** Render one @font-face rule. */
export declare function renderFace(spec: FaceSpec): string;

/** Render the stylesheet of one family. */
export declare function renderStylesheet(
  family: FamilySpec,
  plan: TierPlan,
  version: string,
): string;

/** The content hash of the stylesheets, twelve lowercase hex characters. */
export declare function manifestVersion(cssByFile: Record<string, string>): string;

/**
 * Remove the subset files that this build did not write.
 *
 * Only the `.woff2` files of the directory that are not in `keep` are
 * removed; anything else in the directory is left alone. The names of the
 * removed files are returned, sorted.
 */
export declare function sweepStaleFiles(dir: string, keep: Set<string>): Promise<string[]>;

/** Cut every family and write the stylesheets and the manifest. */
export declare function buildAll(options?: BuildOptions): Promise<BuildReport>;
