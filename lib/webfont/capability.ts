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
 *   | disk       | a probe file in the STAGING dir + a permission check |
 *   | toolchain  | `subset-font`, `typescript`, `tsx`                  |
 *
 * Four properties this module keeps, in this order:
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
 *  3. **The probe measures the thing the pipeline writes.** The disk row
 *     looks at BOTH directories the pipeline writes into, with the
 *     method each one allows: a probe file in the staging directory
 *     (deleted again), and a WRITABILITY CHECK on the font root. The
 *     font root is never written to — it is the production directory,
 *     Next serves it, and a probe file that could not be deleted would
 *     go live with the release. It is checked anyway, because it is
 *     often a MOUNT: a staging volume that takes the 70 MB says
 *     nothing about a font-root volume that is full or read-only.
 *  4. **Nothing is written into the production tree.** Not into
 *     `public/font/`, not anywhere under `public/`. The upstream probe
 *     is a single HEAD, and the download belongs to step ①, not here.
 *
 * The upstream url is NOT hardcoded: it is read from `SOURCES`, the same
 * list the downloader uses, so the probe and the pipeline can never
 * disagree about which server the fonts come from.
 */
import 'server-only';

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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
  /**
   * The disk row — the two directories the pipeline writes into.
   *
   * `stagingDir` is where ① downloads the source fonts and where the
   * probe file is written (and deleted again). `fontDir` is where ③
   * writes the subsets and where the release is applied; it is only
   * CHECKED for writability, never written to. `available` is true only
   * when both of them are usable.
   */
  disk: {
    available: boolean;
    stagingDir: string;
    fontDir: string;
    error: string | null;
  };
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
  /**
   * Where the source fonts are staged, and where the disk probe writes
   * its probe file (and deletes it again). Defaults to the pipeline's
   * staging dir.
   */
  stagingDir?: string;
  /**
   * The font root the disk row checks for writability. It is never
   * written to. Defaults to the subsetter's font root.
   */
  fontDir?: string;
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

/**
 * The remedy for a machine without the three build packages (design
 * §3.4.1).
 *
 * The text is user facing, so it carries no markdown: no `**` and no
 * backticks. The command itself is literal — a test asserts it.
 */
const TOOLCHAIN_REMEDY =
  '字体构建工具链没装齐：subset-font / typescript / tsx 是生产依赖，' +
  '服务器用 npm install --omit=dev 装 ⇒ 缺它们不是这台机器坏了，' +
  '是依赖没提到 dependencies 里。修复：' +
  `${TOOLCHAIN_INSTALL_COMMAND} 然后重装。`;

/** The remedy for a machine without fontTools (design §3.4). */
const FONTTOOLS_REMEDY =
  'Python 在，但 fontTools 没装：pip install fonttools（或 python -m pip install fonttools）。';

/**
 * The remedy for fontTools on a machine without python.
 *
 * The sentence above would be a lie there ("python IS there"), so this
 * one says what to do once python is installed — the same command the
 * axis instancer itself prints (`instance-webfont-axis.mjs:389`).
 */
const FONTTOOLS_REMEDY_WITHOUT_PYTHON =
  'Python 还没装，fontTools 自然也装不上；装好 Python 之后执行 python -m pip install fonttools brotli';

/** The remedy for a machine without a python interpreter (design §3.4). */
const PYTHON_MISSING_REMEDY = '找不到 Python 解释器。装一个，或者设 PYTHON 环境变量指向它。';

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
 *
 * It is NOT cached: the working directory can change under a process,
 * and a cached root would keep probing paths that belong to another
 * tree. Every path this module reports is the path it really probed.
 */
