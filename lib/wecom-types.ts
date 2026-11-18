/**
 * The WeCom (企业微信) notification forwarding vocabulary.
 *
 * The categories are the notification TYPES the site already sends by email —
 * the same keys `email_send_history.template` stores. Reusing that
 * vocabulary means "forward the notes notifications" needs no new concept:
 * the admin picks the types they already know.
 */

/** Every notification category that can be forwarded. */
export type WecomCategory =
  | 'welcome'
  | 'email_verification'
  | 'password_reset'
  | 'notes_notification'
  | 'campaign'
  | 'campaign_preview'
  | 'email_test'
  | 'admin_alert';

/** The catalogue, in the order the admin checkboxes appear. */
export const WECOM_CATEGORIES: readonly WecomCategory[] = [
  'welcome',
  'email_verification',
  'password_reset',
  'notes_notification',
  'campaign',
  'campaign_preview',
  'email_test',
  'admin_alert',
] as const;

/** The Chinese name of each category, for the admin UI. */
export const WECOM_CATEGORY_LABELS: Record<WecomCategory, string> = {
  welcome: '注册欢迎',
  email_verification: '邮箱验证',
  password_reset: '密码重置',
  notes_notification: '用户留言',
  campaign: '营销群发',
  campaign_preview: '营销预览',
  email_test: '邮件测试',
  admin_alert: '管理告警',
};

/**
 * The categories a NEW group starts with.
 *
 * ⚠️ `password_reset` is NOT here: forwarding it puts a password reset link
 * in front of every member of the group. It has to be a deliberate choice.
 * ⚠️ `campaign` is NOT here: a marketing broadcast is long, and it is not
 * something an operations group needs to see.
 */
export const WECOM_DEFAULT_CATEGORIES: readonly WecomCategory[] = [
  'welcome',
  'email_verification',
  'email_test',
] as const;

/** Whether a string is one of the catalogue. */
export function isWecomCategory(value: string): value is WecomCategory {
  return (WECOM_CATEGORIES as readonly string[]).includes(value);
}

/** The only host a group robot webhook may point at. */
const WECOM_HOST = 'qyapi.weixin.qq.com';
/** The only path a group robot webhook may use. */
const WECOM_PATH = '/cgi-bin/webhook/send';

/**
 * Whether a URL is a usable WeCom group robot webhook.
 *
 * The host and the path are pinned, not merely the scheme. An admin who
 * types an internal address would otherwise turn the server into a request
 * forwarder — the webhook URL is fetched with the server's own network
 * access, and the response body is written into the delivery history.
 */
export function isValidWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== WECOM_HOST) return false;
  if (!parsed.pathname.startsWith(WECOM_PATH)) return false;
  const key = parsed.searchParams.get('key');
  return typeof key === 'string' && key.length > 0;
}

/** One configured group robot. */
export interface WecomWebhook {
  id: number;
  name: string;
  webhookUrl: string;
  enabled: boolean;
  categories: WecomCategory[];
}

/** One queued (or delivered) notification. */
export interface WecomDelivery {
  id: number;
  webhookId: number;
  category: WecomCategory;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}
