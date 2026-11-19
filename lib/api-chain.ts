import type { CharInfo } from './chain-types';
import type { CharSource, HskLevel } from './difficulty';

export type ChainCharsResult = {
  chars: CharInfo[];
  // 2026-07-05 (Task 12 I2): hskFallback from /api/chain/chars envelope —
  // surfaced so ChainGame can render <FallbackBanner /> when the HSK
  // filter was widened to a broader pool.
  hskFallback: boolean;
  // 2026-11-20: the server's query threw. This is NOT "the tier is thin":
  // it is "the database did not answer". The route answers HTTP 200 with
  // an empty list in that case, so without this flag the two are
  // indistinguishable to the client.
  failed: boolean;
};

type CacheKey = string; // `${source}::hsk${level ?? 0}`
const cache = new Map<CacheKey, Promise<ChainCharsResult>>();

export async function fetchChainChars(
  source: CharSource = 'chars-all',
  hskLevel?: HskLevel,
): Promise<ChainCharsResult> {
  // 2026-07-04: cache key now includes hskLevel so different HSK levels
  // don't share cached results (used by /game progressive reveal — Tasks 8/9/10).
  const key = `${source}::hsk${hskLevel ?? 0}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // 2026-11-20: an envelope the server answered, but with `failed: true`,
  // must NOT be cached either. It is a successful HTTP response, so the
  // rejection handler below never fires — and the retry button would read
  // the same failed answer forever.
  const pending = fetch(`/api/chain/chars?source=${source}&hskLevel=${hskLevel ?? ''}`)
    .then((r) => {
      if (!r.ok) throw new Error(`fetch /api/chain/chars failed: ${r.status}`);
      return r.json();
    })
    .then((d): ChainCharsResult => {
      // Backward-compat: API may return either a bare array (legacy)
      // or `{ chars: [...], hskFallback, failed }` (new shape — see Task 6
      // W2/W3 + Task 12 I2 fold-ins).
      if (Array.isArray(d)) {
        return { chars: d as CharInfo[], hskFallback: false, failed: false };
      }
      if (d && typeof d === 'object' && Array.isArray((d as { chars?: unknown }).chars)) {
        const env = d as { chars: CharInfo[]; hskFallback?: boolean; failed?: boolean };
        return {
          chars: env.chars,
          hskFallback: env.hskFallback ?? false,
          failed: env.failed ?? false,
        };
      }
      return { chars: [], hskFallback: false, failed: false };
    });

  cache.set(key, pending);
  // 2026-11-20: never cache a failure. `cache` holds the PROMISE, and a
  // rejection is a value like any other — one network blip used to make
  // the key fail for the life of the tab, so 重试 could not work. The
  // guard keeps a newer entry from being deleted by an older rejection.
  pending.then(
    (result) => {
      if (result.failed && cache.get(key) === pending) cache.delete(key);
    },
    () => {
      if (cache.get(key) === pending) cache.delete(key);
    },
  );
  return pending;
}

export function __resetChainCache(): void {
  cache.clear();
}
