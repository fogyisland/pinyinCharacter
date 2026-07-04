import type { CharInfo } from './chain-types';
import type { CharSource, HskLevel } from './difficulty';

export type ChainCharsResult = {
  chars: CharInfo[];
  // 2026-07-05 (Task 12 I2): hskFallback from /api/chain/chars envelope —
  // surfaced so ChainGame can render <FallbackBanner /> when the HSK
  // filter was widened to a broader pool.
  hskFallback: boolean;
};

type CacheKey = string;  // `${source}::hsk${level ?? 0}`
const cache = new Map<CacheKey, Promise<ChainCharsResult>>();

export async function fetchChainChars(
  source: CharSource = 'chars-all',
  hskLevel?: HskLevel,
): Promise<ChainCharsResult> {
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
        .then((d): ChainCharsResult => {
          // Backward-compat: API may return either a bare array (legacy)
          // or `{ chars: [...], hskFallback }` (new shape — see Task 6
          // W2/W3 + Task 12 I2 fold-ins).
          if (Array.isArray(d)) {
            return { chars: d as CharInfo[], hskFallback: false };
          }
          if (d && typeof d === 'object' && Array.isArray((d as { chars?: unknown }).chars)) {
            const env = d as { chars: CharInfo[]; hskFallback?: boolean };
            return { chars: env.chars, hskFallback: env.hskFallback ?? false };
          }
          return { chars: [], hskFallback: false };
        }),
    );
  }
  return cache.get(key)!;
}

export function __resetChainCache(): void {
  cache.clear();
}