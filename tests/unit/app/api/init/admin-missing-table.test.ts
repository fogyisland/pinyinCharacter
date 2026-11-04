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

describe('POST /api/init/admin — the table does not exist yet', () => {
  it('answers 200 instead of 500 when the marker cannot be written', async () => {
    // Step 2 runs before step 3 creates app_config, so this is the normal
    // state of a fresh install — not a fault.
    mockedMarkAdminDone.mockResolvedValue(false);

    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('reports to the client that the marker was not written', async () => {
    mockedMarkAdminDone.mockResolvedValue(false);

    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    const body = await res.json();

    expect(body.data.markerWritten).toBe(false);
  });

  it('reports markerWritten: true when the marker landed', async () => {
    mockedMarkAdminDone.mockResolvedValue(true);

    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    const body = await res.json();

    expect(body.data.markerWritten).toBe(true);
  });

  it('does not write the marker when validation fails', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'short' }));

    expect(res.status).toBe(400);
    expect(mockedMarkAdminDone).not.toHaveBeenCalled();
  });

  it('does not write the marker when the route is locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);

    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));

    expect(res.status).toBe(400);
    expect(mockedMarkAdminDone).not.toHaveBeenCalled();
  });

  it('keeps the response no-store', async () => {
    mockedMarkAdminDone.mockResolvedValue(false);

    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));

    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
