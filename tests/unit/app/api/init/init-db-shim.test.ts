import { describe, it, expect } from 'vitest';
import { POST, GET } from '@/app/api/init/init-db/route';

describe('POST /api/init/init-db (410 shim)', () => {
  it('returns 410 with stale_build error code', async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('stale_build');
    expect(body.error.message).toMatch(/刷新浏览器/);
  });
});

describe('GET /api/init/init-db (410 shim)', () => {
  it('also returns 410', async () => {
    const res = await GET();
    expect(res.status).toBe(410);
  });
});
