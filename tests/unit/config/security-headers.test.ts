/**
 * The site must send the baseline security headers.
 *
 * Before this the app sent NO security headers at all: no
 * X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy, no
 * Permissions-Policy. A grep across the whole repo found zero of them.
 *
 * What each one buys:
 *   - X-Frame-Options: DENY — the site cannot be framed by another origin,
 *     so a hostile page cannot overlay the login form and harvest the
 *     credentials (clickjacking).
 *   - X-Content-Type-Options: nosniff — the browser does not second-guess
 *     the Content-Type. Without it a "text/plain" response holding HTML
 *     can be sniffed into script.
 *   - Referrer-Policy — the URL of a page is not leaked to the third
 *     party it links to. The site has page URLs that carry the reading
 *     position, and a reset-password link that carries a token.
 *   - Permissions-Policy — the browser features the site does not use
 *     (camera, microphone, geolocation) are switched off for the whole
 *     origin.
 *
 * ⚠️ There is deliberately NO Content-Security-Policy. The layout carries
 * three inline <script> blocks (the async stylesheet flip, and two JSON-LD
 * blocks), and the pages carry inline event handlers through
 * dangerouslySetInnerHTML. A strict CSP would need a nonce threaded
 * through every one of them — a separate, larger change with its own
 * risk. The headers below are the ones that need no such work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

const CONFIG = 'next.config.ts';

describe('the security headers', () => {
  const source = readSource(CONFIG);

  it('sends X-Frame-Options: DENY', () => {
    expect(source, 'the site must not be framable').toContain('X-Frame-Options');
    expect(source).toMatch(
      /key:\s*['"]X-Frame-Options['"]\s*,\s*value:\s*['"]DENY['"]/,
    );
  });

  it('sends X-Content-Type-Options: nosniff', () => {
    expect(source, 'the browser must not sniff content types').toContain(
      'X-Content-Type-Options',
    );
    expect(source).toMatch(
      /key:\s*['"]X-Content-Type-Options['"]\s*,\s*value:\s*['"]nosniff['"]/,
    );
  });

  it('sends a Referrer-Policy', () => {
    expect(source, 'the site must not leak its URLs').toContain('Referrer-Policy');
    expect(source).toMatch(
      /key:\s*['"]Referrer-Policy['"]\s*,\s*value:\s*['"]strict-origin-when-cross-origin['"]/,
    );
  });

  it('sends a Permissions-Policy that switches off the unused features', () => {
    expect(source, 'the site must switch off the features it does not use').toContain(
      'Permissions-Policy',
    );
    const match = source.match(
      /key:\s*['"]Permissions-Policy['"]\s*,\s*value:\s*['"]([^'"]+)['"]/,
    );
    expect(match, 'the Permissions-Policy must be a literal string').toBeTruthy();
    const value = match![1];
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(value, `Permissions-Policy must switch off ${feature}`).toContain(
        feature,
      );
    }
  });

  it('applies them to every route', () => {
    // The catch-all source. Without it the headers only cover the paths
    // that match a narrower pattern, and the public pages — the ones that
    // matter most for clickjacking — would be left out.
    expect(source, 'the headers must cover every route').toMatch(
      /source:\s*['"]\/:path\*['"]/,
    );
  });

  it('does not add a Content-Security-Policy', () => {
    // A CSP here would break the three inline <script> blocks in the
    // layout without a nonce scheme. It is a separate piece of work, and
    // adding it half-way would break the site.
    // The comment in the config names the header, so the check is for an
    // actual header entry — a key/value pair — and not for the word.
    expect(
      source,
      'a CSP without a nonce scheme would break the inline scripts in the layout',
    ).not.toMatch(/key:\s*['"]Content-Security-Policy['"]/);
  });

  it('keeps the existing cache headers', () => {
    // The new rule must not replace the font / stroke cache rules.
    expect(source).toContain('Cache-Control');
    expect(source).toContain('/font/web/:path*');
    expect(source).toContain('/strokes/:path*');
  });
});
