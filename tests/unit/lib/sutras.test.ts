import { describe, it, expect } from 'vitest';
import { getSutra } from '@/lib/sutras';
import { sutrasFsAvailable } from '@/lib/sutras-fs';

describe('getSutra — chunk.id convention', () => {
  it('returns 0-based chunk ids matching the array index', async () => {
    if (!sutrasFsAvailable()) return; // skip on hosts without data/sutras
    // xinjing has 1 chunk. Its raw JSON stores `id: 1` (legacy 1-based);
    // getSutra must rewrite to 0 so SutraCopyView's ?chunk=0 call matches
    // the copy-progress API's chunkCount=1 range.
    const sutra = await getSutra(1);
    expect(sutra).not.toBeNull();
    expect(sutra!.chunks.length).toBeGreaterThan(0);
    sutra!.chunks.forEach((c, i) => {
      expect(c.id).toBe(i);
    });
  });

  it('xinjing: first chunk id is 0 (not 1), so it passes the API range check', async () => {
    if (!sutrasFsAvailable()) return;
    const sutra = await getSutra(1);
    expect(sutra).not.toBeNull();
    expect(sutra!.chunks.length).toBe(1);
    expect(sutra!.chunks[0].id).toBe(0);
  });
});
