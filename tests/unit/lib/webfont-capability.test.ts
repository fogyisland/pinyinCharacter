import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

import { SOURCES } from '@/scripts/fonts/download-webfont-sources';
import { probeCapability, type CapabilityReport } from '@/lib/webfont/capability';

/**
 * The capability probe of the admin font pipeline (design §3.4).
 *
 * The probe is the gate in front of the "开始构建" button: it answers
 * "does this machine have everything the pipeline needs?" and, when the
 * answer is no, it says what is missing AND what to do about it.
 *
 * Two properties are worth more here than anywhere else in the feature:
 *
 *  1. **A missing capability is never a green light.** A server without
 *     Python, or without the three build-toolchain packages, must report
 *     `ok: false` and name the remedy. A probe that answered "everything
 *     is fine" on a machine that cannot build fonts is worse than no
 *     probe at all (the G-12 fake green).
 *  2. **The probe reports, it never crashes.** Every probe is an
 *     interaction with the outside world (a subprocess, a file write, an
 *     HTTP HEAD). One that throws instead of reporting would show the
 *     administrator an error page instead of the list of what is missing.
 *     ⇒ Every external interaction is injected here, and **no test in
 *     this file reaches the network**: `fetchImpl` is always a fake.
 */

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

beforeEach(() => {
  stagingDir = mkdtempSync(join(tmpdir(), 'webfont-capability-'));
});

afterEach(() => {
  rmSync(stagingDir, { recursive: true, force: true });
});

describe('probeCapability — a machine that has everything', () => {
  it('reports ok and an empty missing list', async () => {
    const runner = createRunner();
    const { fetchImpl } = createFetch();

    const report = await probeCapability({
      stagingDir,
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
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.fonttools.available).toBe(false);
    expect(report.fonttools.remedy).toContain('pip install fonttools');
    expect(report.missing.some((m) => m.includes('fontTools'))).toBe(true);
  });

  it('does not blame fontTools when python itself is missing', async () => {
    const runner = createRunner({ python: () => enoent('python') });
    const report = await probeCapability({
      stagingDir,
      runCommand: runner.run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    // The fontTools remedy says "Python 在，但 fontTools 没装" — that would
    // be a lie on a machine without python at all.
    expect(report.fonttools.remedy).toBeNull();
    expect(report.missing.some((m) => m.includes('fontTools'))).toBe(false);
  });
});

describe('probeCapability — the upstream', () => {
  it('reports the network as unavailable when the request fails', async () => {
    const { fetchImpl } = createFetch(() => {
      throw new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
    });
    const report = await probeCapability({
      stagingDir,
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
  it('writes a probe file into the staging directory and removes it again', async () => {
    const report = await probeCapability({
      stagingDir,
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.disk.available).toBe(true);
    expect(report.disk.stagingDir).toBe(stagingDir);
    // No junk is left behind.
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it('reports the disk as unusable when the probe file cannot be written', async () => {
    // A path whose parent is a FILE, not a directory: writing there fails.
    const blocker = join(stagingDir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const report = await probeCapability({
      stagingDir: join(blocker, 'staging'),
      runCommand: createRunner().run,
      fetchImpl: createFetch().fetchImpl,
      resolveModule: everythingResolvable,
    });

    expect(report.ok).toBe(false);
    expect(report.disk.available).toBe(false);
    expect(report.disk.error).toBeTruthy();
    expect(report.missing.some((m) => m.includes('staging'))).toBe(true);
  });
});

describe('probeCapability — the build toolchain', () => {
  it('fails the probe when subset-font cannot be resolved', async () => {
    const report = await probeCapability({
      stagingDir,
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

  it('fails the probe when typescript cannot be resolved', async () => {
    const report = await probeCapability({
      stagingDir,
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
      disk: { available: true, stagingDir: '/srv/app/scripts/fonts/staging/web', error: null },
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

  it('rejects an unauthenticated caller', async () => {
    const res = await callRoute(reportWith(true), {
      ok: false,
      reason: 'unauthenticated',
      response: Response.json({ ok: false }, { status: 401 }),
    });
    expect(res.status).toBe(401);
  });
});
