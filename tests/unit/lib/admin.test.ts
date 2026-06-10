import { describe, it, expect } from 'vitest';
import { generateTempPassword } from '@/lib/admin';

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
