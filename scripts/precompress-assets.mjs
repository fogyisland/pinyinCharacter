/**
 * scripts/precompress-assets.mjs — writes `.br` and `.gz` sidecars next to
 * the static assets.
 *
 * WHAT THIS IS: a build-time tool. For every text-ish asset it finds, it
 * writes a brotli compressed `<file>.br` and a gzip compressed `<file>.gz`
 * NEXT TO the source file, so that a web server which is configured to look
 * for pre-compressed sidecars (`gzip_static on;` / `brotli_static on;`) can
 * serve them without spending CPU per request.
 *
 * WHAT THIS IS NOT: it is NOT a realised saving. In the current production
 * topology the paths that matter (`/font/`, `/fonts/`, `/strokes/`,
 * `/_next/static/`, `/audio/`, `/logo.png`) are served by Next.js itself,
 * not by nginx out of a disk `alias` (the `alias` blocks in the repository's
 * nginx config do not take effect in production — the repository config is
 * not the deployed one). `gzip_static` / `brotli_static` only do something
 * when nginx itself emits the file, so today the sidecars this script
 * writes are never selected. The compression that is actually live is the
 * runtime `brotli on;` that Task 6 added for the proxied HTML.
 *
 * To make these sidecars pay off, the deployed nginx has to serve those
 * paths from disk. That is an operations decision; this wave does not make
 * it. The tool is still worth shipping: when that happens, the saving costs
 * no runtime CPU.
 *
 * RULES OF THE TOOL:
 *   - it never deletes anything; it only ADDS `.br` / `.gz` sidecars
 *   - a missing directory is not an error: it is reported and skipped
 *   - a sidecar that is newer than its source is left alone, so a second run
 *     is cheap and a rebuild only refreshes what actually changed
 *   - a file that cannot be compressed is reported, named and counted as a
 *     failure — the run then exits non-zero, it never fails silently
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader).
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * The extensions of the files that are worth compressing: they are text, so
 * brotli and gzip actually shrink them.
 */
export const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.html',
  '.txt',
  '.xml',
  '.map',
]);

/**
 * The extensions that are already compressed, or that carry no text at all.
 * They are listed explicitly so the intent is visible: a file in this set is
 * never given a sidecar, no matter what else happens to it.
 */
export const SKIPPED_EXTENSIONS = new Set([
  '.woff',
  '.woff2',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.mp3',
  '.mp4',
  '.zip',
  '.gz',
  '.br',
  '.ttf',
  '.otf',
  '.pdf',
]);

/** The directories the CLI scans when it is given no directory of its own. */
const DEFAULT_DIRECTORIES = ['.next/static', 'public/font'];

/** The root of the repository, derived from the location of this file. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Whether a file is worth compressing.
 *
 * A file is compressible when its extension is in `COMPRESSIBLE_EXTENSIONS`
 * and NOT in `SKIPPED_EXTENSIONS`. The second half of the test is redundant
 * today (the two sets do not overlap) but it keeps the rule honest: should a
 * format ever end up in both lists — a `.br` that is also listed as text, say
 * — the skip wins.
 *
 * @param {string} filePath The path of the file.
 * @returns {boolean} True when the file gets a sidecar.
 */
export function isCompressible(filePath) {
  const extension = extname(filePath).toLowerCase();
  return (
    COMPRESSIBLE_EXTENSIONS.has(extension) && !SKIPPED_EXTENSIONS.has(extension)
  );
}

/**
 * Report a failure. The message names the file, so a log line is enough to
 * find the culprit — a failure is never swallowed.
 *
 * @param {string} filePath The file that failed.
 * @param {unknown} error The error that caused it.
 */
