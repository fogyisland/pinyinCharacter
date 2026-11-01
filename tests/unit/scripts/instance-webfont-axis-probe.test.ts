/**
 * How often the axis clip asks for the toolchain.
 *
 * The probe of fontTools spawns a Python subprocess, and the answer of it
 * does not change while the process runs: the interpreter either is there
 * or it is not. Two properties are proved here:
 *
 *   1. ONE PROBE PER RUN. A run that clips both variable fonts asks the
 *      toolchain ONCE, not once per font.
 *   2. ZERO PROBES WHEN NOTHING IS CLIPPED. A run in which every axis
 *      instance is already there must not spawn the probe at all: the
 *      probe is asked LAZILY, when a clip is really needed. Hoisting the
 *      probe out of the loop would break this — it would spawn one
 *      subprocess for a run that had nothing to do.
 *
 * The subprocesses are MOCKED here, because the test counts the probes
 * instead of measuring them, and because the real probe would make the
 * test depend on the machine having Python and fontTools installed.
 * The mock has the shape of the real thing: the probe answers with the
 * help of the module, and the clip leaves the output file behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[] }>,
}));

/** The interpreter that is NOT there — the mock fails on it. */
const MISSING_PYTHON = 'pinyin-no-such-python-interpreter';

vi.mock('node:child_process', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  return {
    execFileSync: (
      file: string,
      args: string[] = [],
      options?: { cwd?: string },
    ): string => {
      calls.push({ file, args: [...args] });
      // An interpreter that is not there cannot be started. The shape of
      // the error is the one of a real spawn failure: a STRING code and
      // NO exit status.
      if (file === 'pinyin-no-such-python-interpreter') {
        const error = new Error(`spawnSync ${file} ENOENT`);
        Object.assign(error, { code: 'ENOENT', status: null, stderr: '' });
        throw error;
      }
      // The clip has to leave the output file behind, or the run would
      // fail on "the clip produced no file" and prove nothing about the
      // probe.
      const outIndex = args.indexOf('--output');
      if (outIndex >= 0) {
        const out = args[outIndex + 1];
        fs.writeFileSync(path.join(options?.cwd ?? '', out), 'clipped');
      }
      return '';
    },
  };
});

vi.mock('fontkit', () => ({
  create: (buffer: Buffer) => {
    // A file that is not a font at all: the download is truncated, or it
    // is an HTML error page. The real fontkit throws on it, and so does
    // the mock — the failure ESCAPES the clip, and it has to carry the
    // kind of a clip failure.
    if (buffer.toString('utf8').includes('not a font')) {
      throw new Error('Unknown font format');
    }
    return {
      variationAxes: { wght: { min: 400, default: 400, max: 700 } },
    };
  },
}));

/** The probes the run asked for — the calls that carry `--help`. */
function probes(): Array<{ file: string; args: string[] }> {
  return calls.filter((call) => call.args.includes('--help'));
}

/** A staging directory that holds the given files. */
function stagingWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'webfont-probe-'));
  for (const name of files) {
    writeFileSync(join(dir, name), 'a font');
  }
  return dir;
}

const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the axis clip asks for the toolchain once', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
  });

  it('asks for fontTools once when it clips both variable fonts', async () => {
    const staging = stagingWith(['NotoSansSC-wght.ttf', 'NotoSerifSC-wght.ttf']);
    directories.push(staging);

    const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
    const results = await instancer.instanceAll({ stagingDir: staging });

    expect(results.map((result) => result.status)).toEqual(['done', 'done']);
    // ONE probe for TWO fonts: the answer of the probe does not change
    // while the run goes on, so it is asked once and then reused.
    expect(probes()).toHaveLength(1);
  });

  it('asks for nothing when every font is clipped already', async () => {
    // The axis instances are already there: the run has nothing to clip,
    // so it must not spawn the probe at all.
    const staging = stagingWith([
      'NotoSansSC-wght-400-700.ttf',
      'NotoSerifSC-wght-400-700.ttf',
    ]);
    directories.push(staging);

    const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
    const results = await instancer.instanceAll({ stagingDir: staging });

    expect(results.map((result) => result.status)).toEqual(['skipped', 'skipped']);
    expect(probes()).toHaveLength(0);
    // Nothing was clipped, so nothing was spawned at all.
    expect(calls).toHaveLength(0);
  });

  it('tells the operator what to install when the interpreter is missing', async () => {
    // The remedy of a missing toolchain is NOT "fix the source fonts" —
    // the source fonts are innocent here. The failure carries the kind of
    // it, and the CLI picks the remedy that fits.
    const staging = stagingWith(['NotoSansSC-wght.ttf']);
    directories.push(staging);

    // ⚠️ PYTHON is read when the module loads, so the override has to be
    // in place BEFORE the import — and the modules were reset already.
    process.env.PYTHON = MISSING_PYTHON;
    try {
      const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
      await expect(
        instancer.instanceAll({ stagingDir: staging }),
      ).rejects.toThrow(/Install Python 3, or point PYTHON at the interpreter that owns fontTools\./);
    } finally {
      delete process.env.PYTHON;
    }
  });

  it('tags a missing toolchain as a toolchain failure', async () => {
    // ⚠️ The tag is what lets the CLI pick the remedy that FITS the
    // failure (G12). A missing toolchain and a broken source font need
    // two different remedies, so the failure has to say which one it is.
    const empty = stagingWith([]);
    directories.push(empty);

    // ⚠️ PYTHON is read when the module loads, so the override has to be
    // in place BEFORE the import — and the modules were reset already.
    process.env.PYTHON = MISSING_PYTHON;
    try {
      const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
      await expect(instancer.instanceAll({ stagingDir: empty })).rejects.toMatchObject({
        kind: 'toolchain',
      });
    } finally {
      delete process.env.PYTHON;
    }
  });

  it('tags a broken source font as a clip failure', async () => {
    // The source font is missing: the failure is a CLIP failure, and the
    // source fonts are the ones to fix. ⚠️ The interpreter is the REAL
    // one here (the subprocess is mocked, so it answers), so the failure
    // cannot be a toolchain failure.
    const withoutSources = stagingWith([]);
    directories.push(withoutSources);

    const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
    await expect(
      instancer.instanceAll({ stagingDir: withoutSources }),
    ).rejects.toMatchObject({ kind: 'clip' });
  });

  it('tags a source font that cannot be read as a clip failure', async () => {
    // ⚠️ A failure that ESCAPES the clip is a failure of the SOURCE
    // FONT: a download that is truncated, a file that is not a font at
    // all. It has to carry the kind of it, or the operator would be left
    // without a remedy — the toolchain is innocent here.
    const broken = stagingWith(['NotoSansSC-wght.ttf']);
    writeFileSync(join(broken, 'NotoSansSC-wght.ttf'), 'not a font');
    directories.push(broken);

    const instancer = await import('../../../scripts/fonts/instance-webfont-axis.mjs');
    await expect(instancer.instanceAll({ stagingDir: broken })).rejects.toMatchObject({
      kind: 'clip',
    });
  });
});
