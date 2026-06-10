import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/ratelimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('first call returns true', () => {
    expect(checkRateLimit('1.1.1.1', 60_000)).toBe(true);
  });

  it('second call within window returns false', () => {
    expect(checkRateLimit('2.2.2.2', 60_000)).toBe(true);
    expect(checkRateLimit('2.2.2.2', 60_000)).toBe(false);
  });

  it('different IPs are independent', () => {
    expect(checkRateLimit('3.3.3.3', 60_000)).toBe(true);
    expect(checkRateLimit('4.4.4.4', 60_000)).toBe(true);
  });

  it('after window expires, allows again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(checkRateLimit('5.5.5.5', 60_000)).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit('5.5.5.5', 60_000)).toBe(true);
  });
});
