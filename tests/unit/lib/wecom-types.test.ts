import { describe, it, expect } from 'vitest';
import {
  WECOM_CATEGORIES,
  WECOM_CATEGORY_LABELS,
  WECOM_DEFAULT_CATEGORIES,
  isWecomCategory,
  isValidWebhookUrl,
} from '@/lib/wecom-types';

describe('the WeCom category catalogue', () => {
  it('lists the eight categories', () => {
    expect(WECOM_CATEGORIES).toHaveLength(8);
    expect(WECOM_CATEGORIES).toContain('notes_notification');
    expect(WECOM_CATEGORIES).toContain('password_reset');
  });

  it('labels every category in Chinese', () => {
    for (const category of WECOM_CATEGORIES) {
      expect(WECOM_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('does not enable the password reset category by default', () => {
    // Forwarding a reset link to a group shows it to every member of that
    // group. It has to be a deliberate choice.
    expect(WECOM_DEFAULT_CATEGORIES).not.toContain('password_reset');
  });

  it('does not enable the marketing campaign category by default', () => {
    expect(WECOM_DEFAULT_CATEGORIES).not.toContain('campaign');
  });

  it('recognises exactly the catalogue', () => {
    expect(isWecomCategory('welcome')).toBe(true);
    expect(isWecomCategory('not_a_category')).toBe(false);
  });
});

describe('the webhook URL guard', () => {
  it('accepts a real WeCom group robot URL', () => {
    expect(
      isValidWebhookUrl(
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123',
      ),
    ).toBe(true);
  });

  it('refuses a URL that is not https', () => {
    expect(
      isValidWebhookUrl('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc'),
    ).toBe(false);
  });

  it('refuses a URL pointing at another host', () => {
    // An internal address would turn the server into a request forwarder.
    expect(isValidWebhookUrl('https://192.168.1.10/cgi-bin/webhook/send?key=abc')).toBe(false);
    expect(isValidWebhookUrl('https://evil.example.com/cgi-bin/webhook/send?key=abc')).toBe(false);
  });

  it('refuses a URL with no key', () => {
    expect(isValidWebhookUrl('https://qyapi.weixin.qq.com/cgi-bin/webhook/send')).toBe(false);
  });

  it('refuses a URL with no webhook path', () => {
    expect(isValidWebhookUrl('https://qyapi.weixin.qq.com/cgi-bin/message/send?key=abc')).toBe(false);
  });
});
