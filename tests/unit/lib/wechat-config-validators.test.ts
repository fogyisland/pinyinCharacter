/**
 * lib/config.ts — the `wechat.*` validators.
 *
 * ⚠️ `lib/wechat-config.ts` checks the app id shape too, but that module
 * only sees what the admin screen sends. These validators are the LAST
 * line: `setConfig` is the only way to write `app_config`, so a key
 * without a validator accepts anything at all.
 *
 * Without the `wechat.app_id` validator, a direct
 * `setConfig('wechat.app_id', 'garbage')` would store a broken id, and
 * the failure would surface as a confusing WeChat API error instead of
 * a message at the point of the mistake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { setConfig, clearConfigCache } from '@/lib/config';

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
  clearConfigCache();
});

/** Whether `setConfig` accepts the value. */
async function accepts(key: string, value: string): Promise<boolean> {
  try {
    await setConfig(key, value, null);
    return true;
  } catch {
    return false;
  }
}

describe('the wechat.enabled validator', () => {
  it('accepts true', async () => {
    expect(await accepts('wechat.enabled', 'true')).toBe(true);
  });

  it('accepts false', async () => {
    expect(await accepts('wechat.enabled', 'false')).toBe(true);
  });

  it('rejects anything else', async () => {
    expect(await accepts('wechat.enabled', '1')).toBe(false);
    expect(await accepts('wechat.enabled', 'yes')).toBe(false);
    expect(await accepts('wechat.enabled', '')).toBe(false);
  });
});

describe('the wechat.app_id validator', () => {
  it('accepts a well-formed app id', async () => {
    expect(await accepts('wechat.app_id', 'wx1234567890abcdef')).toBe(true);
  });

  it('rejects an app id with the wrong shape', async () => {
    expect(await accepts('wechat.app_id', 'not-an-app-id')).toBe(false);
    expect(await accepts('wechat.app_id', 'wx123')).toBe(false);
    expect(await accepts('wechat.app_id', 'WX1234567890ABCDEF')).toBe(false);
    expect(await accepts('wechat.app_id', '')).toBe(false);
  });
});

describe('the wechat.app_secret validator', () => {
  it('accepts a secret', async () => {
    expect(await accepts('wechat.app_secret', 'the-secret')).toBe(true);
  });

  it('rejects an empty secret', async () => {
    // An empty secret would look like "no secret configured" and quietly
    // turn the feature off.
    expect(await accepts('wechat.app_secret', '')).toBe(false);
  });

  it('rejects a secret that is too long to be one', async () => {
    expect(await accepts('wechat.app_secret', 'x'.repeat(257))).toBe(false);
  });
});
