/**
 * The capability probe of the admin font pipeline (design §3.4).
 *
 * Before an administrator is allowed to start a font build, this module
 * answers one question: **does this machine have everything the pipeline
 * needs?** The pipeline is four steps — download the source fonts, clip
 * the variable axes, subset the families, verify the result — and each
 * step needs something different:
 *
 *   | capability | how it is probed                                  |
 *   |------------|---------------------------------------------------|
 *   | Node       | `process.version` — it is running, so it is there  |
 *   | Python     | `python --version` (the `PYTHON` override honoured) |
 *   | fontTools  | `python -I -m fontTools.varLib.instancer --help`   |
 *   | upstream   | one `HEAD` on the first source url — never a GET   |
 *   | disk       | a `.probe` file in the staging dir, deleted again  |
 *   | toolchain  | `subset-font`, `typescript`, `tsx`                  |
 *
 * Three properties this module keeps, in this order:
 *
 *  1. **The probe reports, it never crashes.** Every probe is an
 *     interaction with the outside world — a subprocess, a file write, an
 *     HTTP HEAD — and every one of them can fail in a way that throws.
 *     A probe that threw instead of reporting would show the
 *     administrator an error page instead of the list of what is
 *     missing and how to fix it. So every external interaction is
 *     wrapped, and a failure becomes a line in the report.
 *  2. **A missing capability is never a green light.** `ok` is false
 *     when *any* of the six rows above is missing — including one of the
 *     three toolchain packages. The admin page keeps the "开始构建"
 *     button disabled while it is false.
 *  3. **The probe only reads the production tree.** It never writes into
 *     `public/font/`, and it never downloads a font: the upstream probe
 *     is a single `HEAD`, and the staging directory is the only place it
 *     writes a file at all (one byte, deleted again straight away).
 *
 * The upstream url is NOT hardcoded: it is read from `SOURCES`, the same
 * list the downloader uses, so the probe and the pipeline can never
 * disagree about which server the fonts come from.
 */
import 'server-only';

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { SOURCES } from '@/scripts/fonts/download-webfont-sources';

/** The report the admin panel renders. */
export interface CapabilityReport {
  /** The verdict: false when any capability is missing. */
  ok: boolean;
  /** The node version the server runs on. */
  node: string;
  python: { available: boolean; version: string | null; error: string | null };
  fonttools: { available: boolean; version: string | null; error: string | null; remedy: string | null };
  network: { available: boolean; checkedUrl: string; error: string | null };
  disk: { available: boolean; stagingDir: string; error: string | null };
  toolchain: { subsetFont: boolean; typescript: boolean; tsx: boolean };
  sources: { filename: string; label: string; present: boolean; size: number | null }[];
  /** What is missing, in Chinese, one entry per missing thing, with the remedy. */
  missing: string[];
}

/** What a command answered. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell and reports what it answered. */
export type RunCommand = (bin: string, args: string[]) => Promise<CommandResult>;

/** Everything the probe touches outside of this process, so a test can replace it. */
export interface ProbeOptions {
  /** Where the source fonts live. Defaults to the pipeline's staging dir. */
  stagingDir?: string;
  /** Runs a command. Defaults to `execFile` without a shell. */
  runCommand?: RunCommand;
  /** Performs the upstream HEAD request. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Resolves a package by name. Defaults to node's own resolver. */
  resolveModule?: (specifier: string) => string | null;
}

/** The timeout of the upstream HEAD request. */
const NETWORK_TIMEOUT_MS = 10_000;

/** The timeout of one command. A probe that hangs would hang the page. */
const COMMAND_TIMEOUT_MS = 20_000;

/** The name of the file the disk probe writes and deletes again. */
const DISK_PROBE_FILE = '.probe';

/**
 * The command that installs the three build packages where the server
 * can see them.
 *
 * `--save` is not optional: the server installs with
 * `npm install --omit=dev`, so a package that stayed in `devDependencies`
 * is simply not there. The bare `npm install` must never be suggested —
 * it would pull the whole dev dependency tree onto the production
 * machine.
 */
