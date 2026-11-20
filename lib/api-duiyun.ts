/**
 * The client for the couplets.
 *
 * The route answers `{ pairs, failed }`. A failed envelope — the data file
 * could not be read — is not cached, so a retry button actually retries.
 */
import type { DuiyunPair } from './duiyun-rules';

/** What the route answered. */
export interface DuiyunResult {
  pairs: DuiyunPair[];
  /** The server could not read the data file. The list is empty and the game says so. */
  failed: boolean;
}

type CacheKey = string;
const cache = new Map<CacheKey, Promise<DuiyunResult>>();

/** Read the couplets the game draws from. */
export async function fetchDuiyunPairs(limit?: number): Promise<DuiyunResult> {
  const key = `limit:${limit ?? 0}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const query = limit === undefined ? '' : `?limit=${limit}`;
  const pending = fetch(`/api/duiyun${query}`)
    .then((response) => {
      if (!response.ok) throw new Error(`fetch /api/duiyun failed: ${response.status}`);
      return response.json();
    })
    .then((data): DuiyunResult => {
      if (data && typeof data === 'object' && Array.isArray((data as { pairs?: unknown }).pairs)) {
        const envelope = data as { pairs: DuiyunPair[]; failed?: boolean };
        return { pairs: envelope.pairs, failed: envelope.failed ?? false };
      }
      return { pairs: [], failed: false };
    });

  cache.set(key, pending);
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

export function __resetDuiyunCache(): void {
  cache.clear();
}
