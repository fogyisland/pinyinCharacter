import { describe, it, expect } from 'vitest';
import {
  generateResetToken, hashResetToken,
  RESET_TTL_MINUTES, TOKEN_MIN_LENGTH,
} from '@/lib/password-reset';

describe('password-reset primitives', () => {
  it('generateResetToken returns base64url with min length', () => {
    const t = generateResetToken();
    expect(t.length).toBeGreaterThanOrEqual(TOKEN_MIN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls return different tokens', () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });

  it('hashResetToken is deterministic and 64 hex chars', () => {
    const h = hashResetToken('abc');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(hashResetToken('abc')).toBe(h);
  });

  it('hashResetToken changes with different input', () => {
    expect(hashResetToken('abc')).not.toBe(hashResetToken('xyz'));
  });

  it('RESET_TTL_MINUTES is 15', () => {
    expect(RESET_TTL_MINUTES).toBe(15);
  });
});