const TOOLCHAIN_INSTALL_COMMAND =
  'npm install subset-font@^2.4.0 typescript@^5.6.3 tsx@^4.19.2 --save';

/** The remedy for a machine without the three build packages (design §3.4.1). */
const TOOLCHAIN_REMEDY =
  '字体构建工具链没装齐：`subset-font` / `typescript` / `tsx` 是**生产依赖**，' +
  '服务器用 `npm install --omit=dev` 装 ⇒ 缺它们不是这台机器坏了，' +
  '是依赖没提到 `dependencies` 里。修复：' +
  `\`${TOOLCHAIN_INSTALL_COMMAND}\` 然后重装。`;

/** The remedy for a machine without fontTools (design §3.4). */
const FONTTOOLS_REMEDY =
  'Python 在，但 fontTools 没装：`pip install fonttools`（或 `python -m pip install fonttools`）。';

/** The remedy for a machine without a python interpreter (design §3.4). */
const PYTHON_MISSING_REMEDY = '找不到 Python 解释器。装一个，或者设 `PYTHON` 环境变量指向它。';

/** The python interpreter the pipeline itself uses. */
function pythonBin(): string {
  return process.env.PYTHON ?? 'python';
}

/**
 * The directory that holds the application's `package.json`.
 *
 * This is the same directory `scripts/fonts/*.mjs` compute as
 * `resolve(__dirname, '..', '..')`, derived in a way that survives
 * bundling: the scripts run from the source tree, this module runs from
 * a Next.js bundle, so the root is found by walking up to the nearest
 * directory that has a `package.json`. The working directory is the
 * starting point — `next start` reads `.next/` from it, so it is the
 * application root in any deployment that works at all.
 */
let cachedAppRoot: string | null = null;

function appRoot(): string {
  if (cachedAppRoot === null) cachedAppRoot = findAppRoot(process.cwd());
  return cachedAppRoot;
}

function findAppRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/** Where the source fonts are staged. */
function defaultStagingDir(): string {
  return join(appRoot(), 'scripts', 'fonts', 'staging', 'web');
}

/**
 * Resolves a package the way node does, from the application root.
 *
 * `createRequire` is anchored on the root's own `package.json`, so the
 * answer does not depend on the working directory and does not depend on
 * `node_modules/.bin` being on `PATH` — which it is not on a machine
 * where the app is started by a service manager.
 *
 * A package that is not installed is `null`, never an exception.
 */
function defaultResolveModule(specifier: string): string | null {
  try {
    const requireFromRoot = createRequire(join(appRoot(), 'package.json'));
    return requireFromRoot.resolve(specifier);
  } catch {
    return null;
  }
}

/** A command, and the arguments it has to be started with. */
interface ExecutableTarget {
  file: string;
  args: string[];
}

/**
 * The JavaScript entry point of an installed package, from its own
 * `bin` field.
 *
 * npm's Windows shims do nothing else: they run this file with node. So
 * running it directly is what the shim would have done — without a
 * shell, which a `.cmd` shim would need.
 */
