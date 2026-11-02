import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The four-step font pipeline executor (design §3.3).
 *
 * What is under test is not "what did the font scripts do" — they have their
 * own tests — but **what the executor asks of them, and what it tells the
 * administrator**. The failure modes this feature lives or dies by:
 *
 *  - a TRUNCATED source font that the subsetter happily cuts into a family
 *    with missing glyphs (review focus #5) ⇒ a failed download must fail
 *    the STEP, not be warned about;
 *  - a local file that was reused instead of downloaded, logged as
 *    "downloaded" (spec §9.3) ⇒ the word is `skipped`;
 *  - a subset step that writes into the LIVE tree instead of the candidate
 *    ⇒ the env overlay must name the candidate and only the candidate;
 *  - a cancel that KILLS a running child and leaves half a woff2 behind
 *    (spec §9.2) ⇒ the pipeline must never kill anything;
 *  - a page cost that is fabricated instead of measured ⇒ an absent
 *    `[verify] pagecost:` line must yield `null`.
 *
 * The network and the FONT SCRIPTS are faked: `download` and `runCommand`
 * are injected, and the axis clip is mocked at the module boundary (R-26 —
 * it runs in-process, it never goes through `runCommand`). The pipeline
 * itself never starts a font script.
 *
 * ⚠️ The unit tests of `lib/webfont/run-command` at the bottom of this
 * file DO spawn a real child process — `process.execPath`, node itself,
 * running a one-line script. They never start a font script and they never
 * touch the network; they exist because the runner's real behaviour (the
 * exit code, the captured output, the env overlay) is exactly what the
 * pipeline depends on.
 */

const instanceAllMock = vi.fn();

vi.mock('@/scripts/fonts/instance-webfont-axis.mjs', () => ({
  instanceAll: (...args: unknown[]) => instanceAllMock(...args),
  STAGING_DIR: 'unused-by-the-test',
  INSTANCER_TARGETS: [],
  PYTHON_BIN: 'python',
  WEIGHT_MIN: 400,
  WEIGHT_MAX: 700,
  EXPECTED_AXIS: { min: 400, default: 400, max: 700 },
}));

import {
  runPipeline,
  parsePageCost,
  type PipelineCallbacks,
  type PipelineOptions,
  type PipelineResult,
} from '@/lib/webfont/pipeline';
import { REPO_ROOT, LIVE_FONT_DIR, SOURCE_DIR, buildDirFor } from '@/lib/webfont/paths';
import { runCommand as defaultRunCommand } from '@/lib/webfont/run-command';
import type { FontEntry } from '@/scripts/fonts/download-webfont-sources';

/** The shape of `downloadFont`, the real one this pipeline wraps. */
interface DownloadResult {
  status: 'ok' | 'skip' | 'fail';
  size?: number;
  expected?: number;
  reason?: string;
}

/** One recorded call of the fake child-process runner. */
interface RunCall {
  bin: string;
  args: string[];
  opts?: { cwd?: string; env?: Record<string, string> };
}

/** Everything the test observed. */
interface Harness {
  steps: Array<{ step: string; text: string }>;
  logs: string[];
  downloads: Array<{ entry: FontEntry; destDir: string }>;
  runs: RunCall[];
  result: PipelineResult;
}

/** Builds a `FontEntry` the download fake can recognise. */
function entry(filename: string): FontEntry {
  return { filename, urls: [`https://example.invalid/${filename}`], label: filename };
}

/**
 * Runs the pipeline with both fakes injected and returns what was
 * observed.
 */
async function runWithFakes(
  overrides: Partial<PipelineOptions> & {
    download?: (entry: FontEntry, destDir: string) => Promise<DownloadResult>;
    runCommand?: (bin: string, args: string[], opts?: RunCall['opts']) => Promise<{
      code: number;
      stdout: string;
      stderr: string;
    }>;
    shouldStop?: () => Promise<boolean>;
  } = {},
): Promise<Harness> {
  const steps: Array<{ step: string; text: string }> = [];
  const logs: string[] = [];
  const downloads: Array<{ entry: FontEntry; destDir: string }> = [];
  const runs: RunCall[] = [];

  const callbacks: PipelineCallbacks = {
    log: (line: string) => {
      logs.push(line);
    },
    step: (step, text) => {
      steps.push({ step, text });
    },
  };

  const download =
    overrides.download ??
    (async (e: FontEntry, destDir: string): Promise<DownloadResult> => {
      downloads.push({ entry: e, destDir });
      return { status: 'ok', size: 100 };
    });

  const runCommand =
    overrides.runCommand ??
    (async (bin: string, args: string[], opts?: RunCall['opts']) => {
      runs.push({ bin, args, opts });
      return { code: 0, stdout: '', stderr: '' };
    });

  const result = await runPipeline({
    jobId: 'job-1',
    callbacks,
    download,
    runCommand,
    shouldStop: overrides.shouldStop,
    sourceDir: overrides.sourceDir,
    buildDir: overrides.buildDir,
  });

  return { steps, logs, downloads, runs, result };
}

