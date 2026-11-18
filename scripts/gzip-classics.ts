/**
 * gzip-classics — compress `data/classics/*.json` in place.
 *
 * ## WHY
 *
 * The classics corpus is 251 MB of JSON across 196 files, and it is the
 * largest thing in the git repository (the packed repo is 362 MB). The
 * deploy bundle ALREADY ships these files gzipped (see
 * `scripts/copy-to-up.py`'s `GZIP_DIRS`), and the read path ALREADY falls
 * back to `.json.gz` (see `lib/json-fs.ts`'s `readJsonAuto` and
 * `lib/classics/loader.ts`'s `classicFileBytes`) — so the repository is the
 * ONLY place still carrying the uncompressed form.
 *
 * Compressing them in the repository costs nothing at runtime: the reader
 * does the same gunzip it already does for a `.gz`-only deployment.
 *
 * ## WHAT IT DOES
 *
 *   - for every `data/classics/*.json`, write `<name>.json.gz` and delete
 *     the plain file;
 *   - a file that already has a `.json.gz` twin is left untouched — the
 *     twin is the current form, and re-compressing it would need the plain
 *     file, which is gone;
 *   - `decompressClassics` is the inverse, for a machine that wants the
 *     plain files back (a local checkout that diffs the corpus).
 *
 * ## ⚠️ THE GITIGNORE TRAP
 *
 * The repository's `.gitignore` carries a blanket `*.gz` rule (it keeps
 * the precompress-assets sidecars out of git). Without an explicit
 * un-ignore rule, `git add data/classics` silently skips every `.json.gz`
 * — the commit looks successful and the files are NOT in it. The next
 * clone has no classics at all and the reader falls back to the database,
 * which is empty on a fresh install.
 *
 * ⇒ `.gitignore` therefore carries a `!data/classics/*.json.gz` exception,
 * and `tests/unit/scripts/gzip-classics.test.ts` asserts the rule exists
 * AND that it comes after the blanket rule (in one `.gitignore` the last
 * matching rule wins).
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GzipClassicsResult {
  /** How many files were compressed in this run. */
  compressed: number;
  /** The bytes of plain JSON that were replaced. */
  bytesIn: number;
  /** The bytes of gzip that replaced them. */
  bytesOut: number;
}

/** The classics directory of a repository root. */
export function classicsDir(repoRoot: string): string {
  return join(repoRoot, 'data', 'classics');
}

/**
 * Compress every plain `.json` of the classics directory.
 *
 * @param repoRoot the repository root — the directory that HOLDS
 *   `data/classics`
 * @returns how much was compressed
 */
export function gzipClassics(repoRoot: string): GzipClassicsResult {
  const dir = classicsDir(repoRoot);
  const result: GzipClassicsResult = { compressed: 0, bytesIn: 0, bytesOut: 0 };
  if (!existsSync(dir)) return result;

  const entries = readdirSync(dir).filter((name) => name.endsWith('.json'));
  for (const name of entries) {
    const plainPath = join(dir, name);
    const gzPath = `${plainPath}.gz`;
    // A file that already has its compressed twin is left alone: the
    // compressed twin is the current form, and re-compressing it would
    // need the plain file, which is gone.
    if (existsSync(gzPath)) continue;

    const plain = readFileSync(plainPath);
    const gz = gzipSync(plain, { level: 9 });
    writeFileSync(gzPath, gz);
    rmSync(plainPath);

    result.compressed += 1;
    result.bytesIn += plain.byteLength;
    result.bytesOut += gz.byteLength;
  }
  return result;
}

/**
 * The inverse: expand every `.json.gz` back into a plain `.json`.
 *
 * @param repoRoot the repository root — the directory that HOLDS
 *   `data/classics`
 * @returns how many files were expanded
 */
export function decompressClassics(repoRoot: string): number {
  const dir = classicsDir(repoRoot);
  let count = 0;
  if (!existsSync(dir)) return count;

  const entries = readdirSync(dir).filter((name) => name.endsWith('.json.gz'));
  for (const name of entries) {
    const gzPath = join(dir, name);
    const plainPath = gzPath.slice(0, -3);
    // Both forms present: the plain one wins and the compressed twin
    // stays where it is — removing it would lose bytes.
    if (existsSync(plainPath)) continue;

    const plain = gunzipSync(readFileSync(gzPath));
    writeFileSync(plainPath, plain);
    rmSync(gzPath);
    count += 1;
  }
  return count;
}

/** True when the command was asked to expand rather than compress. */
function wantsDecompress(argv: readonly string[]): boolean {
  return argv.includes('--decompress');
}

function main(): void {
  const repoRoot = process.cwd();
  if (wantsDecompress(process.argv.slice(2))) {
    const count = decompressClassics(repoRoot);
    console.log(`[gzip-classics] expanded ${count} file(s)`);
    return;
  }
  const result = gzipClassics(repoRoot);
  const savedMb = (result.bytesIn - result.bytesOut) / 1024 / 1024;
  console.log(
    `[gzip-classics] compressed ${result.compressed} file(s): ` +
      `${(result.bytesIn / 1024 / 1024).toFixed(1)} MB → ` +
      `${(result.bytesOut / 1024 / 1024).toFixed(1)} MB (saved ${savedMb.toFixed(1)} MB)`,
  );
}

// Only run when invoked directly, so the test can import the functions.
if (require.main === module) {
  main();
}
