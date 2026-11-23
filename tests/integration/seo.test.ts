import { describe, it, expect } from 'vitest';

/**
 * SEO markup, checked against a real server.
 *
 * ## Why these were never running
 *
 * Three `it.skip(...)` — robots.txt, the /pinyin title, the home page's
 * JSON-LD — were left disabled "because the dev server may not be up". Nobody
 * ever came back to enable them, so the three assertions that protect the
 * site's search behaviour have never executed once.
 *
 * ## Why `skipIf` instead of enabling them outright
 *
 * `it.skip` is a promise nobody keeps. `it.skipIf(!serverUp)` keeps the same
 * safety (a CI box with no dev server still passes) while making the tests
 * REAL whenever a server happens to be running — which on a developer's
 * machine is most of the time.
 *
 * The probe is one `fetch` with a short timeout, done once.
 *
 * ## Why the requests carry `setup_completed=1`
 *
 * A site whose /init wizard has not finished redirects every page to /init,
 * so the title assertion would read the wizard's page and fail for a reason
 * that has nothing to do with SEO. The cookie is the same one the
 * walkthroughs set: "this server is set up", nothing else.
 */
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4444';
/**
 * Generous on purpose: in dev, the FIRST request to a route also compiles it,
 * and /pinyin took longer than 15 s on a cold Turbopack cache — which read as
 * a failure the first time this suite was ever run.
 */
const TIMEOUT_MS = 60_000;
const PROBE_MS = 5_000;

/**
 * Is a server answering? Probed ONCE at module load.
 *
 * It cannot wait for `beforeAll`: `it.skipIf(...)` is evaluated while the
 * suite is being COLLECTED, which happens before any hook runs. A flag set in
 * `beforeAll` would still be `false` at that moment and every test would be
 * skipped even with the server up — which is exactly what the first version
 * of this file did.
 */
const serverUp = await probeServer();

async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/robots.txt`, { signal: AbortSignal.timeout(PROBE_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!serverUp) {
  // One line, not a stack: a developer reading the output needs to know WHY
  // four tests were skipped, and the answer is "no server on 4444".
  console.warn(`[seo integration] no server on ${BASE} — the SEO checks were skipped`);
}

/** GET a path the way a browser with a completed setup would. */
async function get(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: 'setup_completed=1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.text();
}

describe('SEO markup', () => {
  it.skipIf(!serverUp)('robots.txt disallows /init, /login', async () => {
    const out = await get('/robots.txt');
    expect(out).toContain('Disallow: /init');
    expect(out).toContain('Disallow: /login');
    // The sitemap pointer is what lets a crawler find everything else.
    expect(out).toContain('/sitemap.xml');
  }, TIMEOUT_MS);

  it.skipIf(!serverUp)('/pinyin has its own <title>', async () => {
    const out = await get('/pinyin');
    // Not the layout's generic title: this page is the pinyin converter and
    // a search result must say so.
    expect(out).toMatch(/<title>[^<]*汉字拼音互转工具[^<]*<\/title>/);
    expect(out).toContain('rel="canonical"');
  }, TIMEOUT_MS);

  it.skipIf(!serverUp)('/ has Organization + WebSite JSON-LD', async () => {
    const out = await get('/');
    expect(out).toContain('"@type":"Organization"');
    expect(out).toContain('"@type":"WebSite"');
    // SearchAction target must point to /dictionary?q=… (no /search route).
    expect(out).toContain('/dictionary?q={search_term_string}');
  }, TIMEOUT_MS);

  it.skipIf(!serverUp)('the sitemap lists the teaching pages', async () => {
    // These four are the round's additions. A page in no sitemap is a page
    // a crawler only finds by luck.
    const out = await get('/sitemap.xml');
    for (const page of ['/dictation', '/worksheet', '/pinyin', '/game']) {
      expect(out, `the sitemap must list ${page}`).toContain(page);
    }
  }, TIMEOUT_MS);
});
