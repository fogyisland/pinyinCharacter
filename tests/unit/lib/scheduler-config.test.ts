import { describe, it, expect } from 'vitest';
import { newRunId } from '@/lib/scheduler-config';

describe('newRunId', () => {
  it('returns a string in YYYYMMDDHHMMSS-xxxxxx shape', () => {
    const id = newRunId();
    expect(id).toMatch(/^\d{14}-[a-z0-9]{6}$/);
  });

  it('returns different ids on consecutive calls (random suffix)', () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
  });

  it('starts with the current UTC timestamp (first 14 chars)', () => {
    const before = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const id = newRunId();
    const after = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const prefix = id.slice(0, 14);
    expect(prefix >= before).toBe(true);
    expect(prefix <= after).toBe(true);
  });
});