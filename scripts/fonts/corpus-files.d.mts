/**
 * Type declarations for scripts/fonts/corpus-files.mjs.
 *
 * The script itself is plain ESM JavaScript so it can be run with a bare
 * `node` (no build step, no tsx loader). This sibling declaration file
 * gives TypeScript the types it needs when the unit test imports the
 * helpers, and keeps `tsc --noEmit` honest about the shapes involved.
 */

/**
 * The corpus files of a directory, plain and compressed.
 *
 * A file present as `.json` and as `.json.gz` is listed ONCE — the plain
 * form wins, because it is the form a human edits. A `.json.gz` file with
 * no plain twin is listed as `foo.json.gz`.
 */
export declare function corpusJsonFiles(dir: string): string[];

/**
 * The corpus files of a directory, as ABSOLUTE paths.
 */
export declare function corpusJsonPaths(dir: string): string[];
