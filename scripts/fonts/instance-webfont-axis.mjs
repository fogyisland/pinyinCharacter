/**
 * instance-webfont-axis.mjs
 *
 * Plan wave 2 (W2-1b) — clip the `wght` axis of the two variable source
 * fonts down to the range the site actually renders.
 *
 * The site renders Noto Sans SC, Noto Serif SC and LXGW WenKai TC at
 * weights 400 / 500 / 600 / 700. The upstream variable fonts carry far
 * more: Noto Sans SC spans 100..900, Noto Serif SC 200..900. Clipping the
 * axis to 400..700 keeps every weight the site asks for and drops the
 * instances nobody renders.
 *
 * Clipping also moves the DEFAULT instance. Noto Sans SC defaults to 100
 * and Noto Serif SC to 200; after the clip both default to 400, which is
 * what the site's CSS asks for when no weight is given. The script prints
 * the axis before and after so that move is visible in the log rather
 * than hidden in a font table.
 *
 * The clip is done by fontTools (fontTools.varLib.instancer), not by the
 * `fonttools` console script: the module entry point does not depend on
 * the `Scripts/` directory being on PATH, and the interpreter runs in
 * isolated mode (`-I`) so that neither the script directory nor the
 * working directory can shadow a standard library module. The downloaded
 * fonts are untrusted data; the isolated interpreter is what keeps them
 * from becoming code.
 *
 * The equivalent console script would be:
 *   fonttools varLib.instancer <src> wght=400:700 --output <out> --no-overlap-flag
 *
 * Run: npm run fonts:instance-web
 */

import * as fontkit from 'fontkit';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Where the downloaded sources live. Gitignored, never committed. */
export const STAGING_DIR = resolve(__dirname, 'staging', 'web');

/**
 * The variable fonts that get clipped, and the file each clip is written
 * to. The two static LXGW WenKai TC faces are not here: they carry no
 * axis to clip.
 */
export const INSTANCER_TARGETS = [
  { src: 'NotoSansSC-wght.ttf', out: 'NotoSansSC-wght-400-700.ttf' },
  { src: 'NotoSerifSC-wght.ttf', out: 'NotoSerifSC-wght-400-700.ttf' },
];

/**
 * The Python interpreter that runs fontTools.
 *
 * `PYTHON` overrides it, for the machines where the interpreter that
 * owns the fontTools install is not the first `python` on PATH.
 */
export const PYTHON_BIN = process.env.PYTHON ?? 'python';

/** The axis range the site renders. */
export const WEIGHT_MIN = 400;
export const WEIGHT_MAX = 700;

/** The axis the clip has to produce. */
export const EXPECTED_AXIS = { min: 400, default: 400, max: 700 };

/**
 * The command line of the clip.
 *
 * `-I` (isolated mode) keeps the interpreter from putting the script
 * directory and the working directory on sys.path, so a stray json.py
 * next to the downloads cannot shadow the standard library.
 *
 * `--no-overlap-flag` drops the `OVERLAP_SIMPLE` flag from the output:
 * the flag is meaningless once the axis is pinned and some rasterizers
 * reject it.
 */
export function instancerArgs(src, out) {
  return [
    '-I',
    '-m',
    'fontTools.varLib.instancer',
    src,
    'wght=400:700',
    '--output',
    out,
    '--no-overlap-flag',
  ];
}

/**
 * The `wght` axis of a font, read from its `fvar` table.
 *
 * Returns null when the font carries no weight axis at all.
 */
export function readWeightAxis(buffer) {
  const font = fontkit.create(buffer);
  const axis = font.variationAxes?.wght;
  if (!axis) return null;
  return { min: axis.min, default: axis.default, max: axis.max };
}

/** Render an axis as `wght 400..700 default 400`. */
function formatAxis(axis) {
  if (!axis) return 'no wght axis';
  return `wght ${axis.min}..${axis.max} default ${axis.default}`;
}

