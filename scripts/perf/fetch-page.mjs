/**
 * scripts/perf/fetch-page.mjs — the transport the three perf probes share.
 *
 * Every probe of this wave talks to the site the same way, and every one of
 * them must talk to it CORRECTLY. The initialization gate of the site
 * (middleware.ts:92-100) looks at ONE cookie and at nothing else: a request
 * without `Cookie: setup_completed=1` is answered with a 307 to `/init` and
 * a body of five bytes (the literal `/init`).
 *
 * That is a trap for a measurement, and the worst kind of one:
 *
 *   - `font-load.mjs` would parse four characters out of the redirect, compute
 *     a font payload of about zero kilobytes and PASS the budget;
 *   - `full-load.mjs` would time a five byte redirect and PASS the cold load
 *     gate;
 *   - `paired-ttfb.mjs` would time the middleware redirect instead of the
 *     page render, and the +24 ms gate would measure nothing.
 *
 * Three green probes that measured nothing. So the fetch HERE always carries
 * the cookie and ALWAYS checks the response before the caller is allowed to
 * measure anything:
 *
 *   1. the status must be 200,
 *   2. the content type must start with `text/html`,
 *   3. the body must be larger than 10 000 bytes.
 *
 * A response that fails any of them is an ERROR, not a small page: the
 * function throws, and the probe exits non-zero without printing a single
 * payload number. The rule lives here, ONCE, because three copies of it
 * would drift — and a drifting copy is a probe that reports green while it
 * measures nothing.
 *
 * ⚠️ The self check is for the PAGE under test only. The static baseline of
 * `paired-ttfb.mjs` (`GET /manifest.json`, 442 B of `application/json`) is
 * checked for its status alone: holding a JSON file to "text/html and more
 * than 10 kB" would fail the baseline before the measurement starts.
 */

import http from 'node:http';
import https from 'node:https';

/** The cookie the initialization gate of the site looks at. */
export const DEFAULT_COOKIE = 'setup_completed=1';

/**
 * The smallest body a real page may have.
 *
 * The pages of this site weigh 24 kB to 73 kB; the redirect of the gate
 * weighs five. Anything under 10 kB is the gate, not a page.
 */
export const MIN_PAGE_BYTES = 10_000;

/** The pages the probes measure. */
export const MEASURED_PAGES = ['/', '/dictionary', '/poetry', '/stories'];

/** The origin the probes read when nobody names one. */
export const DEFAULT_BASE = 'https://ziyun.pudafo.com';

/** The user agent the probes send. */
const USER_AGENT = 'pinyin-character-perf/1.0';

/** How long one request may take. */
const TIMEOUT_MS = 30_000;

/** The keep alive agents, one per origin. */
const agents = new Map();

/**
 * The keep alive agent of an origin.
 *
 * The agent is shared by every request of the process, so the page and the
 * assets of a probe travel over ONE connection — the way a browser does it.
 * The first request of the process is the cold one.
 *
 * @param {URL} target the origin of the request
 * @returns {http.Agent} the agent of that origin
 */
export function getAgent(target) {
  const key = `${target.protocol}//${target.host}`;
  let agent = agents.get(key);
  if (!agent) {
    const transport = target.protocol === 'http:' ? http : https;
    agent = new transport.Agent({ keepAlive: true, maxSockets: 8 });
    agents.set(key, agent);
  }
  return agent;
}

/**
 * The command line the three probes share.
 *
 * `--cookie ''` is a legal value: it asks for a request WITHOUT the setup
 * cookie, which is how the gate of the site is reproduced on purpose.
 *
 * @param {string[]} argv the arguments of the probe
 * @returns {{ base: string, cookie: string, rest: string[] }}
 */
