/**
 * Reading the magic-character relation table.
 *
 * The table is `data/magic-chars.json` — a build product of
 * `scripts/build-magic-chars.ts`. It says, for every character that has
 * stroke data, which other characters are one stroke away and in which
 * direction.
 *
 * Why it is read from disk rather than imported: the table is several
 * megabytes, and an import would put all of it in the client bundle.
 * A player should not download the whole table to answer ten questions.
 * The API route reads it on the server; the client asks the route.
 *
 * So this module is SERVER ONLY. It uses `node:fs`, which a client
 * component cannot bundle.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MagicRelation } from './magic-char-rules';

export type MagicTable = Record<string, Record<string, MagicRelation>>;

/** Where the built table lives. */
const DEFAULT_TABLE_PATH = join(process.cwd(), 'data', 'magic-chars.json');

/**
 * The table, read once and kept.
 *
 * The file is a build product: it does not change while the server runs,
 * so reading it once is enough. Keeping it also means ten questions in
 * a round cost one read.
 */
let cached: MagicTable | null = null;

/**
 * Reads the relation table.
 *
 * The path is a parameter so a test can point it at a table of its own;
 * the API route uses the default.
 *
 * A missing or broken file throws with the path in the message: the
 * usual cause is that `npm run magic:build` has not been run, and a
 * bare "ENOENT" sends the reader looking for a missing dependency
 * instead of a build step.
 */
export function getMagicTable(path: string = DEFAULT_TABLE_PATH): MagicTable {
  if (cached) return cached;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The magic-character table could not be read from ${path}: ${reason}\n` +
        'Build it with `npm run magic:build`.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The magic-character table at ${path} is not valid JSON: ${reason}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `The magic-character table at ${path} is not an object of relations — the build wrote something wrong.`,
    );
  }

  cached = parsed as MagicTable;
  return cached;
}

/** Forgets the cached table. A test uses it; the server never does. */
export function __resetMagicTableCache(): void {
  cached = null;
}
