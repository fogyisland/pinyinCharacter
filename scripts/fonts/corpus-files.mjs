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
 * But the FONT pipeline's corpus scanner (`webfont-charset.mjs`'s
 * `scanJsonDirectory`) only looked at `*.json`. On the gzipped corpus it
 * therefore found **ZERO of the 196 classics files** — and the charset it
 * computed dropped all 10 970 distinct CJK characters of the corpus.
 *
 * That failure is SILENT: the font subset build succeeds, the verifier
 * passes (the budgets are upper bounds), and the site ships a font that
 * cannot draw the classics. Nothing turns red. So the scanner has to
 * accept the compressed shape — and this helper is where that decision
 * lives, in ONE place, so the two shapes can never drift apart again.
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
export function corpusJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const plain = new Set();
  const compressed = new Set();
  for (const name of entries) {
    if (name.endsWith('.json')) {
      plain.add(name);
    } else if (name.endsWith('.json.gz')) {
      compressed.add(name.slice(0, -'.gz'.length));
    }
  }
  // The plain form wins when both are there: it is the form a human
  // edits, and the compressed twin is a stale copy of it.
  const names = new Set();
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
export function corpusJsonPaths(dir) {
  return corpusJsonFiles(dir).map((name) => join(dir, name));
}
