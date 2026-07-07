import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { POST } from '@/app/api/init/admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/admin — wizard flag', () => {
  it('writes setup.wizard.admin_done after validation pass', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("'setup.wizard.admin_done'"),
    );
    expect(queryMock.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('does NOT write the flag when validation fails', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'short' }));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns setup_disabled when route locked (no DB write)', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('sets Cache-Control: no-store on the happy-path response', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});