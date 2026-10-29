import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
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
const PAGE_HTML = '<html><body><h1 class="font-kai">楷</h1><p>汉</p></body></html>';

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
      expect(pages['/'].wenkai).toBe('楷');
      expect(pages['/'].sans).toBe('汉');
    },
    30_000,
  );
});