function appRoot(): string {
  return findAppRoot(process.cwd());
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

/**
 * The font root: where the stylesheets, the manifest and the subsets live.
 *
 * The SAME semantics as the subsetter's own `resolveFontDir()`
 * (`scripts/fonts/build-webfont-subsets.mjs:114`): `WEBFONT_FONT_DIR`
 * overrides it, a RELATIVE path is resolved against the application root
 * and not against the working directory, and the default is
 * `<root>/public/font`.
 *
 * ⚠️ ONE environment variable names ONE thing: there is no second
 * variable for the output directory. Two names for one root are two roots
 * that drift apart, and the drift is found when a candidate is applied.
 */
export function resolveFontDir(
  root: string = appRoot(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.WEBFONT_FONT_DIR;
  if (typeof override === 'string' && override.trim() !== '') {
    return resolve(root, override.trim());
  }
  return join(root, 'public', 'font');
}

/**
 * A package's manifest, as far as this module needs it.
 */
interface PackageManifest {
  main?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
}

/**
 * The conditions that are active for a CommonJS `require`.
 *
 * The order of this list does not decide anything: the manifest's own
 * key order decides which condition wins, and this list only says
 * which conditions are active at all — the same rule node uses.
 */
const ACTIVE_CONDITIONS = ['node', 'require', 'node-addons', 'default'];

/**
 * Reads a package's manifest from the disk.
 *
 * `null` when there is no manifest, or when it is not readable JSON: a
 * package that cannot be read is a package that cannot be used.
 */
function readPackageManifest(packageDir: string): PackageManifest | null {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * The `node_modules` directories node would look in, from the root up.
 */
function nodeModulesDirs(root: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(root);
  for (;;) {
    dirs.push(join(dir, 'node_modules'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** A package request: the package itself, and the subpath inside it. */
interface PackageRequest {
  name: string;
  subpath: string;
}

/**
 * Splits a specifier into a package and a subpath.
 *
 * `null` for anything that is not a package name: a relative path and
 * an absolute path are not packages, and neither is an empty string.
 */
function parsePackageRequest(specifier: string): PackageRequest | null {
  if (specifier === '' || specifier.startsWith('.') || isAbsolute(specifier)) return null;
  const segments = specifier.split('/');
  let name: string;
  if (specifier.startsWith('@')) {
    // A scoped package: '@scope/name', and whatever follows is the
    // subpath.
    if (segments.length < 2 || segments[0] === '' || segments[1] === '') return null;
    name = `${segments[0]}/${segments[1]}`;
  } else {
    if (segments[0] === '') return null;
    name = segments[0];
  }
  const rest = specifier.slice(name.length);
  return { name, subpath: rest === '' ? '.' : `.${rest}` };
}

/**
 * The relative paths an `exports` field points at, in the order node
 * would try them.
 *
 * `exports` is one of three things: a path, a list of paths (node takes
 * the first one that exists), or an object. An object is either a
 * subpath map (its keys start with ".") or a map of conditions
 * ("require", "import", "default", …).
 */
function exportCandidates(exportsField: unknown, subpath: string): string[] {
  if (typeof exportsField === 'string') return [exportsField];
  if (Array.isArray(exportsField)) {
    return exportsField.flatMap((item) => exportCandidates(item, subpath));
  }
  if (typeof exportsField !== 'object' || exportsField === null) return [];

  const record = exportsField as Record<string, unknown>;
  const keys = Object.keys(record);

  // A subpath map: the keys start with ".".
  if (keys.every((key) => key.startsWith('.'))) {
    if (Object.prototype.hasOwnProperty.call(record, subpath)) {
      return exportCandidates(record[subpath], subpath);
    }
    return patternCandidates(record, subpath);
  }

  // A map of conditions. The manifest's own key order decides which
  // condition wins — the same rule node uses — and only the conditions
  // that are active for a CommonJS require are taken.
  for (const key of keys) {
    if (!ACTIVE_CONDITIONS.includes(key)) continue;
    const candidates = exportCandidates(record[key], subpath);
    if (candidates.length > 0) return candidates;
  }
  // The package IS installed even when it cannot be required, so a
  // package that only exports "import" still counts as installed.
  if (Object.prototype.hasOwnProperty.call(record, 'import')) {
    return exportCandidates(record['import'], subpath);
  }
  return [];
}

/**
 * The `*` patterns of an exports map.
 *
 * The most specific base wins — node sorts the patterns by the length of
 * their base — and the part the `*` matched is put back into the
 * target.
 */
function patternCandidates(record: Record<string, unknown>, subpath: string): string[] {
  const patternKeys = Object.keys(record)
    .filter((key) => key.includes('*'))
    .sort((left, right) => right.split('*')[0].length - left.split('*')[0].length);

  for (const key of patternKeys) {
    const star = key.indexOf('*');
    const base = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(base) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < base.length + suffix.length) continue;
    const matched = subpath.slice(base.length, subpath.length - suffix.length);
    return exportCandidates(record[key], subpath).map((candidate) =>
      candidate.split('*').join(matched),
    );
  }
  return [];
}

/**
 * The first candidate that is really on the disk.
 *
 * A `main` (and a `bin`) is often written without an extension
 * (`./lib/index`), so the ways node would resolve it are tried — and
 * which one it is, is decided by the disk and not by a guess.
 */
function firstExistingFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    join(base, 'index.js'),
    join(base, 'index.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The entry of an installed package, from its own manifest.
 */
function resolveFromManifest(
  packageDir: string,
  manifest: PackageManifest,
  subpath: string,
): string | null {
  // `exports` takes precedence over `main` — that is node's rule.
  if (manifest.exports !== undefined && manifest.exports !== null) {
    for (const candidate of exportCandidates(manifest.exports, subpath)) {
      const absolute = resolve(packageDir, candidate);
      if (existsSync(absolute)) return absolute;
    }
    return null;
  }
  if (subpath !== '.') {
    // Without an exports map, a subpath is a file inside the package.
    const direct = resolve(packageDir, subpath.slice(2));
    return existsSync(direct) ? direct : null;
  }
  if (typeof manifest.main === 'string' && manifest.main.trim() !== '') {
    return firstExistingFile(resolve(packageDir, manifest.main));
  }
  return firstExistingFile(join(packageDir, 'index'));
}

/**
 * Resolves a package the way node does — by reading the disk.
 *
 * ⚠️ WHY NOT `createRequire`: Next.js bundles this module for the
 * server, and webpack replaces `createRequire` with a shim that cannot
 * parse its argument — the build says so ("module.createRequire failed
 * parsing argument"). In the production bundle the require that shim
 * hands back is broken, `resolve()` throws, the throw is caught, and the
 * toolchain row reports three packages that ARE installed as "not
 * installed". That is a false negative that sends the administrator to
 * install what is already there, so the answer is read from the disk
 * instead: the package's own `package.json` says where its entry is,
 * and the disk says whether that file is there. The same code runs in
 * the dev server and in the bundle.
 *
 * A package that is not installed — or one whose entry cannot be found —
 * is `null`, never an exception.
 */
export function resolveModuleEntry(specifier: string, root: string = appRoot()): string | null {
  const request = parsePackageRequest(specifier);
  if (!request) return null;
  for (const nodeModules of nodeModulesDirs(root)) {
    const packageDir = join(nodeModules, request.name);
    const manifest = readPackageManifest(packageDir);
    if (!manifest) continue;
    // The package is here: whether its entry can be found decides the
    // answer, and node does not go looking in another node_modules
    // afterwards.
    return resolveFromManifest(packageDir, manifest, request.subpath);
  }
  return null;
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
 * `bin` is either a path or a map of command names to paths; both are
 * handled, and the map is asked for the command's own name first.
 *
 * npm's Windows shims do nothing else: they run this file with node. So
 * running it directly is what the shim would have done — without a
 * shell, which a `.cmd` shim would need.
 */
function resolveBinEntry(name: string, root: string): string | null {
  for (const nodeModules of nodeModulesDirs(root)) {
    const packageDir = join(nodeModules, name);
    const manifest = readPackageManifest(packageDir);
    if (!manifest) continue;
    const bin = manifest.bin;
    const relative =
      typeof bin === 'string' ? bin : bin ? (bin[name] ?? Object.values(bin)[0]) : undefined;
    if (!relative) return null;
    return firstExistingFile(resolve(packageDir, relative));
  }
  return null;
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
 * instead, which is exactly what the shim does. When that entry point
 * cannot be resolved, the name is handed to the `PATH` — a `.cmd` file
 * that is handed to node would fail with `spawn EINVAL`, and the
 * extensionless shim (a shell script) would fail with `ENOEXEC`: both
 * are files that cannot run, and a file that cannot run must never be
 * returned as the answer.
 */
function resolveExecutable(bin: string, root: string): ExecutableTarget {
  if (bin.includes('/') || bin.includes('\\')) return { file: bin, args: [] };

  const binDir = join(root, 'node_modules', '.bin');
  if (process.platform === 'win32') {
    const shim = join(binDir, `${bin}.cmd`);
    if (existsSync(shim)) {
      const entry = resolveBinEntry(bin, root);
      if (entry) return { file: process.execPath, args: [entry] };
      // No entry point: fall through to the PATH rather than to a file
      // that cannot be executed.
    }
  } else {
    const plain = join(binDir, bin);
    // A POSIX shim is a script with a shebang: node runs it directly.
    if (existsSync(plain)) return { file: plain, args: [] };
  }

  return { file: bin, args: [] };
}

/**
 * The exact argv a command is started with.
 *
 * This is exported because it is the contract the toolchain row rests on:
 * on Windows the `tsx` shim is a `.cmd` file that node cannot execute
 * without a shell, so the package's own entry point is run with node
 * instead. A test has to be able to look at the ARGV — at the shape of
 * the command, not at "did it run".
 *
 * The argv is always an array: no shell is involved, on any platform.
 */
export function resolveArgv(bin: string, args: string[], root: string = appRoot()): string[] {
  const target = resolveExecutable(bin, root);
  return [target.file, ...target.args, ...args];
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
  const argv = resolveArgv(bin, args);
  return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    execFile(
      argv[0],
      argv.slice(1),
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
}

async function probeFontTools(run: RunCommand): Promise<FontToolsOutcome> {
  let result: CommandResult;
  try {
    result = await run(pythonBin(), ['-I', '-m', 'fontTools.varLib.instancer', '--help']);
  } catch (error) {
    return { available: false, version: null, error: describeFailure(error) };
  }

  if (result.code !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout);
    return {
      available: false,
      version: null,
      error: `fontTools.varLib.instancer exited with code ${result.code}${detail ? `: ${detail}` : ''}`,
    };
  }

  return {
    available: true,
    version: await readFontToolsVersion(run),
    error: null,
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
 * The name of the file the disk probe writes.
 *
 * It has to be unique. A fixed name would be a bug twice over: the probe
 * deletes its file with `rmSync(..., { force: true })`, which removes a
 * file that was already there, and two administrators refreshing the page
 * at the same time would tread on each other.
 */
function probeFileName(): string {
  return `.probe-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * The staging half of the disk probe: write a small file there, delete
 * it again.
 *
 * This is the spec's own method (§3.4): a probe file in the staging
 * directory, deleted right away. The staging directory is NOT a
 * production directory — it is gitignored, the deploy bundle leaves it
 * out (`copy-to-up.py:43-46`), and step ① creates it anyway — so
 * writing a one-byte file there is harmless.
 *
 * The directory may not exist on a fresh server, so it is created
 * first. That leaves an empty directory behind, which is harmless for
 * the reasons above and is disclosed in the report of this module.
 *
 * There is deliberately NO fallback to an ancestor: a writable parent
 * says nothing about the directory itself (the two are not even on the
 * same volume when the staging area is a mount), so a fallback would
 * report a green light for a disk that cannot take the output.
 *
 * The file is deleted even when the write went wrong, and a delete that
 * fails is reported as an unusable disk rather than silently leaving the
 * file behind.
 */
function probeStagingDir(stagingDir: string): { ok: boolean; error: string | null } {
  try {
    mkdirSync(stagingDir, { recursive: true });
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
  const probePath = join(stagingDir, probeFileName());
  try {
    writeFileSync(probePath, 'probe');
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
  try {
    rmSync(probePath, { force: true });
  } catch (error) {
    return { ok: false, error: `${describeFailure(error)}（探针文件 ${probePath} 删不掉）` };
  }
  return { ok: true, error: null };
}

/**
 * The font-root half of the disk probe: a PERMISSION check, and nothing
 * else.
 *
 * The font root is where ③ writes the subsets and where the release is
 * applied. It is the PRODUCTION directory — `public/` is served to the
 * world — so nothing is ever written into it: a probe file that could
 * not be deleted would go live with the next deploy and be reachable
 * by anyone. Hence a writability check instead of a probe file.
 *
 * It has to be checked anyway: the font root is often a MOUNT, so a
 * staging volume that takes the 70 MB says nothing about a font-root
 * volume that is full or read-only. Checking only the staging
 * directory would still be a green light for a disk that cannot take
 * the output.
 */
function checkFontDir(fontDir: string): { ok: boolean; error: string | null } {
  try {
    accessSync(fontDir, constants.W_OK);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
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

/**
 * What is on disk right now. Read only — nothing is downloaded.
 *
 * A filesystem error (EACCES, ENOTDIR, ELOOP …) is not a crash: the file
 * is reported as not there, and the probe keeps going.
 */
function probeSources(stagingDir: string): CapabilityReport['sources'] {
  return SOURCES.map((source) => {
    const missing = { filename: source.filename, label: source.label, present: false, size: null };
    try {
      const stat = statSync(join(stagingDir, source.filename), { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) return missing;
      return { filename: source.filename, label: source.label, present: true, size: stat.size };
    } catch {
      return missing;
    }
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
  const root = appRoot();
  const stagingDir = opts.stagingDir ?? join(root, 'scripts', 'fonts', 'staging', 'web');
  const fontDir = opts.fontDir ?? resolveFontDir(root);
  const run = opts.runCommand ?? defaultRunCommand;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // The default resolver reads the disk (see `resolveModuleEntry`) —
  // the application root is the one every other path is derived from.
  const resolveModule = opts.resolveModule ?? ((specifier: string) => resolveModuleEntry(specifier, root));

  const [python, fonttools, network, toolchain] = await Promise.all([
    probePython(run),
    probeFontTools(run),
    probeNetwork(fetchImpl),
    probeToolchain(run, resolveModule),
  ]);

  // The disk row is two probes: the staging directory is written into
  // (and the probe file deleted again), the font root is only checked
  // for writability — it is the production directory, and nothing is
  // ever written there.
  const staging = probeStagingDir(stagingDir);
  const fontRoot = checkFontDir(fontDir);
  const disk = {
    available: staging.ok && fontRoot.ok,
    stagingDir,
    fontDir,
    error:
      [
        staging.ok ? null : `staging 目录 ${stagingDir}：${staging.error}`,
        fontRoot.ok ? null : `字体根目录 ${fontDir}：${fontRoot.error}`,
      ]
        .filter((reason): reason is string => reason !== null)
        .join('；') || null,
  };
  const sources = probeSources(stagingDir);

  // The fontTools remedy says "Python 在，但 fontTools 没装" — that would be
  // a lie on a machine without python at all, so there the remedy says
  // what to do once python is installed. Either way the row is reported:
  // fontTools really is missing when the row says so.
  const fontToolsRemedy = python.available ? FONTTOOLS_REMEDY : FONTTOOLS_REMEDY_WITHOUT_PYTHON;

  const missing: string[] = [];
  if (!python.available) {
    missing.push(
      python.notInstalled
        ? PYTHON_MISSING_REMEDY
        : `Python 解释器存在但跑不起来（${python.error}）。检查这个解释器是否装坏了，` +
          '或设 PYTHON 环境变量指向一个可用的解释器。',
    );
  }
  if (!fonttools.available) {
    missing.push(fontToolsRemedy);
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
  if (!staging.ok) {
    missing.push(
      `staging 目录不可写：${stagingDir}（${staging.error ?? '未知原因'}）。` +
        '流水线要把下载的源字体写进这个目录，请检查该目录的写权限和磁盘空间。',
    );
  }
  if (!fontRoot.ok) {
    missing.push(
      `字体根目录不可写：${fontDir}（${fontRoot.error ?? '未知原因'}）。` +
        '流水线要把切分产物写进这个目录，请检查该目录的写权限和磁盘空间。',
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
    fonttools.available &&
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
      available: fonttools.available,
      version: fonttools.version,
      error: fonttools.error,
      remedy: fonttools.available ? null : fontToolsRemedy,
    },
    network: {
      available: network.available,
      checkedUrl: network.checkedUrl,
      error: network.error,
    },
    disk: {
      available: disk.available,
      stagingDir: disk.stagingDir,
      fontDir: disk.fontDir,
      error: disk.error,
    },
    toolchain,
    sources,
    missing,
  };
}
