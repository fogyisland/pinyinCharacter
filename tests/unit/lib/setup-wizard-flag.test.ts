import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

// import after mocks
import { isInitWizardAdminDone } from '@/lib/setup';

beforeEach(() => {
  queryMock.mockReset();
  // ensure DATABASE_URL is set for these tests
  process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test';
});

describe('isInitWizardAdminDone', () => {
  it('returns false when row missing', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    expect(await isInitWizardAdminDone()).toBe(false);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("`key` = 'setup.wizard.admin_done'"),
    );
  });

  it('returns true when value="true"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'true' }]]);
    expect(await isInitWizardAdminDone()).toBe(true);
  });

  it('returns false when value="false"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'false' }]]);
    expect(await isInitWizardAdminDone()).toBe(false);
  });

  it('returns false when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    expect(await isInitWizardAdminDone()).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns false on DB error (defensive)', async () => {
    queryMock.mockRejectedValueOnce(new Error('pool gone'));
    expect(await isInitWizardAdminDone()).toBe(false);
  });
});