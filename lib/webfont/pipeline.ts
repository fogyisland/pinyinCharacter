/**
 * The four-step font pipeline, as one job (design §3.3).
 *
 * ```
 *   ① download  →  ② instance  →  ③ subset  →  ④ verify
 *   sources        axis clip      woff2 cuts    checks + page cost
 * ```
 *
 * Each step is a boundary: it either finishes or it fails, and a failure
 * stops the run there. The pipeline never continues past a step that did
 * not do its job — most of all it never continues past a source font that
 * did not arrive intact.
 *
 * ## What this module is careful about
 *
 *  - **A truncated font is a failed step, not a warning.** `downloadFont`
 *    already refuses a file whose size does not match what the server
 *    announced; this pipeline turns that refusal into a failed step and
 *    names the file. A half font would otherwise be cut into a family that
 *    is quietly missing half its glyphs.
 *  - **A candidate is a candidate.** Steps ③ and ④ write into (and read
 *    from) the job's own build directory. The live tree is never touched
 *    here.
 *  - **Cancelling waits.** `shouldStop` is asked once, before each step.
 *    A running child is never signalled — killing it could leave half a
 *    woff2 behind — so the current step runs to its natural end and the
 *    NEXT step is the one that does not start.
 *  - **No number is invented.** The page cost is what the verifier
 *    measured; if the verifier did not print it, it is `null`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WebfontJobStep } from '@/lib/webfont/jobs';
import { REPO_ROOT, SOURCE_DIR, buildDirFor } from '@/lib/webfont/paths';
import { runCommand as defaultRunCommand } from '@/lib/webfont/run-command';
import {
  SOURCES,
  downloadFont,
  type FontEntry,
} from '@/scripts/fonts/download-webfont-sources';
import { instanceAll } from '@/scripts/fonts/instance-webfont-axis.mjs';
import type { PageCostReport } from '@/scripts/fonts/verify-webfont-subsets.d.mts';

/** What the pipeline tells the caller about its progress. */
export interface PipelineCallbacks {
  /** Appends one line to the job's log. The database stamps the time. */
  log(line: string): void | Promise<void>;
  /** Reports which step is running, and a short English description. */
  step(step: WebfontJobStep, text: string): void | Promise<void>;
}

/** The result of one download. Mirrors the real `downloadFont`. */
export interface DownloadOutcome {
  status: 'ok' | 'skip' | 'fail';
  size?: number;
  expected?: number;
  reason?: string;
}

/** The result of one child process. */
export interface CommandOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

/** The options the pipeline accepts. */
export interface PipelineOptions {
  /** Which job this is — it names the candidate directory. */
  jobId: string;
  callbacks: PipelineCallbacks;
  /** Where the source fonts live. Defaults to the shared staging directory. */
  sourceDir?: string;
  /** Where the candidate is built. Defaults to this job's own directory. */
  buildDir?: string;
  /** Downloads one source font. Defaults to the real `downloadFont`. */
  download?: (entry: FontEntry, destDir: string) => Promise<DownloadOutcome>;
  /** Runs a child process. Defaults to the shared runner. */
  runCommand?: (
    bin: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ) => Promise<CommandOutcome>;
  /** Asked once before every step: true means "do not start the next step". */
  shouldStop?: () => Promise<boolean>;
}

/** What the pipeline reports back to the job runner. */
export interface PipelineResult {
  ok: boolean;
  step: WebfontJobStep;
  error: string | null;
  manifestVersion: string | null;
  /** True when the administrator cancelled — that is not a failure. */
  cancelled: boolean;
  pageCost: PageCostReport | null;
}

/** The scripts the pipeline drives. */
const SUBSET_SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'build-webfont-subsets.mjs');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs');

/** The prefix of the line the verifier prints with its page cost. */
const PAGECOST_PREFIX = '[verify] pagecost: ';

/**
 * The prefix of a REAL verifier finding: `[verify]` and THREE spaces.
 *
 * The verifier prints its statistics with ONE space after the tag; only
 * the findings have three. See `extractFindings`.
 */
const FINDING_PREFIX = '[verify]   ';

/** How many verifier findings the error message quotes. */
const MAX_QUOTED_FINDINGS = 5;

