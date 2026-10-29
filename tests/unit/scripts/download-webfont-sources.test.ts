import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { downloadFont, type FontEntry } from '../../../scripts/fonts/download-webfont-sources';

/**
 * These tests drive the real downloader against a local HTTP server.
 *
 * They never touch scripts/fonts/staging/web/ — every case points the
 * downloader at a fresh temporary directory, so the real staging area is
 * only ever written by the real pipeline.
 */

const openServers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    ),
  );
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Start a server on a free port of the loopback interface. */
async function startServer(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/** A port on the loopback interface that nobody listens on. */
async function findClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

/** A fresh temporary directory to download into. */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webfont-download-'));
  tempDirs.push(dir);
  return dir;
}

/** An entry that points at one url. */
function entryFor(filename: string, url: string): FontEntry {
  return { filename, label: filename, urls: [url] };
}

/** Collect everything the downloader prints. */
function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const collect = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  const logSpy = vi.spyOn(console, 'log').mockImplementation(collect);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(collect);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(collect);
  return {
    lines,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

describe('downloadFont', () => {
  it('re-downloads a truncated leftover instead of accepting it', async () => {
    const body = Buffer.from('the complete body of the file, every byte of it');
    const base = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(body.length) });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': String(body.length) });
      res.end(body);
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    // The leftover of an interrupted run: the right beginning, a truncated end.
    await writeFile(dest, body.subarray(0, 12));

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status).toBe('ok');
    expect(await readFile(dest)).toEqual(body);
    expect(existsSync(`${dest}.part`)).toBe(false);
  }, 30_000);

  it('does not skip a truncated file when the server refuses the HEAD probe', async () => {
    const body = Buffer.from('the complete body of the file, every byte of it');
    const base = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        // A server that refuses HEAD still serves the file. The refusal
        // must not be mistaken for "the server sent no Content-Length".
        res.writeHead(405).end();
        return;
      }
      res.writeHead(200, { 'Content-Length': String(body.length) });
      res.end(body);
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    await writeFile(dest, body.subarray(0, 12));

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status).toBe('ok');
    expect(await readFile(dest)).toEqual(body);
    expect(existsSync(`${dest}.part`)).toBe(false);
  }, 30_000);

  it('never accepts a local file when the server cannot be reached', async () => {
    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    const leftover = Buffer.from('a leftover from a previous, interrupted run');
    await writeFile(dest, leftover);

    const port = await findClosedPort();
    const capture = captureConsole();
    let result;
    try {
      result = await downloadFont(entryFor('sample.bin', `http://127.0.0.1:${port}/sample.bin`), dir);
    } finally {
      capture.restore();
    }

    // The local file must not be taken for a finished download.
    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/unreachable/i);
    // The reason has to name the cause, not just the conclusion: a bare
    // "fetch failed" leaves the operator with nothing to act on.
    expect(result.reason).toMatch(/ECONNREFUSED/i);
    expect(await readFile(dest)).toEqual(leftover);

    // The message has to name the real cause. "The server sent no
    // Content-Length" would be a lie: the server was never reached.
    const output = capture.lines.join('\n');
    expect(output).toMatch(/unreachable/i);
    expect(output).not.toMatch(/Content-Length/i);
  }, 60_000);

  it('refuses to promote a body whose length contradicts the declaration', async () => {
    // The server declares the length of the compressed payload but the
    // body it delivers is the decompressed one, so the declaration and
    // the bytes disagree.
    const raw = Buffer.from('the body of the response, longer once inflated');
    const compressed = gzipSync(raw);
    const base = await startServer((req, res) => {
      res.writeHead(200, {
        'Content-Length': String(compressed.length),
        'Content-Encoding': 'gzip',
      });
      res.end(req.method === 'HEAD' ? undefined : compressed);
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    const leftover = Buffer.from('stale');
    await writeFile(dest, leftover);

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/size mismatch/i);
    // The target file is untouched and the half written file is gone.
    expect(await readFile(dest)).toEqual(leftover);
    expect(existsSync(`${dest}.part`)).toBe(false);
  }, 30_000);

  it('leaves no .part file behind when the download dies halfway', async () => {
    const base = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': '100' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': '100' });
      res.write(Buffer.alloc(50));
      // Cut the connection: the body stops in the middle.
      setTimeout(() => res.socket?.destroy(), 20);
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    const leftover = Buffer.from('stale');
    await writeFile(dest, leftover);

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status).toBe('fail');
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(await readFile(dest)).toEqual(leftover);
  }, 30_000);

  it('removes a leftover .part even when the server answers with an error', async () => {
    const base = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': '100' });
        res.end();
        return;
      }
      // The GET fails. The `.part` of an earlier, crashed attempt must
      // not survive this attempt: the error path never opens the file,
      // so nothing else would truncate or remove it.
      res.writeHead(500, { 'Content-Length': '0' });
      res.end();
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    await writeFile(`${dest}.part`, Buffer.alloc(4096, 0x42));

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status).toBe('fail');
    expect(existsSync(`${dest}.part`)).toBe(false);
  }, 30_000);

  it('names every address it failed to reach when the host resolves to many', async () => {
    // `localhost` resolves to more than one address, and the font hosts
    // are like that too. undici tries each of them and folds the
    // failures into one AggregateError whose own `code` is only the
    // FIRST failure. The reason has to carry every address, otherwise
    // the operator sees the noise of the first attempt and never the
    // actionable one.
    const port = await findClosedPort();
    const dir = await makeTempDir();

    const result = await downloadFont(
      entryFor('sample.bin', `http://localhost:${port}/sample.bin`),
      dir,
    );

    expect(result.status).toBe('fail');
    expect(result.reason).toMatch(/unreachable/i);
    // The address that really refused the connection has to survive.
    expect(result.reason).toMatch(/ECONNREFUSED/);
    expect(result.reason).toMatch(/127\.0\.0\.1/);
  }, 60_000);

  it('takes the size contract from the response that carries the bytes', async () => {
    // The HEAD probe lies about the size: it announces 999 bytes for a
    // file that is 100 bytes long. The contract has to come from the
    // GET response — the one that actually carries the bytes — so the
    // download must succeed even though the probe disagreed.
    //
    // This is the test that pins the invariant the whole script is
    // about. Feed `promote()` the probed size instead (999) and the
    // bytes on disk (100) no longer match the declaration, the download
    // fails, and this test goes red.
    const body = Buffer.alloc(100, 0x41);
    const base = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': '999' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': '100' });
      res.end(body);
    });

    const dir = await makeTempDir();
    const dest = resolve(dir, 'sample.bin');
    // Nothing on disk: the file has to be fetched, so the contract is
    // the one of the response that carries the bytes.

    const result = await downloadFont(entryFor('sample.bin', `${base}/sample.bin`), dir);

    expect(result.status, `the download failed: ${result.reason ?? 'unknown error'}`).toBe('ok');
    expect(await readFile(dest)).toEqual(body);
    expect(existsSync(`${dest}.part`)).toBe(false);
  }, 30_000);
});
