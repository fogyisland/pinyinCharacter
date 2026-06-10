import { describe, it, expect } from 'vitest';
import { passwordResetEmail } from '@/lib/email-templates';

describe('passwordResetEmail', () => {
  const args = { username: 'alice', resetUrl: 'https://x.com/reset?token=abc', expiresInMinutes: 15 };

  it('subject mentions 密码', () => {
    expect(passwordResetEmail(args).subject).toMatch(/密码/);
  });

  it('html contains username and the reset URL twice (button + fallback)', () => {
    const html = passwordResetEmail(args).html;
    expect(html).toContain('alice');
    expect(html).toContain('https://x.com/reset?token=abc');
    expect(html).toMatch(/<a [^>]*href="https:\/\/x\.com\/reset\?token=abc"/);
  });

  it('html mentions expiry in minutes', () => {
    expect(passwordResetEmail(args).html).toContain('15 分钟');
  });

  it('text contains username, URL, and expiry', () => {
    const text = passwordResetEmail(args).text;
    expect(text).toContain('alice');
    expect(text).toContain('https://x.com/reset?token=abc');
    expect(text).toContain('15 分钟');
  });
});