/**
 * Runs the four steps, in order.
 *
 * The result says which step the run reached, whether it failed, whether
 * it was cancelled, and what the candidate's page cost measured out to.
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { jobId, callbacks } = options;
  const sourceDir = options.sourceDir ?? SOURCE_DIR;
  const buildDir = options.buildDir ?? buildDirFor(jobId);
  const download = options.download ?? defaultDownload;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const shouldStop = options.shouldStop;

  const log = async (line: string): Promise<void> => {
    await callbacks.log(line);
  };
  const step = async (name: WebfontJobStep, text: string): Promise<void> => {
    await callbacks.step(name, text);
  };

  // A cancellation is not a failure: `error` says it was cancelled, and
  // `cancelled` says so separately so the caller can tell the two apart.
  const cancelledResult = (reached: WebfontJobStep): PipelineResult => ({
    ok: false,
    step: reached,
    error: 'cancelled by admin',
    manifestVersion: null,
    cancelled: true,
    pageCost: null,
  });

  const failedResult = (reached: WebfontJobStep, error: string): PipelineResult => ({
    ok: false,
    step: reached,
    error,
    manifestVersion: null,
    cancelled: false,
    pageCost: null,
  });

  // ── ① download ──────────────────────────────────────────────────────────
  if (await shouldStop?.()) {
    return cancelledResult('');
  }
  await step('download', 'downloading source fonts');
  await log('[download] fetching the source fonts');

  const downloadFailure = await runDownloadStep(download, sourceDir, log);
  if (downloadFailure) {
    await step('download', 'download failed');
    return failedResult('download', downloadFailure);
  }
  await step('download', 'source fonts ready');

  // ── ② instance (axis clipping) ──────────────────────────────────────────
  if (await shouldStop?.()) {
    return cancelledResult('download');
  }
  await step('instance', 'clipping the weight axis');
  await log('[instance] clipping the weight axis (400-700)');

  // The clip runs IN-PROCESS: it is a library call into fontTools, not a
  // script with an exit code. `force` is deliberately NOT set — re-clipping
  // would change the bytes, which would change the version token, which
  // would force a full re-download of every subset.
  let instanceResults: Array<{ out: string; status: string; reason: string | null }>;
  try {
    instanceResults = await instanceAll({ stagingDir: sourceDir });
  } catch (error) {
    const message = errorMessage(error);
    await log(`[instance] FAILED: ${message}`);
    await step('instance', 'axis clipping failed');
    return failedResult('instance', message);
  }

  for (const item of instanceResults) {
    if (item.status === 'skipped') {
      await log(`[instance] ${item.out}: skipped (axis instance already present)`);
    } else {
      await log(`[instance] ${item.out}: clipped`);
    }
  }
  await step('instance', 'axis clipped');

  // ── ③ subset ────────────────────────────────────────────────────────────
  if (await shouldStop?.()) {
    return cancelledResult('instance');
  }
  await step('subset', 'cutting the woff2 subsets');
  await log(`[subset] cutting the subsets into ${buildDir}`);

  // The subsetter reads the SOURCE fonts and writes into the candidate
  // directory. `WEBFONT_FONT_DIR` is the one variable that names the
  // candidate; `WEBFONT_STAGING_DIR` names the sources. There is
  // deliberately no second variable for the output root, because two
  // variables that mean the same thing drift apart.
  let subsetRun: CommandOutcome;
  try {
    subsetRun = await runCommand(process.execPath, [SUBSET_SCRIPT], {
      cwd: REPO_ROOT,
      env: { WEBFONT_FONT_DIR: buildDir, WEBFONT_STAGING_DIR: sourceDir },
    });
  } catch (error) {
    // A spawn that cannot even start (ENOENT, EPERM, EACCES) rejects.
    // That is a FAILED STEP, not a thrown error: the pipeline's contract
    // is that a step either finishes or it fails.
    const message = errorMessage(error);
    await log(`[subset] FAILED: ${message}`);
    await step('subset', 'subsetting failed');
    return failedResult('subset', message);
  }
  await log(`[subset] exit code ${subsetRun.code}`);
  if (subsetRun.code !== 0) {
    const message = describeCommandFailure('subset', subsetRun);
    await log(`[subset] FAILED: ${message}`);
    await step('subset', 'subsetting failed');
    return failedResult('subset', message);
  }
  await step('subset', 'subsets ready');

  // ── ④ verify ────────────────────────────────────────────────────────────
  if (await shouldStop?.()) {
    return cancelledResult('subset');
  }
  await step('verify', 'verifying the candidate');
  await log('[verify] checking the candidate');

  // `WEBFONT_PAGE_COST=report` measures the candidate's page cost and
  // REPORTS it; it does not enforce it. The gate on the live tree is a
  // separate run in `enforce` mode. The intrinsic checks (coverage,
  // disjointness, glyph count, block size, CSS size, face count, manifest,
  // token, identity, weight, directory, latin) still fail the step.
  let verifyRun: CommandOutcome;
  try {
    verifyRun = await runCommand(process.execPath, [VERIFY_SCRIPT], {
      cwd: REPO_ROOT,
      env: { WEBFONT_FONT_DIR: buildDir, WEBFONT_PAGE_COST: 'report' },
    });
  } catch (error) {
    // Same as step ③: a spawn that cannot start is a failed step, not a
    // thrown error. There is no page cost to parse on this path — the
    // child never ran.
    const message = errorMessage(error);
    await log(`[verify] FAILED: ${message}`);
    await step('verify', 'verification failed');
    return failedResult('verify', message);
  }
  await log(`[verify] exit code ${verifyRun.code}`);

  const pageCost = parsePageCost(verifyRun.stdout);
  if (pageCost === null) {
    // A line that is there but does not parse is REPORTED, not swallowed;
    // a line that is not there at all is simply "not measured".
    const broken = findPageCostLine(verifyRun.stdout);
    await log(
      broken === null
        ? '[verify] no page cost was measured'
        : `[verify] the pagecost line could not be read: ${broken}`,
    );
  }

  if (verifyRun.code !== 0) {
    const message = describeCommandFailure('verify', verifyRun);
    await log(`[verify] FAILED: ${message}`);
    await step('verify', 'verification failed');
    return failedResult('verify', message);
  }
  await step('verify', 'candidate verified');

  const manifestVersion = await readManifestVersion(buildDir);
  if (manifestVersion) {
    await log(`[verify] candidate manifest version ${manifestVersion}`);
  }

  return {
    ok: true,
    step: 'verify',
    error: null,
    manifestVersion,
    cancelled: false,
    pageCost,
  };
}

/**
 * Downloads every source font.
 *
 * Returns the error message when a file failed, or `null` when all of
 * them are there. A file that was reused locally (`skip`) counts as
 * SUCCESS — it is not a failure — but it is logged as `skipped`, never as
 * `downloaded`.
 */
