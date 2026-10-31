import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'capture-page-font-profiles.mjs');
const FIXTURE = join(REPO_ROOT, 'data', 'font-page-profiles.json');

/** The four pages the capture needs. */
const PAGE_FILES = ['home', 'dictionary', 'poetry', 'stories'];

/** A page with one character of the brand face and one of the body face. */
const PAGE_HTML =
  '<html><body><h1 class="font-kai">楷 Ā</h1><p>汉 á</p></body></html>';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

/** A directory with the four local captures of the pages. */
function makeLocalPages(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pinyin-capture-'));
  tempDirs.push(dir);
  for (const page of PAGE_FILES) {
    writeFileSync(join(dir, `${page}.html`), PAGE_HTML, 'utf8');
  }
  return dir;
}

/**
 * Run the collector over a local capture and return what it wrote.
 *
 * The collector is a CLI, so it is run as one: the test says what the
 * command line says and reads the JSON it wrote.
 */
async function capture(
  dir: string,
  args: string[] = [],
): Promise<Record<string, unknown>> {
  const out = join(dir, 'profile.json');
  await execFileAsync(
    process.execPath,
    [SCRIPT, '--html-dir', dir, ...args, '--out', out],
    { cwd: REPO_ROOT },
  );
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
}

describe('capture-page-font-profiles', () => {
  it(
    'does not claim the production site when it read local files',
    async () => {
      // The fixture cannot be read: the characters come from the local
      // directory, so the capture must say so. Claiming the production site
      // would be a lie that travels into the fixture (G12).
      const dir = makeLocalPages();
      const profile = await capture(dir, [
        '--fixture',
        join(dir, 'there-is-no-fixture.json'),
      ]);
      expect(profile.source).not.toBe('https://ziyun.pudafo.com');
      expect(profile.source).toBe(`local:${dir}`);
    },
    30_000,
  );

  it(
    'keeps the metadata of the committed fixture when it can read it',
    async () => {
      // A replay reproduces the capture of the fixture, byte for byte, so it
      // inherits its metadata.
      const dir = makeLocalPages();
      const profile = await capture(dir);
      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
      expect(profile.source).toBe(fixture.source);
      expect(profile.capturedAt).toBe(fixture.capturedAt);
    },
    30_000,
  );

  it(
    'says what --source says',
    async () => {
      const dir = makeLocalPages();
      const profile = await capture(dir, ['--source', 'local:by hand']);
      expect(profile.source).toBe('local:by hand');
    },
    30_000,
  );

  it(
    'attributes the characters of the local pages to their face',
    async () => {
      const dir = makeLocalPages();
      const profile = await capture(dir);
      const pages = profile.pages as Record<string, Record<string, string>>;
      expect(Object.keys(pages)).toEqual(['/', '/dictionary', '/poetry', '/stories']);
      // The Chinese part is FIRST and the Latin part comes after it: the
      // Chinese part of the committed fixture is the prefix it has always
      // been, so a Latin capture can never rewrite the Chinese subsets.
      // ⚠️ The SPACE is a Latin character (U+0020 is the first code point of
      // the ASCII printable range), so it leads the Latin run.
      expect(pages['/'].wenkai).toBe('楷 Ā');
      expect(pages['/'].sans).toBe('汉 á');
      expect(pages['/'].serif).toBe('');
    },
    30_000,
  );

  it(
    'says when the Latin characters were captured and where they came from',
    async () => {
      // The Latin part is a capture of its own: it must not claim the date
      // and the origin of the Chinese part.
      const dir = makeLocalPages();
      const profile = await capture(dir, ['--latin-captured-at', '2026-10-31']);
      expect(profile.latinCapturedAt).toBe('2026-10-31');
      expect(typeof profile.latinSource).toBe('string');
    },
    30_000,
  );

  it(
    'unites the rounds of a capture',
    async () => {
      // The live pages are not deterministic: two requests for /stories
      // answer with two different bodies. One round samples the page, so
      // the capture can be asked for several rounds and unite them.
      const dir = makeLocalPages();
      const profile = await capture(dir, ['--union', '3']);
      const pages = profile.pages as Record<string, Record<string, string>>;
      expect(pages['/'].wenkai).toBe('楷 Ā');
    },
    30_000,
  );

  it(
    'refuses a number of rounds that is not a positive integer',
    async () => {
      const dir = makeLocalPages();
      await expect(capture(dir, ['--union', '0'])).rejects.toThrow();
    },
    30_000,
  );

  it(
    'fails loudly when the site answers with the initialization gate',
    async () => {
      // Without the cookie the site answers with a 307 to /init and a body of
      // FIVE bytes. A capture that does not notice records the charset of the
      // gate and seeds the hot tier with it — so the capture must fail, and
      // the message must say what the response really was.
      const server = createServer((_request, response) => {
        response.writeHead(307, {
          location: '/init',
          'content-type': 'text/html; charset=utf-8',
        });
        response.end('/init');
      });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        throw new Error('the test server did not get a port');
      }
      const dir = mkdtempSync(join(tmpdir(), 'pinyin-capture-gate-'));
      tempDirs.push(dir);
      const out = join(dir, 'profile.json');
      try {
        await expect(
          execFileAsync(
            process.execPath,
            [SCRIPT, '--base', `http://127.0.0.1:${address.port}`, '--out', out],
            { cwd: REPO_ROOT },
          ),
        ).rejects.toThrow(/307/);
      } finally {
        server.close();
      }
    },
    30_000,
  );
});
