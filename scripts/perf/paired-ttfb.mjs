/**
 * scripts/perf/paired-ttfb.mjs — what the server render of a page costs.
 *
 * The probe is PAIRED. Every sample reads the time to first byte of a static
 * file (`GET /manifest.json`, 442 B of JSON the server answers without
 * rendering anything) and then the time to first byte of the page, BOTH over
 * the SAME keep alive connection, and keeps the difference. The difference
 * is what the render costs: the network, the TLS handshake and the cache
 * state of the connection are in both numbers and cancel out.
 *
 * The budget is +24 ms (spec §2.2). The number that has to stay inside it
 * is the MEDIAN of the samples: the site is a live one, its content drifts,
 * and a single slow sample is noise, not a regression.
 *
 * ⚠️ The page is CHECKED before it is measured (see `assertHtmlResponse`).
 * The gate of the site (middleware.ts:92-100) answers a request without the
 * setup cookie with a 307 and a body of five bytes — a redirect that is
 * faster than any render and would let this probe pass while it measures
 * the middleware instead of the page. The baseline is checked for its status
 * alone: it is a JSON file, not a page.
 */

import http from 'node:http';
import https from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertHtmlResponse,
  describeResponse,
  parseCommonArgs,
  MEASURED_PAGES,
} from './fetch-page.mjs';

/** How many samples one page takes when nobody asks for another number. */
const DEFAULT_SAMPLES = 15;

/** The budget of the server render delta (spec §2.2). */
const LIMIT_MS = 24;

/** The static baseline: a file the server answers without rendering. */
const BASELINE_PATH = '/manifest.json';

/** The user agent the probe sends. */
const USER_AGENT = 'pinyin-character-perf/1.0';

/**
 * How many samples one page takes.
 *
 * @param {string[]} rest the arguments the probe reads itself
 * @returns {number}
 */
function readSamples(rest) {
  let samples = DEFAULT_SAMPLES;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--samples') {
      const value = rest[index + 1];
      if (value === undefined) throw new Error('the option --samples needs a value');
      samples = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${JSON.stringify(argument)} — the option is --samples`);
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`the number of samples must be a positive whole number, it is ${samples}`);
  }
  return samples;
}

/**
 * The keep alive agent of the probe.
 *
 * `maxSockets: 1` keeps the samples on ONE connection: the baseline and the
 * page of a sample must travel over the same connection, otherwise the
 * difference would also contain the cost of a second connection.
 */
function createAgent(protocol) {
  const transport = protocol === 'http:' ? http : https;
  return new transport.Agent({ keepAlive: true, maxSockets: 1 });
}

/**
 * One request, timed to its first byte.
 *
 * @param {string} url the URL to read
 * @param {{ cookie?: string, agent: http.Agent }} options
 * @returns {Promise<{
 *   status: number, contentType: string, location: string, bytes: number, ttfbMs: number
 * }>}
 */
function timedGet(url, options) {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  const headers = { 'user-agent': USER_AGENT, accept: '*/*' };
  if (options.cookie) headers.cookie = options.cookie;

  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const request = transport.request(
      target,
      { method: 'GET', headers, agent: options.agent },
      (response) => {
        const ttfbMs = Number(process.hrtime.bigint() - started) / 1e6;
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
        });
        response.on('error', reject);
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers['content-type'] ?? '',
            location: response.headers.location ?? '',
            bytes,
            ttfbMs,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** The median of a list of numbers. */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A number of milliseconds. */
function ms(value) {
  return `${Math.round(value * 10) / 10} ms`;
}

/** A number with its sign, so a delta reads as a delta. */
function signed(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1)} ms`;
}

/**
 * The probe.
 */
async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  const samples = readSamples(options.rest);
  const agent = createAgent(new URL(options.base).protocol);

  console.log(
    `[perf:ttfb] the base is ${options.base} — ${samples} samples per page, ` +
      `the budget is +${LIMIT_MS} ms`,
  );
  console.log(
    '[perf:ttfb] the delta is the page time to first byte minus the time to first ' +
      `byte of ${BASELINE_PATH} over the same connection`,
  );

  const failures = [];
  for (const path of MEASURED_PAGES) {
    const url = `${options.base}${path}`;
    const baselineUrl = `${options.base}${BASELINE_PATH}`;
    const deltas = [];
    const baselineTimes = [];
    const pageTimes = [];

    for (let index = 0; index < samples; index += 1) {
      const baseline = await timedGet(baselineUrl, { cookie: options.cookie, agent });
      if (baseline.status !== 200) {
        throw new Error(
          `the baseline ${baselineUrl} answered ${baseline.status} ` +
            `(${describeResponse(baseline)}) — the probe cannot measure without it`,
        );
      }
      const page = await timedGet(url, { cookie: options.cookie, agent });
      assertHtmlResponse(page, url);
      baselineTimes.push(baseline.ttfbMs);
      pageTimes.push(page.ttfbMs);
      deltas.push(page.ttfbMs - baseline.ttfbMs);
    }

    const delta = median(deltas);
    const over = delta > LIMIT_MS;
    if (over) failures.push(path);
    console.log(
      `[perf:ttfb] ${path.padEnd(12)} baseline ${ms(median(baselineTimes)).padStart(9)}` +
        `   page ${ms(median(pageTimes)).padStart(9)}` +
        `   delta ${signed(delta).padStart(9)}` +
        `   (min ${signed(Math.min(...deltas)).padStart(8)}, max ${signed(Math.max(...deltas)).padStart(8)})` +
        `   ${over ? 'OVER' : 'OK'}`,
    );
  }

  if (failures.length > 0) {
    console.error(
      `[perf:ttfb] ${failures.length} page(s) are over the budget of +${LIMIT_MS} ms: ` +
        `${failures.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[perf:ttfb] every page is inside the budget of +${LIMIT_MS} ms`);
}

// Only run the probe when this file is the entry point.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[perf:ttfb] the probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
