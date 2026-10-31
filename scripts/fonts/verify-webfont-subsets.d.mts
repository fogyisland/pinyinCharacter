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
  /** The budget of the Latin hot tier file of a family. */
  latinBytes: number;
  /** The budget of the font bytes one page downloads, per page. */
  pageFontBytes: PageFontBudgets;
  /** The budget of the bytes the union sample downloads, per page. */
  unionSampleBytes: UnionSampleBudgets;
  /** The budget of the number of font files the union sample downloads. */
  maxUnionSampleFilesPerPage: number;
}

/** The font byte budget of every measured page. */
export interface PageFontBudgets {
  '/': number;
  '/dictionary': number;
  '/poetry': number;
  '/stories': number;
  [path: string]: number;
}

/** What one page of the union sample is allowed to download. */
export interface UnionSampleBudgets {
  '/': number;
  '/dictionary': number;
  '/poetry': number;
  '/stories': number;
  [path: string]: number;
}

/** The shape of a page sample: the characters of every measured page. */
export interface SampleProfile {
  capturedAt?: string;
  source?: string;
  rounds?: number;
  pages: Record<string, Record<string, string>>;
}

/** The depth of a measured profile: how far it reaches and what it costs. */
export interface ProfileMeasurement {
  extChars: number;
  costs: Array<{ path: string; files: number }>;
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
  /** The number of Latin blocks of the family: the Latin hot tier plus its tail. */
  latinBlocks: number;
  /** The number of code points the Latin blocks of the family claim. */
  latinChars: number;
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
 * One `@font-face` rule of a stylesheet.
 */
export interface FaceDeclaration {
  /** The font-family the face declares, without the quotes. */
  fontFamily: string;
  /** The font-weight the face declares, e.g. '400 700' or '700'. */
  weight: string;
  /** The font-style the face declares, e.g. 'normal'. */
  fontStyle: string;
  /** The font-display the face declares, e.g. 'swap'. */
  display: string;
  /** The url of the src, e.g. '/font/web/sans/hot.woff2?v=f31ca9b32566'. */
  src: string;
  /** The unicode-range the face declares. */
  range: string;
}

/**
 * The URL of a face: the directory of the family, the file and the version
 * token.
 *
 * It is null when the src is not a URL of `/font/web/…`.
 */
export interface FaceUrl {
  /** The directory of the family, e.g. 'sans'. */
  dir: string;
  /** The file of the face, e.g. 'hot.woff2'. */
  file: string;
  /** The version token of the URL, twelve lowercase hex characters. */
  token: string;
}

/** The shape of public/font/fonts-manifest.json. */
export interface FontManifest {
  /** The content hash of the three stylesheets. */
  version?: string;
  /** The stylesheet of every family, by family key. */
  files?: Record<string, string>;
}

/**
 * Read the `@font-face` rules of a stylesheet.
 */
export declare function parseFaces(css: string): FaceDeclaration[];

/**
 * Read the URL of a face.
 */
export declare function parseFaceUrl(src: string): FaceUrl | null;

/**
 * Check the identity of a face: the family it declares and its style.
 *
 * A stylesheet that declares another family — or a slanted face — still
 * passes every other check, but the page is painted in a different
 * typeface. That is a silent G9 violation.
 */
export declare function checkFaceFamily(
  family: { key: FamilyName; label: string },
  face: FaceDeclaration,
): string[];

/**
 * Check that a static face points at the file of its OWN weight.
 *
 * A variable family is not checked: it has one file per block and one face
 * that declares `font-weight: 400 700`.
 */
export declare function checkFaceWeight(
  family: { key: FamilyName; variable: boolean },
  face: FaceDeclaration,
): string[];

/**
 * Check that a face points at the directory of its OWN family.
 *
 * The directory in the URL is what the browser downloads from: a face that
 * points at the directory of another family hands the page a different
 * typeface. A face whose URL cannot be parsed is reported by the main loop
 * already, so nothing is reported twice here.
 */
export declare function checkFaceDirectory(
  family: { key: FamilyName; dir: string },
  face: { src: string },
): string[];

/**
 * Check that the manifest points every family at EXACTLY its own stylesheet.
 *
 * `lib/font-css.ts` builds the URL of the stylesheet of a family out of
 * `manifest.files.<family>`, so a manifest that points `serif` at
 * `fonts-sans.css` drops the serif stylesheet from the page, and a manifest
 * that points a family at a path that does not exist links the page to a
 * 404.
 */
export declare function checkManifestFiles(
  manifest: FontManifest,
  families: Array<{ key: FamilyName; css: string }>,
): string[];

/**
 * The Latin characters of a page that no BUILT block claims.
 *
 * Two kinds, and the difference between them is the whole point:
 *
 *   `missing`      the source font CAN draw the character and no subset of
 *                  the family claims it ⇒ the Latin tier was never built ⇒
 *                  an ERROR
 *   `unsupported`  the source font CANNOT draw the character ⇒ the browser
 *                  falls back to the system font, which is a limit of the
 *                  FONT and not a bug of the pipeline ⇒ reported only
 *
 * The scope comes from the shared glyph coverage of the source fonts
 * (`loadFamilyCoverage` of scripts/fonts/webfont-charset.mjs) — the same
 * capability the plan builder filters the Latin tier with.
 */
export declare function classifyUnpaintedLatin(
  chars: string,
  cpToBlock: Map<number, string>,
  covered: Set<number> | null,
): { missing: number[]; unsupported: number[] };

/**
 * The Latin hot block of a family must declare the 24 tone vowels.
 *
 * The tone marks are NOT in the page fixture — the four measured pages paint
 * at most a handful of them — so they are in the Latin hot tier because of
 * `lib/pinyin-tone.ts`, not because of the fixture. The assertion is
 * therefore not idle: it proves that the Latin tier was built out of the
 * tone table and not out of the fixture.
 */
export declare function checkLatinToneVowels(
  family: { key: FamilyName; label: string },
  latinBlock: { points: Set<number> } | undefined,
  toneVowels: string[],
): string[];

/**
 * Check one family: its stylesheet, its files and its blocks.
 *
 * The charset plan of Task 1 is loaded from disk, so the check compares the
 * artefacts against the plan, not against a copy of it.
 */
export declare function verifyFamily(family: FamilySpec): Promise<FamilyVerification>;

export declare function checkSampleShape(sample: unknown): string[];
export declare function checkSampleIsDeeper(
  sample: unknown,
  seed: unknown,
  sampleResult: ProfileMeasurement,
  seedResult: ProfileMeasurement,
): string[];

/**
 * Check every family and then the things that span the families: the gzip
 * total of the three stylesheets, the manifest and the page budget.
 */
export declare function verifyAll(): Promise<WebfontVerificationReport>;