/** The size of a file, or 0 when it does not exist. */
function fileSize(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat ? stat.size : 0;
}

/**
 * The outcome of the fontTools probe.
 *
 * The three ways the probe can fail are told apart, because they need
 * three different remedies and only one of them is about fontTools:
 *
 *   - `interpreterMissing` — the Python interpreter could not even be
 *     started. Nothing is wrong with fontTools; the operator has no
 *     interpreter, or one that cannot be executed.
 *   - `moduleMissing` — the interpreter ran and fontTools is not in it.
 *   - neither — the interpreter ran fontTools and fontTools failed.
 *
 * Telling an operator to install a package that is already installed —
 * or to look at fontTools when the interpreter never started — sends
 * them down the wrong path, so the cases must not be lumped together.
 *
 * ⚠️ The answer is NOT remembered here: this function asks the
 * ENVIRONMENT every time it is called. The run of the clip remembers it
 * for its own duration only — see `instanceAll()`.
 *
 * ⚠️ Why not remember it for the whole process: a remembered SUCCESS
 * outlives the run that asked for it, and it then answers a later run
 * with a thing that is no longer true. The operator removes fontTools
 * (or upgrades it out of band), the cached success keeps the run going,
 * the clip subprocess fails, and the failure is classified as a failure
 * of the SOURCE FONTS — the operator is sent to download fonts that are
 * perfectly fine. That is the very falsehood M7 was about, in a narrow
 * window (G12).
 *
 * @returns {{ ok: boolean, moduleMissing: boolean, interpreterMissing: boolean, detail: string }}
 *   what the probe found
 */
export function describeFontTools() {
  return runFontToolsProbe();
}

/**
 * Run the fontTools probe once, and report what it found.
 *
 * @returns {{ ok: boolean, moduleMissing: boolean, interpreterMissing: boolean, detail: string }}
 *   what the probe found
 */
