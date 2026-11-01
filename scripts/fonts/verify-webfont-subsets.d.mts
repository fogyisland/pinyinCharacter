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
 *
 * ⚠️ **Which of the numbers is the gate.** The report carries TWO sets of
 * page costs: `costs` is the cost of the UNION SAMPLE of the live pages and
 * it is THE GATE (over its budget ⇒ the run fails), while `floorCosts` is the
 * cost of the SEED of the hot tier and it is only a LOWER BOUND — it is
 * reported and never fails the run. The seed is not a page: it paints the hot
 * tier only, so its numbers are a floor, not a measurement of a visit.
 *
 * ⚠️ **This file is a HAND-WRITTEN declaration face.** `tsconfig.json` sets
 * `allowJs: false`, so the `.mjs` implementation is NEVER type checked and
 * the two faces can drift apart SILENTLY. The consistency between them is
 * therefore guarded by a machine check, not by the compiler:
 * `tests/unit/scripts/verify-webfont-subsets.test.ts` compares the shape of
 * `WebfontVerificationReport` here with the shape `verifyAll()` really
 * returns. When that check fails, one of the two faces is lying — fix the
 * implementation or this file, never the check.
 */

import type { EnvRecord, FamilySpec } from './build-webfont-subsets.mjs';
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
  /**
   * A NARROW VIEW of the cost of every measured page.
   *
   * The runtime objects of `measureProfile` carry more than this: `bytes`,
   * `budget`, `fileBudget`, `unpainted` and `unpaintedChars` as well. Only
   * `path` and `files` are declared here on purpose: `checkSampleIsDeeper`
   * reads exactly those two, and a narrow declaration cannot be wrong about
   * the fields it does not mention. A missing field is what breaks a build —
   * a narrow view is safe.
   */
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
  /** The budget of the number of files the page downloads. */
  fileBudget: number;
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
   * What the SEED of the hot tier would download.
   *
   * A LOWER BOUND and never a page: the seed paints the hot tier only, so it
   * cannot see the Ext blocks. It is reported and never fails the run.
   */
  floorCosts: PageFontCost[];
  /**
   * The notes about the seed: the budgets of the seed that it busts.
   *
   * They are notes, not errors: the seed is not a page, so busting a budget
   * of its own says nothing about a visit.
   */
  floorNotes: string[];
  /**
   * The union sample the gate is measured on.
   */
  sample: { path: string; rounds?: number; source: string; capturedAt: string };
  /**
   * The failures of the FIXTURES themselves.
   *
   * Three channels, kept apart on purpose:
   *
   *   `budgetErrors`  the cost of a page against its budget. The SAMPLE is
   *                   the gate (over its budget ⇒ the run fails); the seed
   *                   is only a floor and is reported, never failed.
   *   `latinErrors`   the Latin tier does not cover what the page paints.
   *   `fixtureErrors` the SEED or the SAMPLE is not a usable fixture. Both
   *                   fail the run: a broken fixture makes every number of
   *                   this report a lie, so it must not be able to pass.
   *
   * The channel of `checkProfileHasLatin` lives here: a profile that holds
   * no Latin character at all makes the page budget check of the Latin tier
   * an empty set, so a Latin tier that was never built would report green.
   * That is a failure of the FIXTURE, not of the page cost, so it must not
   * be demoted to a note the way the budget findings of the seed are.
   */
  fixtureErrors: string[];
  /**
   * The code points the subset files carry beyond what they declare, per
   * family. They are reported, never failed: harfbuzz pulls the sibling
   * code points of a shared glyph along.
   */
  extras: Record<string, string[]>;
  /**
   * Whether the page cost was ENFORCED (the gate) or only REPORTED.
   */
  pageCostMode: PageCostMode;
  /**
   * The page cost of the measured tree, in the shape the report prints.
   *
   * It is null when the page cost was enforced: nothing was reported then,
   * because the gate speaks for itself.
   */
  pageCost: PageCostReport | null;
}

/** Whether the page cost is enforced (the gate) or only reported. */
export type PageCostMode = 'enforce' | 'report';

/** The page cost of a candidate, measured against the union sample. */
export interface PageCostReport {
  /** The bytes every measured page downloads. */
  bytes: Record<string, number>;
  /** The number of font files every measured page downloads. */
  files: Record<string, number>;
  /** The byte budget of every measured page. */
  budgetBytes: Record<string, number>;
  /** The budget of the number of font files a page downloads. */
  budgetFiles: number;
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
 * The URL of a face: the directory of the family, the file, the version
 * token and the optional release directory.
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
  /**
   * The optional release directory, e.g. 'r0a1b2c3d4e5f'.
   *
   * An empty string is release 0: the layout of the published tree, where
   * the URL of a face is `/font/web/<family>/<file>`.
   */
  release: string;
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
 * Check that a profile holds Latin characters at all.
 *
 * A profile without a single Latin character makes the page budget check of
 * the Latin tier an EMPTY SET, so a Latin tier that was never built would
 * report green. That is a failure of the FIXTURE, not of the page cost, so
 * it belongs to the `fixtureErrors` channel and fails the run for the seed
 * as well as for the sample.
 *
 * The function is pure: it reads the profile and returns one message or an
 * empty array.
 */
export declare function checkProfileHasLatin(
  profile: SampleProfile,
  label: string,
): string[];

/**
 * Check every family and then the things that span the families: the gzip
 * total of the three stylesheets, the manifest and the page budget.
 */
export declare function verifyAll(): Promise<WebfontVerificationReport>;

/**
 * The font root: the tree the artefacts are read from.
 *
 * `WEBFONT_FONT_DIR` overrides it, and a relative path is resolved against
 * the repository root and not against the working directory.
 */
export declare function resolveFontDir(env?: EnvRecord): string;

/**
 * Whether the page cost is ENFORCED (the gate) or only REPORTED.
 *
 * A misspelled mode throws instead of falling back to one of the two.
 */
export declare function resolvePageCostMode(env?: EnvRecord): PageCostMode;
