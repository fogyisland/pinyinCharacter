import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cache the mock pool at module-factory scope so the script-under-test
// and the test assertions share the SAME vi.fn() instance.
const mockPool = {
  query: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
  execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
};

vi.mock('../../../lib/db', () => ({
  getPool: () => mockPool,
  closePool: vi.fn().mockResolvedValue(undefined),
}));

describe('normalizeExistingForm', () => {
  beforeEach(() => {
    mockPool.query.mockClear();
    mockPool.execute.mockClear();
  });

  it('runs 4 UPDATE statements', async () => {
    const { normalizeExistingForm } = await import('../../../scripts/normalize-existing-form');
    await normalizeExistingForm();
    const updateCalls = mockPool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).startsWith('UPDATE')
    );
    expect(updateCalls.length).toBe(4);
  });

  it('maps 五言律诗 -> 五律 etc.', async () => {
    const { NORMALIZE_MAP } = await import('../../../scripts/normalize-existing-form');
    expect(NORMALIZE_MAP).toEqual({
      '五言律诗': '五律',
      '七言律诗': '七律',
      '五言古诗': '五言古风',
      '七言古诗': '七言古风',
    });
  });
});
