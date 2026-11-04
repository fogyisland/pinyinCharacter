import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { markInitWizardAdminDone } from '@/lib/setup';

/**
 * A MySQL "missing table" error, shaped the way mysql2 reports it.
 * The code is the stable identifier; errno and sqlState are checked too.
 */
function missingTableError(): Error {
  const error = new Error("Table 'pinyin_test.app_config' doesn't exist") as Error & {
    code: string;
    errno: number;
    sqlState: string;
  };
  error.code = 'ER_NO_SUCH_TABLE';
  error.errno = 1146;
  error.sqlState = '42S02';
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markInitWizardAdminDone', () => {
  it('writes the marker and reports that it landed', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);

    const written = await markInitWizardAdminDone();

    expect(written).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain("'setup.wizard.admin_done'");
    expect(queryMock.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('reports "not written" instead of throwing when the table does not exist yet', async () => {
    queryMock.mockRejectedValue(missingTableError());

    const written = await markInitWizardAdminDone();

    expect(written).toBe(false);
  });

  it('still throws when the failure is a real fault (not a missing table)', async () => {
    const fault = new Error('Access denied for user') as Error & { code: string };
    fault.code = 'ER_ACCESS_DENIED_ERROR';
    queryMock.mockRejectedValue(fault);

    await expect(markInitWizardAdminDone()).rejects.toThrow('Access denied for user');
  });
});
