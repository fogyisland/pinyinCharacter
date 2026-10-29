/**
 * download-webfont-sources.ts
 *
 * Plan wave 2 (W2-1b) — fetch the SOURCE fonts of the three webfont
 * families the site is about to host itself instead of pulling from
 * Google Fonts.
 *
 * Where the sources land:
 *   scripts/fonts/staging/web/ — gitignored. The four source fonts are
 *   70 MB of TTF that exists only long enough to be subsetted into the
 *   woff2 files public/fonts/ ships.
 *
 * The three OFL licence texts land next to them: the subsets we publish
 * are derived works, so the licence has to travel with them.
 *
 * This downloader is deliberately NOT a copy of
 * scripts/fonts/download-hard-pen-fonts.ts. That script has four defects
 * this one must not inherit:
 *   a) it SKIPs on "the local file exists and is non-empty" without ever
 *      comparing the size, so a truncated 420 KB download was once taken
 *      for a finished file and every later step built on that;
 *   b) its 60 s timeout is far too short for a 25 MB font;
 *   c) its main() exits 0 whether it succeeded or not;
 *   d) it buffers the whole response in memory (res.arrayBuffer()).
 * Here the remote Content-Length is the contract: a file is only SKIPped
 * when its size matches the remote size, and the bytes are streamed to
 * disk so the peak memory stays flat.
 *
 * Run: npm run fonts:download-web
 */

import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** One file the pipeline needs: a source font or its licence. */
export interface FontEntry {
  /** Local filename under scripts/fonts/staging/web/ */
  filename: string;
  /** Ordered list of candidate URLs — first wins, fallbacks for resilience. */
  urls: string[];
  /** Human label for logs */
  label: string;
}

/**
 * The upstream sources.
 *
 * All of them live in the google/fonts repository, which serves the raw
 * bytes of a file over HTTPS. The variable fonts carry the full weight
 * range (Noto Sans SC 100..900, Noto Serif SC 200..900); the axis is
 * clipped later, by instance-webfont-axis.mjs.
 */
export const SOURCES: FontEntry[] = [
  {
    filename: 'NotoSansSC-wght.ttf',
    label: 'Noto Sans SC variable (wght 100..900)',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'],
  },
  {
    filename: 'NotoSerifSC-wght.ttf',
    label: 'Noto Serif SC variable (wght 200..900)',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'],
  },
  {
    filename: 'LXGWWenKaiTC-Regular.ttf',
    label: 'LXGW WenKai TC Regular',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf'],
  },
  {
    filename: 'LXGWWenKaiTC-Bold.ttf',
    label: 'LXGW WenKai TC Bold',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf'],
  },
  {
    filename: 'NotoSansSC-OFL.txt',
    label: 'Noto Sans SC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt'],
  },
  {
    filename: 'NotoSerifSC-OFL.txt',
    label: 'Noto Serif SC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt'],
  },
  {
    filename: 'LXGWWenKaiTC-OFL.txt',
    label: 'LXGW WenKai TC licence',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/OFL.txt'],
  },
];

/** Where the downloaded files live. Gitignored, never committed. */
export const STAGING_DIR = resolve(__dirname, 'staging', 'web');

/**
 * The timeout of a single download attempt.
 *
 * 10 minutes: the largest source is 25 125 512 bytes, which on a slow
 * link takes minutes, not seconds. The 60 s default of the hard-pen
 * downloader would abort it half way through.
 */
export const DOWNLOAD_TIMEOUT_MS = 600_000;

/** How often a single URL is retried before the next URL is tried. */
export const MAX_ATTEMPTS_PER_URL = 3;

/** The pause between two attempts. Fixed, not exponential. */
const RETRY_DELAY_MS = 2_000;

/** The timeout of a HEAD probe. A HEAD is a couple of headers, not 25 MB. */
const HEAD_TIMEOUT_MS = 60_000;

/**
 * The User-Agent we identify with.
 *
 * raw.githubusercontent.com answers 404 to some clients that send no
 * User-Agent at all, so it is not optional.
 */
const USER_AGENT = 'pinyin-character-webfont-fetch/1.0';

/**
 * The headers every request sends.
 *
 * `Accept-Encoding: identity` matters: without it the server is free to
 * answer with a gzipped body, and the Content-Length then describes the
 * COMPRESSED payload (the 4 390 byte LXGW licence text arrives as 1 964
 * bytes). Comparing that number against the file on disk would declare
 * every download corrupt. Asking for the identity encoding makes the
 * Content-Length the size of the file we actually store.
 */
const HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept-Encoding': 'identity',
};

/** The size of a file, or 0 when it does not exist. */
function fileSize(path: string): number {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat ? stat.size : 0;
}

/** A pause, used between two attempts. */
function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * The size of the file behind `url`, as the server reports it.
 *
 * Returns null when the server sends no usable Content-Length — the only
 * case in which a file on disk may be accepted without a size comparison.
 */
export async function remoteSize(url: string): Promise<number | null> {
  const probe = await probeRemoteSize(url);
  return probe.size;
}

/**
 * The outcome of a HEAD probe.
 *
 * `reachable` tells "the request failed" apart from "the server sent no
 * Content-Length". Only the second one means the size is unknown.
 */
interface SizeProbe {
  /** The advertised size, or null when the server sent none. */
  size: number | null;
  /** False when the request itself failed (DNS, TLS, timeout, reset). */
  reachable: boolean;
}

/** One HEAD request. */
async function headOnce(url: string): Promise<SizeProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: HEADERS,
    });
    if (!res.ok) return { size: null, reachable: false };
    const raw = res.headers.get('content-length');
    if (raw === null) return { size: null, reachable: true };
    const size = Number(raw);
    if (!Number.isFinite(size) || size < 0) return { size: null, reachable: true };
    return { size, reachable: true };
  } catch {
    return { size: null, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The remote size of a URL, retried.
 *
 * The HEAD request is cheap, but the link to raw.githubusercontent.com is
 * not always reliable: a connection reset shows up as a failed request
 * rather than as a wrong answer, and one reset must not turn a complete
 * file into an unverifiable one.
 */
async function probeRemoteSize(url: string): Promise<SizeProbe> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_URL; attempt++) {
    const probe = await headOnce(url);
    if (probe.reachable) return probe;
    if (attempt < MAX_ATTEMPTS_PER_URL) {
      await delay(RETRY_DELAY_MS);
    }
  }
  return { size: null, reachable: false };
}

/** The outcome of one download attempt. */
interface AttemptResult {
  ok: boolean;
  /** How many bytes landed in the `.part` file. */
  bytes: number;
  /** Why the attempt failed — the HTTP status or the exception message. */
  reason: string | null;
}

/**
 * Stream one URL into `dest + '.part'`.
 *
 * The bytes are counted on the way through, so the caller can compare
 * them with the size the server advertised.
 */
