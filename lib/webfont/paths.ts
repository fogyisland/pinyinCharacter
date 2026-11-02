/**
 * Where the font pipeline reads and writes.
 *
 * These are pure path constants — no logic, no I/O, no `server-only`
 * marker: the unit tests import them, and so does anything that has to
 * know *which* tree a build touches.
 *
 * ## Why `process.cwd()` and not `__dirname`
 *
 * The font scripts (`scripts/fonts/*.mjs`) compute their own root as
 * `resolve(__dirname, '..', '..')` — the repository root. This module has
 * to agree with them, or the subsetter would cut one tree while the
 * verifier checks another. `__dirname` here would be
 * `<repo>/lib/webfont`, which resolves to the same place… but only until
 * the module is bundled: in a webpack build `__dirname` becomes
 * `.next/server/…` and the two would silently diverge.
 *
 * `process.cwd()` is the repository root for every process in this
 * project: the dev server, `next build`, and the node scripts alike. The
 * pipeline therefore always passes an **absolute** `cwd` to its children
 * and never relies on a relative path resolving the way it "usually" does.
 */
import { join } from 'node:path';

/** The repository root — the directory that holds `scripts/` and `public/`. */
export const REPO_ROOT: string = process.cwd();

/** Where the downloaded source fonts live (shared by every job). */
export const SOURCE_DIR: string = join(REPO_ROOT, 'scripts', 'fonts', 'staging', 'web');

/** Where the finished candidates live — one subdirectory per job. */
export const BUILD_DIR: string = join(REPO_ROOT, 'scripts', 'fonts', 'staging', 'build');

/** The candidate tree of one job: its subsets, its stylesheets, its manifest. */
export function buildDirFor(jobId: string): string {
  return join(BUILD_DIR, jobId);
}

/**
 * The LIVE font tree — the one the site actually serves.
 *
 * The pipeline never writes here. A build produces a candidate under
 * {@link buildDirFor}; promoting it is a separate, explicit step.
 */
export const LIVE_FONT_DIR: string = join(REPO_ROOT, 'public', 'font');
