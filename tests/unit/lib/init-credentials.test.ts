import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { stashAdminCredentials, consumeAdminCredentials, gcExpired, _resetStoreForTest } from '@/lib/init-credentials';

beforeEach(() => { _resetStoreForTest(); });

describe('stashAdminCredentials', () => {
  it('returns a 32-char hex token', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('consumeAdminCredentials', () => {
  it('returns the same credentials that were stashed', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
    expect(consumeAdminCredentials(t)).toEqual({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
  });

  it('is one-shot (second call returns null)', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(consumeAdminCredentials(t)).not.toBeNull();
    expect(consumeAdminCredentials(t)).toBeNull();
  });

  it('returns null for unknown token', () => {
    expect(consumeAdminCredentials('a'.repeat(32))).toBeNull();
  });

  it('returns null after expiry (>120s)', () => {
    vi.useFakeTimers();
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    vi.advanceTimersByTime(121_000);
    expect(consumeAdminCredentials(t)).toBeNull();
    vi.useRealTimers();
  });
});

describe('gcExpired', () => {
  it('removes only expired entries', () => {
    vi.useFakeTimers();
    const t1 = stashAdminCredentials({ username: 'one', password: 'x' });
    vi.advanceTimersByTime(70_000);
    const t2 = stashAdminCredentials({ username: 'two', password: 'y' });
    vi.advanceTimersByTime(60_000); // t1 now at 130s (expired), t2 at 60s
    gcExpired();
    expect(consumeAdminCredentials(t1)).toBeNull(); // already gone via gc
    expect(consumeAdminCredentials(t2)).not.toBeNull();
    vi.useRealTimers();
  });
});