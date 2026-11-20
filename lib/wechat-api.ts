/**
 * The one place that talks to WeChat.
 *
 * Every HTTP request to api.weixin.qq.com in this project goes through
 * this file. That is deliberate: when a WeChat call goes wrong there is
 * exactly one file to look at, and no other module can accidentally
 * bypass the token cache, the timeout, or the error classification.
 *
 * Three calls:
 *
 *   - GET  /cgi-bin/token                        — the access token
 *   - GET  /cgi-bin/user/get                     — the follower list
 *   - POST /cgi-bin/message/template/send        — one template message
 */
import { getConfig } from './config';
import {
  classifyWechatError,
  WechatApiError,
  WechatTokenError,
  type WechatTemplateData,
} from './wechat-types';

/** The official WeChat API host. */
export const WECHAT_API_BASE = 'https://api.weixin.qq.com';

/** A WeChat call that has not answered in this long is a failure. */
export const WECHAT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long a cached access token is trusted.
 *
 * WeChat's token lives for 7200 seconds. This is deliberately much
 * shorter: fetching a new token INVALIDATES the previous one, so a token
 * that is about to expire is a token we would rather replace early than
 * have two processes fight over.
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/** The cached token and the moment it stops being used. */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * The refresh that is already running, if any.
 *
 * ⚠️ WeChat invalidates the previous token when a new one is fetched. If
 * two requests refresh at the same moment, one of them gets a token that
 * is dead the instant it arrives. This promise makes them share a single
 * refresh instead.
 */
let pendingRefresh: Promise<string> | null = null;

/** Forgets the cached token — used after the admin changes the credentials. */
export function resetWechatTokenCache(): void {
  cachedToken = null;
  pendingRefresh = null;
}

/** The shape WeChat answers the token request with. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * The access token, fetched when there is no usable cached one.
 *
 * @param force fetch even when a token is cached.
 */
export async function getWechatAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const appId = await getConfig('wechat.app_id');
    const appSecret = await getConfig('wechat.app_secret');
    if (!appId || !appSecret) {
      throw new Error('the WeChat credentials are not configured');
    }
    const url =
      `${WECHAT_API_BASE}/cgi-bin/token` +
      `?grant_type=client_credential&appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}`;
    const payload = await wechatGet<TokenResponse>(url);
    if (payload.errcode !== undefined && payload.errcode !== 0) {
      throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
    }
    const token = payload.access_token;
    if (!token) {
      throw new Error('WeChat returned no access token');
    }
    cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return token;
  })();

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

/** The shape WeChat answers the follower list with. */
interface FollowerResponse {
  total?: number;
  count?: number;
  data?: { openid?: string[] };
  next_openid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * Every follower's openid.
 *
 * ⚠️ The list pages. `user/get` returns at most 10000 openids and a
 * `next_openid` cursor; the cursor has to be fed back in until it comes
 * back empty. Stopping at the first page would silently skip every
 * follower past the 10000th.
 */
export async function fetchFollowerOpenids(): Promise<string[]> {
  const openids: string[] = [];
  let nextOpenid = '';

  do {
    const token = await getWechatAccessToken();
    const url =
      `${WECHAT_API_BASE}/cgi-bin/user/get?access_token=${encodeURIComponent(token)}` +
      (nextOpenid ? `&next_openid=${encodeURIComponent(nextOpenid)}` : '');
    const payload = await wechatGet<FollowerResponse>(url);
    if (payload.errcode !== undefined && payload.errcode !== 0) {
      throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
    }
    const page = payload.data?.openid;
    if (Array.isArray(page)) openids.push(...page);
    nextOpenid = payload.next_openid ?? '';
  } while (nextOpenid.length > 0);

  return openids;
}

/**
 * Sends one template message to one recipient.
 *
 * @throws WechatApiError — a subclass that says what to do next.
 */
export async function sendTemplateMessage(
  openid: string,
  templateId: string,
  data: WechatTemplateData,
  url?: string | null,
): Promise<void> {
  const token = await getWechatAccessToken();
  const body: Record<string, unknown> = {
    touser: openid,
    template_id: templateId,
    data,
  };
  if (url) body.url = url;

  const endpoint =
    `${WECHAT_API_BASE}/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new WechatApiError(response.status, `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { errcode?: number; errmsg?: string };
  // ⚠️ A zero errcode means the platform accepted the message. It does
  // NOT mean the follower received it — WeChat gives no delivery receipt.
  if (payload.errcode !== undefined && payload.errcode !== 0) {
    throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
  }
}

/** Performs a GET and parses the JSON body, mapping a transport failure. */
async function wechatGet<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WechatApiError(0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    throw new WechatApiError(response.status, `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
