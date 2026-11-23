// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/admin/speech/verify —— 「测试连接」。
 *
 * 只测**已经保存**的那组值。这看起来像一个限制，其实是唯一正确的做法：
 * 表单里密钥框永远是空的（读不到已存的值），所以「测一下我刚打的」这段
 * 逻辑无法知道「刚才打的是什么」还是「留空不改」。测已存的值，语义清楚，
 * 也不需要把密钥在浏览器里多传一次。
 */

const {
  requireAdminMock,
  resolveSpeechConfigMock,
  verifySpeechCredentialsMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  resolveSpeechConfigMock: vi.fn(),
  verifySpeechCredentialsMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/azure-speech', async () => {
  const actual = await vi.importActual<typeof import('@/lib/azure-speech')>('@/lib/azure-speech');
  return {
    ...actual,
    resolveSpeechConfig: resolveSpeechConfigMock,
    verifySpeechCredentials: verifySpeechCredentialsMock,
  };
});

import { POST } from '@/app/api/admin/speech/verify/route';

beforeEach(() => {
  requireAdminMock.mockReset();
  resolveSpeechConfigMock.mockReset();
  verifySpeechCredentialsMock.mockReset();
  requireAdminMock.mockResolvedValue({ ok: true, user: { id: 1, username: 'admin' } });
  resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'stored' });
  verifySpeechCredentialsMock.mockResolvedValue({ ok: true, reason: null, message: '' });
});

describe('POST /api/admin/speech/verify', () => {
  it('requires admin', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(verifySpeechCredentialsMock).not.toHaveBeenCalled();
  });

  it('answers 400 when nothing is saved yet', async () => {
    resolveSpeechConfigMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
    const body = await res.json();
    // 「先保存再测试」 is the sentence that unblocks the operator, and it
    // must not be reported as an Azure problem.
    expect(body.error.message).toContain('保存');
    expect(verifySpeechCredentialsMock).not.toHaveBeenCalled();
  });

  it('returns ok when Azure accepts the stored pair', async () => {
    const res = await POST();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);
  });

  it('passes the failure class and message back so the form can show it', async () => {
    verifySpeechCredentialsMock.mockResolvedValue({
      ok: false,
      reason: 'auth',
      message: 'Azure 拒绝了这组凭据',
    });
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // The test itself succeeded: it DID reach Azure and Azure said no. A
    // non-200 here would be read by the form as "the request broke".
    expect(body.data.ok).toBe(false);
    expect(body.data.reason).toBe('auth');
    expect(body.data.message).toContain('拒绝');
  });

  it('tests the stored pair, not values from the request body', async () => {
    await POST();
    expect(verifySpeechCredentialsMock).toHaveBeenCalledWith({ region: 'eastasia', key: 'stored' });
  });
});
