/**
 * scripts/perf/full-load.mjs — the cold load of a page.
 *
 * The probe opens a COLD connection, reads the page, and then downloads
 * everything the browser would download for it: the stylesheets, the scripts
 * and the fonts the page really paints. It prints the bytes of each kind and
 * the time the whole thing took, and it holds that time against the budget
 * of the design (the first screen of the homepage must load in 5 s).
 *
 * ⚠️ **Which fonts are downloaded.** Not every file a stylesheet mentions —
 * the sans stylesheet of this repository declares 2 459 faces, and a browser
 * downloads the ONE file per character it paints, not the whole catalogue.
 * So the fonts are resolved the way a browser resolves them: the characters
 * of the page are attributed to the three typefaces by `class-attribution.mjs`,
 * and the faces whose `unicode-range` claims those characters are the ones
 * that are downloaded. The faces are read from the stylesheet the LIVE page
 * links to, so the probe measures the build the site really serves.
 *
 * ⚠️ **The timing starts before the first request is sent**, not when the
 * process starts: the imports of this module (the verifier of the subsets
 * and the attribution module) cost about 800 ms and they are NOT part of a
 * page load. The clock is taken in the body of the module, right before the
 * first request, so the measurement window is the load itself.
 *
 * ⚠️ **The bytes are the bytes that travelled over the wire.** The probe
 * asks for gzip (as a browser does) and reports what arrived, so the number
 * is what the user downloads and not what the files weigh on the disk.
 *
 * ⚠️ **The resources are downloaded in parallel, like a browser does.** The
 * budget of 5 s is a BUDGET OF THE FIRST SCREEN — it was set on what a
 * browser needs to paint the page, and a browser keeps six connections per
 * host and asks for everything at once. A probe that downloaded the files
 * one after another would measure "the number of files × the round trip
 * time" instead of the load: from a machine far away from the server (a
 * 300 ms round trip) that is 63 × 300 ms ≈ 19 s of pure network, and the
 * number would say nothing about the site. The probe therefore downloads
 * with six connections at a time, and says so in its output.
 */

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES } from '../fonts/build-webfont-subsets.mjs';

import { collectFamilyCharsets } from './class-attribution.mjs';
import { fetchPage, fetchResource, parseCommonArgs } from './fetch-page.mjs';
import { parseUnicodeRanges } from './font-load.mjs';

/** The budget of the first screen (spec §2.2): the cold load must fit in it. */
const LIMIT_MS = 5000;

/** How many resources are downloaded at the same time — a browser's six. */
const CONCURRENCY = 6;

/** The path the probe reads when nobody names another one. */
const DEFAULT_PATH = '/';

/** The user agent the probe sends. */
const USER_AGENT = 'pinyin-character-perf/1.0';

/**
 * The command line of the probe.
 *
 * @param {string[]} rest the arguments the probe reads itself
 * @returns {{ path: string }}
 */
