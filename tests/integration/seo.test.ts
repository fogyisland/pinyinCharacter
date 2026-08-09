import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

// These tests require a dev server running on port 4444.
// Run `npm run dev` in another terminal, then:
//   npx vitest run tests/integration/seo.test.ts
//
// Skipped by default in CI / pre-commit because the dev server may not be up.
// To enable: switch `it.skip(...)` -> `it(...)` and ensure dev server is up.
const TIMEOUT_MS = 10_000;

describe('SEO markup', () => {
  it.skip('robots.txt disallows /init, /login', () => {
    const out = execSync('curl -s http://localhost:4444/robots.txt', { encoding: 'utf-8' });
    expect(out).toContain('Disallow: /init');
    expect(out).toContain('Disallow: /login');
  }, TIMEOUT_MS);

  it.skip('/pinyin has <title>汉字拼音互转工具</title>', () => {
    const out = execSync('curl -s http://localhost:4444/pinyin', { encoding: 'utf-8' });
    expect(out).toMatch(/<title>.*汉字拼音互转工具.*<\/title>/);
  }, TIMEOUT_MS);

  it.skip('/ has Organization + WebSite JSON-LD', () => {
    const out = execSync('curl -s http://localhost:4444/', { encoding: 'utf-8' });
    expect(out).toContain('"@type":"Organization"');
    expect(out).toContain('"@type":"WebSite"');
    // SearchAction target must point to /dictionary?q=… (no /search route).
    expect(out).toContain('/dictionary?q={search_term_string}');
  }, TIMEOUT_MS);
});
