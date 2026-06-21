import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool hoisted to module scope so script-under-test and assertions
// share the SAME vi.fn() instances (mock.calls inspection pattern).
const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
  closePool: vi.fn().mockResolvedValue(undefined),
}));

describe('backfillForm', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  it('processes all rows in batches and UPDATEs form for non-null inferred forms', async () => {
    mockQuery
      .mockResolvedValueOnce([[
        {
          id: 1,
          paragraphs: '["床前明月光","疑是地上霜","举头望明月","低头思故乡"]',
          type: null,
          rhythmic: null,
          dynasty: 'tang',
        },
      ]])
      .mockResolvedValueOnce([[]]);
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { backfillForm } = await import('../../../scripts/build-form-tags');
    const result = await backfillForm({ batchSize: 100, whereFormNull: true });

    expect(result.formSet).toBe(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE poems SET form'),
      expect.any(Array),
    );
  });

  it('--dry-run does not call UPDATE', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const { backfillForm } = await import('../../../scripts/build-form-tags');
    await backfillForm({ dryRun: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