export function parseCommonArgs(argv) {
  const options = { base: DEFAULT_BASE, cookie: DEFAULT_COOKIE, rest: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base' || argument === '--cookie') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`the option ${argument} needs a value`);
      }
      index += 1;
      if (argument === '--base') options.base = value;
      else options.cookie = value;
      continue;
    }
    options.rest.push(argument);
  }
  options.base = options.base.replace(/\/+$/, '');
  try {
    new URL(options.base);
  } catch {
    throw new Error(`the base ${JSON.stringify(options.base)} is not a URL`);
  }
  return options;
}

/**
 * One request, without any judgement about the response.
 *
 * @param {string} url the URL to read
 * @param {{ cookie?: string, agent?: http.Agent, timeoutMs?: number,
 *           headers?: Record<string, string> }} options
 * @returns {Promise<{
 *   status: number, contentType: string, location: string, headers: object,
 *   body: Buffer, bytes: number, ttfbMs: number
 * }>}
 */
export function fetchResource(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const headers = { 'user-agent': USER_AGENT, accept: '*/*', ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  const agent = options.agent ?? getAgent(target);

  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const request = transport.request(target, { method: 'GET', headers, agent }, (response) => {
      const ttfbMs = Number(process.hrtime.bigint() - started) / 1e6;
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: response.statusCode ?? 0,
          contentType: response.headers['content-type'] ?? '',
          location: response.headers.location ?? '',
          headers: response.headers,
          body,
          bytes: body.length,
          ttfbMs,
        });
      });
    });
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`the request to ${url} timed out after ${timeoutMs} ms`));
    });
    request.end();
  });
}

/**
 * One line description of a response — what the reader of an error message
 * needs to know about the answer the server gave.
 */
export function describeResponse(response) {
  const parts = [
    `status ${response.status}`,
    `content-type ${JSON.stringify(response.contentType)}`,
    `${response.bytes} B`,
  ];
  if (response.location) parts.push(`location ${JSON.stringify(response.location)}`);
  return parts.join(', ');
}

/**
 * The self check of a page response.
 *
 * The rule is here and NOWHERE else: three copies of it would drift, and a
 * drifting copy is a probe that reports green while it measures nothing.
 *
 * @param {{ status: number, contentType: string, bytes: number, location?: string }} response
 * @param {string} url the URL that was read, for the message
 * @throws {Error} when the response is not a page
 */
export function assertHtmlResponse(response, url) {
  const problems = [];
  if (response.status !== 200) {
    problems.push(`the status is ${response.status}, it must be 200`);
  }
  if (!response.contentType.startsWith('text/html')) {
    problems.push(
      `the content type is ${JSON.stringify(response.contentType)}, it must start with "text/html"`,
    );
  }
  if (response.bytes <= MIN_PAGE_BYTES) {
    problems.push(`the body is ${response.bytes} B, it must be more than ${MIN_PAGE_BYTES} B`);
  }
  if (problems.length === 0) return;

  const hint =
    response.status === 307 || response.status === 302
      ? ' — the site redirects to /init when the setup cookie is missing, so this is the GATE and not the page'
      : '';
  throw new Error(
    `the page ${url} did not pass the self check: ${problems.join('; ')}. ` +
      `The response was ${describeResponse(response)}.${hint}`,
  );
}

/**
 * Read a page and check it before it is measured.
 *
 * @param {string} url the URL of the page
 * @param {{ cookie?: string }} options the cookie to send, the default one
 *   when it is not named; an empty string sends NO cookie on purpose
 * @returns {Promise<{ body: string, bytes: number, contentType: string, status: number }>}
 * @throws {Error} when the response is not a page (see `assertHtmlResponse`)
 */
export async function fetchPage(url, options = {}) {
  const cookie = options.cookie === undefined ? DEFAULT_COOKIE : options.cookie;
  const response = await fetchResource(url, { ...options, cookie });
  assertHtmlResponse(response, url);
  return {
    body: response.body.toString('utf8'),
    bytes: response.bytes,
    contentType: response.contentType,
    status: response.status,
  };
}
