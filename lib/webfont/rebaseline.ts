/**
 * The re-base checklist of an apply (design §3.5.9).
 *
 * ## What this module is for
 *
 * An apply writes a new release into `public/font/` — and that changes
 * numbers that are **pinned in the repository**:
 *
 *  - the count and the size of the subset files on the disk;
 *  - the raw and the gzipped size of the three stylesheets;
 *  - the page-cost budgets of the verifier's `LIMITS`.
 *
 * The repository's own test suite asserts those numbers, so after an apply
 * the repository is **red on purpose** until somebody re-calibrates them.
 * This module computes WHAT the new numbers are, so the administrator does
 * not have to measure them by hand.
 *
 * ⚠️ **The backend only COMPUTES. It writes NOTHING.** The gate budget is
 * never rewritten to "whatever the current product happens to need" — that
 * is a false green light, the same one in the opposite direction. A human
 * re-calibrates, in a reviewed change.
 *
 * ## Why the `current` values are constants
 *
 * The pinned numbers live in three files: `tests/unit/lib/fonts-css.test.ts`
 * and `scripts/fonts/verify-webfont-subsets.mjs`. Parsing a TypeScript test
 * file at runtime is brittle, and it would make the test file a second
 * source of truth. So the numbers are **copied** here, and a **drift-guard
 * test** asserts that the copy still equals what the repository pins.
 *
 * ⇒ That is the same pattern the pipeline uses for `resolveFontDir()`: keep
 * the duplication, and let the test carry the drift risk.
 *
 * ## The "未判定" distinction (G12)
 *
 * `expected === null` means 「不用改」 — nothing has to change. But when the
 * page cost could not be **measured** at all, `expected === null` would say
 * 「不用改」 about a number nobody measured. The two are not the same, so the
 * entries that could not be measured carry the reason in their `note`, and
 * the panel renders them as 「未判定」.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** The three families of the site, in the order the checklist lists them. */
export const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/** One family of the site. */
export type Family = (typeof FAMILIES)[number];

/**
 * One entry of the checklist.
 *
 * `expected` is `null` when nothing has to change. ⚠️ The panel decides
 * 「不用改」 and 「未判定」 apart by the `note` — see `UNJUDGED_NOTE`.
 */
export interface RebaselineEntry {
  /** The file the pinned number lives in. */
  file: string;
  /** The line the pinned number lives on. */
  line: number;
  /** What the number pins, in the words of the administrator. */
  what: string;
  /** The number the repository pins today. */
  current: number | number[] | string | null;
  /**
   * The number it has to be after the apply.
   *
   * `null` means 「不用改」 — the number did not move. ⚠️ When the page cost
   * could not be measured, it is `null` as well, and the `note` says
   * 「未判定」 — that is the difference.
   */
  expected: number | number[] | string | null;
  /** True when the number has to be re-calibrated after EVERY import. */
  always: boolean;
  /** Why the entry says what it says — shown next to it. */
  note?: string;
}

/**
 * The note of an entry whose page cost could not be measured.
 *
 * ⚠️ The panel has to render this as 「未判定」, NOT as 「不用改」: the
 * number was not measured, so nobody knows whether it has to change.
 */
export const UNJUDGED_NOTE = '量不出页成本（并集样本读不到），未判定';

/**
 * The pinned numbers of the repository, as they are today.
 *
 * ⚠️ These are COPIES. The drift-guard test
 * (`tests/unit/lib/webfont-apply.test.ts`) asserts that they still equal
 * what `tests/unit/lib/fonts-css.test.ts` and the verifier's `LIMITS`
 * pin. If one of them moves in the repository and this file does not, the
 * test goes red — which is the whole point of the copy.
 */
export const PINNED = {
  /** `tests/unit/lib/fonts-css.test.ts` — the number of subset files. */
  subsetFiles: 7981,
  /** `tests/unit/lib/fonts-css.test.ts` — the bytes of every subset file. */
  subsetBytes: 28236168,
  /** `tests/unit/lib/fonts-css.test.ts` — the raw bytes of the three stylesheets. */
  cssBytes: 2023175,
  /**
   * `tests/unit/lib/fonts-css.test.ts` — the gzipped bytes of the three
   * stylesheets, in the family order sans → serif → wenkai.
   */
  cssGzipBytes: [55821, 64536, 38491],
  /**
   * `scripts/fonts/verify-webfont-subsets.mjs` — `LIMITS.unionSampleBytes`,
   * in the key order `/`, `/dictionary`, `/poetry`, `/stories`.
   */
  unionSampleBytes: [839680, 330752, 241664, 1214464],
  /** `scripts/fonts/verify-webfont-subsets.mjs` — `LIMITS.maxUnionSampleFilesPerPage`. */
  maxUnionSampleFilesPerPage: 255,
} as const;

