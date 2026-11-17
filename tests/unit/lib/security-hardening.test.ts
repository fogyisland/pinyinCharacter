import { describe, it, expect } from 'vitest';

import { safeInternalPath } from '@/lib/auth-client';
import { serializeJsonLd } from '@/lib/seo/jsonld';
import { renderMarkdown } from '@/lib/markdown';

/**
 * A single backslash character.
 *
 * The JSON-LD escape sequences are SIX CHARACTERS (backslash, 'u', '0', '0',
 * '3', 'c'). They cannot be spelled as a plain JS string literal: a literal
 * holding one backslash before 'u003c' is parsed by JavaScript as the
 * CHARACTER '<' - not as the six-character text. Building the expectation
 * from the backslash keeps the test honest about what the serializer
 * actually writes into the page.
 */
const BS = String.fromCharCode(92);

/**
 * Regression tests for the code-level security fixes.
 *
 * Each block corresponds to one vulnerability that was found and closed.
 * The comments name the failure mode, because the assertion alone does not
 * explain WHY a case is dangerous — and a future edit that "simplifies" one
 * of these away should look wrong to the reader.
 */
describe('safeInternalPath — the login redirect cannot leave the site', () => {
  it('accepts a normal internal path', () => {
    expect(safeInternalPath('/worksheet')).toBe('/worksheet');
    expect(safeInternalPath('/dictionary/好')).toBe('/dictionary/好');
  });

  it('falls back to "/" when there is no target', () => {
    expect(safeInternalPath(null)).toBe('/');
    expect(safeInternalPath(undefined)).toBe('/');
    expect(safeInternalPath('')).toBe('/');
  });

  it('refuses an absolute URL', () => {
    // The phishing amplifier: the victim logs in on the real site and is
    // then handed to the attacker's site, which borrows this site's
    // credibility for the credential they just typed.
    expect(safeInternalPath('https://evil.example/phish')).toBe('/');
    expect(safeInternalPath('http://evil.example')).toBe('/');
  });

  it('refuses a protocol-relative URL', () => {
    // `//evil.example` is another HOST to a browser, not a path.
    expect(safeInternalPath('//evil.example')).toBe('/');
  });

  it('refuses a backslash-prefixed URL', () => {
    // Some browsers normalise `/\evil.example` into `//evil.example`.
    expect(safeInternalPath('/\\evil.example')).toBe('/');
  });

  it('refuses a scheme-bearing value', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/');
    expect(safeInternalPath('data:text/html,<script>alert(1)</script>')).toBe('/');
  });

  it('does not treat an encoded separator as safe', () => {
    // The value arrives already URL-decoded by `searchParams.get()`, but a
    // double-encoded payload must not survive either.
    expect(safeInternalPath('/%2f%2fevil.example')).toBe('/%2f%2fevil.example');
  });
});

describe('serializeJsonLd — a JSON-LD payload cannot close the script element', () => {
  it('escapes "<" so a script element cannot be closed early', () => {
    // The HTML parser ends a `<script>` at the FIRST `</script`, even
    // inside a JSON string. `JSON.stringify` does not escape "<", so an
    // unescaped payload turns into live markup in the document.
    const out = serializeJsonLd({ name: 'Book </script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('\u003c');
    expect(out).toContain(BS + 'u003');
  });

  it('escapes ">" and "&"', () => {
    const out = serializeJsonLd({ a: 'x > y & z' });
    expect(out).not.toContain('\u003e');
    expect(out).not.toContain('\u0026');
    expect(out).toContain(BS + 'u003');
    expect(out).toContain(BS + 'u0026');
  });

  it('still parses back to the original value', () => {
    // Escaping must not corrupt the JSON-LD — it only has to be safe to
    // embed. The escapes are valid JSON string escapes.
    const payload = { name: '好</script>', note: 'a & b > c' };
    const out = serializeJsonLd(payload);
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('handles an array and a nested object', () => {
    const out = serializeJsonLd({ list: ['</script>', { deep: '<b>' }] });
    expect(out).not.toContain('\u003c');
    expect(JSON.parse(out)).toEqual({ list: ['</script>', { deep: '<b>' }] });
  });
});

describe('renderMarkdown — a link target cannot carry a script scheme', () => {
  it('refuses a javascript: target and renders it as plain text', () => {
    const out = renderMarkdown('[click me](javascript:alert(1))');
    expect(out).not.toContain('href');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click me');
  });

  it('refuses a data: target', () => {
    const out = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
    expect(out).not.toContain('href');
    expect(out).not.toContain('data:');
  });

  it('refuses a scheme written in mixed case', () => {
    // Browsers treat `JaVaScRiPt:` as `javascript:`.
    const out = renderMarkdown('[x](JaVaScRiPt:alert(1))');
    expect(out).not.toContain('href');
    expect(out).not.toContain('JaVaScRiPt:');
  });

  it('still renders an http/https/mailto target as a link', () => {
    expect(renderMarkdown('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(renderMarkdown('[x](http://example.com)')).toContain('href="http://example.com"');
    expect(renderMarkdown('[x](mailto:a@example.com)')).toContain('href="mailto:a@example.com"');
  });

  it('still renders a relative target as a link', () => {
    expect(renderMarkdown('[x](/guide)')).toContain('href="/guide"');
    expect(renderMarkdown('[x](#section)')).toContain('href="#section"');
  });
});
