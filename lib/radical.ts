import 'server-only';
import radicals from '@/data/radicals.json';

let map: Record<string, string> | null = null;

export function initRadicalMap(m: Record<string, string>): void {
  map = m;
}

export function _resetRadicalMapForTest(): void {
  map = null;
}

function ensureLoaded(): Record<string, string> {
  if (map) return map;
  // data/radicals.json is a Record<char, radical> built by scripts/build-radicals.ts
  map = radicals as unknown as Record<string, string>;
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
