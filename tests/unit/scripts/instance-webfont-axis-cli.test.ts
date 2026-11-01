/**
 * The CLI of the axis clip, and what it says when it fails.
 *
 * The remedy of a failure has to FIT the failure (G12). A missing Python
 * interpreter is NOT a broken source font, and the text of the CLI goes
 * into the log of a backend job — an operator who is told to download the
 * fonts again when the interpreter is missing will fix the wrong thing.
 *
 * The test runs the real CLI, as a child process, with `PYTHON` pointing
 * at an executable that does not exist.
 *
 * ⚠️ The script is COPIED into a scratch directory of the repository
 * before it runs. The staging directory of the clip is derived from the
 * place of the script itself, and the staging directory of the
 * repository already holds every axis instance — so the copy is the only
 * way to make the clip really attempt one, and therefore the only way to
 * reach the probe. The scratch directory is `.tmp/`, which is gitignored
 * and removed after the test.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'instance-webfont-axis.mjs');
const SCRATCH = join(REPO_ROOT, '.tmp');

/** The scratch directories this file created — they are removed after every test. */
const temporaryDirs: string[] = [];

/**
 * Run the CLI with `PYTHON` pointing at an interpreter that is not there.
 *
 * @returns {{ status: number | null, output: string }} what the CLI said
 */
function runCliWithMissingPython(): { status: number | null; output: string } {
  const dir = copyOfTheScript();
  const result = spawnSync(process.execPath, [join(dir, 'instance-webfont-axis.mjs')], {
    env: { ...process.env, PYTHON: 'pinyin-no-such-python-interpreter' },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Copy the script into a scratch directory of the repository.
 *
 * The staging directory of the clip is derived from the place of the
 * script itself, so the copy is what makes the clip really attempt one
 * (the staging of the repository already holds every axis instance). The
 * staging directory of the copy is EMPTY, so the source fonts are
 * missing there — the clip fails, and the failure is the one of the
 * source fonts.
 *
 * @returns {string} the directory the copy lives in
 */
function copyOfTheScript(): string {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH, 'instance-cli-'));
  temporaryDirs.push(dir);
  copyFileSync(SCRIPT, join(dir, 'instance-webfont-axis.mjs'));
  mkdirSync(join(dir, 'staging', 'web'), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Is the toolchain of the clip there?
 *
 * The clip itself needs Python and fontTools, so the test of a CLIP
 * failure can only run where they are installed. Where they are not, the
 * failure would be a TOOLCHAIN failure — and the branch of the clip
 * would never be reached. The unit test of the kind of the failure
 * (`instance-webfont-axis-probe.test.ts`) covers that branch everywhere.
 */
const TOOLCHAIN_IS_THERE = (() => {
  const probe = spawnSync(
    process.env.PYTHON ?? 'python',
    ['-I', '-m', 'fontTools.varLib.instancer', '--help'],
    { encoding: 'utf8' },
  );
  return probe.status === 0;
})();

describe('the CLI of the axis clip', () => {
  it(
    'says what is missing when the Python interpreter is not there',
    () => {
      const run = runCliWithMissingPython();

      // The run FAILS: an interpreter that is not there cannot clip.
      expect(run.status).not.toBe(0);
      // The remedy is the one of the TOOLCHAIN: install Python, or point
      // PYTHON at the interpreter that owns fontTools.
      expect(run.output).toContain(
        'Install Python 3, or point PYTHON at the interpreter that owns fontTools.',
      );
    },
    120_000,
  );

  it(
    'does not tell the operator to fix the source fonts when the toolchain is missing',
    () => {
      // ⚠️ This is the assertion that matters: the source fonts are
      // innocent here, and the remedy of a toolchain failure has to say
      // so. "fix the source fonts" would send the operator to download
      // fonts that are perfectly fine.
      const run = runCliWithMissingPython();

      expect(run.output).not.toContain('fix the source fonts');
      expect(run.output).not.toContain('npm run fonts:download-web');
    },
    120_000,
  );

  it.skipIf(!TOOLCHAIN_IS_THERE)(
    'still tells the operator to fix the source fonts when the clip is what failed',
    () => {
      // ⚠️ The other half of the truth: a CLIP failure IS the source
      // fonts' fault, so the remedy of the source fonts has to be there.
      // The clip of a source that is not there fails like this.
      const dir = copyOfTheScript();
      const run = spawnSync(process.execPath, [join(dir, 'instance-webfont-axis.mjs')], {
        env: { ...process.env },
        encoding: 'utf8',
      });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

      expect(run.status).not.toBe(0);
      expect(output).toContain('fix the source fonts');
      expect(output).toContain('npm run fonts:download-web && npm run fonts:instance-web');
    },
    120_000,
  );
});
