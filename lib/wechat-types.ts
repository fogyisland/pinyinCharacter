/**
 * The WeChat Official Account (微信公众号) vocabulary.
 *
 * Two things live here, and neither of them talks to WeChat:
 *
 *   - the TYPES the rest of the code passes around
 *   - the ERROR CLASSIFICATION, which decides what the sender does when
 *     WeChat says no
 *
 * The classification is a pure function on purpose. It is the part of
 * this feature that is easiest to get wrong, and a pure function is the
 * part that is easiest to be sure about.
 */

/** The lifecycle of one announcement. */
export type WechatBroadcastStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

/** One field of the WeChat template. */
export interface WechatTemplateValue {
  value: string;
}

/** The fields of one WeChat template, keyed by the template's own field names. */
export type WechatTemplateData = Record<string, WechatTemplateValue>;

/** One announcement, as the rest of the code sees it. */
export interface WechatBroadcast {
  id: number;
  title: string;
  templateId: string;
  url: string | null;
  data: WechatTemplateData;
  status: WechatBroadcastStatus;
  totalRecipients: number;
  acceptedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/**
 * A failure from the WeChat API.
 *
 * `errcode` is WeChat's own code. The HTTP status is always 200 — WeChat
 * reports failures in the body, so a 200 says nothing about the outcome.
 */
export class WechatApiError extends Error {
  readonly errcode: number;

  constructor(errcode: number, message: string) {
    super(`WeChat error ${errcode}: ${message}`);
    this.name = 'WechatApiError';
    this.errcode = errcode;
  }
}

/**
 * The access token is missing, expired or wrong.
 *
 * The sender refreshes the token and tries the message once more.
 */
export class WechatTokenError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatTokenError';
  }
}

/**
 * The message itself is wrong — a bad openid, a bad template id, a data
 * key that does not match the template, or a permission that was never
 * granted.
 *
 * ⚠️ RETRYING A PARAMETER ERROR IS ALWAYS WRONG. The same parameters
 * will fail the same way, and every attempt costs one of the daily API
 * calls. The sender stops the whole run.
 */
export class WechatParamError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatParamError';
  }
}

/**
 * This one recipient cannot be reached — they left the account, muted
 * the account, or turned the message off.
 *
 * The sender skips this recipient and keeps going. The other followers
 * still get their message.
 */
export class WechatRecipientError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatRecipientError';
  }
}

/**
 * The daily call quota is spent.
 *
 * The sender stops the whole run and waits for the next tick.
 */
export class WechatQuotaError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatQuotaError';
  }
}

/** The errcodes that mean "the request is wrong". */
const PARAM_ERRCODES: ReadonlySet<number> = new Set([40003, 40037, 47003, 48001]);

/**
 * Turns a WeChat error into the kind of error that says what to do.
 *
 * A zero errcode is success and is never an error — WeChat answers 200
 * with a JSON body, and the body is where the outcome lives.
 */
export function classifyWechatError(errcode: number, errmsg: string): WechatApiError {
  const message = errmsg && errmsg.length > 0 ? errmsg : 'no message';
  if (errcode === 40001) return new WechatTokenError(errcode, message);
  if (errcode === 43101) return new WechatRecipientError(errcode, message);
  if (errcode === 45009) return new WechatQuotaError(errcode, message);
  if (PARAM_ERRCODES.has(errcode)) return new WechatParamError(errcode, message);
  return new WechatApiError(errcode, message);
}

/** The keys a WeChat template field may have. */
const TEMPLATE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * Checks the admin-authored template data.
 *
 * The field names are whatever the admin chose in the WeChat template
 * library — `keyword1`, `thing2`, `first`, `remark` — so the code cannot
 * know them and must not guess. It only checks the shape.
 *
 * @throws Error when the data cannot be sent as it is.
 */
export function validateTemplateData(data: unknown): WechatTemplateData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('the template data must be an object');
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error('the template data is empty — a template with no fields sends nothing');
  }
  const result: WechatTemplateData = {};
  for (const [key, raw] of entries) {
    if (!TEMPLATE_KEY_PATTERN.test(key)) {
      throw new Error(`the template key "${key}" is not a valid field name`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`the template key "${key}" must be an object with a value`);
    }
    const value = (raw as { value?: unknown }).value;
    if (typeof value !== 'string') {
      throw new Error(`the template key "${key}" must have a string value`);
    }
    if (value.trim().length === 0) {
      throw new Error(`the template key "${key}" has an empty value`);
    }
    result[key] = { value };
  }
  return result;
}

/** The config keys this feature owns. */
export const WECHAT_CONFIG_KEYS = {
  enabled: 'wechat.enabled',
  appId: 'wechat.app_id',
  appSecret: 'wechat.app_secret',
} as const;

/**
 * Whether a string looks like a WeChat Official Account app id.
 *
 * An app id is `wx` followed by sixteen lowercase hex characters. The
 * check is a shape check, not a proof — it only stops a typo from
 * becoming a confusing API error.
 */
export function isValidWechatAppId(value: string): boolean {
  return /^wx[0-9a-f]{16}$/.test(value);
}