/** The stdout of a successful verify run, with a page cost on it. */
const VERIFY_STDOUT_WITH_PAGECOST = [
  '[verify] fonts-sans.css: 3 blocks, 12000 chars',
  '[verify] pagecost: {"bytes":{"/":123456,"/stories":23456},"files":{"/":4,"/stories":4},' +
    '"budgetBytes":{"/":200000,"/stories":200000},"budgetFiles":6}',
  '[verify] 0 error(s)',
].join('\n');

beforeEach(() => {
  instanceAllMock.mockReset();
  instanceAllMock.mockResolvedValue([
    { source: 'NotoSansSC-wght.ttf', out: 'NotoSansSC-wght-400-700.ttf', status: 'done', bytes: 10, reason: null },
  ]);
});

describe('lib/webfont/paths', () => {
  it('roots the repository at process.cwd(), not at __dirname', () => {
    expect(REPO_ROOT).toBe(process.cwd());
  });

  it('points the live font dir at public/font', () => {
    expect(LIVE_FONT_DIR).toBe(resolve(REPO_ROOT, 'public', 'font'));
  });

  it('gives every job its own build directory', () => {
    const dir = buildDirFor('job-abc');
    expect(dir).toBe(resolve(REPO_ROOT, 'scripts', 'fonts', 'staging', 'build', 'job-abc'));
    expect(buildDirFor('job-abc')).not.toBe(buildDirFor('job-def'));
  });

  it('agrees with the ROOT the font scripts compute for themselves', () => {
    // The scripts compute `resolve(__dirname, '..', '..')`. The pipeline
    // computes `process.cwd()`. They MUST be the same directory, or the
    // subsetter would cut a different tree than the verifier checks.
    const scriptRoot = resolve(process.cwd(), 'scripts', 'fonts');
    const scriptOwnRoot = resolve(scriptRoot, '..', '..');
    expect(REPO_ROOT).toBe(scriptOwnRoot);
  });
});

