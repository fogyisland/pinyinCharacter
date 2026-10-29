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
 * THE SIZE CONTRACT
 * -----------------
 * The size the bytes on disk are checked against is the Content-Length
 * of the very response that carried them — NOT of a separate HEAD
 * probe. A HEAD probe only ever decides whether an already present
 * local file may be skipped; it never decides whether bytes that were
 * just downloaded are acceptable.
 *
 * That distinction is not academic. Two completely different situations
 * look identical when you only look at a HEAD probe:
 *   - the server answered but sent no Content-Length (size unknown), and
 *   - the server never answered at all (DNS / TLS / timeout / reset).
 * The second one is the dangerous one: it happens exactly when the
 * network is flaky, which is exactly when a truncated leftover from an
 * earlier interrupted run is most likely to be sitting on disk. Treating
 * it as "the server sent no Content-Length" would skip that leftover
 * and let an unverified font flow into the subsetter. So an unreachable
 * server is never allowed to authorise a skip, and the bytes of a
 * download are only accepted against the declaration of the response
 * that actually carried them.
 *
 * Run: npm run fonts:download-web
 */

import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
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
 * What a server told us about a file.
 *
 * `reachable` means "the server answered at all" — any HTTP status
 * counts, a 404 or a 405 included. Only a request that never completed
 * (DNS, TLS, timeout, reset) leaves it false.
 */
interface SizeProbe {
  /** The size the server declared, or null when it declared none. */
  size: number | null;
  /** True when the server answered at all. */
  reachable: boolean;
  /** True when the answer was a 2xx. */
  ok: boolean;
  /** The HTTP status of the answer, or null when there was no answer. */
  status: number | null;
}

/** Parse a Content-Length header into a usable size. */
function parseContentLength(raw: string | null): number | null {
  if (raw === null) return null;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 0) return null;
  return size;
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
    // ANY HTTP answer means the server is there. A 404 or a 405 is not an
    // unreachable server, it is a reachable server that says no. Only a
    // request that never completed counts as unreachable.
    if (!res.ok) {
      return { size: null, reachable: true, ok: false, status: res.status };
    }
    return {
      size: parseContentLength(res.headers.get('content-length')),
      reachable: true,
      ok: true,
      status: res.status,
    };
  } catch {
    // The request itself failed: DNS, TLS, timeout, reset. Nothing at all
    // was learned about the server — in particular we did NOT learn that
    // it serves the file without a Content-Length.
    return { size: null, reachable: false, ok: false, status: null };
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
  return { size: null, reachable: false, ok: false, status: null };
}

/**
 * The size of the file behind `url`, as the server reports it.
 *
 * Returns null when the server declared no size — or when it could not
 * be reached at all. The two cases are told apart by the probe, not by
 * this function's return value.
 */
export async function remoteSize(url: string): Promise<number | null> {
  const probe = await probeRemoteSize(url);
  return probe.size;
}

/** The outcome of one download attempt. */
interface AttemptResult {
  ok: boolean;
  /** How many bytes landed in the `.part` file. */
  bytes: number;
  /**
   * The Content-Length of the very response that carried the bytes.
   * null when the server declared no size.
   */
  expected: number | null;
  reason: string | null;
}

/**
 * Stream one URL into `dest + '.part'`.
 *
 * The bytes are counted on the way through, so the caller can compare
 * them with the size the response declared. The declaration is read
 * from THIS response, never from a separate probe: it is the only
 * declaration that is guaranteed to describe these bytes.
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
      return { ok: false, bytes: 0, expected: null, reason: `HTTP ${res.status} ${res.statusText}`.trim() };
    }
    if (!res.body) {
      return { ok: false, bytes: 0, expected: null, reason: 'the response carried no body' };
    }

    // The size contract comes from the response that carries the bytes.
    const expected = parseContentLength(res.headers.get('content-length'));

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
      rmSync(part, { force: true });
      return { ok: false, bytes: 0, expected, reason: 'the response body was empty' };
    }
    return { ok: true, bytes: written, expected, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A half written body is not a download. Remove it so the next
    // attempt starts from nothing.
    rmSync(part, { force: true });
    return { ok: false, bytes: 0, expected: null, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Promote `dest + '.part'` to `dest`, but only when it is complete.
 *
 * `expected` is the size the response that carried the bytes declared.
 * When it is known and the file on disk says something else, the
 * download is truncated: the `.part` is thrown away and the attempt
 * counts as a failure. When the size is unknown the bytes are accepted
 * — but the caller is told so, because "the server did not declare a
 * size" and "the server said a size that does not match" are two very
 * different stories.
 */
