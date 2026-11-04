import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
  markInitWizardAdminDone: vi.fn(),
}));

import { POST } from '@/app/api/init/admin/route';
import { isSetupRouteEnabled, markInitWizardAdminDone } from '@/lib/setup';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedMarkAdminDone = vi.mocked(markInitWizardAdminDone);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
  mockedMarkAdminDone.mockResolvedValue(true);
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
    expect(mockedMarkAdminDone).toHaveBeenCalled();
  });

  it('does NOT write the flag when validation fails', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'short' }));
    expect(res.status).toBe(400);
    expect(mockedMarkAdminDone).not.toHaveBeenCalled();
  });

  it('returns setup_disabled when route locked (no DB write)', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(400);
    expect(mockedMarkAdminDone).not.toHaveBeenCalled();
  });

  it('sets Cache-Control: no-store on the happy-path response', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
