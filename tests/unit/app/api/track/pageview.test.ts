import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@/lib/page-views', () => ({
  recordPageView: vi.fn(async () => undefined),
}));

import { POST } from '@/app/api/track/pageview/route';
import { recordPageView } from '@/lib/page-views';

const mockedRecord = vi.mocked(recordPageView);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRecord.mockResolvedValue(undefined);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/track/pageview', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * POST /api/track/pageview
 *
 * A page view is an analytics side-effect. If the database is down (or not
 * yet initialized) the route must NOT answer 500: that turns every single
 * navigation into a red console line that reads as "the site is broken"
 * and buries the real problem. The write failure is logged server-side
 * and reported as `tracked: false`.
 */
describe('POST /api/track/pageview', () => {
  it('records the view and answers 200', async () => {
    const res = await POST(postReq({ path: '/poems' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, tracked: true });
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/poems' }),
    );
  });

  it('answers 200 with tracked:false when the write fails (no 500 in the visitor console)', async () => {
    mockedRecord.mockRejectedValueOnce(new Error('DATABASE_URL is not set'));
    const res = await POST(postReq({ path: '/poems' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, tracked: false });
  });

  it('still rejects a malformed path with 400', async () => {
    const res = await POST(postReq({ path: 'not-a-path' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_path' },
    });
    expect(mockedRecord).not.toHaveBeenCalled();
  });
});
