/**
 * The WeChat admin API routes.
 *
 * Seven routes, one guard, and five audit events. The guard is the same
 * everywhere: `requireAdmin()` decides, and a request that is not an
 * admin never reaches the store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const adminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => adminMock(),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

const configMock = vi.fn();
const saveConfigMock = vi.fn();
vi.mock('@/lib/wechat-config', () => ({
  getWechatConfig: () => configMock(),
  saveWechatConfig: (...args: unknown[]) => saveConfigMock(...args),
  isWechatConfigured: (config: { enabled: boolean; appId: string; appSecretSet: boolean }) =>
    config.enabled && config.appId.length > 0 && config.appSecretSet,
}));

const followerMock = vi.fn();
const sendTemplateMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  fetchFollowerOpenids: () => followerMock(),
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMock(...args),
}));

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const queueMock = vi.fn();
const cancelMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  listBroadcasts: (...args: unknown[]) => listMock(...args),
  getBroadcast: (...args: unknown[]) => getMock(...args),
  createBroadcast: (...args: unknown[]) => createMock(...args),
  queueBroadcast: (...args: unknown[]) => queueMock(...args),
  cancelBroadcast: (...args: unknown[]) => cancelMock(...args),
}));

const sendMock = vi.fn();
vi.mock('@/lib/wechat-sender', () => ({
  sendBroadcast: (...args: unknown[]) => sendMock(...args),
}));

import { GET as getConfigRoute, PUT as putConfigRoute } from '@/app/api/admin/wechat/config/route';
import { GET as getFollowersRoute } from '@/app/api/admin/wechat/followers/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/wechat/broadcasts/route';
import { GET as getOneRoute } from '@/app/api/admin/wechat/broadcasts/[id]/route';
import { POST as sendRoute } from '@/app/api/admin/wechat/broadcasts/[id]/send/route';
import { POST as cancelRoute } from '@/app/api/admin/wechat/broadcasts/[id]/cancel/route';
import { POST as testRoute } from '@/app/api/admin/wechat/test/route';

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
    url: 'http://localhost:4444/api/admin/wechat/broadcasts',
  } as unknown as NextRequest;
}

/** The `[id]` routes take the id from the path, not the body. */
function idContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const BROADCAST = {
  id: 5,
  title: 'v1.2',
  templateId: 'TM00001',
  url: null,
  data: { keyword1: { value: 'x' } },
  status: 'queued' as const,
  totalRecipients: 0,
  acceptedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  lastError: null,
  createdBy: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  finishedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockReset();
  auditMock.mockReset();
  configMock.mockReset();
  saveConfigMock.mockReset();
  followerMock.mockReset();
  sendTemplateMock.mockReset();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  queueMock.mockReset();
  cancelMock.mockReset();
  sendMock.mockReset();
  adminMock.mockResolvedValue({ ok: true, user: { id: 1 } });
  configMock.mockResolvedValue({ enabled: true, appId: 'wx1234567890abcdef', appSecretSet: true });
  getMock.mockResolvedValue(BROADCAST);
});

describe('the admin guard', () => {
  it('refuses a request that is not an admin', async () => {
    adminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 401 }) });

    const response = await listRoute();

    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('refuses a request that is not an admin on every route', async () => {
    adminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) });

    const calls = [
      getConfigRoute(),
      getFollowersRoute(),
      listRoute(),
      getOneRoute(request({}), idContext('5')),
      sendRoute(request({}), idContext('5')),
      cancelRoute(request({}), idContext('5')),
      testRoute(request({})),
    ];

    for (const call of calls) {
      const response = await call;
      expect(response.status).toBe(403);
    }
    expect(listMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});