describe('runPipeline', () => {
  it('runs the four steps in order and succeeds', async () => {
    const harness = await runWithFakes();

    expect(harness.result.ok).toBe(true);
    expect(harness.result.step).toBe('verify');
    expect(harness.result.error).toBeNull();
    expect(harness.result.cancelled).toBe(false);
    // Every step announces itself before AND after it runs, so each one
    // shows up twice.
    expect(harness.steps.map((s) => s.step)).toEqual([
      'download',
      'download',
      'instance',
      'instance',
      'subset',
      'subset',
      'verify',
      'verify',
    ]);
  });

  it('fails the download step when a file does not match its size', async () => {
    // Review focus #5: a truncated source font must never reach the
    // subsetter. The downloader already refuses it; the pipeline must
    // turn that refusal into a FAILED STEP.
    const harness = await runWithFakes({
      download: async (e) =>
        e.filename === 'NotoSansSC-wght.ttf'
          ? { status: 'fail', reason: 'size mismatch: 100 bytes on disk, the server announced 25000' }
          : { status: 'ok', size: 10 },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('download');
    expect(harness.result.error).toContain('NotoSansSC-wght.ttf');
    expect(harness.result.error).toContain('size mismatch');
    // The subset step must never have started.
    expect(harness.runs).toHaveLength(0);
  });

  it('reports the missing fontTools with the word fonttools in it', async () => {
    // The axis clip runs IN-PROCESS (R-26), so its failure is a thrown
    // error, not a non-zero exit code. The message of the real failure
    // names the tool: "fontTools is not installed in ...".
    instanceAllMock.mockRejectedValue(
      new Error(
        '[instance] fontTools is not installed in "python" — install it with: ' +
          'python -m pip install --upgrade fonttools brotli',
      ),
    );

    const harness = await runWithFakes();

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('instance');
    expect(harness.result.error).toContain('fonttools');
    expect(harness.runs).toHaveLength(0);
  });

  it('logs at least once in every step', async () => {
    const harness = await runWithFakes();

    const perStep = new Map<string, number>();
    for (const line of harness.logs) {
      const match = /^\[(\w+)\]/.exec(line);
      if (!match) continue;
      perStep.set(match[1], (perStep.get(match[1]) ?? 0) + 1);
    }
    for (const step of ['download', 'instance', 'subset', 'verify']) {
      expect(perStep.get(step) ?? 0).toBeGreaterThan(0);
    }
  });

  it('cancels before the next step and never kills a child', async () => {
    let checks = 0;
    const harness = await runWithFakes({
      shouldStop: async () => {
        checks += 1;
        // The check before the SECOND step returns true.
        return checks >= 2;
      },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.cancelled).toBe(true);
    expect(harness.result.error).toBe('cancelled by admin');
    // The subset step never started ⇒ runCommand was never called.
    expect(harness.runs).toHaveLength(0);
    // Only the download step ran — and it announced itself before and
    // after. The instance step never announced itself at all.
    expect(harness.steps.map((s) => s.step)).toEqual(['download', 'download']);
  });

  it('never kills a child process', async () => {
    await runWithFakes();
    const source = readFileSync(
      resolve(process.cwd(), 'lib', 'webfont', 'pipeline.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bkill\b/);
    expect(source).not.toMatch(/taskkill/);
  });

  it('counts a reused local file as skipped, not as downloaded', async () => {
    const harness = await runWithFakes({
      download: async () => ({ status: 'skip', size: 1234 }),
    });

    expect(harness.result.ok).toBe(true);
    expect(harness.result.step).toBe('verify');
    const joined = harness.logs.join('\n');
    expect(joined).toContain('skipped');
    expect(joined).not.toMatch(/downloaded/i);
  });

  it('gives the subset step the candidate dir and the verify step the report mode', async () => {
    const harness = await runWithFakes();

    expect(harness.runs).toHaveLength(2);
    const [subsetCall, verifyCall] = harness.runs;

    const buildDir = buildDirFor('job-1');
    expect(subsetCall.opts?.cwd).toBe(REPO_ROOT);
    // The subsetter needs BOTH roots: the candidate it writes into and
    // the sources it reads from.
    expect(subsetCall.opts?.env).toEqual({
      WEBFONT_FONT_DIR: buildDir,
      WEBFONT_STAGING_DIR: SOURCE_DIR,
    });
    expect(verifyCall.opts?.cwd).toBe(REPO_ROOT);
    // The verifier reads the candidate only — it has no business with
    // the sources.
    expect(verifyCall.opts?.env).toEqual({
      WEBFONT_FONT_DIR: buildDir,
      WEBFONT_PAGE_COST: 'report',
    });

    // One env names one thing: there is no second variable for the root.
    expect(subsetCall.opts?.env?.WEBFONT_OUT_ROOT).toBeUndefined();
    expect(verifyCall.opts?.env?.WEBFONT_OUT_ROOT).toBeUndefined();
  });

  it('takes the page cost out of the verifier stdout', async () => {
    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 0, stdout: VERIFY_STDOUT_WITH_PAGECOST, stderr: '' }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(true);
    expect(harness.result.pageCost).not.toBeNull();
    expect(harness.result.pageCost?.bytes['/']).toBe(123456);
    expect(typeof harness.result.pageCost?.budgetFiles).toBe('number');
  });

  it('reports no page cost when the verifier printed none', async () => {
    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 0, stdout: '[verify] 0 error(s)', stderr: '' }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(true);
    expect(harness.result.pageCost).toBeNull();
  });

  it('does not lose the run when the page cost line does not parse', async () => {
    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 0, stdout: '[verify] pagecost: {not json}', stderr: '' }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(true);
    expect(harness.result.pageCost).toBeNull();
    // The broken line is reported, not swallowed: the log names the
    // verifier's own token and repeats the line that could not be read.
    const joined = harness.logs.join('\n');
    expect(joined).toContain('pagecost');
    expect(joined).toContain('{not json}');
  });

  it('fails the verify step and quotes the verifier findings, not the whole stderr', async () => {
    const stdout = [
      '[verify]   the sans family misses 12 chars',
      '[verify]   info: the sample page / is over its budget',
      '[verify]   the serif family misses 3 chars',
      '[verify]   the wenkai family misses 1 char',
      '[verify]   the sans family has a bad token',
      '[verify]   the serif family has a bad token',
      '[verify]   the wenkai family has a bad token',
      '[verify]   the sans family has a bad token',
      '[verify] 3 error(s)',
    ].join('\n');
    const stderr = 'a very long stderr that must never be pasted into the error';

    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 1, stdout, stderr }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('verify');
    expect(harness.result.error).toContain('the sans family misses 12 chars');
    // The informational lines are not errors.
    expect(harness.result.error).not.toContain('info: the sample page');
    // The whole stderr is never pasted.
    expect(harness.result.error).not.toContain('a very long stderr');
    // The first five findings are there, and the rest are counted. There
    // are seven findings: the `info:` line and the `3 error(s)` summary
    // are neither of them a finding.
    expect(harness.result.error).toContain('and 2 more');
  });

  it('quotes only the real findings, not the verifier\'s statistics', async () => {
    // The verifier prints SEVERAL shapes of `[verify]` line, and only one
    // of them is an error:
    //
    //   `[verify] sans   : 12000 chars, …`   ← one space   (a statistic)
    //   `[verify] css    : 12345 B gzip …`     ← one space   (a statistic)
    //   `[verify] note   : …`                 ← one space   (a note)
    //   `[verify] pagecost: {…}`              ← one space   (the measurement)
    //   `[verify] 3 error(s)`                 ← one space   (the count)
    //   `[verify]   latin: 210 char(s) …`     ← THREE spaces (a statistic!)
    //   `[verify]   info: …`                  ← THREE spaces (information)
    //   `[verify]   <message>`                ← THREE spaces (A REAL ERROR)
    //
    // A filter that accepts every `[verify]` line mixes the statistics into
    // the errors, pushes the real ones out of the quoted window and
    // reports a wrong count — the administrator would read "and 13 more"
    // when there are three errors.
    const stdout = [
      '[verify] sans   : 12000 chars, 24 files, ~1.20 MB   2 ERROR(S)',
      '[verify]   [sans] missing glyph for U+5B57',
      '[verify]   latin: 210 char(s) in 3 block(s)',
      '[verify] serif  : 11000 chars, 22 files, ~1.10 MB   1 ERROR(S)',
      '[verify]   [serif] missing glyph for U+4E2D',
      '[verify] wenkai : 10500 chars, 21 files, ~1.05 MB   1 ERROR(S)',
      '[verify]   [wenkai] missing glyph for U+6587',
      '[verify]   info: the sample page / is over its budget',
      '[verify] css    : 12345 B gzip of 65536 B   OK',
      '[verify] sample : / (10 rounds, 4 blocks)',
      '[verify] note   : the four page numbers above are the UNION of …',
      '[verify] pagecost: {"bytes":{"/":1},"files":{"/":1},"budgetBytes":{"/":2},"budgetFiles":3}',
      '[verify] 3 error(s)',
    ].join('\n');

    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 1, stdout, stderr: 'a stack nobody can act on' }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('verify');
    const error = harness.result.error ?? '';

    // ⚠️ NONE of the statistics may appear in the error message.
    expect(error).not.toContain('12000 chars');
    expect(error).not.toContain('latin:');
    expect(error).not.toContain('css    :');
    expect(error).not.toContain('note   :');
    expect(error).not.toContain('pagecost');
    expect(error).not.toContain('sample :');
    expect(error).not.toContain('info:');
    expect(error).not.toContain('error(s)');

    // ⚠️ AND all three real errors are quoted, with the TRUE count.
    expect(error).toContain('[sans] missing glyph for U+5B57');
    expect(error).toContain('[serif] missing glyph for U+4E2D');
    expect(error).toContain('[wenkai] missing glyph for U+6587');
    expect(error).not.toContain('and 1 more');
    expect(error).not.toContain('more)');
  });

  it('quotes five findings and counts the rest', async () => {
    // Six real findings: five are quoted, the sixth is counted.
    const stdout = [
      '[verify] sans   : 12000 chars, 24 files, ~1.20 MB   6 ERROR(S)',
      '[verify]   error one',
      '[verify]   error two',
      '[verify]   error three',
      '[verify]   error four',
      '[verify]   error five',
      '[verify]   error six',
      '[verify] 6 error(s)',
    ].join('\n');

    const harness = await runWithFakes({
      runCommand: async (bin, args) =>
        args[0].includes('verify-webfont-subsets')
          ? { code: 1, stdout, stderr: '' }
          : { code: 0, stdout: '', stderr: '' },
    });

    expect(harness.result.ok).toBe(false);
    const error = harness.result.error ?? '';
    expect(error).toContain('error one');
    expect(error).toContain('error five');
    expect(error).not.toContain('error six');
    expect(error).toContain('and 1 more');
  });

  it('turns a failed spawn into a failed subset step, not into a thrown error', async () => {
    // A spawn that cannot even start (ENOENT, EPERM, EACCES) rejects.
    // The pipeline's contract is that a step either finishes or it fails —
    // a rejection must not escape `runPipeline` and take the whole job
    // with it.
    const harness = await runWithFakes({
      runCommand: async (bin, args) => {
        if (args[0].includes('build-webfont-subsets')) {
          throw new Error('spawn ENOENT');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('subset');
    expect(harness.result.error).toContain('ENOENT');
    expect(harness.logs.join('\n')).toContain('[subset] FAILED');
  });

  it('turns a failed spawn into a failed verify step, not into a thrown error', async () => {
    const harness = await runWithFakes({
      runCommand: async (bin, args) => {
        if (args[0].includes('verify-webfont-subsets')) {
          throw new Error('spawn EPERM');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    expect(harness.result.ok).toBe(false);
    expect(harness.result.step).toBe('verify');
    expect(harness.result.error).toContain('EPERM');
    expect(harness.logs.join('\n')).toContain('[verify] FAILED');
  });

  it('gives the subset step the source directory it was told to use', async () => {
    // The subsetter reads the SOURCE fonts from its own hard-coded staging
    // directory. Without this the `sourceDir` option would only serve
    // steps ① and ②, and step ③ would cut a tree nobody asked for.
    const sourceDir = resolve(REPO_ROOT, 'tmp', 'a-source-dir');
    const harness = await runWithFakes({ sourceDir });

    expect(harness.runs).toHaveLength(2);
    const [subsetCall] = harness.runs;
    expect(subsetCall.opts?.env?.WEBFONT_STAGING_DIR).toBe(sourceDir);
    // The verifier reads the CANDIDATE, not the source — it must not be
    // pointed at the sources.
    expect(harness.runs[1].opts?.env?.WEBFONT_STAGING_DIR).toBeUndefined();
  });

  it('never mutates process.env', async () => {
    const before = { ...process.env };
    await runWithFakes();
    expect(process.env).toEqual(before);
  });
});

describe('parsePageCost', () => {
  /** Wraps a payload in the line the verifier prints. */
  function line(payload: string): string {
    return `[verify] pagecost: ${payload}`;
  }

  it('returns the measurement when every field is there and well typed', () => {
    const parsed = parsePageCost(
      line(
        '{"bytes":{"/":123456,"/stories":23456},"files":{"/":4,"/stories":4},' +
          '"budgetBytes":{"/":200000,"/stories":200000},"budgetFiles":6}',
      ),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.bytes['/']).toBe(123456);
    expect(parsed?.files['/stories']).toBe(4);
    expect(parsed?.budgetBytes['/']).toBe(200000);
    expect(parsed?.budgetFiles).toBe(6);
  });

  it('returns null when a field is missing', () => {
    // A measurement without its budget is not a measurement: the pipeline
    // would report a page cost it cannot compare against anything.
    expect(
      parsePageCost(
        line('{"bytes":{"/":123456},"files":{"/":4},"budgetBytes":{"/":200000}}'),
      ),
    ).toBeNull();
  });

  it('returns null when a field has the wrong type', () => {
    expect(
      parsePageCost(
        line(
          '{"bytes":"not-a-number","files":{"/":4},' +
            '"budgetBytes":{"/":200000},"budgetFiles":6}',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when a nested value is not a number', () => {
    expect(
      parsePageCost(
        line(
          '{"bytes":{"/":"lots"},"files":{"/":4},' +
            '"budgetBytes":{"/":200000},"budgetFiles":6}',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when the payload is not an object at all', () => {
    expect(parsePageCost(line('42'))).toBeNull();
    expect(parsePageCost(line('[1,2,3]'))).toBeNull();
    expect(parsePageCost(line('"a string"'))).toBeNull();
  });

  it('returns null when there is no pagecost line at all', () => {
    expect(parsePageCost('[verify] 0 error(s)')).toBeNull();
    expect(parsePageCost('')).toBeNull();
  });
});

describe('lib/webfont/run-command', () => {
  it('runs a child process and captures its output', async () => {
    const result = await defaultRunCommand(
      process.execPath,
      ['-e', 'process.stdout.write("hello"); process.stderr.write("oops")'],
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.stderr).toContain('oops');
  });

  it('reports a non-zero exit as a result, not as an exception', async () => {
    const result = await defaultRunCommand(process.execPath, ['-e', 'process.exit(3)']);
    expect(result.code).toBe(3);
  });

  it('passes the env as an overlay, so the child still has its PATH', async () => {
    const result = await defaultRunCommand(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.env.WEBFONT_FONT_DIR) + "|" + String(Boolean(process.env.PATH)))'],
      { env: { WEBFONT_FONT_DIR: 'candidate-dir' } },
    );

    expect(result.stdout).toContain('candidate-dir');
    expect(result.stdout).toContain('true');
  });
});
