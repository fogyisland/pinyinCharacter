import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import { SOURCES } from '@/scripts/fonts/download-webfont-sources';
import {
  probeCapability,
  resolveArgv,
  type CapabilityReport,
} from '@/lib/webfont/capability';

/**
 * The capability probe of the admin font pipeline (design §3.4).
 *
 * The probe is the gate in front of the "开始构建" button: it answers
 * "does this machine have everything the pipeline needs?" and, when the
 * answer is no, it says what is missing AND what to do about it.
 *
 * Three properties are worth more here than anywhere else in the feature:
 *
 *  1. **A missing capability is never a green light.** A server without
 *     Python, or without the three build-toolchain packages, must report
 *     `ok: false` and name the remedy. A probe that answered "everything
 *     is fine" on a machine that cannot build fonts is worse than no
 *     probe at all (the G-12 fake green).
 *  2. **The probe measures the thing the pipeline writes.** The disk row
 *     probes the FONT ROOT — the directory the subsetter writes into —
 *     and never an ancestor of it. A writable parent says nothing about
 *     the directory itself, and the two are not even on the same volume
 *     when the font root is a mount.
 *  3. **The probe reports, it never crashes.** Every probe is an
 *     interaction with the outside world (a subprocess, a file write, an
 *     HTTP HEAD). One that throws instead of reporting would show the
 *     administrator an error page instead of the list of what is missing.
 *     ⇒ Every external interaction is injected here, and **no test in
 *     this file reaches the network**: `fetchImpl` is always a fake.
 */

/**
 * The filesystem is mocked so that a FAILING filesystem can be simulated:
 * a delete that does not work and a stat that throws are two paths that
 * no test can reach with a real disk, and they are exactly the paths
 * that used to escape the probe and turn the admin page into a 500.
 *
 * The mock delegates to the real module; only the three calls below can
 * be made to fail, and only while the matching flag is set.
 */
