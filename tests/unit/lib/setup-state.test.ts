import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { getSetupState, isSetupComplete, isMissingTableError } from '@/lib/setup';

beforeEach(() => {
  queryMock.mockReset();
  process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test';
});

/**
 * The tri-state setup state.
 *
 * `isSetupComplete()` alone cannot drive a redirect: it collapses "setup
 * never ran" and "the database is unreachable" into the same `false`, and
 * a gate that redirects on `false` would bounce every visitor into the
 * wizard whenever the database blinks. `getSetupState()` keeps the three
 * cases apart.
 */
describe('getSetupState', () => {
  it('is "incomplete" when DATABASE_URL is not set (the install was never configured)', async () => {
    delete process.env.DATABASE_URL;
    expect(await getSetupState()).toBe('incomplete');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('is "complete" when setup.completed = "true"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'true' }]]);
    expect(await getSetupState()).toBe('complete');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("`key` = 'setup.completed'"),
    );
  });

  it('is "incomplete" when the setup.completed row is missing', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    expect(await getSetupState()).toBe('incomplete');
  });

  it('is "incomplete" when setup.completed is set to anything but "true"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'false' }]]);
    expect(await getSetupState()).toBe('incomplete');
  });

  it('is "unknown" when the database cannot be reached (never "incomplete")', async () => {
    queryMock.mockRejectedValueOnce(new Error('pool gone'));
    expect(await getSetupState()).toBe('unknown');
  });

  it('is "incomplete" when the app_config table does not exist yet', async () => {
    // The empty-database first-run state. MySQL reports a missing table
    // (or a missing schema) as ER_NO_SUCH_TABLE / errno 1146.
    const missing = Object.assign(new Error("Table 'app_config' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE',
      errno: 1146,
      sqlState: '42S02',
    });
    queryMock.mockRejectedValueOnce(missing);

    expect(await getSetupState()).toBe('incomplete');
  });

  it('is "incomplete" for a missing table identified only by errno', async () => {
    // A driver that populates errno but not code must still be recognised.
    const missing = Object.assign(new Error("Table 'app_config' doesn't exist"), {
      errno: 1146,
    });
    queryMock.mockRejectedValueOnce(missing);

    expect(await getSetupState()).toBe('incomplete');
  });

  it('is "incomplete" for a missing table identified only by sqlState', async () => {
    const missing = Object.assign(new Error("Table 'app_config' doesn't exist"), {
      sqlState: '42S02',
    });
    queryMock.mockRejectedValueOnce(missing);

    expect(await getSetupState()).toBe('incomplete');
  });

  it('is "unknown" for a refused connection, not a missing table', async () => {
    const refused = Object.assign(new Error('Access denied'), {
      code: 'ER_ACCESS_DENIED_ERROR',
      errno: 1045,
      sqlState: '28000',
    });
    queryMock.mockRejectedValueOnce(refused);

    expect(await getSetupState()).toBe('unknown');
  });

  it('is "unknown" for a timeout, not a missing table', async () => {
    const timedOut = Object.assign(new Error('ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    queryMock.mockRejectedValueOnce(timedOut);

    expect(await getSetupState()).toBe('unknown');
  });
});

describe('isMissingTableError', () => {
  it('recognises the missing-table error by code, errno or sqlState', () => {
    expect(isMissingTableError({ code: 'ER_NO_SUCH_TABLE' })).toBe(true);
    expect(isMissingTableError({ errno: 1146 })).toBe(true);
    expect(isMissingTableError({ sqlState: '42S02' })).toBe(true);
  });

  it('rejects everything else, including non-objects', () => {
    expect(isMissingTableError({ code: 'ECONNREFUSED' })).toBe(false);
    expect(isMissingTableError({ errno: 1045 })).toBe(false);
    expect(isMissingTableError(new Error('pool gone'))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError('ER_NO_SUCH_TABLE')).toBe(false);
  });
});

describe('isSetupComplete', () => {
  it('is true only for the "complete" state', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'true' }]]);
    expect(await isSetupComplete()).toBe(true);
  });

  it('is false for "incomplete"', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    expect(await isSetupComplete()).toBe(false);
  });

  it('is false for "unknown" (unchanged defensive behaviour)', async () => {
    queryMock.mockRejectedValueOnce(new Error('pool gone'));
    expect(await isSetupComplete()).toBe(false);
  });

  it('is false when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    expect(await isSetupComplete()).toBe(false);
  });
});
