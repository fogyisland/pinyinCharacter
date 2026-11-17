import { describe, it, expect, beforeEach } from 'vitest';

import { checkAttemptLimit, resetAttemptLimit } from '@/lib/ratelimit';

/**
 * The attempt budget used by the auth and TTS endpoints.
 *
 * `checkRateLimit` (the older helper) expresses a MINIMUM INTERVAL: one
 * call per window. That cannot express a brute-force limit, which needs
 * "at most N tries per window" — so `checkAttemptLimit` was added for it.
 */
describe('checkAttemptLimit', () => {
  beforeEach(() => {
    // The counters are module-level, so each test uses its own key.
    // Nothing to reset globally; the keys below are unique per test.
  });

  it('allows an attempt and reports the remaining budget', () => {
    const first = checkAttemptLimit('test:a', 3, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = checkAttemptLimit('test:a', 3, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = checkAttemptLimit('test:a', 3, 60_000);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks once the budget is exhausted', () => {
    for (let i = 0; i < 3; i++) checkAttemptLimit('test:b', 3, 60_000);
    const fourth = checkAttemptLimit('test:b', 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('keeps blocking while the window is open', () => {
    for (let i = 0; i < 3; i++) checkAttemptLimit('test:c', 3, 60_000);
    expect(checkAttemptLimit('test:c', 3, 60_000).allowed).toBe(false);
    expect(checkAttemptLimit('test:c', 3, 60_000).allowed).toBe(false);
    expect(checkAttemptLimit('test:c', 3, 60_000).allowed).toBe(false);
  });

  it('never reports a negative remaining budget', () => {
    const limit = checkAttemptLimit('test:d', 1, 60_000);
    expect(limit.remaining).toBe(0);
    const over = checkAttemptLimit('test:d', 1, 60_000);
    expect(over.remaining).toBe(0);
    expect(over.allowed).toBe(false);
  });

  it('keeps separate budgets per key', () => {
    // One account exhausting its budget must not lock out another one.
    for (let i = 0; i < 2; i++) checkAttemptLimit('test:user1', 2, 60_000);
    expect(checkAttemptLimit('test:user1', 2, 60_000).allowed).toBe(false);
    expect(checkAttemptLimit('test:user2', 2, 60_000).allowed).toBe(true);
  });

  it('starts a fresh window once the old one has passed', () => {
    // A window of 0 ms has already expired by the time the second call
    // is made, so the counter restarts.
    const first = checkAttemptLimit('test:e', 2, 0);
    expect(first.allowed).toBe(true);
    const second = checkAttemptLimit('test:e', 2, 0);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });
});

describe('resetAttemptLimit', () => {
  it('clears the counter so a successful login restores the budget', () => {
    for (let i = 0; i < 3; i++) checkAttemptLimit('test:reset', 3, 60_000);
    expect(checkAttemptLimit('test:reset', 3, 60_000).allowed).toBe(false);

    resetAttemptLimit('test:reset');

    const after = checkAttemptLimit('test:reset', 3, 60_000);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(2);
  });

  it('is safe to call for a key that was never used', () => {
    expect(() => resetAttemptLimit('test:never-seen')).not.toThrow();
  });
});