function promote(
  part: string,
  dest: string,
  expected: number | null,
): { ok: boolean; verified: boolean; reason: string | null } {
  const actual = fileSize(part);
  if (actual === 0) {
    rmSync(part, { force: true });
    return { ok: false, verified: false, reason: 'nothing was written' };
  }
  if (expected !== null && actual !== expected) {
    rmSync(part, { force: true });
    return {
      ok: false,
      verified: false,
      reason: `size mismatch: ${actual} bytes on disk, the server announced ${expected}`,
    };
  }
  renameSync(part, dest);
  return { ok: true, verified: expected !== null, reason: null };
}

/** The outcome of downloading one url. */
interface DownloadOutcome {
  ok: boolean;
  /** How many bytes are on disk under the destination. */
  bytes: number;
  /** The size the server declared on the response that carried the bytes. */
  expected: number | null;
  /** True when the byte count was checked against the declared size. */
  verified: boolean;
  reason: string | null;
}

/**
 * Download one url into `dest`, retrying it.
 *
 * This is the ONE place where bytes are allowed to land on disk. It
 * takes no size from a probe: the declaration of the response that
 * carries the bytes is the only contract it trusts.
 */
async function downloadUrl(url: string, dest: string, timeoutMs: number): Promise<DownloadOutcome> {
  let lastReason = 'no attempt was made';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_URL; attempt++) {
    const attemptResult = await fetchToPart(url, dest, timeoutMs);
    if (attemptResult.ok) {
      const promoted = promote(`${dest}.part`, dest, attemptResult.expected);
      if (promoted.ok) {
        if (!promoted.verified) {
          console.warn(
            `[download] WARN ${basename(dest)}: the server answered without a Content-Length, so the ` +
              `${attemptResult.bytes} bytes could not be checked`,
          );
        }
        return {
          ok: true,
          bytes: attemptResult.bytes,
          expected: attemptResult.expected,
          verified: promoted.verified,
          reason: null,
        };
      }
      lastReason = promoted.reason ?? 'unknown error';
    } else {
      lastReason = attemptResult.reason ?? 'unknown error';
    }
    if (attempt < MAX_ATTEMPTS_PER_URL) {
      await delay(RETRY_DELAY_MS);
    }
  }
  return { ok: false, bytes: 0, expected: null, verified: false, reason: lastReason };
}

/**
 * What to do with a local file that is already on disk.
 *
 * `verified`   — the server declared a size and the file matches it.
 * `unverified` — the server answered with a success status but declared
 *                no size, so the file cannot be checked. It may still be
 *                accepted, but only with a warning that says exactly
 *                that.
 * `download`   — the local file must not be accepted. `why` says why.
 */
type SkipDecision =
  | { kind: 'verified'; localSize: number; expected: number }
  | { kind: 'unverified'; localSize: number }
  | { kind: 'download'; localSize: number; why: string };

/**
 * Decide what to do with the local file, given what the server said.
 *
 * The invariant this function protects: a local file is only accepted
 * as a finished download when the server's own declaration matches it.
 * "The server declared no size" and "the server could not be reached"
 * both forbid the acceptance of a local file that cannot be checked —
 * but they are reported differently, because the operator has to fix
 * different things.
 */
function decideSkip(dest: string, probe: SizeProbe): SkipDecision {
  const localSize = fileSize(dest);
  if (localSize === 0) {
    return { kind: 'download', localSize, why: 'the file is not there yet' };
  }
  if (probe.ok && probe.size !== null) {
    if (localSize === probe.size) {
      return { kind: 'verified', localSize, expected: probe.size };
    }
    return {
      kind: 'download',
      localSize,
      why: `the local ${localSize} bytes != the remote ${probe.size} bytes (truncated leftover)`,
    };
  }
  if (probe.ok) {
    // The server answered with a success status but declared no size.
    return { kind: 'unverified', localSize };
  }
  if (probe.reachable) {
    return {
      kind: 'download',
      localSize,
      why: `the server answered HTTP ${probe.status ?? '?'}, which declares no size`,
    };
  }
  return {
    kind: 'download',
    localSize,
    why: 'every candidate url is unreachable — the server never answered',
  };
}

/**
 * Download `url` into `dest`.
 *
 * Returns true when the bytes are on disk under `dest` and their size
 * has been checked against the Content-Length of the response that
 * carried them. A failed attempt removes the `.part` file, so the next
 * attempt starts clean and a truncated file can never be mistaken for a
 * finished one.
 */