function resolvePackageEntry(name: string): string | null {
  try {
    const packageDir = join(appRoot(), 'node_modules', name);
    const manifestPath = join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = manifest.bin;
    const relative = typeof bin === 'string' ? bin : bin ? (bin[name] ?? Object.values(bin)[0]) : undefined;
    if (!relative) return null;
    const entry = resolve(packageDir, relative);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Where a bare command name actually lives.
 *
 * A name that carries a path is used as it is. A bare name is looked for
 * in the application's own `node_modules/.bin` first — that is where
 * `tsx` lives, and a service manager's `PATH` usually does not reach
 * there — and only then on the `PATH`.
 *
 * On Windows the shim is a `.cmd` file, which node cannot execute
 * without a shell; the package's own entry point is run with node
 * instead, which is exactly what the shim does.
 */
function resolveExecutable(bin: string): ExecutableTarget {
  if (bin.includes('/') || bin.includes('\\')) return { file: bin, args: [] };

  const binDir = join(appRoot(), 'node_modules', '.bin');
  if (process.platform === 'win32') {
    const shim = join(binDir, `${bin}.cmd`);
    if (existsSync(shim)) {
      const entry = resolvePackageEntry(bin);
      if (entry) return { file: process.execPath, args: [entry] };
      return { file: shim, args: [] };
    }
  }

  const plain = join(binDir, bin);
  if (existsSync(plain)) return { file: plain, args: [] };
  return { file: bin, args: [] };
}

/**
 * Runs a command without a shell.
 *
 * A command that could not be *started* (the binary is not installed, the
 * file is not executable) rejects with the error node reported; a command
 * that ran and failed answers with a non-zero exit code. The two are
 * different stories and the probe tells them apart.
 */
async function defaultRunCommand(bin: string, args: string[]): Promise<CommandResult> {
  const target = resolveExecutable(bin);
  return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    execFile(
      target.file,
      [...target.args, ...args],
      { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ code: 0, stdout, stderr });
          return;
        }
        if (error.killed) {
          rejectPromise(new Error(`${bin} timed out after ${COMMAND_TIMEOUT_MS} ms`));
          return;
        }
        const exitCode = typeof error.code === 'number' ? error.code : null;
        if (exitCode === null) {
          // The process never started: ENOENT, EACCES, EINVAL …
          rejectPromise(error);
          return;
        }
        resolvePromise({ code: exitCode, stdout, stderr });
      },
    );
  });
}

/** The first non-empty line of a command's output. */
function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) return line.trim();
  }
  return '';
}

/** A failure, described the way an operator needs to read it. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  if (code && !error.message.includes(code)) return `${code}: ${error.message}`;
  return error.message;
}

/** The python version out of the text `python --version` answered with. */
function parsePythonVersion(output: string): string | null {
  const match = /Python\s+(\d+\.\d+(?:\.\d+)?)/i.exec(output);
  if (match) return match[1];
  const line = firstLine(output);
  return line ? line : null;
}

/** The python probe, and what it found. */
interface PythonOutcome {
  available: boolean;
  version: string | null;
  error: string | null;
  /** True when the interpreter is simply not installed. */
  notInstalled: boolean;
}

async function probePython(run: RunCommand): Promise<PythonOutcome> {
  try {
    const result = await run(pythonBin(), ['--version']);
    if (result.code !== 0) {
      const detail = firstLine(result.stderr) || firstLine(result.stdout);
      return {
        available: false,
        version: null,
        error: `python --version exited with code ${result.code}${detail ? `: ${detail}` : ''}`,
        notInstalled: false,
      };
    }
    // Python 3 prints to stdout, Python 2 to stderr; read both.
    const version = parsePythonVersion(`${result.stdout}\n${result.stderr}`);
    return { available: true, version, error: null, notInstalled: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return {
      available: false,
      version: null,
      error: describeFailure(error),
      notInstalled: code === 'ENOENT',
    };
  }
}

/** The fontTools probe, and what it found. */
interface FontToolsOutcome {
  available: boolean;
  version: string | null;
  error: string | null;
  remedy: string | null;
}

async function probeFontTools(run: RunCommand): Promise<FontToolsOutcome> {
  let result: CommandResult;
  try {
    result = await run(pythonBin(), ['-I', '-m', 'fontTools.varLib.instancer', '--help']);
  } catch (error) {
    return {
      available: false,
      version: null,
      error: describeFailure(error),
      remedy: FONTTOOLS_REMEDY,
    };
  }

  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout);
    return {
      available: false,
      version: null,
      error: `fontTools.varLib.instancer exited with code ${result.code}${detail ? `: ${detail}` : ''}`,
      remedy: FONTTOOLS_REMEDY,
    };
  }

  return {
    available: true,
    version: await readFontToolsVersion(run),
    error: null,
    remedy: null,
  };
}

