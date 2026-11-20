import { describe, it, expect } from 'vitest';
import { resolveWechatJumpUrl } from '@/lib/wechat-jump-url';

const SITE = 'https://ziyun.pudafo.com';

describe('the jump url of a template message', () => {
  it('accepts a url on the site itself', () => {
    expect(resolveWechatJumpUrl('https://ziyun.pudafo.com/guide', SITE)).toBe(
      'https://ziyun.pudafo.com/guide',
    );
  });

  it('turns a site-relative path into an absolute url', () => {
    // WeChat wants an absolute url; a relative one is a parameter error
    // and would stop the whole broadcast.
    expect(resolveWechatJumpUrl('/guide', SITE)).toBe('https://ziyun.pudafo.com/guide');
  });

  it('refuses a url pointing at another host', () => {
    // The phishing case: a link inside the official account's message
    // that goes somewhere else.
    expect(resolveWechatJumpUrl('https://evil.example.com/steal', SITE)).toBeNull();
  });

  it('refuses a protocol-relative url — it is another host in disguise', () => {
    expect(resolveWechatJumpUrl('//evil.example.com/steal', SITE)).toBeNull();
  });

  it('refuses a url that only looks like ours', () => {
    expect(resolveWechatJumpUrl('https://ziyun.pudafo.com.evil.example.com/', SITE)).toBeNull();
    expect(resolveWechatJumpUrl('https://evil.example.com/?x=ziyun.pudafo.com', SITE)).toBeNull();
  });

  it('refuses a url with a different scheme', () => {
    expect(resolveWechatJumpUrl('javascript:alert(1)', SITE)).toBeNull();
    expect(resolveWechatJumpUrl('data:text/html,<script>', SITE)).toBeNull();
  });

  it('refuses a url with the wrong port', () => {
    expect(resolveWechatJumpUrl('https://ziyun.pudafo.com:8443/guide', SITE)).toBeNull();
  });

  it('keeps a climbing path on our own origin', () => {
    // `..` cannot escape the authority, so this stays on the site.
    expect(resolveWechatJumpUrl('/../evil', SITE)).toBe('https://ziyun.pudafo.com/evil');
  });

  it('refuses an empty url', () => {
    expect(resolveWechatJumpUrl('', SITE)).toBeNull();
    expect(resolveWechatJumpUrl('   ', SITE)).toBeNull();
  });

  it('refuses everything when the site url itself is unknown', () => {
    expect(resolveWechatJumpUrl('https://ziyun.pudafo.com/guide', 'not a url')).toBeNull();
    expect(resolveWechatJumpUrl('/guide', 'not a url')).toBeNull();
  });

  it('accepts a url on the site when the site runs on a port', () => {
    const site = 'http://localhost:3000';
    expect(resolveWechatJumpUrl('http://localhost:3000/guide', site)).toBe(
      'http://localhost:3000/guide',
    );
    expect(resolveWechatJumpUrl('http://localhost:4000/guide', site)).toBeNull();
  });
});