/** The paths of the pinned numbers, as the checklist shows them. */
export const PINNED_FILES = {
  fontsCss: 'tests/unit/lib/fonts-css.test.ts',
  verifier: 'scripts/fonts/verify-webfont-subsets.mjs',
  nginx: 'tests/unit/deploy/nginx-config.test.ts',
} as const;

/** The lines of the pinned numbers, as the checklist shows them. */
export const PINNED_LINES = {
  subsetFiles: 310,
  subsetBytes: 311,
  cssBytes: 298,
  cssGzipBytes: [73, 82, 91],
  unionSampleBytes: 201,
  maxUnionSampleFilesPerPage: 207,
  nginxReadPath: 688,
} as const;

/**
 * The read path of the nginx test, as it is today.
 *
 * ⚠️ It is the path the test looks a subset file up at. After an apply the
 * stylesheet points at `web/r<token>/<族>/`, so the path has to carry the
 * release segment.
 *
 * ⚠️⚠️ **Task 2 already made it so (R-205, 2026-11-02).**
 * `tests/unit/deploy/nginx-config.test.ts:688` reads
 * `statSync(resolve(ROOT, 'public', 'font', 'web', face.release, face.dir, face.file))`
 * — the release segment comes from the **stylesheet** (`face.release`), not
 * from a hard-coded name ⇒ the line **follows the stylesheet on its own**.
 * ⇒ There is **nothing for a human to change** after an import.
 *
 * ⇒ This constant is therefore the path **as it is today** — the same string
 * the target is. The spec's §3.5.9 entry 7 ("每次回灌都要改") was written when
 * the `release` field did not exist yet; Task 2 (`488038be3`) landed it early
 * on purpose, exactly so the re-import day would not blow up
 * (`statSync` on a missing path throws ⇒ the whole test file dies at import).
 */
export const CURRENT_READ_PATH = 'public/font/web/<release>/<dir>/<file>';

/**
 * The read path after an apply.
 *
 * ⚠️ It is the **same string** as {@link CURRENT_READ_PATH} — the line
 * already carries the release segment and follows the stylesheet ⇒ the
 * checklist's seventh entry says 「不用改」 (`expected: null`).
 */
export const RELEASED_READ_PATH = 'public/font/web/<release>/<dir>/<file>';

/**
 * The subset files of a font tree, with their bytes.
 *
 * The walk is recursive over `web/`, so it counts EVERY release on the disk
 * — release 0 and every published one. That is the number the checklist's
 * first entry pins.
 */
export function subsetFilesOf(liveFontDir: string): Array<{ path: string; bytes: number }> {
  const root = join(liveFontDir, 'web');
  if (!existsSync(root)) return [];

  const found: Array<{ path: string; bytes: number }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (name.endsWith('.woff2')) {
        found.push({ path: full, bytes: stat.size });
      }
    }
  };
  walk(root);
  return found;
}

/**
 * The raw and the gzipped bytes of the three stylesheets of a font tree.
 *
 * ⚠️ The gzipped bytes are measured with `gzipSync` at the **zlib default
 * level** — the same measurement `tests/unit/lib/fonts-css.test.ts` makes.
 * A different level would produce a different number, and the number would
 * not fit the assertion it has to satisfy.
 */
export function stylesheetSizes(
  liveFontDir: string,
): { rawBytes: number; gzipBytes: number[] } {
  let rawBytes = 0;
  const gzipBytes: number[] = [];

  for (const family of FAMILIES) {
    const path = join(liveFontDir, `fonts-${family}.css`);
    const content = readFileSync(path);
    rawBytes += content.length;
    gzipBytes.push(gzipSync(content).length);
  }

  return { rawBytes, gzipBytes };
}

/** The page cost the gate reported, in the shape the checklist reads. */
export type PageCostInput = {
  bytes: Record<string, number>;
  files: Record<string, number>;
};

