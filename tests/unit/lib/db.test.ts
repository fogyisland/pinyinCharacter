import { describe, it, expect, afterEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';

describe('db pool', () => {
  const original = process.env.DATABASE_URL;

  afterEach(async () => {
    if (original) process.env.DATABASE_URL = original;
    else delete process.env.DATABASE_URL;
    await closePool();
  });

  it('throws if DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });

  it('returns the same pool on repeat calls (singleton)', () => {
    process.env.DATABASE_URL = 'mysql://x:y@localhost:3306/z';
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
  });
});