async function runDownloadStep(
  download: (entry: FontEntry, destDir: string) => Promise<DownloadOutcome>,
  sourceDir: string,
  log: (line: string) => Promise<void>,
): Promise<string | null> {
  for (const entry of SOURCES) {
    const outcome = await download(entry, sourceDir);

    if (outcome.status === 'fail') {
      // The name of the file and the reason both go in: the administrator
      // has to know WHICH font is broken and WHY.
      const reason = outcome.reason ?? 'the download failed for an unknown reason';
      await log(`[download] ${entry.filename}: FAILED — ${reason}`);
      return `download of ${entry.filename} failed: ${reason}`;
    }

    if (outcome.status === 'skip') {
      await log(`[download] ${entry.filename}: skipped (a matching local file is already there)`);
      continue;
    }

    const size = typeof outcome.size === 'number' ? `${outcome.size} bytes` : 'an unknown size';
    await log(`[download] ${entry.filename}: downloaded (${size})`);
  }

  await log(`[download] ${SOURCES.length} source fonts are ready`);
  return null;
}

/**
 * The real downloader, wrapped so that the pipeline always passes an
 * explicit destination.
 */
async function defaultDownload(entry: FontEntry, destDir: string): Promise<DownloadOutcome> {
  return downloadFont(entry, destDir);
}

/**
 * Reads the page cost out of the verifier's stdout.
 *
 * The verifier prints one line — `[verify] pagecost: {…}` — and only in
 * `report` mode, and only when it could actually measure the cost. A
 * missing line means `null`; a line that does not parse is LOGGED and
 * also means `null`. A page cost is never invented.
 *
 * ⚠️ The payload is CHECKED, not cast: every one of the five fields of
 * `PageCostReport` must be there and must have the right type. A JSON
 * object that merely happens to be an object (`{"foo":1}`) is not a
 * measurement, and reporting one would put a number in the admin page
 * that was never measured.
 */