function runFontToolsProbe() {
  try {
    execFileSync(PYTHON_BIN, ['-I', '-m', 'fontTools.varLib.instancer', '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      ok: true,
      moduleMissing: false,
      interpreterMissing: false,
      detail: 'fontTools.varLib.instancer answered --help',
    };
  } catch (error) {
    // Did the subprocess start at all? The shape of the error says so,
    // and the shape is the same on every platform: a spawn failure
    // carries a STRING code ('ENOENT', 'EFTYPE', 'EACCES', ...) and no
    // exit status, while a child that ran and failed carries a NUMBER
    // status and no string code. Enumerating the errno strings would
    // miss the platform specific ones — Windows answers EFTYPE for a
    // file that is not an executable, POSIX answers EACCES for a file
    // that may not be executed.
    const errno = typeof error?.code === 'string' ? error.code : null;
    const spawnFailed = errno !== null && (error?.status === null || error?.status === undefined);
    if (spawnFailed) {
      // The interpreter never ran, so nothing at all is known about
      // fontTools. Saying "fonttools is installed" here would assert
      // something that was never checked.
      const raw = typeof error?.message === 'string' ? error.message.trim() : '';
      // The message of a spawn failure is "spawnSync <binary> <ERRNO>",
      // which repeats the errno. Only a message that adds something is
      // worth carrying.
      const extra = raw && !raw.endsWith(errno) ? `: ${raw}` : '';
      const reason = errno === 'ENOENT' ? 'was not found' : 'could not be started';
      return {
        ok: false,
        moduleMissing: false,
        interpreterMissing: true,
        detail: `the interpreter "${PYTHON_BIN}" ${reason} (${errno}${extra})`,
      };
    }
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const message = error instanceof Error ? error.message : String(error);
    const output = `${stderr}\n${message}`;
    const moduleMissing = /No module named|ModuleNotFoundError/i.test(output);
    const detail = (stderr.trim() || message.trim() || 'the probe failed without a message')
      .split(/\r?\n/)
      .slice(0, 4)
      .join(' | ');
    return { ok: false, moduleMissing, interpreterMissing: false, detail };
  }
}

/**
 * Is fontTools installed?
 *
 * The probe runs the module entry point with `--help` instead of looking
 * for `fonttools` on PATH: the console script lives in the interpreter's
 * `Scripts/` directory, which is often not on PATH at all, while the
 * module is always importable where the package is installed.
 */
export function probeFontTools() {
  return describeFontTools().ok;
}

/**
 * Clip one variable font and verify the result.
 *
 * The output is verified, not trusted: the `fvar` table of the produced
 * font has to read exactly 400 / 400 / 700. A clip that silently kept
 * the original axis would ship a font with the wrong default weight and
 * nothing else would notice.
 *
 * @param {object} target the source file and the file the clip lands in
 * @param {{ stagingDir?: string, force?: boolean }} options where the
 *   fonts live, and whether an existing clip is re-cut
 * @returns {Promise<object>} the outcome of the clip
 */
export async function instanceOne(target, options = {}) {
  const stagingDir = options.stagingDir ?? STAGING_DIR;
  const force = options.force === true;
  const srcPath = resolve(stagingDir, target.src);
  const outPath = resolve(stagingDir, target.out);

  if (!existsSync(srcPath)) {
    return {
      status: 'fail',
      out: target.out,
      reason: `the source font is missing: ${srcPath} (run npm run fonts:download-web first)`,
    };
  }

  const sourceAxis = readWeightAxis(readFileSync(srcPath));
  console.log(`[instance] ${target.src}  original axis: ${formatAxis(sourceAxis)}`);

  // An output that is newer than its source and already carries the
  // expected axis is up to date; clipping it again would burn minutes
  // for the same bytes.
  if (!force && existsSync(outPath)) {
    const outStat = statSync(outPath);
    const srcStat = statSync(srcPath);
    if (outStat.mtimeMs >= srcStat.mtimeMs) {
      const existingAxis = readWeightAxis(readFileSync(outPath));
      if (
        existingAxis &&
        existingAxis.min === EXPECTED_AXIS.min &&
        existingAxis.default === EXPECTED_AXIS.default &&
        existingAxis.max === EXPECTED_AXIS.max
      ) {
        console.log(
          `[instance] SKIP ${target.out}  ${formatAxis(existingAxis)}  ${fileSize(outPath)} bytes ` +
            '(already clipped)',
        );
        return { status: 'skip', out: target.out, axis: existingAxis };
      }
    }
  }

  console.log(
    `[instance] clipping ${target.src} -> ${target.out}  (wght=${WEIGHT_MIN}:${WEIGHT_MAX})`,
  );

  let stdout = '';
  try {
    stdout = execFileSync(PYTHON_BIN, instancerArgs(target.src, target.out), {
      encoding: 'utf8',
      cwd: stagingDir,
      // fontTools reports its table repairs on stderr; they are part of
      // the normal clipping flow and must stay visible.
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'fail', out: target.out, reason: message };
  }

  if (!existsSync(outPath)) {
    return {
      status: 'fail',
      out: target.out,
      reason: `the clip produced no file (fontTools said: ${stdout.trim() || 'nothing'})`,
    };
  }

  let axis = null;
  try {
    axis = readWeightAxis(readFileSync(outPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'fail', out: target.out, reason: `the clipped font is unreadable: ${message}` };
  }

  if (
    !axis ||
    axis.min !== EXPECTED_AXIS.min ||
    axis.default !== EXPECTED_AXIS.default ||
    axis.max !== EXPECTED_AXIS.max
  ) {
    return {
      status: 'fail',
      out: target.out,
      axis,
      reason: `the clipped font carries the axis ${formatAxis(axis)}, expected ${formatAxis(EXPECTED_AXIS)}`,
    };
  }

  console.log(
    `[instance] OK   ${target.out}  ${formatAxis(axis)}  ${fileSize(outPath)} bytes`,
  );
  return { status: 'ok', out: target.out, axis };
}

/**
 * What happened to one target of the axis clip.
 *
 * @typedef {object} InstanceResult
 * @property {string} source the source file of the target
 * @property {string} out the file the clip lands in
 * @property {'done'|'skipped'} status whether the clip ran or was skipped
 * @property {number|null} bytes the size of the clipped file, null when there is none
 * @property {string|null} reason why the target was skipped, null when it was clipped
 */

/**
 * The kinds of failure the clip can end in.
 *
 * They need DIFFERENT remedies, so a failure says which one it is: a
 * missing toolchain is fixed by installing the interpreter or fontTools,
 * while a failed clip is fixed by downloading the source fonts again. One
 * remedy for both of them sends the operator down the wrong path — and
 * this text ends up in the log of a backend job (G12).
 */
const FAILURE_TOOLCHAIN = 'toolchain';
const FAILURE_CLIP = 'clip';

/**
 * A failure of the clip, tagged with the kind of it.
 *
 * The tag is what lets the caller pick the remedy that FITS the failure,
 * instead of printing the same remedy for every failure.
 *
 * @param {string} kind what failed: the toolchain or the clip
 * @param {string} message what went wrong
 * @returns {Error} the error, with the kind of it on it
 */
function clipFailure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

/**
 * The reason the toolchain cannot clip, in one sentence.
 *
 * The three failure modes need three different remedies, so they are
 * told apart: there is no Python at all, there is a Python without
 * fontTools, and there is a fontTools that failed.
 *
 * @param {object} probe the outcome of the fontTools probe
 * @returns {string} the message of the failure
 */
function fontToolsFailure(probe) {
  if (probe.interpreterMissing) {
    return (
      `[instance] the Python interpreter could not be started — ${probe.detail}. ` +
      'Install Python 3, or point PYTHON at the interpreter that owns fontTools.'
    );
  }
  if (probe.moduleMissing) {
    return (
      `[instance] fontTools is not installed in "${PYTHON_BIN}" — install it with: ` +
      'python -m pip install --upgrade fonttools brotli'
    );
  }
  return (
    `[instance] the fontTools probe ran but failed — ${probe.detail}. Run it by hand to ` +
    `see the full error: ${PYTHON_BIN} -I -m fontTools.varLib.instancer --help`
  );
}

/**
 * Clip every variable font, and say what happened to each one.
 *
 * A target whose axis instance is ALREADY there is skipped: clipping it
 * again would change its bytes, the version token of the family would
 * change with it, and every font of the site would have to be downloaded
 * again. `opts.force` says to clip it anyway.
 *
 * A failure THROWS, and it says why: there is no Python, there is no
 * fontTools, or the clip itself failed. A failure that is swallowed
 * would leave a half built pipeline behind it that looks green.
 *
 * @param {{ stagingDir?: string, force?: boolean }} opts where the fonts
 *   live, and whether an existing clip is re-cut
 * @returns {Promise<InstanceResult[]>} what happened to every target
 */
export async function instanceAll(opts = {}) {
  const stagingDir = opts.stagingDir ?? STAGING_DIR;
  const force = opts.force === true;
  const results = [];

  // ⚠️ The answer of the probe is remembered for THIS RUN and for this
  // run only. It is a local variable, not a module level one:
  //
  //   - The environment can change under a long lived process. A success
  //     that outlives its run would answer a later run with a thing that
  //     is no longer true: the operator removes fontTools, the cached
  //     success keeps the run going, the clip subprocess fails, and the
  //     failure is classified as a failure of the SOURCE FONTS — the
  //     operator is sent to download fonts that are perfectly fine. That
  //     is the very falsehood M7 was about, in a narrow window (G12).
  //   - A local variable cannot be reset by another run: two runs that
  //     happen at the same time each ask the environment for themselves
  //     and never share an answer.
  //
  // It starts EMPTY, so every run asks the environment again. The asking
  // is LAZY — it happens when the first clip is really needed — so a run
  // in which every axis instance is already there still spawns nothing.
  let fontTools = null;

  for (const target of INSTANCER_TARGETS) {
    const existing = fileSize(resolve(stagingDir, target.out));
    if (!force && existing > 0) {
      results.push({
        source: target.src,
        out: target.out,
        status: 'skipped',
        bytes: existing,
        reason:
          'the axis instance already exists — clipping it again would change its bytes',
      });
      continue;
    }

    // A clip is really needed, so the toolchain has to be there — and the
    // reason it is not has to be exact: "there is no Python" and
    // "fontTools is missing" need two different remedies.
    //
    // ⚠️ The probe is asked AT MOST ONCE per run: the answer does not
    // change while the run goes on, so the very same subprocess must not
    // be spawned again for every target.
    let probe = fontTools;
    if (probe === null) {
      probe = describeFontTools();
      // ⚠️ Only a SUCCESS is remembered — a failure describes the
      // ENVIRONMENT (no interpreter, no fontTools), and the environment
      // can change. A remembered failure would keep saying a thing that
      // is no longer true (G12).
      if (probe.ok) fontTools = probe;
    }
    if (!probe.ok) {
      // The remedy of a missing toolchain is in the message itself: the
      // interpreter or fontTools has to be installed, and the source
      // fonts are innocent here.
      throw clipFailure(FAILURE_TOOLCHAIN, fontToolsFailure(probe));
    }

    let outcome;
    try {
      outcome = await instanceOne(target, { stagingDir, force });
    } catch (error) {
      // ⚠️ A failure that ESCAPES the clip is a failure of the SOURCE
      // FONT: a download that is truncated, a file that is not a font at
      // all. It has to carry the kind of it, or the caller would have no
      // remedy to offer — the toolchain is innocent here.
      throw clipFailure(
        FAILURE_CLIP,
        `[instance] the clip of ${target.src} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (outcome.status === 'fail') {
      throw clipFailure(
        FAILURE_CLIP,
        `[instance] the clip of ${target.src} failed: ${outcome.reason ?? 'unknown error'}`,
      );
    }
    results.push({
      source: target.src,
      out: target.out,
      status: 'done',
      bytes: fileSize(resolve(stagingDir, target.out)) || null,
      reason: null,
    });
  }

  return results;
}

async function main() {
  console.log(`[instance] staging dir: ${STAGING_DIR}`);
  console.log(`[instance] python: ${PYTHON_BIN}`);

  try {
    const results = await instanceAll();
    for (const result of results) {
      const mark = result.status === 'done' ? 'DONE' : 'SKIP';
      console.log(
        `[instance] ${mark} ${result.out}  ${result.bytes ?? 0} bytes` +
          (result.reason ? `  (${result.reason})` : ''),
      );
    }
    console.log('');
    console.log(
      '[instance] done — every variable font is pinned to wght 400..700 default 400',
    );
  } catch (error) {
    // The reason is in the message: there is no Python, there is no
    // fontTools, or the clip itself failed. The code is set and the
    // function returns instead of calling process.exit(): on Windows a
    // process.exit() right after a write to a pipe can drop the text that
    // is still sitting in the buffer.
    console.error(`[instance] ${error instanceof Error ? error.message : String(error)}`);
    // ⚠️ The remedy has to FIT the failure (G12). A missing interpreter or
    // a missing fontTools is NOT a broken source font, and the remedy for
    // those is already in the message of the failure itself — so the
    // source font remedy is printed for the clip failure only.
    if (error instanceof Error && error.kind === FAILURE_CLIP) {
      console.error('    fix the source fonts and retry with:');
      console.error('    npm run fonts:download-web && npm run fonts:instance-web');
    }
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('[instance] unexpected error:', error);
    process.exitCode = 1;
  });
}
