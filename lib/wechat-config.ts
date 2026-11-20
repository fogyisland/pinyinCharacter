/**
 * The WeChat Official Account credentials.
 *
 * The app secret is stored in `app_config` in plain text, the same way
 * `smtp.pass` is, and the admin screen never sends it back — the UI only
 * learns WHETHER one is set. An empty secret means "keep the one that is
 * already there", which is what makes the password field work like a
 * password field.
 *
 * ⚠️ This module is the ONLY place that reads or writes these three
 * keys. The API routes, the sender, and the admin screen all go through
 * it, so the secret cannot leak out by accident.
 */
import { getConfig, setConfigBatch } from './config';
import { isValidWechatAppId, WECHAT_CONFIG_KEYS } from './wechat-types';
import { resetWechatTokenCache } from './wechat-api';

/** What the admin screen needs to know about the configuration. */
export interface WechatConfig {
  /** Whether the admin turned the feature on. */
  enabled: boolean;
  /** The WeChat app id. Not a secret. */
  appId: string;
  /** Whether an app secret is stored — the secret itself is never returned. */
  appSecretSet: boolean;
}

/** Reads the configuration, without the secret. */
export async function getWechatConfig(): Promise<WechatConfig> {
  const enabled = (await getConfig(WECHAT_CONFIG_KEYS.enabled)) === 'true';
  const appId = (await getConfig(WECHAT_CONFIG_KEYS.appId)) ?? '';
  const appSecret = (await getConfig(WECHAT_CONFIG_KEYS.appSecret)) ?? '';
  return { enabled, appId, appSecretSet: appSecret.length > 0 };
}

/** What the admin screen may change. */
export interface SaveWechatConfigInput {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
}

/**
 * Writes the configuration.
 *
 * An empty app secret keeps the stored one — the admin screen sends an
 * empty string when the field was left alone.
 *
 * ⚠️ The app id is different: an empty string CLEARS it, and only
 * `undefined` (the field was not sent at all) keeps the stored one.
 * Otherwise an admin who mistypes the AppID could never unset it — the
 * only way out would be to type a different wrong one.
 *
 * @throws Error when the app id does not look like one.
 */
export async function saveWechatConfig(
  input: SaveWechatConfigInput,
  byUserId: number,
): Promise<void> {
  const updates: Record<string, string> = {};
  if (input.enabled !== undefined) {
    updates[WECHAT_CONFIG_KEYS.enabled] = input.enabled ? 'true' : 'false';
  }
  if (input.appId !== undefined) {
    if (input.appId !== '' && !isValidWechatAppId(input.appId)) {
      throw new Error('the WeChat app id does not look like a WeChat app id');
    }
    updates[WECHAT_CONFIG_KEYS.appId] = input.appId;
  }
  if (input.appSecret !== undefined && input.appSecret !== '') {
    updates[WECHAT_CONFIG_KEYS.appSecret] = input.appSecret;
  }
  if (Object.keys(updates).length > 0) {
    await setConfigBatch(updates, byUserId);
  }
  // The credentials may have changed, and the cached token belongs to the
  // old ones. WeChat invalidates the previous token when a new one is
  // fetched, so a stale one must not survive.
  resetWechatTokenCache();
}

/**
 * Whether the feature can send anything.
 *
 * Both the credentials and the switch have to be on.
 */
export function isWechatConfigured(config: WechatConfig): boolean {
  return config.enabled && config.appId.length > 0 && config.appSecretSet;
}
