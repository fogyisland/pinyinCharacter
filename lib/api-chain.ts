import type { CharInfo } from './chain-types';

interface CacheEntry { data: CharInfo[]; ts: number }
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

export async function fetchChainChars(): Promise<CharInfo[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return cache.data;
  }
  const res = await fetch('/api/chain/chars');
  if (!res.ok) throw new Error(`fetch /api/chain/chars failed: ${res.status}`);
  const data = (await res.json()) as CharInfo[];
  cache = { data, ts: Date.now() };
  return data;
}
