/**
 * Type declarations for scripts/fonts/verify-webfont-subsets.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 *
 * The verifier reads the artefacts on the disk and checks the promises the
 * stylesheets make: coverage (the unicode-ranges stay inside the charset of
 * Task 1), disjointness (the blocks of a family never overlap), the glyphs
 * (every declared character has a glyph — the tofu gate), the sizes, the
 * manifest, the page budget and the version token of every URL (R18).
 * Every failure is COLLECTED, so one run reports all of them.
 */

import type { FamilySpec } from './build-webfont-subsets.mjs';
import type { FamilyName } from './webfont-charset.mjs';

/**
 * The budgets of the design, in bytes unless the name says otherwise.
 *
 * They are measurements, not wishes: a build that busts one of them is a
 * build that busts the page, so they must not be relaxed to make a build
 * pass.
 */
export interface FontLimits {
  /** The budget of the hot tier file of a family. */
  hotBytes: number;
  /** The budget of one Ext block file of a family. */
  extBlockBytes: number;
  /** The budget of the three stylesheets together, gzipped. */
  cssBytes: number;
  /** The budget of the render blocking stylesheet alone, gzipped. */
  sansCssBytes: number;
  /** The budget of the number of `@font-face` rules of one stylesheet. */
  maxFacesPerCss: number;
  /** The budget of the number of font files one page downloads. */
  maxFontFilesPerPage: number;
  /** The budget of the font bytes one page downloads, per page. */
  pageFontBytes: PageFontBudgets;
}

/** The font byte budget of every measured page. */
export interface PageFontBudgets {
  '/': number;
  '/dictionary': number;
  '/poetry': number;
  '/stories': number;
  [path: string]: number;
}

/** What one family costs and how it holds up. */
export interface FamilyStats {
  /** The key of the family: 'sans', 'serif' or 'wenkai'. */
  key: FamilyName;
  /** The number of code points the stylesheet claims. */
  chars: number;
  /** The number of `@font-face` rules of the stylesheet. */
  faces: number;
  /** The number of blocks of the family: the hot tier plus the Ext blocks. */
  blocks: number;
  /** The number of subset files the stylesheet points at. */
  files: number;
  /** The bytes of the subset files. */
  bytes: number;
  /** The bytes of the stylesheet. */
  cssBytes: number;
  /** The bytes of the gzipped stylesheet. */
  cssGzipBytes: number;
  /** The version token of the family: twelve lowercase hex characters. */
  version: string;
  /** The number of code points the files carry beyond what they declare. */
  extraCodepoints: number;
  /** The number of declared characters that have no glyph — tofu boxes. */
  missingGlyphs: number;
}

/** The result of the check of one family. */
export interface FamilyVerification {
  /** True when the family has no error at all. */
  ok: boolean;
  /** The messages of the failures, empty when there is none. */
  errors: string[];
  /** What the family costs and how it holds up. */
  stats: FamilyStats;
}

/** What one page downloads of the webfonts. */
export interface PageFontCost {
  /** The path of the page, e.g. '/dictionary'. */
  path: string;
  /** The bytes the page downloads. */
  bytes: number;
  /** The number of files the page downloads. */
  files: number;
  /** The budget of the page. */
  budget: number;
  /** The number of characters no subset claims. */
  unpainted: number;
  /** The characters no subset claims, as readable messages. */
  unpaintedChars: string[];
}

/** The result of the check of every family. */
export interface WebfontVerificationReport {
  /** True when nothing failed at all. */
  ok: boolean;
  /** The messages of the failures, empty when there is none. */
  errors: string[];
  /** What every family costs and how it holds up. */
  stats: FamilyStats[];
  /** What every measured page downloads. */
  costs: PageFontCost[];
  /**
   * The code points the subset files carry beyond what they declare, per
   * family. They are reported, never failed: harfbuzz pulls the sibling
   * code points of a shared glyph along.
   */
  extras: Record<string, string[]>;
}

/** The budgets of the design. */
export declare const LIMITS: FontLimits;

/**
 * Check one family: its stylesheet, its files and its blocks.
 *
 * The charset plan of Task 1 is loaded from disk, so the check compares the
 * artefacts against the plan, not against a copy of it.
 */
export declare function verifyFamily(family: FamilySpec): Promise<FamilyVerification>;

/**
 * Check every family and then the things that span the families: the gzip
 * total of the three stylesheets, the manifest and the page budget.
 */
export declare function verifyAll(): Promise<WebfontVerificationReport>;
