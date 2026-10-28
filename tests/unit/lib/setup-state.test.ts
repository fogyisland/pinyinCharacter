import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { getSetupState, isSetupComplete } from '@/lib/setup';

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