/**
 * Builds the checklist of an apply.
 *
 * @param liveFontDir the font tree the apply has just published into
 * @param pageCost the page cost the gate reported, or `null` when it could
 *   not be measured
 * @returns the seven entries, in the order of the specification
 */
export function buildRebaselineChecklist(
  liveFontDir: string,
  pageCost: PageCostInput | null,
): RebaselineEntry[] {
  const subsets = subsetFilesOf(liveFontDir);
  const totalSubsetBytes = subsets.reduce((total, file) => total + file.bytes, 0);
  const { rawBytes, gzipBytes } = stylesheetSizes(liveFontDir);

  // Entry 5: the union-sample budget of every measured page.
  //
  // ⚠️ The expected array keeps the key order of `current` (`/`,
  // `/dictionary`, `/poetry`, `/stories`) — the panel shows the two side by
  // side, and two arrays in different orders are two different rows.
  const unionKeys = ['/', '/dictionary', '/poetry', '/stories'];
  const measuredBytes = unionKeys.map((key) => pageCost?.bytes[key] ?? null);
  const measuredAll = pageCost !== null && measuredBytes.every((value) => value !== null);
  const unionChanged =
    measuredAll &&
    measuredBytes.some((value, index) => value !== PINNED.unionSampleBytes[index]);
  const unionExpected = unionChanged
    ? (measuredBytes as number[])
    : null;

  // Entry 6: the number of font files a page may download. The budget is
  // compared against the MAX over the pages, so that is what the entry
  // carries.
  const measuredFiles = pageCost === null ? [] : Object.values(pageCost.files);
  const maxFiles = measuredFiles.length > 0 ? Math.max(...measuredFiles) : null;
  const filesChanged = maxFiles !== null && maxFiles !== PINNED.maxUnionSampleFilesPerPage;
  const filesExpected = filesChanged ? maxFiles : null;

  // The page cost could not be measured ⇒ the two entries are 未判定, not
  // 「不用改」. The type of `expected` does not change — the note carries
  // the difference.
  const unjudged = pageCost === null;

  return [
    {
      file: PINNED_FILES.fontsCss,
      line: PINNED_LINES.subsetFiles,
      what: 'subsets.length',
      current: PINNED.subsetFiles,
      expected: subsets.length,
      always: true,
    },
    {
      file: PINNED_FILES.fontsCss,
      line: PINNED_LINES.subsetBytes,
      what: '总字节',
      current: PINNED.subsetBytes,
      expected: totalSubsetBytes,
      always: true,
    },
    {
      file: PINNED_FILES.fontsCss,
      line: PINNED_LINES.cssBytes,
      what: 'cssBytes（原始）',
      current: PINNED.cssBytes,
      expected: rawBytes,
      always: true,
    },
    {
      file: PINNED_FILES.fontsCss,
      line: PINNED_LINES.cssGzipBytes[0],
      what: 'gzipBytes（sans / serif / wenkai）',
      current: [...PINNED.cssGzipBytes],
      expected: gzipBytes,
      always: true,
    },
    {
      file: PINNED_FILES.verifier,
      line: PINNED_LINES.unionSampleBytes,
      what: 'LIMITS.unionSampleBytes',
      current: [...PINNED.unionSampleBytes],
      expected: unionExpected,
      always: false,
      ...(unjudged ? { note: UNJUDGED_NOTE } : {}),
    },
    {
      file: PINNED_FILES.verifier,
      line: PINNED_LINES.maxUnionSampleFilesPerPage,
      what: 'LIMITS.maxUnionSampleFilesPerPage',
      current: PINNED.maxUnionSampleFilesPerPage,
      expected: filesExpected,
      always: false,
      ...(unjudged ? { note: UNJUDGED_NOTE } : {}),
    },
    {
      file: PINNED_FILES.nginx,
      line: PINNED_LINES.nginxReadPath,
      what: '读盘路径',
      current: CURRENT_READ_PATH,
      // ⚠️ `null` = 「不用改」. The line already carries the release segment
      // (`face.release` comes from the stylesheet) ⇒ it follows the apply on
      // its own ⇒ there is nothing for a human to edit. See
      // {@link CURRENT_READ_PATH} for the whole story.
      expected: null,
      always: false,
      note: 'Task 2 已把这一行改成 face.release 动态跟随，不需要人工改',
    },
  ];
}
