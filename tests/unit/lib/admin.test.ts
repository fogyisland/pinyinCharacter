import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedExecute = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ execute: mockedExecute }),
}));

import { generateTempPassword, listUsers } from '@/lib/admin';

describe('admin pure helpers', () => {
  it('generateTempPassword returns 16+ char base64url', () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls return different passwords', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

describe('listUsers q filter', () => {
  beforeEach(() => mockedExecute.mockReset());

  it('q matches username OR email with two %x% params', async () => {
    // Two execute calls: one for rows + one for count
    mockedExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listUsers({ q: 'alice' });
    expect(mockedExecute.mock.calls[0][0]).toContain('(u.username LIKE ? OR u.email LIKE ?)');
    // First query params: [q_value, q_value, limit, offset] — q bound twice
    expect(mockedExecute.mock.calls[0][1].slice(0, 2)).toEqual(['%alice%', '%alice%']);
  });

  it('q omitted leaves username/email out of WHERE', async () => {
    mockedExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ n: 0 }]]);
    await listUsers({});
    expect(mockedExecute.mock.calls[0][0]).not.toContain('username LIKE');
    expect(mockedExecute.mock.calls[0][0]).not.toContain('email LIKE');
  });
});
