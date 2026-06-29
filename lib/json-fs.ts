import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * Read a JSON file, transparently handling .json.gz if .json is missing.
 *
 * The Up/ deploy bundle ships data/classics/*.json.gz and data/content/*.json.gz
 * (created by scripts/copy-to-up.py) to shrink the bundle by ~180 MB. In dev
 * we ship plain .json — same code reads both, so the loader never knows the
 * difference. Use this helper for any large data JSON the bundle includes.
 *
 * Cost vs plain JSON: per-read CPU ~5-15 ms (zlib gunzip), memory peak
 * slightly above file size during inflate, then JSON.parse as usual.
 */
export function readJsonAuto(path: string): unknown | null {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const gzPath = `${path}.gz`;
  if (existsSync(gzPath)) {
    const buf = readFileSync(gzPath);
    const text = gunzipSync(buf).toString('utf8');
    return JSON.parse(text);
  }
  return null;
}

/**
 * Same as readJsonAuto, with a per-process in-memory cache so the second
 * request for the same path is a dictionary lookup. Used for the per-char
 * data/content files (7905 entries) and per-book data/classics files (196
 * entries) — both are read repeatedly at runtime and benefit greatly from
 * memoization once decompressed.
 */
const cache = new Map<string, unknown>();

export function readJsonAutoCached(path: string): unknown | null {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  const value = readJsonAuto(path);
  if (value !== null) cache.set(path, value);
  return value;
}

/** Drop a path from the cache (used by writers so subsequent reads see fresh data). */
export function invalidateJsonCache(path: string): void {
  cache.delete(path);
}

/** Clear all entries — used by tests and by any bulk importer that wrote many files. */
export function clearJsonCache(): void {
  cache.clear();
}

/**
 * Resolve data/<dir>/<file> → first existing of (.json.gz, .json). Returns
 * null if neither exists. Used by readers that want to log/branch on
 * existence without the extra stat for the unfound path.
 */
export function resolveJsonPath(dir: string, file: string): string | null {
  const jsonPath = join(dir, `${file}.json`);
  if (existsSync(jsonPath)) return jsonPath;
  const gzPath = join(dir, `${file}.json.gz`);
  if (existsSync(gzPath)) return gzPath;
  return null;
}