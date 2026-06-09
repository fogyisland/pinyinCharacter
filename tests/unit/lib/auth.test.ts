import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  hashPassword, verifyPassword, signSession, verifySession,
  validateUsername, validatePassword,
} from '@/lib/auth';

const TEST_SECRET = 'x'.repeat(40);

beforeAll(() => { process.env.JWT_SECRET = TEST_SECRET; });
beforeEach(() => { process.env.JWT_SECRET = TEST_SECRET; });

describe('auth lib', () => {
  it('hashes and verifies a password', async () => {
    const h = await hashPassword('hunter22-abc');
    expect(h).not.toBe('hunter22-abc');
    expect(await verifyPassword('hunter22-abc', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('signs and verifies a session token', async () => {
    const tok = await signSession({ id: 7, username: 'alice' });
    const s = await verifySession(tok);
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(7);
    expect(s!.username).toBe('alice');
  });

  it('returns null for invalid token', async () => {
    const s = await verifySession('garbage.token.string');
    expect(s).toBeNull();
  });

  it('validateUsername accepts good input', () => {
    expect(validateUsername('good_user-1')).toBeNull();
  });

  it('validateUsername rejects too-short', () => {
    expect(validateUsername('ab')).toMatch(/3-32/);
  });

  it('validateUsername rejects bad chars', () => {
    expect(validateUsername('a b')).toMatch(/只能含/);
  });

  it('validatePassword accepts good input', () => {
    expect(validatePassword('longenoughpwd')).toBeNull();
  });

  it('validatePassword rejects too-short', () => {
    expect(validatePassword('short')).toMatch(/至少 8/);
  });

  it('validatePassword rejects too-long', () => {
    expect(validatePassword('a'.repeat(73))).toMatch(/不能超过/);
  });

  it('throws if JWT_SECRET is too short', async () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short';
    await expect(signSession({ id: 1, username: 'x' })).rejects.toThrow(/32/);
    process.env.JWT_SECRET = original;
  });
});
