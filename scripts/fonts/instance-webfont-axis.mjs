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
 * Is fontTools installed?
 *
 * The probe runs the module entry point with `--help` instead of looking
 * for `fonttools` on PATH: the console script lives in the interpreter's
 * `Scripts/` directory, which is often not on PATH at all, while the
 * module is always importable where the package is installed.
 */
export function probeFontTools() {
  try {
    execFileSync(PYTHON_BIN, ['-I', '-m', 'fontTools.varLib.instancer', '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/** The remedy printed when fontTools cannot be found. */
const FONTTOOLS_REMEDY = `[instance] fonttools not found — install it with:
    python -m pip install --upgrade fonttools brotli`;

/**
 * Clip one variable font and verify the result.
 *
 * The output is verified, not trusted: the `fvar` table of the produced
 * font has to read exactly 400 / 400 / 700. A clip that silently kept
 * the original axis would ship a font with the wrong default weight and
 * nothing else would notice.
 */
export async function instanceOne(target) {
  const srcPath = resolve(STAGING_DIR, target.src);
  const outPath = resolve(STAGING_DIR, target.out);

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
  if (existsSync(outPath)) {
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
      cwd: STAGING_DIR,
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

async function main() {
  console.log(`[instance] staging dir: ${STAGING_DIR}`);
  console.log(`[instance] python: ${PYTHON_BIN}`);

  if (!probeFontTools()) {
    console.error(FONTTOOLS_REMEDY);
    process.exit(1);
  }

  let failed = 0;
  for (const target of INSTANCER_TARGETS) {
    const result = await instanceOne(target);
    if (result.status === 'fail') {
      failed++;
      console.error(`[instance] FAIL ${target.out}`);
      console.error(`[instance]      ${result.reason ?? 'unknown error'}`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`[instance] ${failed} file(s) failed — fix the source fonts and retry with:`);
    console.error('    npm run fonts:download-web && npm run fonts:instance-web');
    process.exit(1);
  }
  console.log('[instance] done — every variable font is pinned to wght 400..700 default 400');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('[instance] unexpected error:', error);
    process.exit(1);
  });
}
