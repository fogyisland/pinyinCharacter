/**
 * lib/wechat-config.ts
 *
 * The credentials, and the one place that decides whether the feature
 * can send anything.
 *
 * ⚠️ The app secret never leaves this module. The admin screen only
 * learns WHETHER one is set — an empty secret means "keep the one that
 * is already there", which is what makes the password field work like a
 * password field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getConfigMock = vi.fn();
const setConfigBatchMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
  setConfigBatch: (...args: unknown[]) => setConfigBatchMock(...args),
}));

const resetTokenMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  resetWechatTokenCache: () => resetTokenMock(),
}));

import { getWechatConfig, isWechatConfigured, saveWechatConfig } from '@/lib/wechat-config';

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockReset();
  setConfigBatchMock.mockReset();
  resetTokenMock.mockReset();
  getConfigMock.mockImplementation((key: string) => {
    if (key === 'wechat.enabled') return 'true';
    if (key === 'wechat.app_id') return 'wx1234567890abcdef';
    if (key === 'wechat.app_secret') return 'the-secret';
    return '';
  });
});

describe('reading the WeChat configuration', () => {
  it('reports whether the feature is on', async () => {
    const config = await getWechatConfig();

    expect(config.enabled).toBe(true);
  });

  it('reports the app id', async () => {
    const config = await getWechatConfig();

    expect(config.appId).toBe('wx1234567890abcdef');
  });

  it('never returns the app secret itself', async () => {
    const config = await getWechatConfig();

    expect(config.appSecretSet).toBe(true);
    expect(JSON.stringify(config)).not.toContain('the-secret');
  });

  it('treats an unset secret as not set', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_secret' ? '' : 'x'));

    const config = await getWechatConfig();

    expect(config.appSecretSet).toBe(false);
  });

  it('treats a missing key as not set', async () => {
    // getConfig returns null for a key that was never written.
    getConfigMock.mockImplementation((key: string) =>
      key === 'wechat.app_secret' ? null : 'x',
    );

    const config = await getWechatConfig();

    expect(config.appSecretSet).toBe(false);
  });
});

describe('saving the WeChat configuration', () => {
  it('writes the fields it was given', async () => {
    await saveWechatConfig({ enabled: false, appId: 'wxabcdefabcdef0123' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates['wechat.enabled']).toBe('false');
    expect(updates['wechat.app_id']).toBe('wxabcdefabcdef0123');
  });

  it('does not write the secret when it was left blank', async () => {
    await saveWechatConfig({ enabled: true, appId: 'wx1234567890abcdef', appSecret: '' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates).not.toHaveProperty('wechat.app_secret');
  });

  it('records who changed the credentials', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 42);

    const [, byUserId] = setConfigBatchMock.mock.calls[0];
    expect(byUserId).toBe(42);
  });

  it('writes the secret when it was given', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates['wechat.app_secret']).toBe('new-secret');
  });

  it('rejects an app id that is not shaped like one', async () => {
    await expect(saveWechatConfig({ appId: 'not-an-app-id' }, 7)).rejects.toThrow(/app id/i);
  });

  it('forgets the cached token — the old one belongs to the old credentials', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 7);

    expect(resetTokenMock).toHaveBeenCalled();
  });

  it('writes nothing when there was nothing to write', async () => {
    await saveWechatConfig({}, 7);

    expect(setConfigBatchMock).not.toHaveBeenCalled();
  });

  it('does not write the secret when the app id was rejected', async () => {
    await expect(saveWechatConfig({ appId: 'bad', appSecret: 'new-secret' }, 7)).rejects.toThrow();

    expect(setConfigBatchMock).not.toHaveBeenCalled();
  });

  it('clears the app id when it is set to empty on purpose', async () => {
    // ⚠️ The admin screen sends an empty string when the field was left
    // alone — the same value a deliberate clear sends. The two must be
    // told apart, or an admin who wants to turn the feature off can
    // never un-set a mistyped AppID.
    await saveWechatConfig({ appId: '' }, 7);

    expect(setConfigBatchMock).toHaveBeenCalledWith(
      { 'wechat.app_id': '' },
      7,
    );
  });

  it('keeps the stored app id when the field was not sent at all', async () => {
    // `undefined` means "the admin did not touch this field" — that is a
    // different thing from an empty string.
    await saveWechatConfig({ enabled: true }, 7);

    expect(setConfigBatchMock).toHaveBeenCalledWith(
      { 'wechat.enabled': 'true' },
      7,
    );
  });
});

describe('whether WeChat is configured', () => {
  it('is not configured without an app id', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_id' ? '' : 'x'));

    expect(isWechatConfigured(await getWechatConfig())).toBe(false);
  });

  it('is not configured without a secret', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_secret' ? '' : 'x'));

    expect(isWechatConfigured(await getWechatConfig())).toBe(false);
  });

  it('is not configured when the feature is off', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.enabled' ? 'false' : 'x'));

    expect(isWechatConfigured(await getWechatConfig())).toBe(false);
  });

  it('is configured with both', async () => {
    expect(isWechatConfigured(await getWechatConfig())).toBe(true);
  });
});
