// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 后台的「语音评测」配置接口。
 *
 * 和 AI 配置接口同一套规矩，但有两条不同：
 *   1. **key 永不回显** —— 响应里只有一个布尔值表示「配过了」；
 *   2. **空值不清空** —— 保存表单时留空的字段不写入，否则管理员误点一次
 *      保存就把密钥擦掉了。
 */

const { requireAdminMock, getAllConfigMock, setConfigBatchMock, writeAuditMock } = vi.hoisted(
  () => ({
    requireAdminMock: vi.fn(),
    getAllConfigMock: vi.fn(),
    setConfigBatchMock: vi.fn(),
    writeAuditMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/config', () => ({
  getAllConfig: getAllConfigMock,
  setConfigBatch: setConfigBatchMock,
  getConfig: vi.fn(async () => null),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: writeAuditMock }));

import { GET, PUT } from '@/app/api/admin/speech/config/route';

beforeEach(() => {
  requireAdminMock.mockReset();
  getAllConfigMock.mockReset();
  setConfigBatchMock.mockReset();
  writeAuditMock.mockReset();
  requireAdminMock.mockResolvedValue({ ok: true, user: { id: 1, username: 'admin' } });
  getAllConfigMock.mockResolvedValue({
    'speech.region': 'eastasia',
    'speech.key': 'secret-key',
  });
  setConfigBatchMock.mockResolvedValue(undefined);
});

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/speech/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/speech/config', () => {
  it('requires admin', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns the region and a flag for the key', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.data.config['speech.region']).toBe('eastasia');
    // The key itself is never in the response.
    expect(body.data.config['speech.key']).toBeUndefined();
    expect(body.data.hasKey).toBe(true);
  });

  it('says no when there is no key', async () => {
    getAllConfigMock.mockResolvedValue({});
    const res = await GET();
    const body = await res.json();
    expect(body.data.hasKey).toBe(false);
  });

  it('reports the daily cap so the form can show it', async () => {
    getAllConfigMock.mockResolvedValue({ 'speech.daily_limit': '20' });
    const res = await GET();
    const body = await res.json();
    expect(body.data.config['speech.daily_limit']).toBe('20');
  });
});

describe('PUT /api/admin/speech/config', () => {
  it('writes the region', async () => {
    const res = await PUT(putReq({ 'speech.region': 'westus' }));
    expect(res.status).toBe(200);
    expect(setConfigBatchMock).toHaveBeenCalledWith({ 'speech.region': 'westus' }, 1);
  });

  it('writes a new key', async () => {
    const res = await PUT(putReq({ 'speech.key': 'new-key' }));
    expect(res.status).toBe(200);
    expect(setConfigBatchMock).toHaveBeenCalledWith({ 'speech.key': 'new-key' }, 1);
  });

  it('does NOT wipe a stored key when the field is left empty', async () => {
    // The form shows the key as blank; an empty value means "unchanged",
    // not "delete it". Otherwise one careless save locks the feature out.
    const res = await PUT(putReq({ 'speech.region': 'eastasia', 'speech.key': '' }));
    expect(res.status).toBe(200);
    expect(setConfigBatchMock).toHaveBeenCalledWith({ 'speech.region': 'eastasia' }, 1);
  });

  it('rejects a region that is not a plain identifier', async () => {
    // The region goes into a hostname (eastasia.stt.speech.microsoft.com);
    // anything with a slash or a dot would let a typo redirect the key.
    const res = await PUT(putReq({ 'speech.region': 'eastasia/../evil.com' }));
    expect(res.status).toBe(400);
    expect(setConfigBatchMock).not.toHaveBeenCalled();
  });

  it('rejects a body with nothing to write', async () => {
    const res = await PUT(putReq({}));
    expect(res.status).toBe(400);
  });

  it('refuses a daily cap that is not a small integer', async () => {
    // 0 means unlimited in `resolveDailyLimit`, so a non-number must never
    // reach the table: "abc" would parse to NaN and silently become 0.
    const res = await PUT(putReq({ 'speech.daily_limit': 'abc' }));
    expect(res.status).toBe(400);
    expect(setConfigBatchMock).not.toHaveBeenCalled();
  });

  it('saves a daily cap of 0, which means unlimited', async () => {
    const res = await PUT(putReq({ 'speech.daily_limit': '0' }));
    expect(res.status).toBe(200);
    expect(setConfigBatchMock).toHaveBeenCalledWith({ 'speech.daily_limit': '0' }, 1);
  });

  it('records the change as a speech audit, never the key', async () => {
    await PUT(putReq({ 'speech.region': 'eastasia', 'speech.key': 'secret-key' }));
    const entry = writeAuditMock.mock.calls[0][0] as {
      event: string;
      metadata: Record<string, unknown>;
    };
    expect(entry.event).toBe('speech_config_updated');
    expect(JSON.stringify(entry.metadata)).not.toContain('secret-key');
  });

  it('rejects a non-admin', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) });
    const res = await PUT(putReq({ 'speech.region': 'westus' }));
    expect(res.status).toBe(403);
    expect(setConfigBatchMock).not.toHaveBeenCalled();
  });
});
