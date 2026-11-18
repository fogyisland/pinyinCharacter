/**
 * The corpus files of a directory, in BOTH storage shapes.
 *
 * ## WHY
 *
 * `data/classics/` is stored GZIPPED in the repository since 2026-11-18
 * (see `scripts/gzip-classics.ts`) — 251 MB of JSON became 39 MB. The
 * deploy bundle always shipped it gzipped, and the runtime read path
 * (`lib/json-fs.ts`'s `readJsonAuto`) always fell back to `.json.gz`.
 *
 * But several BUILD-TIME scripts walked the directory looking for
 * `*.json` only. On the gzipped corpus they therefore found NOTHING:
 *
 *   - `scripts/build-classics.ts`'s `buildManifestFromDisk()` produced an
 *     EMPTY manifest, and `scripts/init-db.ts` seeds the `classics` table
 *     from that manifest — so a fresh install would seed ZERO books and
 *     the site would look complete while holding nothing;
 *   - `scripts/migrate-classics-to-files.ts`'s `rebuildManifest()` did
 *     the same;
 *   - the font charset scan dropped all 10 970 distinct CJK characters of
 *     the corpus, so the font would ship without the ability to draw the
 *     classics — and NOTHING would turn red.
 *
 * Every failure here is SILENT: the script succeeds, the output looks
 * right, and the defect only shows up in the product. So the two shapes
 * are resolved in ONE place, and every reader goes through it.
 *
 * ## THE CONTRACT
 *
 *   - a file present as `.json` and as `.json.gz` is listed ONCE (the
 *     plain one wins — it is the one a human edits);
 *   - a `.json.gz` file with no plain twin is listed as `foo.json.gz`;
 *   - nothing else is listed.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The corpus files of a directory, plain and compressed.
 *
 * @param dir the directory to list
 * @returns the file names, `foo.json` or `foo.json.gz`, sorted
 */
export function corpusJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const plain = new Set<string>();
  const compressed = new Set<string>();
  for (const name of entries) {
    if (name.endsWith('.json')) {
      plain.add(name);
    } else if (name.endsWith('.json.gz')) {
      compressed.add(name.slice(0, -'.gz'.length));
    }
  }
  // The plain form wins when both are there: it is the form a human
  // edits, and the compressed twin is a stale copy of it.
  const names = new Set<string>();
  for (const name of plain) names.add(name);
  for (const name of compressed) {
    if (!plain.has(name)) names.add(`${name}.gz`);
  }
  return [...names].sort();
}

/**
 * The corpus files of a directory, as ABSOLUTE paths.
 *
 * @param dir the directory to list
 * @returns the absolute paths of the corpus files, sorted
 */
export function corpusJsonPaths(dir: string): string[] {
  return corpusJsonFiles(dir).map((name) => join(dir, name));
}