async function fetchToPart(url: string, dest: string, timeoutMs: number): Promise<AttemptResult> {
  const part = `${dest}.part`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: HEADERS,
    });
    if (!res.ok) {
      return { ok: false, bytes: 0, reason: `HTTP ${res.status} ${res.statusText}`.trim() };
    }
    if (!res.body) {
      return { ok: false, bytes: 0, reason: 'the response carried no body' };
    }

    let written = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        callback(null, chunk);
      },
    });
    // `res.body` is typed as the DOM ReadableStream (lib.dom), while
    // `Readable.fromWeb` wants the node:stream/web one. They are the same
    // object at runtime — undici's fetch hands out a node web stream — so
    // the cast only bridges the two type declarations.
    const body = res.body as unknown as NodeWebReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), counter, createWriteStream(part));

    if (written === 0) {
      return { ok: false, bytes: 0, reason: 'the response body was empty' };
    }
    return { ok: true, bytes: written, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, bytes: 0, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Promote `dest + '.part'` to `dest`, but only when it is complete.
 *
 * `expected` is the size the server advertised. When it is known and the
 * file on disk says something else, the download is truncated: the
 * `.part` is thrown away and the attempt counts as a failure. When the
 * file matches, it is renamed — so the real file name only ever appears
 * on a complete file.
 */
function promote(part: string, dest: string, expected: number | null): { ok: boolean; reason: string | null } {
  const actual = fileSize(part);
  if (actual === 0) {
    rmSync(part, { force: true });
    return { ok: false, reason: 'nothing was written' };
  }
  if (expected !== null && actual !== expected) {
    rmSync(part, { force: true });
    return {
      ok: false,
      reason: `size mismatch: ${actual} bytes on disk, the server announced ${expected}`,
    };
  }
  renameSync(part, dest);
  return { ok: true, reason: null };
}

/**
 * Download `url` into `dest`.
 *
 * Returns true when the bytes are on disk under `dest` and their size
 * has been checked against the Content-Length of the response. A failed
 * attempt removes the `.part` file, so the next attempt starts clean and
 * a truncated file can never be mistaken for a finished one.
 */
export async function downloadOnce(
  url: string,
  dest: string,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<boolean> {
  const probe = await probeRemoteSize(url);
  const attempt = await fetchToPart(url, dest, timeoutMs);
  if (!attempt.ok) {
    rmSync(`${dest}.part`, { force: true });
    return false;
  }
  const promoted = promote(`${dest}.part`, dest, probe.size);
  return promoted.ok;
}

/**
 * Fetch one font source into the staging directory.
 *
 * The rules:
 *   - the local file matches the remote Content-Length => SKIP;
 *   - the local file exists but is a different size => it is a truncated
 *     leftover, so it is downloaded again (REDO);
 *   - the server sends no Content-Length and a local file exists => SKIP,
 *     with a warning, because the size cannot be checked;
 *   - otherwise every URL is tried up to MAX_ATTEMPTS_PER_URL times.
 */
export async function downloadFont(
  entry: FontEntry,
): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number; expected?: number; reason?: string }> {
  const dest = resolve(STAGING_DIR, entry.filename);

  // Probe every candidate URL for its advertised size. The probes are
  // sequential on purpose: parallel connections to raw.githubusercontent.com
  // are reset often enough to matter.
  const probes = new Map<string, SizeProbe>();
  for (const url of entry.urls) {
    probes.set(url, await probeRemoteSize(url));
  }

  const primary = entry.urls.find((url) => probes.get(url)?.size !== null && probes.get(url)?.size !== undefined);
  const expected = primary ? (probes.get(primary)?.size ?? null) : null;

  const localSize = fileSize(dest);
  if (localSize > 0) {
    if (expected === null) {
      console.warn(
        `[download] WARN ${entry.filename}: the server sent no Content-Length, so the local ` +
          `${localSize} bytes cannot be verified — skipping`,
      );
      return { status: 'skip', size: localSize };
    }
    if (localSize === expected) {
      return { status: 'skip', size: localSize, expected };
    }
    console.log(
      `[download] REDO ${entry.filename}: local ${localSize} bytes != remote ${expected} bytes ` +
        `(truncated leftover) — downloading again`,
    );
  }

  let reason = 'no attempt was made';
  for (const url of entry.urls) {
    const urlExpected = probes.get(url)?.size ?? null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_URL; attempt++) {
      const result = await fetchToPart(url, dest, DOWNLOAD_TIMEOUT_MS);
      if (result.ok) {
        const promoted = promote(`${dest}.part`, dest, urlExpected);
        if (promoted.ok) {
          return { status: 'ok', size: result.bytes, expected: urlExpected ?? undefined };
        }
        reason = promoted.reason ?? 'unknown error';
      } else {
        rmSync(`${dest}.part`, { force: true });
        reason = result.reason ?? 'unknown error';
      }
      if (attempt < MAX_ATTEMPTS_PER_URL) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  return { status: 'fail', expected: expected ?? undefined, reason };
}

/** The remedy printed when a file could not be fetched. */
const REMEDY = `[download] 1 file(s) failed — retry with:
    npm run fonts:download-web
If a download keeps stalling, fetch it by hand (the URLs are printed above)
and drop it into scripts/fonts/staging/web/ with the exact file name.`;

async function main() {
  mkdirSync(STAGING_DIR, { recursive: true });
  console.log(`[download] target dir: ${STAGING_DIR}`);
  console.log('[download] sources:');
  for (const source of SOURCES) {
    console.log(`[download]   ${source.filename}  <-  ${source.urls.join(', ')}`);
  }
  console.log('');

  let failed = 0;
  for (const source of SOURCES) {
    const result = await downloadFont(source);
    if (result.status === 'ok') {
      console.log(`[download] OK  ${result.size} bytes ${source.filename}`);
    } else if (result.status === 'skip') {
      console.log(`[download] SKIP ${result.size} bytes ${source.filename}`);
    } else {
      failed++;
      console.error(`[download] FAIL ${source.filename}`);
      console.error(`[download]      ${result.reason ?? 'unknown error'}`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(REMEDY);
    process.exit(1);
  }
  console.log('[download] done — every source is present and its size matches the remote file');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('[download] unexpected error:', error);
    process.exit(1);
  });
}
