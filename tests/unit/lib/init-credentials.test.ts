import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stashAdminCredentials,
  consumeAdminCredentials,
  gcExpired,
  _resetStoreForTest,
} from '@/lib/init-credentials';

beforeEach(() => {
  _resetStoreForTest();
});

describe('stashAdminCredentials', () => {
  it('returns a 32-char hex token', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('consumeAdminCredentials', () => {
  it('returns the same credentials that were stashed', () => {
    const t = stashAdminCredentials({
      username: 'admin',
      password: 'supersecret',
      email: 'a@b.com',
    });
    expect(consumeAdminCredentials(t)).toEqual({
      username: 'admin',
      password: 'supersecret',
      email: 'a@b.com',
    });
  });

  it('is one-shot (second call returns null)', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(consumeAdminCredentials(t)).not.toBeNull();
    expect(consumeAdminCredentials(t)).toBeNull();
  });

  it('returns null for unknown token', () => {
    expect(consumeAdminCredentials('a'.repeat(32))).toBeNull();
  });

  // Bug guard (2026-10-24): in `next dev` the create-admin route is compiled
  // on demand and gets its own module registry, so a module-level Map was
  // instantiated separately from the one stash-admin wrote to — the token
  // was invisible and the wizard died with 401 token_expired. The store now
  // lives on globalThis, so it survives a module re-instantiation.
  it('survives a module re-instantiation (dev server recompile)', async () => {
    const token = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    vi.resetModules();
    const fresh = await import('@/lib/init-credentials');
    expect(fresh.consumeAdminCredentials(token)).toEqual({
      username: 'admin',
      password: 'supersecret',
    });
  });

  it('returns null after expiry (>10min)', () => {
    vi.useFakeTimers();
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    vi.advanceTimersByTime(601_000);
    expect(consumeAdminCredentials(t)).toBeNull();
    vi.useRealTimers();
  });
});

describe('gcExpired', () => {
  it('removes only expired entries', () => {
    vi.useFakeTimers();
    const t1 = stashAdminCredentials({ username: 'one', password: 'x' });
    vi.advanceTimersByTime(601_000); // t1 is now past the 10-minute TTL
    const t2 = stashAdminCredentials({ username: 'two', password: 'y' });
    vi.advanceTimersByTime(60_000); // t2 is 60s old — still alive
    gcExpired();
    expect(consumeAdminCredentials(t1)).toBeNull(); // already gone via gc
    expect(consumeAdminCredentials(t2)).not.toBeNull();
    vi.useRealTimers();
  });
});
