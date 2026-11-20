import type { ErrorTranslation } from '@/lib/api-handler';
import {
  WechatApiError,
  WechatTokenError,
  WechatParamError,
  WechatRecipientError,
  WechatQuotaError,
} from '@/lib/wechat-types';

/**
 * The API's answer when a WeChat call fails.
 *
 * ## Why the caller needs a code and not just "server error"
 *
 * The generic 500 says "something went wrong" and stops there. The
 * administrator who sees it cannot tell a wrong password from a missing
 * migration, so the only sensible next step is to file a bug report. But
 * every one of these causes has a known fix, and three of them are fixed
 * on the WeChat side — in the公众号后台 — where the code cannot go.
 *
 * So these failures get their own code and a message that says what to
 * change and where. The status is 503: the server is fine, the WeChat
 * side is not ready for this feature yet, and a retry after the fix will
 * succeed.
 *
 * ⚠️ The WeChat error code is kept in every message. It is the thing an
 * administrator looks up in WeChat's own documentation, and a message
 * that drops it sends them hunting.
 */

/** The errcode -> what to tell the administrator. */
const REMEDIES: ReadonlyMap<number, { code: string; message: string }> = new Map([
  [
    40164,
    {
      code: 'wechat_ip_not_whitelisted',
      message:
        '微信错误 40164：服务器公网 IP 不在公众号后台的白名单里。请到「设置与开发 → 基本配置 → IP 白名单」加入服务器 IP 后重试。',
    },
  ],
  [
    40013,
    {
      code: 'wechat_bad_credentials',
      message:
        '微信错误 40013：AppID 无效。请检查后台填的 AppID 是否正确（它以 wx 开头，共 18 位）。',
    },
  ],
  [
    40001,
    {
      code: 'wechat_token_invalid',
      message:
        '微信错误 40001：access_token 失效。请检查 AppID 与 AppSecret 是否匹配，保存配置后会自动重新取 token。',
    },
  ],
  [
    48001,
    {
      code: 'wechat_no_permission',
      message:
        '微信错误 48001：接口未授权。公众号后台还没有开启模板消息权限 —— 需要认证服务号，并在「模板库」申请模板。',
    },
  ],
  [
    45009,
    {
      code: 'wechat_quota_exceeded',
      message:
        '微信错误 45009：今日接口调用额度已用完。请到公众号后台「接口权限」页查看剩余额度，明天再发。',
    },
  ],
  [
    47003,
    {
      code: 'wechat_template_mismatch',
      message:
        '微信错误 47003：模板不匹配。请确认模板 ID 正确，且数据字段名与公众号后台模板里的字段名完全一致。',
    },
  ],
  [
    43101,
    {
      code: 'wechat_recipient_unreachable',
      message:
        '微信错误 43101：该用户取关、关闭了消息或设了免打扰。这条会被跳过，不影响其他人。',
    },
  ],
]);

/**
 * Translates a WeChat error into an answer that says what to do.
 *
 * Every other error is left alone — it returns `null`, and the route's
 * generic 500 handles it. A translator that claimed errors it does not
 * understand would tell the administrator the wrong thing, which is worse
 * than telling them nothing.
 */
export function translateWechatApiError(error: unknown): ErrorTranslation | null {
  if (!(error instanceof WechatApiError)) return null;
  const remedy = REMEDIES.get(error.errcode);
  if (remedy) {
    return { code: remedy.code, message: remedy.message, status: 503 };
  }
  // An error we have no name for still deserves better than "server
  // error": the code and WeChat's own words are in it.
  return {
    code: 'wechat_error',
    message: `微信错误 ${error.errcode}：${error.message}`,
    status: 503,
  };
}
