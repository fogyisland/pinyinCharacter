// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 后台「测试连接」—— 一键验证 region + key 是否真的能用。
 *
 * ## 为什么需要它
 *
 * 保存成功只说明两个字符串写进了 `app_config`；它不说明 Azure 认这两个值。
 * 密钥贴错一位、区域选成 `eastasia` 而资源其实建在 `southeastasia` ——
 * 两种都保存成功，然后每个学生点「精评」都拿到 401。一次点击就能把这两种
 * 情况分开，而不用等第一个学生报错。
 *
 * ## 用哪个端点验证
 *
 * 语音服务的令牌端点：`https://<region>.api.cognitive.microsoft.com/sts/v1.0/
 * issueToken`。它只验凭据，不收音频，因此**不产生任何计费**，也不会把
 * 任何人的声音送出去。200 = region 和 key 都对；401/403 = key 或 region 错。
 */

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('@/lib/config', () => ({ getConfig: getConfigMock }));

import {
  classifySpeechFailure,
  describeConfigState,
  speechTokenUrl,
  verifySpeechCredentials,
} from '@/lib/azure-speech';

beforeEach(() => {
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue(null);
  vi.unstubAllGlobals();
});

describe('speechTokenUrl', () => {
  it('builds the token endpoint from the region', () => {
    expect(speechTokenUrl('eastasia')).toBe(
      'https://eastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken',
    );
  });
});

describe('verifySpeechCredentials', () => {
  it('reports ok when the token endpoint accepts the key', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('tok', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'good' });
    expect(result).toEqual({ ok: true, reason: null, message: '' });
    const url = fetchMock.mock.calls[0]?.[0] ?? '';
    const init = fetchMock.mock.calls[0]?.[1] ?? {};
    expect(url).toContain('eastasia.api.cognitive.microsoft.com');
    // The key travels in a header, never in the URL.
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('good');
  });

  it('reports an auth failure when the key or the region is wrong', async () => {
    // Azure answers 401 for both mistakes, and that is exactly what an
    // operator needs to hear: "the pair is wrong", not "success".
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'typo' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('auth');
    expect(result.message).toContain('区域');
  });

  it('says nothing was configured when the key is missing', async () => {
    const result = await verifySpeechCredentials({ region: '', key: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unconfigured');
  });

  it('reports a network failure as upstream and not as a bad key', async () => {
    // A firewall or an offline machine must not send the operator hunting
    // for a new Azure key.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'good' });
    expect(result.reason).toBe('upstream');
  });

  it('classifies a 429 as a quota problem, which a key swap would not fix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'good' });
    expect(result.reason).toBe('rate-limit');
  });
});

describe('what an operator reads', () => {
  it('names the region in the auth message, because a wrong region looks like a wrong key', async () => {
    // The two values are pasted from the same portal page and both are easy
    // to mismatch. Naming both is what makes the message actionable.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'x' });
    expect(result.message).toContain('region');
  });

  it('keeps classifySpeechFailure as the single classifier', async () => {
    // The test path and the assessment path must agree: two tables of
    // status codes would drift apart, and 429 would mean two things.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const result = await verifySpeechCredentials({ region: 'eastasia', key: 'x' });
    expect(result.reason).toBe(classifySpeechFailure(503));
  });
});

describe('describeConfigState on the test path', () => {
  it('describes an empty pair', () => {
    expect(describeConfigState(null)).toContain('未配置');
  });
});