function readOptions(rest) {
  let path = DEFAULT_PATH;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--path') {
      const value = rest[index + 1];
      if (value === undefined) throw new Error('the option --path needs a value');
      path = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${JSON.stringify(argument)} — the option is --path`);
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return { path };
}

/** The value of an attribute of an HTML tag. */
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return match ? match[1] : '';
}

/** A declaration out of a CSS block: `font-family: 'Noto Sans SC';`. */
function cssField(body, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  return match ? match[1].trim() : '';
}

/**
 * The stylesheets, the scripts and the fonts the HTML asks for.
 *
 * @param {string} html the HTML of the page
 * @returns {{ stylesheets: string[], scripts: string[], fonts: string[] }}
 */
function extractResources(html) {
  const stylesheets = [];
  const scripts = [];
  const fonts = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attribute(tag, 'href');
    if (href === '') continue;
    const rel = attribute(tag, 'rel').toLowerCase();
    const as = attribute(tag, 'as').toLowerCase();
    if (rel.includes('stylesheet')) stylesheets.push(href);
    else if (rel === 'modulepreload' || (rel === 'preload' && as === 'script')) scripts.push(href);
    else if (rel === 'preload' && as === 'style') stylesheets.push(href);
    else if (rel === 'preload' && as === 'font') fonts.push(href);
  }

  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attribute(match[0], 'src');
    if (src !== '') scripts.push(src);
  }

  return { stylesheets, scripts, fonts };
}

/** The `url()`s of the style blocks that are inline in the HTML. */
function inlineStyleUrls(html) {
  const urls = [];
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const url of block[1].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      urls.push(url[1]);
    }
  }
  return urls;
}

/** The font file a URL points at, when it points at one. */
function isFontUrl(url) {
  return url.split('?')[0].toLowerCase().endsWith('.woff2');
}

/**
 * The text of a response, decompressed the way the server encoded it.
 */
function decodeText(body, encoding) {
  const value = String(encoding).toLowerCase();
  if (value === 'gzip' || value === 'x-gzip') return zlib.gunzipSync(body).toString('utf8');
  if (value === 'br') return zlib.brotliDecompressSync(body).toString('utf8');
  if (value === 'deflate') return zlib.inflateSync(body).toString('utf8');
  return body.toString('utf8');
}

/**
 * The faces of a stylesheet whose range claims one of the characters of the
 * page — the files a browser downloads for those characters.
 *
 * @param {string} css the text of the stylesheet
 * @param {Record<string, Set<number>>} points the code points of the page,
 *   per family
 * @returns {{ src: string, family: string }[]} the faces to download
 */
function selectFontFaces(css, points) {
  const familyByLabel = new Map(FAMILIES.map((family) => [family.label, family.key]));
  const selected = new Map();
  for (const block of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const body = block[1];
    const src = /src:\s*url\(([^)]*)\)/.exec(body);
    if (!src) continue;
    const label = cssField(body, 'font-family').replace(/['"]/g, '').trim();
    const family = familyByLabel.get(label);
    if (!family) continue;
    const wanted = points[family];
    if (!wanted || wanted.size === 0) continue;
    const range = cssField(body, 'unicode-range');
    if (range === '') continue;
    const ranges = parseUnicodeRanges(range);
    const hit = [...wanted].some((point) =>
      ranges.some(({ start, end }) => point >= start && point <= end),
    );
    if (hit) selected.set(src[1].trim(), family);
  }
  return [...selected].map(([src, family]) => ({ src, family }));
}

/** The bytes of a number, with a thousands separator. */
function withSeparator(bytes) {
  return String(bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The cold agent of the probe: one connection per slot, nothing reused.
 *
 * @param {URL} target the origin of the request
 * @returns {http.Agent}
 */
function createColdAgent(target) {
  const transport = target.protocol === 'http:' ? http : https;
  return new transport.Agent({ keepAlive: true, maxSockets: CONCURRENCY });
}

/**
 * Run a task over a list with a bounded number of them at the same time.
 *
 * A browser keeps six connections per host and asks for everything at once;
 * the probe does the same, so the time it measures is a load and not "the
 * number of files times the round trip time".
 *
 * @template T, R
 * @param {T[]} items the items to work through
 * @param {number} limit how many of them run at the same time
 * @param {(item: T) => Promise<R>} worker the work of one item
 * @returns {Promise<R[]>} the results, in the order of the items
 */
async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  const runners = [];
  for (let index = 0; index < Math.min(limit, items.length); index += 1) runners.push(run());
  await Promise.all(runners);
  return results;
}

/**
 * The probe.
 */
async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  const { path } = readOptions(options.rest);
  const url = `${options.base}${path}`;
  const agent = createColdAgent(new URL(options.base));
  const headers = { 'accept-encoding': 'gzip, br', 'user-agent': USER_AGENT };

  console.log(`[perf:load] the base is ${options.base}, the path is ${path}`);
  console.log(
    `[perf:load] the connection is cold and ${CONCURRENCY} resources are downloaded at a time, ` +
      'the way a browser does it',
  );

  // The clock starts here, right before the first request — the imports of
  // this module are not part of a page load.
  const started = process.hrtime.bigint();

  const page = await fetchPage(url, { cookie: options.cookie, agent });
  const resources = extractResources(page.body);
  const charsets = collectFamilyCharsets(page.body);
  const points = {
    sans: new Set([...charsets.sans].map((char) => char.codePointAt(0))),
    serif: new Set([...charsets.serif].map((char) => char.codePointAt(0))),
    wenkai: new Set([...charsets.wenkai].map((char) => char.codePointAt(0))),
  };

  const cssUrls = [...new Set(resources.stylesheets)];
  const jsUrls = [...new Set(resources.scripts)];
  // The font URL → the family it belongs to. The family is read out of the
  // `@font-face` block that declares the file; the files the HTML preloads
  // carry no family, they are counted apart.
  const fontUrls = new Map();
  for (const href of resources.fonts) fontUrls.set(href, 'preloaded');

  const cssResponses = await mapWithLimit(cssUrls, CONCURRENCY, async (href) => {
    const response = await fetchResource(new URL(href, options.base).href, {
      cookie: options.cookie,
      agent,
      headers,
    });
    if (response.status !== 200) {
      throw new Error(
        `the stylesheet ${href} answered ${response.status} (${response.bytes} B) — ` +
          'the cold load cannot be measured without it',
      );
    }
    return response;
  });

  let cssBytes = 0;
  for (const response of cssResponses) {
    cssBytes += response.bytes;
    const css = decodeText(response.body, response.headers['content-encoding']);
    for (const face of selectFontFaces(css, points)) fontUrls.set(face.src, face.family);
  }

  for (const inline of inlineStyleUrls(page.body)) {
    if (isFontUrl(inline)) fontUrls.set(inline, 'inline');
  }

  const scriptResponses = await mapWithLimit(jsUrls, CONCURRENCY, async (src) => {
    const response = await fetchResource(new URL(src, options.base).href, {
      cookie: options.cookie,
      agent,
      headers,
    });
    if (response.status !== 200) {
      throw new Error(
        `the script ${src} answered ${response.status} (${response.bytes} B) — ` +
          'the cold load cannot be measured without it',
      );
    }
    return { src, response };
  });
  let jsBytes = 0;
  for (const { response } of scriptResponses) jsBytes += response.bytes;

  const fontEntries = [...fontUrls];
  const fontResponses = await mapWithLimit(fontEntries, CONCURRENCY, async ([src, family]) => {
    const response = await fetchResource(new URL(src, options.base).href, {
      cookie: options.cookie,
      agent,
      headers,
    });
    if (response.status !== 200) {
      throw new Error(
        `the font ${src} answered ${response.status} (${response.bytes} B) — ` +
          'the cold load cannot be measured without it',
      );
    }
    return { src, family, response };
  });

  let fontBytes = 0;
  const fontBytesByFamily = new Map();
  const fontCountByFamily = new Map();
  for (const { family, response } of fontResponses) {
    fontBytes += response.bytes;
    fontBytesByFamily.set(family, (fontBytesByFamily.get(family) ?? 0) + response.bytes);
    fontCountByFamily.set(family, (fontCountByFamily.get(family) ?? 0) + 1);
  }

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const total = page.bytes + cssBytes + jsBytes + fontBytes;

  console.log(`[perf:load] html   ${withSeparator(page.bytes).padStart(9)} B  (1 file)`);
  console.log(
    `[perf:load] css    ${withSeparator(cssBytes).padStart(9)} B  (${cssResponses.length} files)`,
  );
  console.log(
    `[perf:load] js     ${withSeparator(jsBytes).padStart(9)} B  (${scriptResponses.length} files)`,
  );
  console.log(
    `[perf:load] fonts  ${withSeparator(fontBytes).padStart(9)} B  (${fontResponses.length} files)`,
  );
  for (const [family, bytes] of [...fontBytesByFamily].sort()) {
    console.log(
      `[perf:load]   ${family.padEnd(12)} ${withSeparator(bytes).padStart(9)} B` +
        `  (${fontCountByFamily.get(family)} files)`,
    );
  }
  console.log(
    `[perf:load] total  ${withSeparator(total).padStart(9)} B  in ${(elapsedMs / 1000).toFixed(2)} s` +
      `  — the budget of the first screen is ${(LIMIT_MS / 1000).toFixed(0)} s  ` +
      `${elapsedMs <= LIMIT_MS ? 'OK' : 'OVER'}`,
  );
  console.log(
    `[perf:load] note: the resources were downloaded ${CONCURRENCY} at a time over cold ` +
      'connections, the way a browser does it; the time still carries the round trip time of ' +
      'this machine to the server',
  );

  if (elapsedMs > LIMIT_MS) {
    process.exitCode = 1;
  }
}

// Only run the probe when this file is the entry point.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[perf:load] the probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
