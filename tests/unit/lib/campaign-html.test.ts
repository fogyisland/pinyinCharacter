import { describe, it, expect } from 'vitest';

import { sanitizeCampaignHtml, isSafeCampaignUrl } from '@/lib/campaign-html';

/**
 * The campaign body sanitizer.
 *
 * A campaign body is authored by an admin and mailed to every subscriber.
 * It is trusted in the ordinary sense, but not unconditionally: a
 * hijacked admin session would let an attacker write a body carrying
 * script or a tracking pixel, and that body then lands in the inbox of
 * everyone on the list.
 *
 * The rule: keep the FORMATTING, drop the EXECUTABLE parts.
 */
describe('sanitizeCampaignHtml — script cannot survive', () => {
  it('removes a script element and its body', () => {
    const out = sanitizeCampaignHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>hi</p>');
  });

  it('removes a script element written in mixed case', () => {
    const out = sanitizeCampaignHtml('<ScRiPt>alert(1)</ScRiPt>');
    expect(out).not.toContain('alert(1)');
    expect(out.toLowerCase()).not.toContain('script');
  });

  it('removes a script element with attributes', () => {
    const out = sanitizeCampaignHtml('<script src="https://evil.example/x.js"></script>');
    expect(out).not.toContain('evil.example');
  });

  it('removes the other executable containers', () => {
    expect(sanitizeCampaignHtml('<iframe src="https://evil.example"></iframe>')).not.toContain('iframe');
    expect(sanitizeCampaignHtml('<object data="x.swf"></object>')).not.toContain('object');
    expect(sanitizeCampaignHtml('<embed src="x.swf">')).not.toContain('embed');
    expect(sanitizeCampaignHtml('<applet code="x"></applet>')).not.toContain('applet');
    expect(sanitizeCampaignHtml('<style>body{display:none}</style>')).not.toContain('display:none');
  });

  it('removes a form, so a campaign cannot post to another origin', () => {
    const out = sanitizeCampaignHtml('<form action="https://evil.example/steal"><input name="p"></form>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('evil.example');
  });

  it('removes svg, which can carry script', () => {
    const out = sanitizeCampaignHtml('<svg><script>alert(1)</script></svg>');
    expect(out).not.toContain('svg');
    expect(out).not.toContain('alert(1)');
  });

  it('removes an HTML comment, which can hide a conditional script', () => {
    const out = sanitizeCampaignHtml('<!--[if IE]><script>alert(1)</script><![endif]-->');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert(1)');
  });
});

describe('sanitizeCampaignHtml — event handlers cannot survive', () => {
  it('removes an onerror handler', () => {
    const out = sanitizeCampaignHtml('<img src="x.png" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('removes an onload handler', () => {
    const out = sanitizeCampaignHtml('<body onload="alert(1)">');
    expect(out).not.toContain('onload');
  });

  it('removes an onclick handler', () => {
    const out = sanitizeCampaignHtml('<a href="https://example.com" onclick="steal()">x</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('href="https://example.com"');
  });

  it('removes a handler written in mixed case', () => {
    const out = sanitizeCampaignHtml('<img src="x.png" OnErRoR="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
  });
});

describe('sanitizeCampaignHtml — dangerous URL schemes cannot survive', () => {
  it('removes a javascript: href', () => {
    const out = sanitizeCampaignHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('x');
  });

  it('removes a javascript: href written in mixed case', () => {
    const out = sanitizeCampaignHtml('<a href="JaVaScRiPt:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('removes a javascript: href split by a tab', () => {
    // Browsers strip control characters before they read the scheme, so
    // `java\tscript:` is `javascript:` to the browser.
    const out = sanitizeCampaignHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('script:');
  });

  it('removes a vbscript: href', () => {
    const out = sanitizeCampaignHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('vbscript:');
  });

  it('removes a data:text/html src', () => {
    const out = sanitizeCampaignHtml('<img src="data:text/html,<script>alert(1)</script>">');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('alert(1)');
  });

  it('removes a data:image/svg+xml src, because an SVG can carry script', () => {
    const out = sanitizeCampaignHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">');
    expect(out).not.toContain('data:image/svg');
  });

  it('keeps an http or https href', () => {
    expect(sanitizeCampaignHtml('<a href="https://example.com/x">x</a>')).toContain(
      'href="https://example.com/x"',
    );
    expect(sanitizeCampaignHtml('<a href="http://example.com/x">x</a>')).toContain(
      'href="http://example.com/x"',
    );
  });

  it('keeps a mailto href', () => {
    expect(sanitizeCampaignHtml('<a href="mailto:a@example.com">x</a>')).toContain(
      'href="mailto:a@example.com"',
    );
  });

  it('keeps a relative href', () => {
    expect(sanitizeCampaignHtml('<a href="/guide">x</a>')).toContain('href="/guide"');
  });
});

describe('sanitizeCampaignHtml — formatting is preserved', () => {
  it('keeps headings, paragraphs and emphasis', () => {
    const html = '<h1>标题</h1><p>正文 <strong>粗体</strong> <em>斜体</em></p>';
    const out = sanitizeCampaignHtml(html);
    expect(out).toContain('<h1>标题</h1>');
    expect(out).toContain('<strong>粗体</strong>');
    expect(out).toContain('<em>斜体</em>');
  });

  it('keeps lists', () => {
    const out = sanitizeCampaignHtml('<ul><li>一</li><li>二</li></ul>');
    expect(out).toContain('<li>一</li>');
  });

  it('keeps a table', () => {
    const out = sanitizeCampaignHtml('<table><tr><td>格子</td></tr></table>');
    expect(out).toContain('<td>格子</td>');
  });

  it('keeps an inline style', () => {
    const out = sanitizeCampaignHtml('<p style="color:#ff0000">红</p>');
    expect(out).toContain('color:#ff0000');
  });

  it('keeps a png data: image', () => {
    const out = sanitizeCampaignHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).toContain('data:image/png');
  });
});

describe('sanitizeCampaignHtml — remote resources in styles cannot phone home', () => {
  it('strips a url() from a style attribute', () => {
    // A remote background image is a tracking pixel: it tells the sender
    // which subscriber opened the mail, and when.
    const out = sanitizeCampaignHtml('<div style="background:url(https://tracker.example/p.gif)">x</div>');
    expect(out).not.toContain('tracker.example');
  });

  it('strips a url() that hides a script scheme', () => {
    const out = sanitizeCampaignHtml('<div style="background:url(javascript:alert(1))">x</div>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });
});

describe('sanitizeCampaignHtml — the edges', () => {
  it('handles an empty string', () => {
    expect(sanitizeCampaignHtml('')).toBe('');
  });

  it('handles a plain-text body', () => {
    expect(sanitizeCampaignHtml('just text')).toBe('just text');
  });

  it('escapes a stray "<" that is not a tag', () => {
    const out = sanitizeCampaignHtml('a < b and c > d');
    expect(out).toContain('&lt;');
  });

  it('does not throw on malformed markup', () => {
    expect(() => sanitizeCampaignHtml('<p><div><span>unclosed')).not.toThrow();
    expect(() => sanitizeCampaignHtml('<<<>>>')).not.toThrow();
    expect(() => sanitizeCampaignHtml('<a href=">')).not.toThrow();
  });
});

describe('isSafeCampaignUrl', () => {
  it('accepts http, https, mailto and tel', () => {
    expect(isSafeCampaignUrl('https://example.com')).toBe(true);
    expect(isSafeCampaignUrl('http://example.com')).toBe(true);
    expect(isSafeCampaignUrl('mailto:a@example.com')).toBe(true);
    expect(isSafeCampaignUrl('tel:+123')).toBe(true);
  });

  it('accepts a relative URL', () => {
    expect(isSafeCampaignUrl('/guide')).toBe(true);
    expect(isSafeCampaignUrl('#section')).toBe(true);
  });

  it('refuses javascript, vbscript and data', () => {
    expect(isSafeCampaignUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeCampaignUrl('vbscript:x')).toBe(false);
    expect(isSafeCampaignUrl('data:text/html,x')).toBe(false);
  });

  it('refuses a data: URI when images are not allowed', () => {
    expect(isSafeCampaignUrl('data:image/png;base64,AAA', false)).toBe(false);
  });

  it('accepts a raster data: image when images are allowed', () => {
    expect(isSafeCampaignUrl('data:image/png;base64,AAA', true)).toBe(true);
    expect(isSafeCampaignUrl('data:image/webp;base64,AAA', true)).toBe(true);
  });

  it('refuses an svg data: URI even when images are allowed', () => {
    expect(isSafeCampaignUrl('data:image/svg+xml;base64,AAA', true)).toBe(false);
  });

  it('refuses an empty URL', () => {
    expect(isSafeCampaignUrl('')).toBe(false);
    expect(isSafeCampaignUrl('   ')).toBe(false);
  });

  it('refuses a scheme hidden behind control characters', () => {
    expect(isSafeCampaignUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeCampaignUrl('java\nscript:alert(1)')).toBe(false);
  });
});
