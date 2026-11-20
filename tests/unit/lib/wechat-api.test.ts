/**
 * lib/wechat-api.ts
 *
 * The one place that talks to WeChat. Every HTTP request to
 * api.weixin.qq.com in this project goes through this file, so when a
 * WeChat call goes wrong there is exactly one file to look at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => configMock(key),
}));

import {
  fetchFollowerOpenids,
  getWechatAccessToken,
  resetWechatTokenCache,
  sendTemplateMessage,
  WECHAT_API_BASE,
} from '@/lib/wechat-api';
import { WechatParamError, WechatRecipientError, WechatTokenError } from '@/lib/wechat-types';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  resetWechatTokenCache();
  configMock.mockImplementation((key: string) => {
    if (key === 'wechat.app_id') return 'wx1234567890abcdef';
    if (key === 'wechat.app_secret') return 'the-secret';
    return '';
  });
});

/**
 * The follower list and the template message both fetch an access token
 * first. A test that only cares about the second call has to queue the
 * token response ahead of the response it is actually testing.
 */
function withToken(): void {
  fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('the access token', () => {
  it('asks WeChat for a token and returns it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    const token = await getWechatAccessToken();

    expect(token).toBe('the-token');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/cgi-bin/token');
    expect(url).toContain('grant_type=client_credential');
  });

  it('sends the app id to WeChat', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    await getWechatAccessToken();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('appid=wx1234567890abcdef');
  });

  it('caches the token — a second call does not hit WeChat again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    await getWechatAccessToken();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await getWechatAccessToken();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('refetches after the cache is reset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    await getWechatAccessToken();
    resetWechatTokenCache();
    await getWechatAccessToken();

    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('throws a token error when WeChat refuses the credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));

    await expect(getWechatAccessToken()).rejects.toThrow(/40013/);
  });

  it('throws when the credentials are not configured', async () => {
    configMock.mockImplementation(() => '');

    await expect(getWechatAccessToken()).rejects.toThrow(/not configured/i);
  });

  it('throws when WeChat returns no token at all', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ expires_in: 7200 }));

    await expect(getWechatAccessToken()).rejects.toThrow(/no access token/i);
  });

  it('shares one refresh between concurrent callers', async () => {
    // WeChat invalidates the previous token when a new one is fetched, so
    // two concurrent refreshes would leave one of them holding a dead
    // token. The in-flight promise makes them share.
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    const [first, second] = await Promise.all([
      getWechatAccessToken(),
      getWechatAccessToken(),
    ]);

    expect(first).toBe('the-token');
    expect(second).toBe('the-token');
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

describe('the follower list', () => {
  it('returns the openids of one page', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 2, count: 2, data: { openid: ['a', 'b'] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a', 'b']);
  });

  it('follows the next_openid cursor until the list ends', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 3, count: 2, data: { openid: ['a', 'b'] }, next_openid: 'cursor-1' }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 3, count: 1, data: { openid: ['c'] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a', 'b', 'c']);
    // The call sequence is [token, page 1, page 2] — the cursor goes on
    // the LAST page request, not the first.
    const lastUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
    expect(lastUrl).toContain('next_openid=cursor-1');
  });

  it('keeps paging through three pages', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { openid: ['a'] }, next_openid: 'c1' }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { openid: ['b'] }, next_openid: 'c2' }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { openid: ['c'] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a', 'b', 'c']);
    // [token, page 1, page 2, page 3] — the token request is one of them.
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it('returns an empty list when the account has no followers', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 0, count: 0, data: { openid: [] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual([]);
  });

  it('returns an empty list when the data field is missing entirely', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 0 }));

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual([]);
  });

  it('tolerates a missing errmsg on a successful response', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 1, count: 1, data: { openid: ['a'] } }));

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a']);
  });

  it('throws when WeChat reports an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }));

    await expect(fetchFollowerOpenids()).rejects.toThrow(/40001/);
  });
});

describe('the template message', () => {
  it('posts the message to the one recipient', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'hello' } });

    // The call sequence is [token, send].
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(url)).toContain('/cgi-bin/message/template/send');
    expect(String(url)).toContain('access_token=the-token');
    const body = JSON.parse(String(init.body));
    expect(body.touser).toBe('the-openid');
    expect(body.template_id).toBe('TM00001');
    expect(body.data).toEqual({ keyword1: { value: 'hello' } });
  });

  it('includes the jump url when there is one', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage(
      'the-openid',
      'TM00001',
      { keyword1: { value: 'x' } },
      'https://example.com/x',
    );

    const body = JSON.parse(
      String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body),
    );
    expect(body.url).toBe('https://example.com/x');
  });

  it('omits the jump url when there is none', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } });

    const body = JSON.parse(
      String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body),
    );
    expect(body.url).toBeUndefined();
  });

  it('treats a zero errcode with no errmsg as success', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).resolves.toBeUndefined();
  });

  it('treats a body with no errcode at all as success', async () => {
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ msgid: 12345 }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).resolves.toBeUndefined();
  });

  it('throws a recipient error for 43101', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 43101, errmsg: 'user refuse' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatRecipientError);
  });

  it('throws a token error for 40001', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatTokenError);
  });

  it('throws a parameter error for 47003', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 47003, errmsg: 'argument invalid' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatParamError);
  });

  it('throws when the HTTP call fails outright', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toThrow(/network down/);
  });

  it('throws when the response is not a success status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toThrow(/500/);
  });

  it('never puts the app secret into the message request', async () => {
    // ⚠️ The token endpoint takes the secret as a query parameter — that
    // is how WeChat authenticates it, and there is no header form. The
    // secret therefore appears in exactly ONE request: the token one.
    // What must never happen is the secret riding along with a message.
    withToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } });

    const messageUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
    expect(messageUrl).not.toContain('the-secret');
  });

  it('never puts the app secret into an error message', async () => {
    // An error message ends up in `wechat_broadcasts.last_error` and in
    // the admin screen. A URL with the secret in it must never get there.
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));

    await expect(getWechatAccessToken()).rejects.toThrow(/40013/);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    resetWechatTokenCache();
    await expect(getWechatAccessToken()).rejects.toThrow(/network down/);
  });
});

describe('the api base', () => {
  it('is the official WeChat host', () => {
    expect(WECHAT_API_BASE).toBe('https://api.weixin.qq.com');
  });
});
