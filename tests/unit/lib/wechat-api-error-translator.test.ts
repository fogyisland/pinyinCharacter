import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateWechatApiError, REMEDIES } from '@/lib/wechat-api-error';
const ROOT = process.cwd();

import {
  WechatApiError,
  WechatTokenError,
  WechatParamError,
  WechatRecipientError,
  WechatQuotaError,
} from '@/lib/wechat-types';

describe('the WeChat API error translator', () => {
  it('leaves an unrelated error alone', () => {
    // A translator that claimed errors it does not understand would tell
    // the administrator the wrong thing, which is worse than nothing.
    expect(translateWechatApiError(new Error('a database is on fire'))).toBeNull();
    expect(translateWechatApiError('not even an error')).toBeNull();
    expect(translateWechatApiError(null)).toBeNull();
  });

  it('names the IP whitelist error and what to do about it', () => {
    const translated = translateWechatApiError(new WechatApiError(40164, 'invalid ip'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_ip_not_whitelisted');
    expect(translated!.message).toContain('40164');
    expect(translated!.message).toContain('白名单');
  });

  it('names a bad appid or secret', () => {
    const translated = translateWechatApiError(new WechatApiError(40013, 'invalid appid'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_bad_credentials');
    expect(translated!.message).toContain('40013');
    expect(translated!.message).toContain('AppID');
  });

  it('names a missing template-message permission', () => {
    const translated = translateWechatApiError(new WechatApiError(48001, 'api unauthorized'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_no_permission');
    expect(translated!.message).toContain('48001');
  });

  it('names a hit daily quota', () => {
    const translated = translateWechatApiError(new WechatQuotaError(45009, 'api freq out of limit'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_quota_exceeded');
    expect(translated!.message).toContain('45009');
  });

  it('names an expired access token', () => {
    const translated = translateWechatApiError(new WechatTokenError(40001, 'invalid credential'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_token_invalid');
    expect(translated!.message).toContain('40001');
  });

  it('names a wrong template id or a mismatched field name', () => {
    const translated = translateWechatApiError(new WechatParamError(47003, 'template param error'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_template_mismatch');
    expect(translated!.message).toContain('47003');
    expect(translated!.message).toContain('字段名');
  });

  it('names a recipient who cannot be reached', () => {
    const translated = translateWechatApiError(new WechatRecipientError(43101, 'user refuse'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_recipient_unreachable');
    expect(translated!.message).toContain('43101');
  });

  it('falls back to the raw WeChat error for a code it has no name for', () => {
    const translated = translateWechatApiError(new WechatApiError(99999, 'something odd'));
    expect(translated).not.toBeNull();
    expect(translated!.code).toBe('wechat_error');
    expect(translated!.message).toContain('99999');
    expect(translated!.message).toContain('something odd');
  });

  it('answers 503 — the server is fine, the WeChat side is not ready', () => {
    const translated = translateWechatApiError(new WechatApiError(40164, 'invalid ip'));
    expect(translated!.status).toBe(503);
  });

  it('keeps the error code in the message so the admin can search for it', () => {
    // The WeChat error code is the thing an admin looks up. A message
    // that drops it sends them hunting.
    const translated = translateWechatApiError(new WechatApiError(40164, 'invalid ip'));
    expect(translated!.message).toContain('40164');
  });
});

describe('the deployment notes and the translator agree', () => {
  it('lists every errcode the translator knows', () => {
    // The table in DEPLOY.md is what the admin reads when a broadcast
    // fails. If a code is missing or means something else there, the
    // admin is sent to fix the wrong thing.
    const deploy = readFileSync(join(ROOT, 'DEPLOY.md'), 'utf8');
    for (const errcode of REMEDIES.keys()) {
      expect(deploy).toContain(String(errcode));
    }
  });

  it('does not claim that 47003 is a permission problem', () => {
    // 47003 is the template/field-name mismatch — the commonest
    // mistake. 48001 is the permission problem.
    const deploy = readFileSync(join(ROOT, 'DEPLOY.md'), 'utf8');
    const row = deploy
      .split(String.fromCharCode(10))
      .find((line) => line.includes('`47003`'));
    expect(row).toBeDefined();
    expect(row).toContain('模板');
    expect(row).not.toContain('认证服务号');
  });
});