export function parsePageCost(stdout: string): PageCostReport | null {
  const payload = findPageCostLine(stdout);
  if (payload === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  return toPageCostReport(parsed);
}

/**
 * Turns a parsed JSON value into a `PageCostReport`, or `null` when it
 * is not one.
 *
 * The five fields are all required: `bytes`, `files` and `budgetBytes`
 * are records of numbers, `budgetFiles` is a number. A record is an
 * object that is not an array and whose every value is a number.
 */
function toPageCostReport(value: unknown): PageCostReport | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const bytes = toNumberRecord(record.bytes);
  const files = toNumberRecord(record.files);
  const budgetBytes = toNumberRecord(record.budgetBytes);
  if (bytes === null || files === null || budgetBytes === null) return null;

  const budgetFiles = record.budgetFiles;
  if (typeof budgetFiles !== 'number' || !Number.isFinite(budgetFiles)) return null;

  return { bytes, files, budgetBytes, budgetFiles };
}

/**
 * A record of numbers, or `null` when the value is not one.
 */
function toNumberRecord(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, number> = {};
  for (const [key, entry] of entries) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    result[key] = entry;
  }
  return result;
}

/**
 * The payload of the page cost line — the text after the prefix — or
 * `null` when the verifier did not print one.
 */
function findPageCostLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(PAGECOST_PREFIX)) continue;
    return line.slice(PAGECOST_PREFIX.length).trim();
  }
  return null;
}

/**
 * Turns a failed child process into one error message.
 *
 * The verifier prints its findings on STDOUT, one per line, as
 * `[verify]   <message>`; the informational ones are `[verify]   info:
 * <message>`. The first five real findings are quoted and the rest are
 * counted. The whole stderr is never pasted — it is usually a stack
 * trace nobody can act on.
 */
function describeCommandFailure(step: string, run: CommandOutcome): string {
  const findings = extractFindings(run.stdout);
  if (findings.length === 0) {
    const tail = run.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    return tail
      ? `${step} failed with exit code ${run.code}: ${tail}`
      : `${step} failed with exit code ${run.code}`;
  }

  const quoted = findings.slice(0, MAX_QUOTED_FINDINGS);
  const rest = findings.length - quoted.length;
  const body = quoted.join('; ');
  return rest > 0
    ? `${step} failed with exit code ${run.code}: ${body} (and ${rest} more)`
    : `${step} failed with exit code ${run.code}: ${body}`;
}

/**
 * The error lines of the verifier's stdout — the informational ones are
 * not errors and are left out.
 *
 * ⚠️ The prefix is THREE spaces, and that is the whole filter:
 *
 *   `[verify] sans   : 12000 chars, …`  ← ONE space   (a statistic)
 *   `[verify] css    : 12345 B gzip …`    ← ONE space   (a statistic)
 *   `[verify] note   : …`                ← ONE space   (a note)
 *   `[verify] pagecost: {…}`             ← ONE space   (the measurement)
 *   `[verify] 3 error(s)`                ← ONE space   (the count)
 *   `[verify]   latin: 210 char(s) …`    ← THREE spaces (a statistic!)
 *   `[verify]   info: …`                 ← THREE spaces (information)
 *   `[verify]   <message>`               ← THREE spaces (A REAL ERROR)
 *
 * The one-space lines are the statistics and the count; they are left out
 * by the prefix alone. Two three-space lines are NOT errors and have to
 * be excluded by name: `info:` (information) and `latin:` (a count of
 * the Latin tier). Everything else with three spaces is a real error.
 *
 * A looser filter would let the statistics into the findings: the real
 * errors would be pushed out of the quoted window and the count would be
 * wrong — the administrator would read "and 13 more" when the verifier
 * found three errors.
 */
function extractFindings(stdout: string): string[] {
  const findings: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(FINDING_PREFIX)) continue;
    const body = line.slice(FINDING_PREFIX.length).trim();
    if (body === '') continue;
    if (body.startsWith('info:')) continue;
    // The Latin tier's own count has three spaces too — it is a
    // statistic, not an error.
    if (body.startsWith('latin:')) continue;
    findings.push(body);
  }
  return findings;
}

/**
 * Reads the version token out of the candidate's manifest.
 *
 * The candidate's manifest is written by the subsetter into the build
 * directory. A manifest that is missing (or unreadable, or without a
 * version) means `null` — the pipeline never invents a version.
 */
async function readManifestVersion(buildDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(buildDir, 'fonts-manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * The message of a thrown value.
 *
 * Only the MESSAGE is used — the pipeline does not look at any structured
 * field of the error, so it does not depend on the shape of the thrower.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
    return error.message;
  }
  if (typeof error === 'string' && error !== '') return error;
  return 'the step failed for an unknown reason';
}