export async function downloadOnce(
  url: string,
  dest: string,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<boolean> {
  // The probe only decides whether the local file may be skipped. An
  // unreachable server never authorises a skip.
  const probe = await probeRemoteSize(url);
  const decision = decideSkip(dest, probe);
  if (decision.kind === 'verified') return true;
  if (decision.kind === 'unverified') {
    console.warn(
      `[download] WARN ${basename(dest)}: the server answered but sent no Content-Length, so the ` +
        `local ${decision.localSize} bytes cannot be verified — skipping`,
    );
    return true;
  }

  const outcome = await downloadUrl(url, dest, timeoutMs);
  return outcome.ok;
}

/**
 * Fetch one font source into the staging directory.
 *
 * The rules:
 *   - the local file matches the size the server declared => SKIP;
 *   - the local file exists but is a different size => it is a truncated
 *     leftover, so it is downloaded again (REDO);
 *   - the server answered but declared no size and a local file exists
 *     => SKIP, with a warning that says exactly that;
 *   - no server answered at all => the local file is NOT accepted; the
 *     download is attempted anyway (a GET may succeed where a HEAD was
 *     reset), and a failure says the server was unreachable.
 */
export async function downloadFont(
  entry: FontEntry,
  targetDir: string = STAGING_DIR,
): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number; expected?: number; reason?: string }> {
  const dest = resolve(targetDir, entry.filename);

  // Probe every candidate URL for its declared size. The probes are
  // sequential on purpose: parallel connections to raw.githubusercontent.com
  // are reset often enough to matter.
  const probes = new Map<string, SizeProbe>();
  for (const url of entry.urls) {
    probes.set(url, await probeRemoteSize(url));
  }

  // The aggregate of what the candidates told us: the declared size of
  // the first url that answered 2xx with a Content-Length, plus whether
  // anything answered at all.
  let expected: number | null = null;
  let anyAnswered = false;
  let anyOk = false;
  let answeredStatus: number | null = null;
  for (const url of entry.urls) {
    const probe = probes.get(url);
    if (!probe) continue;
    if (probe.reachable) anyAnswered = true;
    if (probe.ok) {
      anyOk = true;
      if (expected === null && probe.size !== null) expected = probe.size;
    } else if (probe.reachable && answeredStatus === null) {
      answeredStatus = probe.status;
    }
  }

  const aggregate: SizeProbe = {
    size: expected,
    reachable: anyAnswered,
    ok: anyOk,
    status: answeredStatus,
  };

  const decision = decideSkip(dest, aggregate);
  if (decision.kind === 'verified') {
    return { status: 'skip', size: decision.localSize, expected: decision.expected };
  }
  if (decision.kind === 'unverified') {
    console.warn(
      `[download] WARN ${entry.filename}: the server answered but sent no Content-Length, so the ` +
        `local ${decision.localSize} bytes cannot be verified — skipping`,
    );
    return { status: 'skip', size: decision.localSize };
  }
  if (decision.localSize > 0) {
    console.log(`[download] REDO ${entry.filename}: ${decision.why} — downloading again`);
  }

  let reason = 'no attempt was made';
  for (const url of entry.urls) {
    const outcome = await downloadUrl(url, dest, DOWNLOAD_TIMEOUT_MS);
    if (outcome.ok) {
      return { status: 'ok', size: outcome.bytes, expected: outcome.expected ?? undefined };
    }
    reason = outcome.reason ?? 'unknown error';
  }

  const unreachable = !anyAnswered;
  return {
    status: 'fail',
    expected: expected ?? undefined,
    reason: unreachable ? `unreachable: ${reason}` : reason,
  };
}

/** The remedy printed when files could not be fetched. */
function remedy(failed: number): string {
  return `[download] ${failed} file(s) failed — retry with:
    npm run fonts:download-web
If a download keeps stalling, fetch it by hand (the URLs are printed above)
and drop it into scripts/fonts/staging/web/ with the exact file name.`;
}

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
    console.error(remedy(failed));
    // Set the code and return instead of calling process.exit(): on
    // Windows a process.exit() right after a write to a pipe can drop the
    // text that is still sitting in the buffer.
    process.exitCode = 1;
    return;
  }
  console.log('[download] done — every source is present and its size matches the remote file');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('[download] unexpected error:', error);
    process.exitCode = 1;
  });
}
