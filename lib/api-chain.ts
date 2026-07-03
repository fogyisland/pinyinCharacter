import type { CharInfo } from './chain-types';
import type { CharSource } from './difficulty';

interface CacheEntry { data: CharInfo[]; ts: number; source: CharSource }
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

export async function fetchChainChars(source: CharSource = 'chars-all'): Promise<CharInfo[]> {
  // Cache per source so easy/medium/hard don't all share the same pool.
  if (cache && cache.source === source && Date.now() - cache.ts < TTL_MS) {
    return cache.data;
  }
  const res = await fetch(`/api/chain/chars?source=${source}`);
  if (!res.ok) throw new Error(`fetch /api/chain/chars failed: ${res.status}`);
  const data = (await res.json()) as CharInfo[];
  cache = { data, ts: Date.now(), source };
  return data;
}
