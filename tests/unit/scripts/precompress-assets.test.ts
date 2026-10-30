import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  utimes,
  writeFile,
  stat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  COMPRESSIBLE_EXTENSIONS,
  isCompressible,
  precompressFile,
  precompressTree,
} from '../../../scripts/precompress-assets.mjs';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'precompress-assets.mjs');

/** The outcome of running the precompressor as a CLI. */
interface ScriptRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the precompressor as a CLI and report what it did, whatever it did.
 *
 * A non-zero exit makes `execFileAsync` reject, so the rejection is turned
 * back into a plain result: the exit code is exactly what the test is about.
 */
async function runScript(args: string[]): Promise<ScriptRun> {
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/**
 * Whether this host can create a file symbolic link at all.
 *
 * Windows needs Administrator or Developer Mode for a *file* symlink, so the
 * platform alone does not decide it. Probing once at module load keeps the
 * symlink case running wherever it can run, instead of switching it off on
 * every Windows host — including the ones that can do it.
 *
 * The probe uses the same call shape as the test it guards: a symlink whose
 * target exists, with no explicit type.
 */
function canCreateFileSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'precompress-symlink-probe-'));
  try {
    const target = join(dir, 'target.js');
    writeFileSync(target, 'probe');
    symlinkSync(target, join(dir, 'link.js'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The symlink case runs wherever a file symlink can actually be made. */
const symlinkSupported = canCreateFileSymlink();

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('isCompressible', () => {
  it('accepts text payloads', () => {
    for (const file of ['a.js', 'a.css', 'a.json', 'a.svg', 'a.html', 'a.txt']) {
      expect(isCompressible(file)).toBe(true);
    }
  });

  it('rejects already-compressed payloads', () => {
    for (const file of ['a.woff2', 'a.png', 'a.jpg', 'a.webp', 'a.mp3', 'a.gz', 'a.br']) {
      expect(isCompressible(file)).toBe(false);
    }
  });

  it('rejects extensions that are on neither list', () => {
    for (const file of ['a.xyz', 'a.bin', 'a.exe']) {
      expect(isCompressible(file)).toBe(false);
    }
  });

  it('accepts every extension of the compressible list', () => {
    for (const extension of COMPRESSIBLE_EXTENSIONS) {
      expect(isCompressible(`a${extension}`)).toBe(true);
    }
  });
});

describe('precompressFile', () => {
  it('writes a .br next to the source and shrinks it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    const source = 'console.log("x");'.repeat(500);
    await writeFile(file, source);
    const result = await precompressFile(file);
    expect(result.status).toBe('written');
    expect(result.bytesOut).toBeLessThan(result.bytesIn);
    const br = await readFile(`${file}.br`);
    expect(br.length).toBe(result.bytesOut);
    expect(brotliDecompressSync(br).toString('utf8')).toBe(source);
  });

  it('writes a .gz next to the source that decodes back to it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    const source = 'console.log("gz");'.repeat(500);
    await writeFile(file, source);
    const result = await precompressFile(file);
    expect(result.status).toBe('written');
    const gz = await readFile(`${file}.gz`);
    expect(gz.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(gunzipSync(gz).toString('utf8')).toBe(source);
  });

  it('skips a file whose .br is newer than the source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("x");'.repeat(500));
    await precompressFile(file);
    const second = await precompressFile(file);
    expect(second.status).toBe('skipped');
  });

  it('refuses to touch an already-compressed file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'font.woff2');
    await writeFile(file, 'not really a font');
    const result = await precompressFile(file);
    expect(result.status).toBe('skipped');
    await expect(stat(`${file}.br`)).rejects.toThrow();
  });

  it('reports a missing source as failed instead of skipped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'there-is-no-such-file.js');
    const result = await precompressFile(file);
    expect(result.status).toBe('failed');
  });

  it('rewrites a pair whose .gz sidecar is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("half");'.repeat(500));
    // A half-written run: the `.br` landed, the `.gz` did not. The stale
    // `.br` is newer than the source, so a run that only looks at the `.br`
    // would call this done and never repair the missing `.gz`.
    await writeFile(`${file}.br`, 'a brotli stream that is not one');
    const newer = new Date(Date.now() + 2000);
    await utimes(`${file}.br`, newer, newer);
    const result = await precompressFile(file);
    expect(result.status).toBe('written');
    expect(existsSync(`${file}.gz`)).toBe(true);
  });
});

describe('precompressTree', () => {
  it('walks a directory tree and reports the totals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    await writeFile(join(dir, 'a.css'), 'body{color:red}'.repeat(200));
    await writeFile(join(dir, 'b.woff2'), 'binary');
    const result = await precompressTree(dir);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.savedBytes).toBeGreaterThan(0);
  });

  it.skipIf(!symlinkSupported)(
    'counts a symbolic link as skipped and never follows it',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
      dirs.push(dir);
      const targetDir = join(dir, 'target');
      const linkDir = join(dir, 'links');
      await mkdir(targetDir);
      await mkdir(linkDir);
      const target = join(targetDir, 'real.js');
      await writeFile(target, 'console.log("link");'.repeat(500));
      await symlink(target, join(linkDir, 'link.js'));
      const result = await precompressTree(linkDir);
      expect(result.skipped).toBe(1);
      expect(existsSync(`${target}.br`)).toBe(false);
      expect(existsSync(`${target}.gz`)).toBe(false);
    },
  );
});

describe('precompress-assets CLI', () => {
  it('exits with 1 and names the option it does not know', async () => {
    const run = await runScript(['--bogus']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('unknown option');
  });

  it('exits with 0 and reports a directory that does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const missing = join(dir, 'there-is-no-such-directory');
    const run = await runScript([missing]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('does not exist');
  });
});
