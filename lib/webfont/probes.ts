/**
 * The capability probes of the admin font pipeline (design §3.4).
 *
 * Each probe is ONE interaction with the outside world — a subprocess, a
 * file write, an HTTP HEAD — and each of them can fail in a way that
 * throws. So every probe here reports instead of throwing: a probe that
 * threw would show the administrator an error page instead of the list
 * of what is missing and how to fix it.
 *
 * ## WHY THESE LIVE HERE
 *
 * These are the SIDE EFFECTS: they run a command, they write a file, they
 * open a socket. `capability.ts` is the orchestration — it decides what
 * is probed, in what order, and what the report says. `module-resolution.ts`
 * only reads the disk. Splitting them apart keeps the side-effecting code
 * in one place, so "what does this module touch?" has one answer.
 *
 * The shared types live in `types.ts`, not here and not in
 * `capability.ts`, so that neither file has to import the other.
 */
import 'server-only';

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCES } from '@/scripts/fonts/download-webfont-sources';

import { resolveArgv, resolveModuleEntry } from './module-resolution';
import type {
  CapabilityReport,
  CommandResult,
  DiskCheck,
  FontToolsOutcome,
  ProbeOptions,
  PythonOutcome,
  RunCommand,
} from './types';

/** The timeout of the upstream HEAD request. */
const NETWORK_TIMEOUT_MS = 10_000;

/** The timeout of one command. A probe that hangs would hang the page. */
const COMMAND_TIMEOUT_MS = 20_000;

/** The python interpreter the pipeline itself uses. */
export function pythonBin(): string {
  return process.env.PYTHON ?? 'python';
}

/**
 * Runs a command without a shell.
 *
 * A command that could not be *started* (the binary is not installed, the
 * file is not executable) rejects with the error node reported; a command
 * that ran and failed answers with a non-zero exit code. The two are
 * different stories and the probe tells them apart.
 */
export async function defaultRunCommand(bin: string, args: string[]): Promise<CommandResult> {
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
export function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) return line.trim();
  }
  return '';
}

/** A failure, described the way an operator needs to read it. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  if (code && !error.message.includes(code)) return `${code}: ${error.message}`;
  return error.message;
}

/** The python version out of the text `python --version` answered with. */
export function parsePythonVersion(output: string): string | null {
  const match = /Python\s+(\d+\.\d+(?:\.\d+)?)/i.exec(output);
  if (match) return match[1];
  const line = firstLine(output);
  return line ? line : null;
}

/** The python probe, and what it found. */
export async function probePython(run: RunCommand): Promise<PythonOutcome> {
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
export async function probeFontTools(run: RunCommand): Promise<FontToolsOutcome> {
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
export async function readFontToolsVersion(run: RunCommand): Promise<string | null> {
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
export async function probeNetwork(fetchImpl: typeof fetch): Promise<{
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
export function probeFileName(): string {
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
export function probeStagingDir(stagingDir: string): DiskCheck {
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
 * The font root is where the apply (release) step writes the published
 * subsets. It is the PRODUCTION directory — `public/` is served to the
 * world — so nothing is ever written into it: a probe file that could
 * not be deleted would go live with the next deploy and be reachable
 * by anyone. Hence a writability check instead of a probe file.
 *
 * ⚠️ ③ does NOT write here: the subsetting step writes into the
 * staging output directory (design §3.3), and the release copies the
 * result into this root. A reader who took "③ writes the subsets into
 * the font root" for the truth would "fix" this probe by letting ③
 * write here — and that is precisely what the design forbids: it would
 * destroy the staging + explicit-apply model. The probe is read-only
 * HERE on purpose; copying into the font root is the apply step's job.
 *
 * It has to be checked anyway: the font root is often a MOUNT, so a
 * staging volume that takes the 70 MB says nothing about a font-root
 * volume that is full or read-only. Checking only the staging
 * directory would still be a green light for a disk that cannot take
 * the output.
 */
export function checkFontDir(fontDir: string): DiskCheck {
  try {
    accessSync(fontDir, constants.W_OK);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
}

/** Resolves a package, and turns a resolver that throws into "not there". */
export function resolveSafely(
  resolveModule: (specifier: string) => string | null,
  specifier: string,
): boolean {
  try {
    return resolveModule(specifier) !== null;
  } catch {
    return false;
  }
}

/** The build toolchain probe: the two packages and the one executable. */
export async function probeToolchain(
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

/**
 * What is on disk right now. Read only — nothing is downloaded.
 *
 * A filesystem error (EACCES, ENOTDIR, ELOOP …) is not a crash: the file
 * is reported as not there, and the probe keeps going.
 */
export function probeSources(stagingDir: string): CapabilityReport['sources'] {
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
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The default package resolver: read the disk.
 *
 * The application root is the one every other path is derived from, so
 * it is computed once here and handed down.
 */
export function defaultResolveModule(root: string): (specifier: string) => string | null {
  return (specifier: string) => resolveModuleEntry(specifier, root);
}

/**
 * The probe options, with the defaults filled in.
 *
 * The defaults are computed once per call, so a caller that replaces one
 * of them keeps the others.
 */
export function resolveProbeOptions(opts: ProbeOptions, root: string): Required<
  Pick<ProbeOptions, 'runCommand' | 'fetchImpl' | 'resolveModule'>
> {
  return {
    runCommand: opts.runCommand ?? defaultRunCommand,
    fetchImpl: opts.fetchImpl ?? fetch,
    resolveModule: opts.resolveModule ?? defaultResolveModule(root),
  };
}
