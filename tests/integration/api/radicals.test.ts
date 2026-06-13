import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/radicals/route';

describe('GET /api/radicals', () => {
  it('returns a JSON object with cache header', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400');
    const json = await res.json();
    expect(typeof json).toBe('object');
    expect(Object.keys(json).length).toBeGreaterThan(1000);
  });
});