function reportFailure(filePath, error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[precompress] failed: ${filePath}: ${reason}`);
}

/**
 * Whether the brotli sidecar of a file is at least as new as the file
 * itself.
 *
 * @param {string} sidecarPath The path of the `.br` sidecar.
 * @param {number} sourceMtimeMs The modification time of the source file.
 * @returns {Promise<boolean>} True when the sidecar is up to date.
 */
async function isSidecarCurrent(sidecarPath, sourceMtimeMs) {
  try {
    const sidecarStat = await stat(sidecarPath);
    return sidecarStat.mtimeMs >= sourceMtimeMs;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Precompress one file: write a `.br` and a `.gz` next to it.
 *
 * The file is left alone when it is not compressible, or when its brotli
 * sidecar is already newer than the file itself (unless `force` says
 * otherwise).
 *
 * @param {string} filePath The path of the file to precompress.
 * @param {{ force?: boolean }} [options] The options of the run.
 * @returns {Promise<{ file: string, bytesIn: number, bytesOut: number, status: 'written' | 'skipped' | 'failed' }>}
 *   What the call did: `bytesIn` is the size of the source, `bytesOut` is
 *   the size of the brotli sidecar this call wrote (0 when it wrote none).
 */
export async function precompressFile(filePath, options = {}) {
  const { force = false } = options;

  if (!isCompressible(filePath)) {
    return { file: filePath, bytesIn: 0, bytesOut: 0, status: 'skipped' };
  }

  let sourceStat;
  try {
    sourceStat = await stat(filePath);
  } catch (error) {
    reportFailure(filePath, error);
    return { file: filePath, bytesIn: 0, bytesOut: 0, status: 'failed' };
  }

  if (!sourceStat.isFile()) {
    return { file: filePath, bytesIn: 0, bytesOut: 0, status: 'skipped' };
  }

  const bytesIn = sourceStat.size;

  if (!force) {
    const current = await isSidecarCurrent(`${filePath}.br`, sourceStat.mtimeMs);
    if (current) {
      return { file: filePath, bytesIn, bytesOut: 0, status: 'skipped' };
    }
  }

  try {
    const source = await readFile(filePath);
    const brotli = await brotliCompressAsync(source, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
    });
    const gzipped = await gzipAsync(source, { level: 9 });
    await writeFile(`${filePath}.br`, brotli);
    await writeFile(`${filePath}.gz`, gzipped);
    return { file: filePath, bytesIn, bytesOut: brotli.length, status: 'written' };
  } catch (error) {
    reportFailure(filePath, error);
    return { file: filePath, bytesIn, bytesOut: 0, status: 'failed' };
  }
}

/**
 * Walk a directory tree and precompress every file in it.
 *
 * The listing of a directory is taken ONCE, before any file in it is
 * touched. That matters: the sidecars are written INTO the directory that
 * is being walked, so a walk that re-read the listing would count the
 * `.br` / `.gz` files it just created as source files, and the skipped count
 * would be inflated by the very work the run had just done.
 *
 * @param {string} dir The root of the tree.
 * @param {{ force?: boolean }} [options] The options of the run.
 * @returns {Promise<{ written: number, skipped: number, failed: number, savedBytes: number }>}
 *   The totals of the walk. `savedBytes` is the sum of the source bytes minus
 *   the brotli bytes over every file that was written.
 */
export async function precompressTree(dir, options = {}) {
  const totals = { written: 0, skipped: 0, failed: 0, savedBytes: 0 };
  await walk(dir, options, totals);
  return totals;
}

/**
 * Walk one directory and add its results to the totals.
 *
 * @param {string} dir The directory to walk.
 * @param {{ force?: boolean }} options The options of the run.
 * @param {{ written: number, skipped: number, failed: number, savedBytes: number }} totals
 *   The totals to add to.
 */
async function walk(dir, options, totals) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, options, totals);
      continue;
    }

    if (!entry.isFile()) continue;

    const result = await precompressFile(fullPath, options);
    if (result.status === 'written') {
      totals.written += 1;
      totals.savedBytes += result.bytesIn - result.bytesOut;
    } else if (result.status === 'skipped') {
      totals.skipped += 1;
    } else {
      totals.failed += 1;
    }
  }
}

/**
 * Whether a path exists.
 *
 * @param {string} target The path to look at.
 * @returns {Promise<boolean>} True when the path is there.
 */
async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a number of bytes for a human reader.
 *
 * @param {number} bytes The number of bytes.
 * @returns {string} The formatted size.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Run the CLI: precompress the given directories, or the default ones.
 *
 * @param {string[]} argv The arguments of the command line.
 * @returns {Promise<number>} The exit code of the run.
 */
async function run(argv) {
  const force = argv.includes('--force');
  const unknown = argv.filter(
    (argument) => argument.startsWith('--') && argument !== '--force',
  );
  if (unknown.length > 0) {
    console.error(`[precompress] unknown option: ${unknown.join(', ')}`);
    console.error(
      '[precompress] usage: node scripts/precompress-assets.mjs [--force] [directory ...]',
    );
    return 1;
  }

  const directories = argv.filter((argument) => !argument.startsWith('--'));
  const targets =
    directories.length > 0
      ? directories.map((directory) => resolve(directory))
      : DEFAULT_DIRECTORIES.map((directory) => resolve(REPOSITORY_ROOT, directory));

  const totals = { written: 0, skipped: 0, failed: 0, savedBytes: 0 };

  for (const target of targets) {
    let result;
    try {
      result = await precompressTree(target, { force });
    } catch (error) {
      // A directory that is not there is not a failure: `.next/static` only
      // exists after a build, and this repository builds elsewhere.
      if (error && error.code === 'ENOENT' && !(await exists(target))) {
        console.log(`[precompress] skipped: ${target} does not exist`);
        continue;
      }
      throw error;
    }

    totals.written += result.written;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.savedBytes += result.savedBytes;

    console.log(
      `[precompress] ${target}: written ${result.written}, skipped ${result.skipped}, ` +
        `failed ${result.failed}, saved ${formatBytes(result.savedBytes)} (${result.savedBytes} bytes)`,
    );
  }

  console.log(
    `[precompress] total: written ${totals.written}, skipped ${totals.skipped}, ` +
      `failed ${totals.failed}, saved ${formatBytes(totals.savedBytes)} (${totals.savedBytes} bytes)`,
  );

  if (totals.failed > 0) {
    console.error(
      `[precompress] ${totals.failed} file(s) failed — every failure is named in the error lines above`,
    );
    return 1;
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  run(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `[precompress] the run itself failed: ${error.stack ?? error.message}`,
      );
      process.exitCode = 1;
    });
}
