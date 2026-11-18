import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { listWebhooks } from '@/lib/wecom-webhooks';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
});

describe('reading the groups when the table is not there yet', () => {
  it('returns an empty list instead of throwing', async () => {
    // The two tables are created by a migration, and the migration is run
    // BY HAND on the server (`npx tsx scripts/migrate.ts`). Until it is,
    // `wecom_webhooks` does not exist and MySQL answers
    // ER_NO_SUCH_TABLE.
    //
    // The admin page is a server component that calls `listWebhooks()`
    // directly. An unhandled throw there takes down the WHOLE page —
    // React renders the error boundary for the entire route, not a panel.
    // The admin cannot even reach the page that tells them to run the
    // migration.
    //
    // The repo's convention is that a missing table is a STATE, not a
    // failure: `getAllConfig()` swallows it and returns an empty map
    // (lib/config.ts). This does the same.
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error("Table 'pinyin.wecom_webhooks' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
      }),
    );

    await expect(listWebhooks()).resolves.toEqual([]);
  });
});
