/**
 * Type declarations for scripts/fonts/import-webfont-release.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * script, and keeps `tsc --noEmit` honest about the shapes involved.
 *
 * ⚠️ The script is a **command line tool**, not a library: it parses
 * `process.argv`, stages paths with git and exits. The only thing a test
 * imports is {@link main}, which runs it with an explicit argument list and
 * an explicit working directory — so that a test can point it at a
 * TEMPORARY git repository instead of this one.
 */
import type { EnvRecord } from './build-webfont-subsets.mjs';

/** What the script was asked to do. */
export interface ImportOptions {
  /**
   * The release directory to re-import — `r` and twelve lowercase hex
   * characters.
   *
   * ⚠️ The shape is checked BEFORE any path is built, so a traversal
   * (`../../evil`) is refused before it can reach the font tree.
   */
  release: string;
  /** True when the script commits; false when it only stages. */
  commit: boolean;
}

/**
 * The numbers the script prints, in the shape the parseable output block
 * carries them.
 *
 * ⚠️ The script PRINTS these numbers; it never writes them into a source
 * file. The re-calibration of the pinned constants is a separate,
 * human-reviewed change (design §3.7).
 */
export interface PrintedNumbers {
  /** The number of `*.woff2` under `public/font/web/` — RECURSIVE, so it counts every release. */
  subsetFiles: number;
  /** Their total bytes. */
  subsetBytes: number;
  /** The raw bytes of the three stylesheets together. */
  cssBytes: number;
  /** The gzipped bytes of each stylesheet, by family. */
  gzipBytes: Record<'sans' | 'serif' | 'wenkai', number>;
  /** The hash of the three stylesheets — the version of the manifest. */
  manifestVersion: string;
}

/**
 * The failure of the script.
 *
 * Every refusal is one of these, and it always carries a Chinese message
 * the operator can act on.
 */
export declare class UserError extends Error {}

/**
 * Run the script.
 *
 * @param argv the arguments, without the script and the node
 * @param cwd the directory the script works in — the repository root
 */
export declare function main(argv: string[], cwd?: string): number;