/**
 * The fontTools version.
 *
 * The `--help` of the instancer carries no version, so the version is
 * asked for separately. A failure here costs the version, not the
 * capability — the capability was already decided by the exit code.
 */
async function readFontToolsVersion(run: RunCommand): Promise<string | null> {
  try {
    const result = await run(pythonBin(), [
      '-I',
      '-c',
      'import fontTools; print(fontTools.version)',
    ]);
    if (result.code !== 0) return null;
    const line = firstLine(result.stdout);
    return line ? line : null;
  } catch {
    return null;
  }
}

/** The upstream probe: one HEAD, on the url the downloader would use. */
async function probeNetwork(fetchImpl: typeof fetch): Promise<{
  available: boolean;
  checkedUrl: string;
  error: string | null;
}> {
  const source = SOURCES[0];
  if (!source || source.urls.length === 0) {
    return { available: false, checkedUrl: '', error: 'no source url is configured' };
  }
  const url = source.urls[0];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    // A HEAD, never a GET: the probe must not pull 25 MB of font.
    await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    // Any answer at all means the server is there — the same rule the
    // downloader uses. Only a request that never completed is a failure.
    return { available: true, checkedUrl: url, error: null };
  } catch (error) {
    return { available: false, checkedUrl: url, error: describeFailure(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the disk probe may write its file.
 *
 * The staging directory itself, when it is there. When it is not there
 * yet — it is gitignored, so a fresh server does not have it — the
 * nearest directory above it is used: that is the volume the pipeline
 * will write 70 MB into, and the probe must not create the directory
 * tree to find that out.
 *
 * A path component that exists but is not a directory is a hard failure:
 * the staging directory can never exist there.
 */
function resolveDiskTarget(stagingDir: string): { dir: string | null; error: string | null } {
  let dir = resolve(stagingDir);
  for (;;) {
    const stat = statSync(dir, { throwIfNoEntry: false });
    if (stat) {
      if (!stat.isDirectory()) {
        return { dir: null, error: `ENOTDIR: ${dir} is not a directory` };
      }
      return { dir, error: null };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return { dir: null, error: `no directory exists above ${stagingDir}` };
    }
    dir = parent;
  }
}

/**
 * The disk probe: write one byte into the staging directory, delete it
 * again.
 *
 * The file is deleted even when the write went wrong, and a delete that
 * fails is reported as an unusable disk rather than silently leaving the
 * file behind.
 */
function probeDisk(stagingDir: string): { available: boolean; stagingDir: string; error: string | null } {
  const target = resolveDiskTarget(stagingDir);
  if (!target.dir) {
    return { available: false, stagingDir, error: target.error };
  }

  const probePath = join(target.dir, DISK_PROBE_FILE);
  try {
    writeFileSync(probePath, 'probe');
  } catch (error) {
    return { available: false, stagingDir, error: describeFailure(error) };
  }
  try {
    rmSync(probePath, { force: true });
  } catch (error) {
    return {
      available: false,
      stagingDir,
      error: `${describeFailure(error)} (the probe file ${probePath} could not be removed)`,
    };
  }
  return { available: true, stagingDir, error: null };
}

/** The build toolchain probe: the two packages and the one executable. */
async function probeToolchain(
  run: RunCommand,
  resolveModule: (specifier: string) => string | null,
): Promise<{ subsetFont: boolean; typescript: boolean; tsx: boolean }> {
  const subsetFont = resolveSafely(resolveModule, 'subset-font');
  const typescript = resolveSafely(resolveModule, 'typescript');

  let tsx = false;
  try {
    const result = await run('tsx', ['--version']);
    tsx = result.code === 0;
  } catch {
    tsx = false;
  }

  return { subsetFont, typescript, tsx };
}

/** Resolves a package, and turns a resolver that throws into "not there". */
function resolveSafely(
  resolveModule: (specifier: string) => string | null,
  specifier: string,
): boolean {
  try {
    return resolveModule(specifier) !== null;
  } catch {
    return false;
  }
}

/** What is on disk right now. Read only — nothing is downloaded. */
function probeSources(stagingDir: string): CapabilityReport['sources'] {
  return SOURCES.map((source) => {
    const stat = statSync(join(stagingDir, source.filename), { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      return { filename: source.filename, label: source.label, present: false, size: null };
    }
    return { filename: source.filename, label: source.label, present: true, size: stat.size };
  });
}

/** The host of the upstream url, for the message the administrator reads. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Probes the machine and reports what it found.
 *
 * The result is the whole answer: the caller shows it as it is. `ok` is
 * the CAPABILITY verdict — false means "this machine cannot build fonts
 * yet", which is not an error and not a failed request.
 */
export async function probeCapability(opts: ProbeOptions = {}): Promise<CapabilityReport> {
  const stagingDir = opts.stagingDir ?? defaultStagingDir();
  const run = opts.runCommand ?? defaultRunCommand;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolveModule = opts.resolveModule ?? defaultResolveModule;

  const [python, fonttools, network, toolchain] = await Promise.all([
    probePython(run),
    probeFontTools(run),
    probeNetwork(fetchImpl),
    probeToolchain(run, resolveModule),
  ]);

  // The fontTools remedy says "Python 在，但 fontTools 没装" — that would be
  // a lie on a machine without python at all, so it is only offered when
  // python is really there.
  const fonttoolsOutcome: FontToolsOutcome = python.available
    ? fonttools
    : { ...fonttools, remedy: null };

  const disk = probeDisk(stagingDir);
  const sources = probeSources(stagingDir);

  const missing: string[] = [];
  if (!python.available) {
    missing.push(
      python.notInstalled
        ? PYTHON_MISSING_REMEDY
        : `Python 解释器存在但跑不起来（${python.error}）。检查这个解释器是否装坏了，` +
          '或设 `PYTHON` 环境变量指向一个可用的解释器。',
    );
  }
  if (fonttoolsOutcome.available === false && python.available) {
    missing.push(fonttoolsOutcome.remedy ?? FONTTOOLS_REMEDY);
  }
  if (!network.available) {
    if (network.checkedUrl === '') {
      missing.push('没有配置字体源 URL，无法探测上游可达性。');
    } else {
      const host = hostOf(network.checkedUrl);
      missing.push(
        `连不上 ${host}（DNS/TLS/超时）。这台机器可能没有出网权限，请检查网络、代理或 DNS 后重试。`,
      );
    }
  }
  if (!disk.available) {
    missing.push(
      `staging 目录不可写：${disk.stagingDir}（${disk.error ?? '未知原因'}）。` +
        '流水线要把源字体写进这个目录，请检查该目录的写权限和磁盘空间。',
    );
  }
  // Three of three or nothing: the build steps ③ and ④ need all three
  // packages, so one missing package makes the whole toolchain unusable.
  // The remedy names the whole toolchain and the one command that
  // installs it — including the packages that are already there, because
  // the command installs all three at once. The `toolchain` field says
  // which one is actually missing.
  if (!toolchain.subsetFont || !toolchain.typescript || !toolchain.tsx) {
    missing.push(TOOLCHAIN_REMEDY);
  }

  const ok =
    python.available &&
    fonttoolsOutcome.available &&
    network.available &&
    disk.available &&
    toolchain.subsetFont &&
    toolchain.typescript &&
    toolchain.tsx;

  return {
    ok,
    node: process.version,
    python: {
      available: python.available,
      version: python.version,
      error: python.error,
    },
    fonttools: {
      available: fonttoolsOutcome.available,
      version: fonttoolsOutcome.version,
      error: fonttoolsOutcome.error,
      remedy: fonttoolsOutcome.remedy,
    },
    network: {
      available: network.available,
      checkedUrl: network.checkedUrl,
      error: network.error,
    },
    disk: {
      available: disk.available,
      stagingDir: disk.stagingDir,
      error: disk.error,
    },
    toolchain,
    sources,
    missing,
  };
}