const fsFaults = vi.hoisted(() => ({
  statThrows: false,
  writeThrows: false,
  deleteThrows: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fault = (code: string, what: string) =>
    Object.assign(new Error(`${code}: ${what}`), { code });
  return {
    ...actual,
    statSync: ((...args: unknown[]) => {
      if (fsFaults.statThrows) throw fault('EACCES', 'permission denied, stat');
      return (actual.statSync as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof actual.statSync,
    writeFileSync: ((...args: unknown[]) => {
      if (fsFaults.writeThrows) throw fault('EACCES', 'permission denied, open');
      return (actual.writeFileSync as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof actual.writeFileSync,
    rmSync: ((...args: unknown[]) => {
      if (fsFaults.deleteThrows) throw fault('EPERM', 'operation not permitted, unlink');
      return (actual.rmSync as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof actual.rmSync,
  };
});

type FakeOutcome = { code: number; stdout?: string; stderr?: string };

/** What each command the probe runs answers with. */
interface CommandScript {
  python?: () => FakeOutcome | Error;
  fontTools?: () => FakeOutcome | Error;
  fontToolsVersion?: () => FakeOutcome | Error;
  tsx?: () => FakeOutcome | Error;
}

interface FakeRunner {
  run: (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  calls: { bin: string; args: string[] }[];
}

/** The answers a machine with everything installed gives. */
const HEALTHY: Required<CommandScript> = {
  python: () => ({ code: 0, stdout: 'Python 3.12.1\n' }),
  fontTools: () => ({ code: 0, stdout: 'usage: fonttools varLib.instancer\n' }),
  fontToolsVersion: () => ({ code: 0, stdout: '4.61.1\n' }),
  tsx: () => ({ code: 0, stdout: '4.19.2\n' }),
};

/**
 * A stand-in for `execFile`.
 *
 * The command is recognised by what it is, not by the order the probe
 * happens to run things in: the fontTools probe asks for
 * `fontTools.varLib.instancer`, the version query asks for `-c`, `tsx`
 * asks for its own version, and everything else is `python --version`.
 */
function createRunner(script: CommandScript = {}): FakeRunner {
  const calls: { bin: string; args: string[] }[] = [];
  const merged = { ...HEALTHY, ...script };
  const run = async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    const pick = args.includes('fontTools.varLib.instancer')
      ? merged.fontTools
      : args.includes('-c')
        ? merged.fontToolsVersion
        : bin === 'tsx'
          ? merged.tsx
          : merged.python;
    const outcome = pick();
    if (outcome instanceof Error) throw outcome;
    return { code: outcome.code, stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' };
  };
  return { run, calls };
}

/** The error Node reports when the binary is not installed at all. */
function enoent(bin: string): Error {
  const error = new Error(`spawn ${bin} ENOENT`);
  (error as NodeJS.ErrnoException).code = 'ENOENT';
  return error;
}

interface FakeFetch {
  fetchImpl: typeof fetch;
  calls: { url: string; method: string | undefined }[];
}

/**
 * A stand-in for `fetch`.
 *
 * It never touches the network: it records the call and answers with an
 * empty 200 unless the test says otherwise.
 */
function createFetch(
  behaviour?: (url: string) => Promise<Response> | Response,
): FakeFetch {
  const calls: { url: string; method: string | undefined }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (behaviour) return behaviour(url);
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A `resolveModule` that finds everything. */
const everythingResolvable = () => '/somewhere/node_modules/pkg/index.js';

let stagingDir: string;
let fontDir: string;

beforeEach(() => {
  fsFaults.statThrows = false;
  fsFaults.writeThrows = false;
  fsFaults.deleteThrows = false;
  stagingDir = mkdtempSync(join(tmpdir(), 'webfont-capability-'));
  fontDir = mkdtempSync(join(tmpdir(), 'webfont-fontdir-'));
});

afterEach(() => {
  // The faults are cleared FIRST: the cleanup below deletes a directory,
  // and a mocked `rmSync` would throw.
  fsFaults.statThrows = false;
  fsFaults.writeThrows = false;
  fsFaults.deleteThrows = false;
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(fontDir, { recursive: true, force: true });
});

describe('probeCapability — a machine that has everything', () => {
  it('reports ok and an empty missing list', async () => {
    const runner = createRunner();
    const { fetchImpl } = createFetch();

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.python.available).toBe(true);
    expect(report.python.version).toBe('3.12.1');
    expect(report.fonttools.available).toBe(true);
    expect(report.fonttools.version).toBe('4.61.1');
    expect(report.network.available).toBe(true);
    expect(report.disk.available).toBe(true);
    expect(report.toolchain).toEqual({ subsetFont: true, typescript: true, tsx: true });
  });

  it('names the node version it runs on', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });
    expect(report.node).toBe(process.version);
  });

  it('asks python for its version and fontTools for the instancer help', async () => {
    const runner = createRunner();
    await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(runner.calls.some((c) => c.args[0] === '--version')).toBe(true);
    expect(
      runner.calls.some(
        (c) => c.args[0] === '-I' && c.args.includes('fontTools.varLib.instancer'),
      ),
    ).toBe(true);
  });

  it('honours the PYTHON override, the same name the pipeline uses', async () => {
    vi.stubEnv('PYTHON', '/opt/python/bin/python3');
    try {
      const runner = createRunner();
      await probeCapability({
        stagingDir,
        fontDir,
        runCommand: runner.run,
        fetchImpl: createFetch().fetchImpl,
        resolveModule: everythingResolvable,
      });
      expect(runner.calls[0].bin).toBe('/opt/python/bin/python3');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('probeCapability — python', () => {
  it('reports "not installed" when the interpreter does not exist', async () => {
    const runner = createRunner({ python: () => enoent('python') });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.python.available).toBe(false);
    expect(report.python.version).toBeNull();
    expect(report.python.error).toContain('ENOENT');
    // The missing list must say what is missing AND what to do about it.
    const entry = report.missing.find((m) => m.includes('Python'));
    expect(entry).toBeDefined();
    expect(entry).toContain('PYTHON');
  });

  it('tells "installed but broken" apart from "not installed"', async () => {
    const runner = createRunner({
      python: () => ({ code: 2, stderr: 'cannot load shared object' }),
    });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.python.available).toBe(false);
    // Not the "找不到" wording — this interpreter IS installed.
    const entry = report.missing.find((m) => m.includes('Python'));
    expect(entry).toBeDefined();
    expect(entry).not.toContain('找不到 Python');
    expect(entry).toContain('2');
  });
});

describe('probeCapability — fontTools', () => {
  it('reports the remedy when the instancer cannot be run', async () => {
    const runner = createRunner({
      fontTools: () => ({ code: 1, stderr: 'No module named fontTools' }),
    });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.fonttools.available).toBe(false);
    expect(report.fonttools.remedy).toContain('pip install fonttools');
    expect(report.missing.some((m) => m.includes('fontTools'))).toBe(true);
  });

  it('still names fontTools when python itself is missing', async () => {
    // The fontTools probe RUNS python, so a machine without python fails
    // that probe as well — exactly as it does in reality.
    const runner = createRunner({
      python: () => enoent('python'),
      fontTools: () => enoent('python'),
      fontToolsVersion: () => enoent('python'),
    });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    // fontTools really is missing — it cannot even be looked for without
    // python — so the list names it. The remedy is the one that stays
    // true on a machine without python: it says what to do AFTER python
    // is installed.
    expect(report.missing.some((m) => m.includes('Python'))).toBe(true);
    expect(report.missing.some((m) => m.includes('fontTools'))).toBe(true);
    expect(report.fonttools.remedy).toContain('fontTools');
    expect(report.fonttools.remedy).toContain('pip install fonttools');
  });
});

describe('probeCapability — the upstream', () => {
  it('reports the network as unavailable when the request fails', async () => {
    const { fetchImpl } = createFetch(() => {
      throw new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
    });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.network.available).toBe(false);
    expect(report.network.error).toContain('ENOTFOUND');
    expect(report.missing.some((m) => m.includes('raw.githubusercontent.com'))).toBe(true);
  });

  it('sends a HEAD to the first source url — never a GET, never a download', async () => {
    const { fetchImpl, calls } = createFetch();
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('HEAD');
    // The url comes from SOURCES, it is not hardcoded anywhere.
    expect(calls[0].url).toBe(SOURCES[0].urls[0]);
    expect(report.network.checkedUrl).toBe(SOURCES[0].urls[0]);
  });
});

describe('probeCapability — the disk', () => {
  it('probes the font root — the directory the pipeline writes into', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    // The report names the path that was really probed.
    expect(report.disk.fontDir).toBe(fontDir);
    // The staging dir is NOT what the disk row measures.
    expect(report.disk.fontDir).not.toBe(stagingDir);
    // No junk is left behind.
    expect(readdirSync(fontDir)).toEqual([]);
  });

  it('never falls back to an ancestor directory', async () => {
    // The font root does not exist, but its parent does and is writable.
    // Probing the parent would answer "the disk is fine" for a
    // directory the pipeline cannot write — and the two are not even on
    // the same volume when the font root is a mount.
    const report = await probeCapability({
      stagingDir,
      fontDir: join(fontDir, 'missing', 'font'),
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.fontDir).toBe(join(fontDir, 'missing', 'font'));
    // Nothing was written into the parent either.
    expect(readdirSync(fontDir)).toEqual([]);
  });

  it('does not remove a file that was already there', async () => {
    // The probe file has a unique name: a fixed one would be deleted by
    // the next probe (rmSync with force removes a file that is already
    // there) and two administrators refreshing at the same time would
    // tread on each other.
    const existing = join(fontDir, '.probe');
    writeFileSync(existing, 'not mine');

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    expect(readdirSync(fontDir)).toEqual(['.probe']);
  });

  it('reports the disk as unusable when the probe file cannot be written', async () => {
    const report = await probeCapability({
      stagingDir,
      // A path whose parent is a FILE, not a directory.
      fontDir: join(fontDir, 'blocker', 'font'),
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.error).toBeTruthy();
    expect(report.missing.some((m) => m.includes('字体根目录不可写'))).toBe(true);
  });

  it('honours WEBFONT_FONT_DIR — the same variable the subsetter reads', async () => {
    vi.stubEnv('WEBFONT_FONT_DIR', join(fontDir, 'override'));
    try {
      const report = await probeCapability({
        stagingDir,
        runCommand: createRunner().run,
        fetchImpl: createFetch().fetchImpl,
        resolveModule: everythingResolvable,
      });
      expect(report.disk.fontDir).toBe(join(fontDir, 'override'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('probeCapability — the disk (two places, two methods)', () => {
  it('never writes into the font root — the production directory', async () => {
    // `public/` is served to the world: a probe file that could not be
    // deleted would go live with the next release. So the font root is
    // CHECKED, never written to.
    writeFileSync(join(fontDir, 'fonts-sans.css'), '/* live */');
    const before = readdirSync(fontDir);

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    // Not one file more than there was.
    expect(readdirSync(fontDir)).toEqual(before);
    expect(readdirSync(fontDir)).toEqual(['fonts-sans.css']);
  });

  it('creates the staging directory when it is not there yet', async () => {
    // On a fresh production server the staging directory is not part of
    // the deploy bundle, so it does not exist. The probe creates it.
    const fresh = join(fontDir, 'not', 'there', 'yet');
    expect(existsSync(fresh)).toBe(false);

    const report = await probeCapability({
      stagingDir: fresh,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    // The directory is there …
    expect(existsSync(fresh)).toBe(true);
    expect(report.disk.stagingDir).toBe(fresh);
    // … and the probe file is gone: only the FILE was deleted, the
    // directory stays.
    expect(readdirSync(fresh)).toEqual([]);
  });

  it('leaves a file that was already in the staging directory alone', async () => {
    // The probe file has a unique name: a fixed one would be deleted by
    // the next probe (rmSync with force removes a file that is already
    // there) and two administrators refreshing at the same time would
    // tread on each other.
    const existing = join(stagingDir, '.probe');
    writeFileSync(existing, 'not mine');

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    expect(readdirSync(stagingDir)).toEqual(['.probe']);
  });

  it('says the disk is unusable when the staging directory cannot be written', async () => {
    // The staging path is a FILE, so it can never be a directory.
    const blocked = join(fontDir, 'blocked');
    writeFileSync(blocked, 'not a directory');

    const report = await probeCapability({
      stagingDir: blocked,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.error).toBeTruthy();
    expect(report.missing.some((m) => m.includes('staging 目录不可写'))).toBe(true);
  });

  it('says the disk is unusable when the font root cannot be written to', async () => {
    const report = await probeCapability({
      stagingDir,
      // The font root does not exist: the pipeline could not write the
      // 70 MB of subsets into it either.
      fontDir: join(fontDir, 'missing', 'font'),
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.missing.some((m) => m.includes('字体根目录不可写'))).toBe(true);
    // The staging directory is fine, and that does NOT make the disk
    // usable: the font root is often another volume.
    expect(report.disk.stagingDir).toBe(stagingDir);
  });
});

describe('probeCapability — a filesystem that fails', () => {
  it('still returns a report when the filesystem probe throws', async () => {
    fsFaults.writeThrows = true;
    fsFaults.statThrows = true;

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    // The exception stayed inside the probe: the administrator gets the
    // report, not a 500 with "server error" on it.
    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.error).toContain('EACCES');
    // The sources row did not throw either.
    expect(report.sources.every((s) => s.present === false)).toBe(true);
  });

  it('reports the disk as unusable when the probe file cannot be deleted', async () => {
    fsFaults.deleteThrows = true;

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.error).toContain('EPERM');
  });

  it('survives a path the filesystem refuses outright', async () => {
    const report = await probeCapability({
      stagingDir: '\0invalid',
      fontDir: '\0invalid',
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
  });
});

describe('probeCapability — the build toolchain', () => {
  it('fails the probe when subset-font cannot be resolved', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: (specifier) =>
        specifier === 'subset-font' ? null : '/somewhere/node_modules/pkg/index.js',
    });

    expect(report.ok).toBe(false);
    expect(report.toolchain.subsetFont).toBe(false);
    expect(report.toolchain.typescript).toBe(true);
    expect(report.toolchain.tsx).toBe(true);
    // The remedy must install into `dependencies` — a bare `npm install`
    // or `npm install --omit=dev` would leave the server just as it was.
    const entry = report.missing.find((m) => m.includes('--save'));
    expect(entry).toBeDefined();
    expect(entry).toContain('subset-font');
    expect(entry).toContain('typescript');
    expect(entry).toContain('tsx');
  });

  it('keeps markdown out of the user-facing remedy', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: () => null,
    });

    const entry = report.missing.find((m) => m.includes('--save'));
    expect(entry).toBeDefined();
    // The admin page does not render markdown: no `**`, no backticks.
    expect(entry).not.toContain('**');
    expect(entry).not.toContain('`');
  });

  it('fails the probe when typescript cannot be resolved', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: (specifier) =>
        specifier === 'typescript' ? null : '/somewhere/node_modules/pkg/index.js',
    });

    expect(report.ok).toBe(false);
    expect(report.toolchain.typescript).toBe(false);
    expect(report.missing.some((m) => m.includes('--save'))).toBe(true);
  });

  it('fails the probe when the tsx executable cannot be run', async () => {
    const runner = createRunner({ tsx: () => ({ code: 1, stderr: 'not found' }) });
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.toolchain.tsx).toBe(false);
    expect(report.missing.some((m) => m.includes('--save'))).toBe(true);
  });
});

describe('probeCapability — the source fonts on disk', () => {
  it('reports what is there and what is not, without downloading anything', async () => {
    const first = SOURCES[0];
    writeFileSync(join(stagingDir, first.filename), 'twelve bytes');

    const { fetchImpl, calls } = createFetch();
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: createRunner().run,
      fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.sources).toHaveLength(SOURCES.length);
    const present = report.sources.find((s) => s.filename === first.filename);
    expect(present?.present).toBe(true);
    expect(present?.size).toBe(12);
    expect(present?.label).toBe(first.label);

    const absent = report.sources.find((s) => s.filename !== first.filename);
    expect(absent?.present).toBe(false);
    expect(absent?.size).toBeNull();

    // Reading the directory is not a download.
    expect(calls.every((c) => c.method === 'HEAD')).toBe(true);
  });
});

describe('probeCapability — it reports, it never crashes', () => {
  it('survives every external interaction failing at once', async () => {
    const runner = createRunner({
      python: () => enoent('python'),
      fontTools: () => enoent('python'),
      fontToolsVersion: () => enoent('python'),
      tsx: () => enoent('tsx'),
    });
    const { fetchImpl } = createFetch(() => {
      throw new Error('network down');
    });

    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: runner.run,
      fetchImpl,
      resolveModule: () => {
        throw new Error('the resolver exploded');
      },
    });

    // No throw — the administrator gets a report, not an error page.
    expect(report.ok).toBe(false);
    expect(report.python.available).toBe(false);
    expect(report.fonttools.available).toBe(false);
    expect(report.network.available).toBe(false);
    expect(report.toolchain).toEqual({ subsetFont: false, typescript: false, tsx: false });
    expect(report.missing.length).toBeGreaterThan(0);
  });

  it('keeps the report shape even when everything failed', async () => {
    const report = await probeCapability({
      stagingDir,
      fontDir,
      runCommand: () => {
        throw new Error('boom');
      },
      fetchImpl: createFetch(() => {
        throw new Error('boom');
      }).fetchImpl,
      resolveModule: () => null,
    });

    const keys = Object.keys(report).sort();
    expect(keys).toEqual(
      [
        'disk',
        'fonttools',
        'missing',
        'network',
        'node',
        'ok',
        'python',
        'sources',
        'toolchain',
      ].sort(),
    );
  });
});

describe('resolveArgv — how a bare command is started', () => {
  let fakeRoot: string;
  let entry: string;

  beforeEach(() => {
    fakeRoot = mkdtempSync(join(tmpdir(), 'webfont-bin-'));
    mkdirSync(join(fakeRoot, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(fakeRoot, 'node_modules', 'faketool'), { recursive: true });
    // The shims npm writes on Windows. A `.cmd` file is NOT executable by
    // node without a shell (`spawn EINVAL`), and the extensionless twin
    // is a shell script (`ENOEXEC`).
    writeFileSync(join(fakeRoot, 'node_modules', '.bin', 'faketool.cmd'), '@echo off\r\nexit /b 1\r\n');
    writeFileSync(join(fakeRoot, 'node_modules', '.bin', 'faketool'), '#!/bin/sh\nexit 1\n');
    // The package behind them — this is what the shim actually runs.
    entry = join(fakeRoot, 'node_modules', 'faketool', 'cli.js');
    writeFileSync(entry, '// the real entry point\n');
    writeFileSync(
      join(fakeRoot, 'node_modules', 'faketool', 'package.json'),
      JSON.stringify({ name: 'faketool', version: '1.0.0', bin: { faketool: './cli.js' } }),
    );
  });

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('starts the package entry with node — never the .cmd shim, never a shell', () => {
    const argv = resolveArgv('faketool', ['--version'], fakeRoot);

    if (process.platform === 'win32') {
      // The .cmd shim cannot be executed without a shell, so the package's
      // own entry point is run with node — exactly what the shim does.
      expect(argv).toEqual([process.execPath, entry, '--version']);
    } else {
      expect(argv).toEqual([join(fakeRoot, 'node_modules', '.bin', 'faketool'), '--version']);
    }

    // The shape is the contract: no shell, no file that cannot run.
    expect(argv[0]).not.toContain('cmd.exe');
    expect(argv[0].endsWith('.cmd')).toBe(false);
    expect(argv).not.toContain('/c');
    expect(argv.every((part) => typeof part === 'string')).toBe(true);
  });

  it('falls back to the PATH when the package entry cannot be resolved', () => {
    // A shim with no package behind it: there is no entry point to run,
    // so the bare name goes to the PATH. Returning the shim would hand
    // node a file it cannot execute — `spawn EINVAL` on Windows.
    writeFileSync(join(fakeRoot, 'node_modules', '.bin', 'lonely.cmd'), '@echo off\r\n');

    expect(resolveArgv('lonely', ['--version'], fakeRoot)).toEqual(['lonely', '--version']);
  });
});

describe('GET /api/admin/webfonts/capability', () => {
  const ADMIN = { id: 7, username: 'admin', isAdmin: true };

  /** The report the route hands back — flat, with `ok` as the verdict. */
  function reportWith(ok: boolean): CapabilityReport {
    return {
      ok,
      node: 'v20.11.0',
      python: { available: true, version: '3.12.1', error: null },
      fonttools: { available: true, version: '4.61.1', error: null, remedy: null },
      network: { available: true, checkedUrl: SOURCES[0].urls[0], error: null },
      disk: {
        available: true,
        stagingDir: '/srv/app/scripts/fonts/staging/web',
        fontDir: '/srv/app/public/font',
        error: null,
      },
      toolchain: { subsetFont: true, typescript: true, tsx: true },
      sources: [],
      missing: ok ? [] : ['字体构建工具链没装齐'],
    };
  }

  async function callRoute(report: CapabilityReport, auth: unknown = { ok: true, user: ADMIN }) {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ requireAdmin: async () => auth }));
    vi.doMock('@/lib/webfont/capability', () => ({ probeCapability: async () => report }));
    const { GET } = await import('@/app/api/admin/webfonts/capability/route');
    return GET(new NextRequest('http://localhost/api/admin/webfonts/capability'));
  }

  afterEach(() => {
    vi.doUnmock('@/lib/auth');
    vi.doUnmock('@/lib/webfont/capability');
    vi.resetModules();
  });

  it('answers 200 with the report at the top level — no envelope', async () => {
    const report = reportWith(true);
    const res = await callRoute(report);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(report);
    // A flat report: the fields sit at the top, there is no `data` wrapper.
    expect(body.data).toBeUndefined();
    expect(body.ok).toBe(true);
  });

  it('still answers 200 when the capabilities are incomplete', async () => {
    // `ok` is the CAPABILITY verdict, not a transport verdict: a machine
    // that cannot build fonts is not a server error, and the remedy text
    // has to reach the administrator either way.
    const report = reportWith(false);
    const res = await callRoute(report);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.missing).toEqual(['字体构建工具链没装齐']);
  });

  it('tells the browser not to cache the answer', async () => {
    const res = await callRoute(reportWith(true));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await callRoute(reportWith(true), {
      ok: false,
      reason: 'unauthenticated',
      response: Response.json({ ok: false }, { status: 401 }),
    });
    expect(res.status).toBe(401);
  });
});
