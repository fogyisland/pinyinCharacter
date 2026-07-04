import type { CharInfo } from './chain-types';
import type { CharSource, HskLevel } from './difficulty';

type CacheKey = string;  // `${source}::hsk${level ?? 0}`
const cache = new Map<CacheKey, Promise<CharInfo[]>>();

export async function fetchChainChars(
  source: CharSource = 'chars-all',
  hskLevel?: HskLevel,
): Promise<CharInfo[]> {
  // 2026-07-04: cache key now includes hskLevel so different HSK levels
  // don't share cached results (used by /game progressive reveal — Tasks 8/9/10).
  const key = `${source}::hsk${hskLevel ?? 0}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`/api/chain/chars?source=${source}&hskLevel=${hskLevel ?? ''}`)
        .then((r) => {
          if (!r.ok) throw new Error(`fetch /api/chain/chars failed: ${r.status}`);
          return r.json();
        })
        .then((d) => {
          // Backward-compat: API may return either a bare array (legacy)
          // or `{ chars: [...] }` (new shape — see Task 6 W2/W3 fold-ins).
          if (Array.isArray(d)) return d as CharInfo[];
          if (d && typeof d === 'object' && Array.isArray((d as { chars?: unknown }).chars)) {
            return (d as { chars: CharInfo[] }).chars;
          }
          return [] as CharInfo[];
        }),
    );
  }
  return cache.get(key)!;
}

export function __resetChainCache(): void {
  cache.clear();
}