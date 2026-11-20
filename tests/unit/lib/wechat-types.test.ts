/**
 * lib/wechat-types.ts
 *
 * The error classification is a pure function on purpose: it is the part of
 * the WeChat feature that is easiest to get wrong, and a pure function is
 * the part that is easiest to be sure about. Every code that decides what
 * to do after WeChat says no goes through `classifyWechatError`.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyWechatError,
  isValidWechatAppId,
  validateTemplateData,
  WechatApiError,
  WechatParamError,
  WechatQuotaError,
  WechatRecipientError,
  WechatTokenError,
  WECHAT_CONFIG_KEYS,
  getTemplateValueLimit,
} from '@/lib/wechat-types';

describe('the WeChat error classification', () => {
  it('never throws for a zero errcode — that is success', () => {
    expect(() => classifyWechatError(0, 'ok')).not.toThrow();
  });

  it('classifies 40001 as a token error, so the caller refreshes and retries', () => {
    expect(classifyWechatError(40001, 'invalid credential')).toBeInstanceOf(WechatTokenError);
  });

  it('classifies 43101 as a recipient error, so the caller skips that follower', () => {
    expect(classifyWechatError(43101, 'user refuse to accept the msg')).toBeInstanceOf(
      WechatRecipientError,
    );
  });

  it('classifies 45009 as a quota error, so the caller stops', () => {
    expect(classifyWechatError(45009, 'api freq out of limit')).toBeInstanceOf(WechatQuotaError);
  });

  it('classifies every parameter error as a parameter error', () => {
    // 40003 invalid openid, 40037 invalid template_id,
    // 47003 argument invalid, 48001 api unauthorized
    for (const code of [40003, 40037, 47003, 48001]) {
      expect(classifyWechatError(code, 'x')).toBeInstanceOf(WechatParamError);
    }
  });

  it('keeps the errcode and the message on the error', () => {
    const error = classifyWechatError(40037, 'invalid template_id');
    expect(error.errcode).toBe(40037);
    expect(error.message).toContain('40037');
    expect(error.message).toContain('invalid template_id');
  });

  it('falls back to a generic error for an unknown errcode', () => {
    const error = classifyWechatError(60011, 'no permission');
    expect(error.errcode).toBe(60011);
    expect(error).not.toBeInstanceOf(WechatParamError);
    expect(error).not.toBeInstanceOf(WechatQuotaError);
    expect(error).not.toBeInstanceOf(WechatRecipientError);
    expect(error).not.toBeInstanceOf(WechatTokenError);
    expect(error).toBeInstanceOf(WechatApiError);
  });

  it('names the error so the log says what kind of failure it was', () => {
    expect(classifyWechatError(40001, 'x').name).toBe('WechatTokenError');
    expect(classifyWechatError(43101, 'x').name).toBe('WechatRecipientError');
    expect(classifyWechatError(45009, 'x').name).toBe('WechatQuotaError');
    expect(classifyWechatError(47003, 'x').name).toBe('WechatParamError');
  });

  it('copes with a missing errmsg — WeChat sometimes sends only the code', () => {
    const error = classifyWechatError(40001, '');
    expect(error.errcode).toBe(40001);
    expect(error.message).toContain('40001');
  });
});

describe('the template data validation', () => {
  it('accepts a well-formed data object', () => {
    const data = validateTemplateData({
      first: { value: '字·韵公告' },
      keyword1: { value: 'v1.2 已上线' },
    });
    expect(data.first.value).toBe('字·韵公告');
    expect(data.keyword1.value).toBe('v1.2 已上线');
  });

  it('rejects a value that is not an object', () => {
    expect(() => validateTemplateData('nope')).toThrow(/object/i);
  });

  it('rejects a value that is an array', () => {
    expect(() => validateTemplateData([])).toThrow(/object/i);
  });

  it('rejects null', () => {
    expect(() => validateTemplateData(null)).toThrow(/object/i);
  });

  it('rejects a key whose value is missing', () => {
    expect(() => validateTemplateData({ keyword1: {} })).toThrow(/value/i);
  });

  it('rejects an empty value — WeChat rejects an empty thing field with 47003', () => {
    expect(() => validateTemplateData({ keyword1: { value: '' } })).toThrow(/empty/i);
  });

  it('rejects a value that is only whitespace', () => {
    expect(() => validateTemplateData({ keyword1: { value: '   ' } })).toThrow(/empty/i);
  });

  it('rejects a value that is not a string', () => {
    expect(() => validateTemplateData({ keyword1: { value: 42 } })).toThrow(/string/i);
  });

  it('rejects a key that is not a plain identifier', () => {
    expect(() => validateTemplateData({ 'keyword 1': { value: 'x' } })).toThrow(/key/i);
  });

  it('rejects an empty data object — a template with no fields sends nothing', () => {
    expect(() => validateTemplateData({})).toThrow(/empty/i);
  });
});

describe('the app id validation', () => {
  it('accepts a real-looking app id', () => {
    expect(isValidWechatAppId('wx1234567890abcdef')).toBe(true);
  });

  it('rejects an app id that does not start with wx', () => {
    expect(isValidWechatAppId('1234567890abcdef')).toBe(false);
  });

  it('rejects an app id of the wrong length', () => {
    expect(isValidWechatAppId('wx123')).toBe(false);
  });

  it('rejects an app id with uppercase hex', () => {
    expect(isValidWechatAppId('wx1234567890ABCDEF')).toBe(false);
  });
});

describe('the config keys', () => {
  it('names the three keys this feature owns', () => {
    expect(WECHAT_CONFIG_KEYS.enabled).toBe('wechat.enabled');
    expect(WECHAT_CONFIG_KEYS.appId).toBe('wechat.app_id');
    expect(WECHAT_CONFIG_KEYS.appSecret).toBe('wechat.app_secret');
  });
});

describe('the length limits WeChat enforces on a template field', () => {
  it('accepts a thing field of exactly twenty characters', () => {
    expect(() =>
      validateTemplateData({ thing1: { value: 'x'.repeat(20) } }),
    ).not.toThrow();
  });

  it('refuses a thing field of twenty-one characters', () => {
    // WeChat caps `thing` at 20 characters. A longer value passes the
    // shape check and is then rejected by WeChat with a PARAMETER
    // error — which stops the whole broadcast, so every follower is
    // denied the announcement because of one field.
    expect(() =>
      validateTemplateData({ thing1: { value: 'x'.repeat(21) } }),
    ).toThrow(/20/);
  });

  it('refuses a first field longer than ten characters', () => {
    expect(() =>
      validateTemplateData({ first: { value: 'x'.repeat(11) } }),
    ).toThrow(/10/);
  });

  it('refuses a remark field longer than twenty characters', () => {
    expect(() =>
      validateTemplateData({ remark: { value: 'x'.repeat(21) } }),
    ).toThrow(/20/);
  });

  it('refuses a phrase field longer than five characters', () => {
    expect(() =>
      validateTemplateData({ phrase1: { value: 'x'.repeat(6) } }),
    ).toThrow(/5/);
  });

  it('accepts a plain keyword field of thirty-two characters', () => {
    // `keyword1` carries no type of its own — the template library says
    // what it is — so the generic limit applies.
    expect(() =>
      validateTemplateData({ keyword1: { value: 'x'.repeat(32) } }),
    ).not.toThrow();
  });

  it('refuses a plain keyword field longer than thirty-two characters', () => {
    expect(() =>
      validateTemplateData({ keyword1: { value: 'x'.repeat(33) } }),
    ).toThrow(/32/);
  });

  it('counts the characters, not the bytes', () => {
    // A Chinese character is three bytes in UTF-8 but one character.
    expect(() =>
      validateTemplateData({ thing1: { value: '字'.repeat(20) } }),
    ).not.toThrow();
  });
});

describe('the limit derived from the field name', () => {
  it('knows the limit of each WeChat field type', () => {
    expect(getTemplateValueLimit('thing1')).toBe(20);
    expect(getTemplateValueLimit('thing2')).toBe(20);
    expect(getTemplateValueLimit('short_thing1')).toBe(5);
    expect(getTemplateValueLimit('phrase1')).toBe(5);
    expect(getTemplateValueLimit('first')).toBe(10);
    expect(getTemplateValueLimit('remark')).toBe(20);
    expect(getTemplateValueLimit('character_string1')).toBe(32);
    expect(getTemplateValueLimit('number1')).toBe(32);
  });

  it('falls back to the generic limit for a name it does not know', () => {
    expect(getTemplateValueLimit('keyword1')).toBe(32);
    expect(getTemplateValueLimit('whatever')).toBe(32);
  });
});
