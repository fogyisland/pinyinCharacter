import { describe, it, expect } from 'vitest';
// @ts-expect-error -- the module is plain ESM. The repository convention is a
// sibling `.d.mts` (see scripts/fonts/build-webfont-subsets.d.mts), but the
// file whitelist of this task allows no new file besides the ones listed in it.
import { verifyAll, LIMITS } from '../../../scripts/fonts/verify-webfont-subsets.mjs';

describe('verify-webfont-subsets', () => {
  it(
    'passes on the committed font artifacts',
    async () => {
      const result = await verifyAll();
      if (!result.ok) {
        console.error(result.errors.join('\n'));
      }
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    },
    300_000,
  );

  it('publishes the size limits from the design', () => {
    expect(LIMITS.hotBytes).toBe(96 * 1024);
    expect(LIMITS.extBlockBytes).toBe(7 * 1024);
    expect(LIMITS.cssBytes).toBe(175 * 1024);
    expect(LIMITS.sansCssBytes).toBe(65 * 1024);
    expect(LIMITS.maxFontFilesPerPage).toBe(12);
    expect(LIMITS.pageFontBytes['/dictionary']).toBe(330 * 1024);
  });
});