describe('the configuration route', () => {
  it('returns the configuration without the secret', async () => {
    const response = await getConfigRoute();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.config.appSecretSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain('the-secret');
  });

  it('saves the configuration and writes an audit event', async () => {
    await putConfigRoute(request({ enabled: false, appId: 'wx1234567890abcdef' }));

    expect(saveConfigMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_config_updated' }),
    );
  });

  it('records who changed the configuration', async () => {
    await putConfigRoute(request({ enabled: false }));

    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      1,
    );
  });

  it('refuses a bad app id', async () => {
    saveConfigMock.mockRejectedValue(
      new Error('the WeChat app id does not look like a WeChat app id'),
    );

    const response = await putConfigRoute(request({ appId: 'nope' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain('app id');
  });

  it('does not write an audit event when the save failed', async () => {
    saveConfigMock.mockRejectedValue(new Error('nope'));

    await putConfigRoute(request({ appId: 'nope' }));

    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('the follower route', () => {
  it('returns the follower count', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);

    const response = await getFollowersRoute();

    const body = await response.json();
    expect(body.data.count).toBe(3);
  });

  it('returns zero when there are no followers', async () => {
    followerMock.mockResolvedValue([]);

    const response = await getFollowersRoute();

    const body = await response.json();
    expect(body.data.count).toBe(0);
  });

  it('never returns the openids themselves', async () => {
    followerMock.mockResolvedValue(['openid-1', 'openid-2']);

    const response = await getFollowersRoute();

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('openid-1');
  });
});

describe('the announcement routes', () => {
  it('lists the announcements', async () => {
    listMock.mockResolvedValue([]);

    const response = await listRoute();

    expect(response.status).toBe(200);
  });

  it('creates an announcement and queues it', async () => {
    createMock.mockResolvedValue(11);

    const response = await createRoute(
      request({ title: 'v1.2', templateId: 'TM00001', url: '', data: { keyword1: { value: 'x' } } }),
    );

    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalled();
    expect(queueMock).toHaveBeenCalledWith(11);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_created' }),
    );
  });

  it('writes the announcement title into the audit event', async () => {
    createMock.mockResolvedValue(11);

    await createRoute(
      request({ title: 'v1.2 已上线', templateId: 'TM00001', data: { keyword1: { value: 'x' } } }),
    );

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'wechat_broadcast_created',
        metadata: expect.objectContaining({ title: 'v1.2 已上线' }),
      }),
    );
  });

  it('refuses an announcement with no title', async () => {
    const response = await createRoute(request({ templateId: 'TM00001', data: {} }));

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses an announcement with no template id', async () => {
    const response = await createRoute(request({ title: 'v1.2', data: { keyword1: { value: 'x' } } }));

    expect(response.status).toBe(400);
  });

  it('refuses an announcement with no template data', async () => {
    const response = await createRoute(request({ title: 'v1.2', templateId: 'TM00001', data: {} }));

    expect(response.status).toBe(400);
  });

  it('refuses an announcement whose template data is not usable', async () => {
    const response = await createRoute(
      request({ title: 'v1.2', templateId: 'TM00001', data: { 'bad key': { value: 'x' } } }),
    );

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('does not write an audit event when the creation failed', async () => {
    const response = await createRoute(request({ templateId: 'TM00001', data: {} }));

    expect(response.status).toBe(400);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('returns one announcement', async () => {
    const response = await getOneRoute(request({}), idContext('5'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.broadcast.id).toBe(5);
  });

  it('refuses an id that is not a number', async () => {
    const response = await getOneRoute(request({}), idContext('abc'));

    expect(response.status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('refuses an id that is not positive', async () => {
    const response = await getOneRoute(request({}), idContext('0'));

    expect(response.status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('refuses an announcement that does not exist', async () => {
    getMock.mockResolvedValue(null);

    const response = await getOneRoute(request({}), idContext('5'));

    expect(response.status).toBe(400);
  });

  it('sends an announcement on demand', async () => {
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 2,
      accepted: 2,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const response = await sendRoute(request({}), idContext('5'));

    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith(5);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_sent' }),
    );
  });

  it('writes the announcement title into the send event', async () => {
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 2,
      accepted: 2,
      skipped: 0,
      failed: 0,
      error: null,
    });

    await sendRoute(request({}), idContext('5'));

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'wechat_broadcast_sent',
        metadata: expect.objectContaining({ title: 'v1.2' }),
      }),
    );
  });

  it('refuses a bad id on the send route', async () => {
    const response = await sendRoute(request({}), idContext('abc'));

    expect(response.status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a bad id on the cancel route', async () => {
    const response = await cancelRoute(request({}), idContext('abc'));

    expect(response.status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('refuses a zero id on the send route', async () => {
    const response = await sendRoute(request({}), idContext('0'));

    expect(response.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a negative id on the cancel route', async () => {
    const response = await cancelRoute(request({}), idContext('-1'));

    expect(response.status).toBe(400);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('does not send an announcement that does not exist', async () => {
    getMock.mockResolvedValue(null);

    const response = await sendRoute(request({}), idContext('5'));

    expect(response.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('cancels an announcement', async () => {
    cancelMock.mockResolvedValue(true);

    const response = await cancelRoute(request({}), idContext('5'));

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(5);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_cancelled' }),
    );
  });

  it('refuses to cancel an announcement that already went out', async () => {
    cancelMock.mockResolvedValue(false);

    const response = await cancelRoute(request({}), idContext('5'));

    expect(response.status).toBe(400);
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('the test-message route', () => {
  it('sends a test message', async () => {
    sendTemplateMock.mockResolvedValue(undefined);

    const response = await testRoute(
      request({ openid: 'o-1', templateId: 'TM00001', data: { keyword1: { value: 'x' } } }),
    );

    expect(response.status).toBe(200);
    expect(sendTemplateMock).toHaveBeenCalledWith('o-1', 'TM00001', { keyword1: { value: 'x' } }, null);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_test_sent' }),
    );
  });

  it('refuses to send when the account is not configured', async () => {
    configMock.mockResolvedValue({ enabled: false, appId: '', appSecretSet: false });

    const response = await testRoute(
      request({ openid: 'o-1', templateId: 'TM00001', data: { keyword1: { value: 'x' } } }),
    );

    expect(response.status).toBe(400);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it('reports a send failure', async () => {
    sendTemplateMock.mockRejectedValue(new Error('WeChat error 40037: invalid template_id'));

    const response = await testRoute(
      request({ openid: 'o-1', templateId: 'TM00001', data: { keyword1: { value: 'x' } } }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toContain('40037');
    expect(auditMock).not.toHaveBeenCalled();
  });
});
