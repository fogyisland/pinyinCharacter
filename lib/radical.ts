import 'server-only';
import { join } from 'node:path';
import { readJsonAuto } from './json-fs';

/**
 * The char → radical map.
 *
 * data/radicals.json is a Record<char, radical> built by
 * scripts/build-radicals.ts — 70234 entries, 868 KB.
 *
 * The map is read at runtime instead of being imported statically: a static
 * `import radicals from '@/data/radicals.json'` would inline 868 KB of JSON
 * into the server bundle, and this module is reachable from the quest tier
 * builder. The runtime read also finds the `.json.gz` variant the deploy
 * bundle ships (lib/json-fs.ts reads either).
 */
const RADICALS_PATH = join(process.cwd(), 'data', 'radicals.json');

let map: Record<string, string> | null = null;

export function initRadicalMap(m: Record<string, string>): void {
  map = m;
}

export function _resetRadicalMapForTest(): void {
  map = null;
}

function ensureLoaded(): Record<string, string> {
  if (map) return map;
  const raw = readJsonAuto(RADICALS_PATH);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `the radical map could not be read from ${RADICALS_PATH} — every char's radical is unknown until it is`,
    );
  }
  map = raw as Record<string, string>;
  return map;
}

export function getRadical(char: string): string | null {
  if (!char || char.length !== 1) return null;
  const code = char.codePointAt(0)!;
  // Only CJK Unified Ideographs (basic plane + ext A/B) make sense as radicals
  if (code < 0x4e00 || (code > 0x9fff && code < 0x20000)) return null;
  const m = ensureLoaded();
  return m[char] ?? null;
}
