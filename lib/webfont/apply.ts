/**
 * The publish step of the font pipeline (design §3.5.2).
 *
 * An apply takes a finished staging build and makes it live. It does that
 * in the only order that can be safe: **build first, verify second, swap
 * last**. Nothing under the live tree changes until the candidate has passed
 * the wave-2 gate.
 *
 * ## The one invariant: G-3
 *
 * A visitor who cached the OLD stylesheet must never get a 404. Every woff2
 * the old stylesheet named has to still be there, **byte for byte**, after
 * the apply. That is why an apply:
 *
 *  - publishes a NEW release directory (`web/r<token>/`) instead of
 *    overwriting the files of the old one;
 *  - rewrites the three stylesheets in MEMORY and swaps them in only at the
 *    very end;
 *  - and never deletes anything. The cleanup is a separate, explicit action
 *    (design §4.2).
 *
 * ## The two tokens
 *
 *  - **T** (the publish token) = the staging manifest's `version` — the hash
 *    of the stylesheets BEFORE the rewrite. It names the release directory.
 *  - **V** (the manifest version) = the hash of the stylesheets AFTER the
 *    rewrite. It goes into `fonts-manifest.json` and becomes the stylesheets'
 *    `?v=` query.
 *
 * They are different on purpose: the publish token has to be written INTO
 * the stylesheets, and the manifest version has to be the hash of the
 * stylesheets that were written. Chicken and egg ⇒ two tokens.
 *
 * ## Why the V hash is computed HERE and not imported
 *
 * `scripts/fonts/build-webfont-subsets.mjs` imports `subset-font` (a
 * harfbuzz wasm build) and `scripts/fonts/verify-webfont-subsets.mjs`
 * imports `fontkit`. Importing either from a Next.js **server** module
 * drags those into the server bundle. So the hash is computed locally —
 * and the local copy is **pinned by a test** against the authoritative
 * `manifestVersion()`, so a drift in wave-2 goes red instead of silent.
 *
 * ⚠️ The KEYS of the hash are the **file names** of the stylesheets
 * (`fonts-sans.css`, …), not the family keys and not the URLs. The keys only
 * decide the ORDER; the hash is over the CSS **contents**. A wrong key
 * produces a wrong V — and a wrong V makes the idempotence check refuse a
 * correct publish.
 *
 * ## What this module does NOT do
 *
 *  - It does not delete old releases. `removeReleaseDirs` is deliberately
 *    NOT imported here: the cleanup has its own gates (design §4.2), and an
 *    apply that "just happens to tidy up" would walk straight through them.
 *    The ONE deletion this module performs is its own rollback: the release
 *    directory it just created, when the gate refuses it.
 *  - It does not run git. The backend never touches the repository
 *    (design §9, rule 5) — it only says what a human has to do.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { LIVE_FONT_DIR, REPO_ROOT } from './paths';
import { readReleases, writeReleases, markSuperseded, type ReleaseRecord } from './releases';
import { runCommand as defaultRunCommand } from './run-command';
import { buildRebaselineChecklist, type RebaselineEntry } from './rebaseline';
import type { PageCostReport } from '@/scripts/fonts/verify-webfont-subsets.d.mts';

/** The three families of the site. */
const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/**
 * The six stylesheets, by their file name — the key of the V hash.
 *
 * Every family has TWO stylesheets since the ext tier was split out of
 * the render-blocking one: the hot tier and the ext tier. Both are
 * released together — a release with only the hot sheet would leave the
 * ext characters of the site without a font.
 */
const STYLESHEETS = [
  'fonts-sans-hot.css',
  'fonts-sans-ext.css',
  'fonts-serif-hot.css',
  'fonts-serif-ext.css',
  'fonts-wenkai-hot.css',
  'fonts-wenkai-ext.css',
] as const;

/** The prefix of the line the verifier prints with its page cost. */
const PAGECOST_PREFIX = '[verify] pagecost: ';

/**
 * The prefix of a REAL verifier finding: `[verify]` and THREE spaces.
 *
 * The verifier prints its statistics with ONE space after the tag; only the
 * findings have three.
 */
const FINDING_PREFIX = '[verify]   ';

/** How many verifier findings the error message quotes. */
const MAX_QUOTED_FINDINGS = 10;

/** The prefix of the line the verifier prints with the number of its errors. */
const ERROR_COUNT_PATTERN = /^\[verify\] \d+ error\(s\)/;

/**
 * The options of an apply.
 *
 * ⚠️ The `runCommand` injection point is the LOOSE one — `opts` is
 * optional, and `env` is an overlay of `Record<string, string>`. A loose
 * injection point is easy to fake in a test, and the default implementation
 * is the shared `lib/webfont/run-command.ts` — one runner for the whole
 * pipeline, not a second copy.
 */
export interface ApplyOptions {
  /** The job this apply belongs to. */
  jobId: string;
  /** The staging font root — it holds `fonts-*.css`, the manifest and `web/`. */
  stagedFontDir: string;
  /** The live font root. Defaults to the published tree. */
  liveFontDir?: string;
  /**
   * How many releases to keep. Accepted for interface compatibility with
   * the cleanup — **an apply never deletes anything** (design §4.2).
   */
  keepReleases?: number;
  /**
   * How long a superseded release is kept. Accepted for interface
   * compatibility with the cleanup — **an apply never deletes anything**
   * (design §4.2).
   */
  maxAgeDays?: number;
  /** How the gate is started. Defaults to the shared runner. */
  runCommand?: (
    bin: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
}

/** The facts about the product that has to be re-imported into the repository. */
export interface ReimportInfo {
  /** Always true — the product is on the server and not in the repository. */
  required: boolean;
  /** The command that re-imports the release. */
  command: string;
  /** What happens when the command is not run. */
  note: string;
}

/** The difference between the live tree and the new product. */
export interface ApplySummary {
  /** How many woff2 files the live tree held before the apply. */
  liveFiles: number;
  /** How many bytes they held. */
  liveBytes: number;
  /** How many woff2 files the new product holds. */
  newFiles: number;
  /** How many bytes they hold. */
  newBytes: number;
  /** How many bytes the new release directory occupies on the disk. */
  releaseBytes: number;
}

/** What an apply reports back. */
export interface ApplyResult {
  /** Whether the product went live. */
  ok: boolean;
  /** V — the hash of the REWRITTEN stylesheets, the version of the manifest. */
  manifestVersion: string | null;
  /** T — the publish token, the name of the release directory without its `r`. */
  releaseToken: string | null;
  /** The release directory — `r<T>`. */
  releaseDir: string | null;
  /** How many faces the rewrite touched. */
  rewrittenFaces: number;
  /**
   * Always an EMPTY ARRAY: an apply deletes nothing (design §4.2). The
   * cleanup is a separate, explicit admin action.
   */
  swept: string[];
  /** The release this apply superseded, or `null` when there was none. */
  supersededDir: string | null;
  /** The reason the apply failed, or `null` when it succeeded. */
  error: string | null;
  /** The difference between the live tree and the new product. */
  summary: ApplySummary | null;
  /**
   * The page cost of the candidate, measured against the union sample, with
   * the OLD budgets beside it.
   *
   * ⚠️ The panel shows the two side by side and says which lines have to
   * change. The backend NEVER rewrites `LIMITS` — that would be a false
   * green light.
   */
  pageCost: PageCostReport | null;
  /** What a human has to do to re-import the product into the repository. */
  reimport: ReimportInfo;
  /** The seven numbers that have to be re-calibrated after the import. */
  rebaseline: RebaselineEntry[];
}

/** The result of a failed apply — every field is empty, and the reason says why. */
function failure(error: string, partial: Partial<ApplyResult> = {}): ApplyResult {
  return {
    ok: false,
    manifestVersion: null,
    releaseToken: null,
    releaseDir: null,
    rewrittenFaces: 0,
    swept: [],
    supersededDir: null,
    error,
    summary: null,
    pageCost: null,
    reimport: { required: false, command: '', note: '' },
    rebaseline: [],
    ...partial,
  };
}

/**
 * Counts the `@font-face` rules of a stylesheet.
 *
 * ⚠️ This is a COPY of a fragment of wave-2's `parseFaces()`, and it is
 * NOT the authority — the authority is `parseFaces()` itself. The copy
 * exists because the wave-2 scripts pull `fontkit` and `subset-font` into
 * whatever imports them, and a Next.js server module must not.
 *
 * ⇒ The drift risk is carried by a TEST: `countFaceRules(css)` has to equal
 * `parseFaces(css).length` for the three real stylesheets.
 */
export function countFaceRules(css: string): number {
  const blockPattern = /@font-face\s*\{([\s\S]*?)\}/g;
  let count = 0;
  let match = blockPattern.exec(css);
  while (match !== null) {
    count += 1;
    match = blockPattern.exec(css);
  }
  return count;
}

/**
 * Rewrites every `/font/web/` reference of a stylesheet to a release.
 *
 * The `?v=` query that follows the URL is kept — it is the cache buster of
 * the file, and dropping it would serve a stale copy from a cache that
 * already has it.
 *
 * @param css the stylesheet
 * @param releasePrefix the prefix the references get, e.g. `/font/web/r0a1b`
 * @returns the rewritten CSS, how many references were rewritten, and how
 *   many faces the stylesheet declares
 */
export function rewriteStylesheetUrls(
  css: string,
  releasePrefix: string,
): { css: string; rewritten: number; expected: number } {
  const expected = countFaceRules(css);
  // Every `/font/web/` reference — the family segment follows it.
  //
  // ⚠️ A URL that ALREADY points at a release (`/font/web/r<hex>/…`) is NOT
  // rewritten again: the stylesheet of a staging build is never released
  // twice, and a rewrite that matched its own output would produce a
  // mangled path.
  const pattern = /\/font\/web\/(?!r[0-9a-f]+\/)/g;
  let rewritten = 0;
  const out = css.replace(pattern, () => {
    rewritten += 1;
    return `${releasePrefix}/`;
  });
  return { css: out, rewritten, expected };
}

/**
 * The V hash — the hash of the rewritten stylesheets.
 *
 * ⚠️ The KEYS are the **file names** of the stylesheets. They only decide
 * the order; the hash is over the CSS **contents**. The algorithm is
 * wave-2's `manifestVersion()`, copied here so the wave-2 scripts do not
 * have to be imported into the server bundle — and pinned against the
 * original by a test.
 */
export function manifestVersionOf(cssByFile: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The page cost the gate printed, or `null` when there was none.
 *
 * ⚠️ The line is either one line of valid JSON or it is ABSENT — the
 * verifier prints it only when there is a page cost to print, and
 * `pagecost: null` is not valid JSON (design §3.5.7, R-58). A line that is
 * there but does not parse is a DEFECT: it is logged, and the page cost is
 * reported as unavailable. It never fails the run — the intrinsic checks
 * still decide.
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
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const bytes = toNumberRecord(record.bytes);
  const files = toNumberRecord(record.files);
  const budgetBytes = toNumberRecord(record.budgetBytes);
  if (bytes === null || files === null || budgetBytes === null) return null;

  const budgetFiles = record.budgetFiles;
  if (typeof budgetFiles !== 'number' || !Number.isFinite(budgetFiles)) return null;

  return { bytes, files, budgetBytes, budgetFiles };
}

/** A record of numbers, or `null` when the value is not one. */
function toNumberRecord(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    result[key] = entry;
  }
  return result;
}

/** The payload of the page-cost line, or `null` when the line is absent. */
function findPageCostLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(PAGECOST_PREFIX)) continue;
    return line.slice(PAGECOST_PREFIX.length).trim();
  }
  return null;
}

/**
 * The error lines of the verifier's stdout.
 *
 * The informational ones (`[verify]   info: …`) are left out — they are not
 * errors.
 */
function extractFindings(stdout: string): string[] {
  const findings: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(FINDING_PREFIX)) continue;
    const text = line.slice(FINDING_PREFIX.length).trim();
    if (text === '' || text.startsWith('info:')) continue;
    findings.push(text);
  }
  return findings;
}

/**
 * The error message of a failed gate.
 *
 * ⚠️ Only the verifier's FINDINGS are quoted — at most ten of them, plus
 * the final `[verify] N error(s)` line. The stderr is NEVER pasted: it
 * carries paths and internal information that the administrator must not
 * see, and it is a stack trace nobody can act on.
 */
export function describeGateFailure(
  code: number,
  stdout: string,
  stderr: string,
): string {
  const findings = extractFindings(stdout);
  const summary = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => ERROR_COUNT_PATTERN.test(line));

  const parts: string[] = [];
  if (findings.length > 0) {
    const quoted = findings.slice(0, MAX_QUOTED_FINDINGS);
    const rest = findings.length - quoted.length;
    parts.push(quoted.join('; '));
    if (rest > 0) parts.push(`(and ${rest} more)`);
  }
  if (summary) parts.push(summary);

  if (parts.length === 0) {
    const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    return tail
      ? `候选校验未通过（退出码 ${code}）：${tail}`
      : `候选校验未通过（退出码 ${code}）`;
  }

  return `候选校验未通过（退出码 ${code}）：${parts.join(' ')}`;
}

/** The woff2 files of a tree, with their bytes. */
function woff2FilesOf(root: string): Array<{ path: string; bytes: number }> {
  if (!existsSync(root)) return [];
  const found: Array<{ path: string; bytes: number }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith('.woff2')) found.push({ path: full, bytes: stat.size });
    }
  };
  walk(root);
  return found;
}

/** The recursive byte size of a directory tree. */
function directoryBytes(path: string): number {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of readdirSync(path)) {
    total += directoryBytes(join(path, name));
  }
  return total;
}

/**
 * Copies the staged release into a NEW release directory of the live tree.
 *
 * ⚠️ The directory is NEW: an apply never overwrites a release that is
 * already on the disk, because a stylesheet a visitor cached may still
 * point at it.
 *
 * @returns how many woff2 files the release holds, and how many bytes
 */
function publishRelease(
  stagedFontDir: string,
  liveFontDir: string,
  releaseDir: string,
): { files: number; bytes: number } {
  const target = join(liveFontDir, 'web', releaseDir);
  mkdirSync(target, { recursive: true });

  const stagedWeb = join(stagedFontDir, 'web');
  let files = 0;
  let bytes = 0;

  for (const family of FAMILIES) {
    const source = join(stagedWeb, family);
    if (!existsSync(source)) continue;
    const destination = join(target, family);
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) {
      const from = join(source, name);
      const to = join(destination, name);
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true });
        continue;
      }
      cpSync(from, to);
      if (name.endsWith('.woff2')) {
        files += 1;
        bytes += statSync(to).size;
      }
    }
  }

  // ⚠️ The licences go in TWO places, exactly like wave-2 does: on the root
  // of the release and inside the directory of the family. "A subset of an
  // OFL font is still an OFL font" — the licence has to travel with it.
  for (const family of FAMILIES) {
    const licence = join(stagedWeb, `OFL-${family}.txt`);
    if (!existsSync(licence)) continue;
    cpSync(licence, join(target, `OFL-${family}.txt`));
  }

  return { files, bytes };
}

/**
 * Builds the candidate tree the gate reads.
 *
 * The candidate holds the three REWRITTEN stylesheets, a manifest whose
 * version is V, and `web/r<T>/` — the release that was just published.
 *
 * ⚠️ `web/r<T>/` is a JUNCTION to the live release directory when the
 * platform allows it: a copy of 41 MB per gate run would be wasteful, and a
 * junction needs no elevation on Windows. When it cannot be created, the
 * directory is copied instead — the gate then reads the same bytes either
 * way, and the test asserts the BEHAVIOUR, not the mechanism.
 *
 * @returns the candidate directory, and whether a junction was used
 */
function buildCandidate(
  liveFontDir: string,
  releaseDir: string,
  rewrittenCss: Record<string, string>,
  manifest: unknown,
): { candidateDir: string; junction: boolean } {
  const candidateDir = mkdtempSync(join(tmpdir(), 'webfont-candidate-'));
  const candidateWeb = join(candidateDir, 'web');
  mkdirSync(candidateWeb, { recursive: true });

  for (const file of STYLESHEETS) {
    writeFileSync(join(candidateDir, file), rewrittenCss[file], 'utf8');
  }
  writeFileSync(
    join(candidateDir, 'fonts-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const liveRelease = join(liveFontDir, 'web', releaseDir);
  const candidateRelease = join(candidateWeb, releaseDir);
  let junction = false;
  try {
    // A junction on Windows, a symbolic link elsewhere. Neither needs
    // elevation on Windows; a symbolic link does on POSIX, and then the copy
    // below takes over.
    const { symlinkSync } = require('node:fs') as typeof import('node:fs');
    symlinkSync(liveRelease, candidateRelease, 'junction');
    junction = true;
  } catch {
    junction = false;
  }
  if (!junction) {
    cpSync(liveRelease, candidateRelease, { recursive: true });
  }

  return { candidateDir, junction };
}

/**
 * Removes the candidate tree.
 *
 * ⚠️ The junction is removed FIRST and WITHOUT descending into it: Node's
 * `fs.rm(path, { recursive: true })` removes a junction itself and does not
 * follow it into the live release. `force: true` makes a missing target a
 * non-event. ⇒ The live release survives the cleanup.
 */
function removeCandidate(candidateDir: string): void {
  rmSync(candidateDir, { recursive: true, force: true });
}

/**
 * The release the live stylesheets currently point at, or `null`.
 *
 * It is the release whose directory name appears in the live stylesheet's
 * URLs — the one this apply supersedes.
 */
function currentLiveReleaseDir(liveFontDir: string): string | null {
  for (const file of STYLESHEETS) {
    const path = join(liveFontDir, file);
    if (!existsSync(path)) continue;
    const css = readFileSync(path, 'utf8');
    const match = /\/font\/web\/(r[0-9a-f]+)\//.exec(css);
    if (match) return match[1];
  }
  return null;
}

/**
 * Publishes a finished staging build.
 *
 * The order is: read → rewrite in memory → publish the release directory →
 * build the candidate → verify the candidate → swap the stylesheets and the
 * manifest → register the supersession. **Only the swap touches the live
 * tree** — everything before it writes into a temporary directory or into
 * the new release directory, and the release directory is rolled back when
 * the gate refuses the candidate.
 */
export async function applyStagedBuild(options: ApplyOptions): Promise<ApplyResult> {
  const liveFontDir = options.liveFontDir ?? LIVE_FONT_DIR;
  const runCommand = options.runCommand ?? defaultRunCommand;

  // ── ① the publish token T ──────────────────────────────────────────────
  const manifestPath = join(options.stagedFontDir, 'fonts-manifest.json');
  if (!existsSync(manifestPath)) {
    return failure(`staging 里没有 manifest：${manifestPath}`);
  }

  let stagedManifest: { version?: unknown; files?: unknown };
  try {
    stagedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof stagedManifest;
  } catch (err) {
    return failure(`staging 的 manifest 读不出来：${(err as Error).message}`);
  }
  const token = stagedManifest.version;
  if (typeof token !== 'string' || token === '') {
    return failure(`staging 的 manifest 没有 version：${manifestPath}`);
  }
  // ⚠️ The publish token names the release directory, and that name reaches
  // the LEDGER — whose reader refuses anything that is not `r` plus
  // lowercase hex, because the name reaches the delete path. A token that
  // is not a hex string would therefore publish a tree that the ledger
  // cannot read afterwards. It is refused here, before anything is written.
  if (!/^[0-9a-f]+$/.test(token)) {
    return failure(
      `staging 的 manifest version 不是小写十六进制：${JSON.stringify(token)}`,
    );
  }
  const releaseDir = `r${token}`;

  // ── ② the three stylesheets, rewritten IN MEMORY ───────────────────────
  const rewrittenCss: Record<string, string> = {};
  let rewrittenFaces = 0;
  for (const file of STYLESHEETS) {
    const path = join(options.stagedFontDir, file);
    if (!existsSync(path)) {
      return failure(`staging 里没有样式表：${path}`);
    }
    const css = readFileSync(path, 'utf8');
    const result = rewriteStylesheetUrls(css, `/font/web/${releaseDir}`);
    // ⚠️ A stylesheet that declares faces but has no URL to rewrite is a
    // DEFECT, not a no-op: "rewrote nothing and called it a success" would
    // publish a stylesheet that still points at the old release.
    if (result.rewritten !== result.expected) {
      return failure(
        `样式表 ${file} 的改写条数对不上：改写了 ${result.rewritten} 条，` +
          `应有 ${result.expected} 条`,
      );
    }
    rewrittenCss[file] = result.css;
    rewrittenFaces += result.rewritten;
  }

  // ── ③ the manifest version V ───────────────────────────────────────────
  // ⚠️ The keys are the FILE NAMES of the stylesheets — they decide the
  // order of the hash, and the hash is over the CSS contents.
  const manifestVersion = manifestVersionOf(rewrittenCss);

  // ── ④ the idempotence check — the live manifest's version only ────────
  // ⚠️ ONLY the version is compared. The release directory, the token and
  // the file list change for a new build with identical stylesheet bytes.
  const liveManifestPath = join(liveFontDir, 'fonts-manifest.json');
  if (existsSync(liveManifestPath)) {
    try {
      const liveManifest = JSON.parse(readFileSync(liveManifestPath, 'utf8')) as {
        version?: unknown;
      };
      if (liveManifest.version === manifestVersion) {
        return failure('线上已经是这一份，无需再次发布');
      }
    } catch (err) {
      return failure(`线上的 manifest 读不出来：${(err as Error).message}`);
    }
  }

  // ── ⑤ the release directory ───────────────────────────────────────────
  const liveBefore = woff2FilesOf(join(liveFontDir, 'web'));
  const summary: ApplySummary = {
    liveFiles: liveBefore.length,
    liveBytes: liveBefore.reduce((total, file) => total + file.bytes, 0),
    newFiles: 0,
    newBytes: 0,
    releaseBytes: 0,
  };

  let published: { files: number; bytes: number };
  try {
    published = publishRelease(options.stagedFontDir, liveFontDir, releaseDir);
  } catch (err) {
    return failure(`发布目录建不出来：${(err as Error).message}`);
  }
  summary.newFiles = published.files;
  summary.newBytes = published.bytes;
  summary.releaseBytes = directoryBytes(join(liveFontDir, 'web', releaseDir));

  // The manifest the live tree gets: the same `files` as the staged one —
  // the verifier requires exactly `/font/fonts-<族>.css` — and the new V.
  const newManifest = {
    ...stagedManifest,
    version: manifestVersion,
  };

  // ── ⑥ the candidate ────────────────────────────────────────────────────
  let candidate: { candidateDir: string; junction: boolean };
  try {
    candidate = buildCandidate(liveFontDir, releaseDir, rewrittenCss, newManifest);
  } catch (err) {
    rollbackRelease(liveFontDir, releaseDir);
    return failure(`候选目录搭不起来：${(err as Error).message}`);
  }

  // ── ⑦ the gate ─────────────────────────────────────────────────────────
  let run: { code: number; stdout: string; stderr: string };
  try {
    run = await runCommand(
      process.execPath,
      [join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs')],
      {
        cwd: REPO_ROOT,
        // ⚠️ The variables are spelled out HERE as well as in the default
        // runner: the injected fake does not do the overlay, so it would
        // never see them.
        env: {
          ...process.env,
          WEBFONT_FONT_DIR: candidate.candidateDir,
          // ⚠️ The candidate's page cost is REPORTED, never enforced: the
          // budget describes the LIVE tree, and the candidate's corpus has
          // moved. Judging the candidate against it would fail every
          // rebuild whose corpus changed.
          WEBFONT_PAGE_COST: 'report',
        },
      },
    );
  } catch (err) {
    removeCandidate(candidate.candidateDir);
    rollbackRelease(liveFontDir, releaseDir);
    return failure(`候选校验跑不起来：${(err as Error).message}`);
  }

  const pageCost = parsePageCost(run.stdout);
  if (pageCost === null && findPageCostLine(run.stdout) !== null) {
    // A line that is there but does not parse is a DEFECT. It is reported
    // — and it never fails the run: the intrinsic checks still decide.
    console.error(
      `[webfont] the pagecost line of the candidate could not be read: ${
        findPageCostLine(run.stdout) ?? ''
      }`,
    );
  }

  // ── ⑧ the gate refused the candidate ───────────────────────────────────
  if (run.code !== 0) {
    // ⚠️ The candidate is removed FIRST, then the release directory that
    // was created for it. The junction must not be followed into the live
    // release.
    removeCandidate(candidate.candidateDir);
    rollbackRelease(liveFontDir, releaseDir);
    return failure(describeGateFailure(run.code, run.stdout, run.stderr));
  }

  // ── ⑨ the swap — the ONLY step that touches the live tree ─────────────
  // ⚠️ The release the live stylesheets point at RIGHT NOW is read BEFORE
  // the swap: after the swap they point at the new one, and the release
  // this apply supersedes would be lost.
  const previousRelease = supersededReleaseOf(liveFontDir);

  try {
    for (const file of STYLESHEETS) {
      writeFileSync(join(liveFontDir, file), rewrittenCss[file], 'utf8');
    }
    writeFileSync(
      join(liveFontDir, 'fonts-manifest.json'),
      `${JSON.stringify(newManifest, null, 2)}\n`,
      'utf8',
    );
  } catch (err) {
    removeCandidate(candidate.candidateDir);
    rollbackRelease(liveFontDir, releaseDir);
    return failure(`线上样式表换不上去：${(err as Error).message}`);
  }
  removeCandidate(candidate.candidateDir);

  // ── ⑩ the supersession ─────────────────────────────────────────────────
  // ⚠️ This happens AFTER the swap: the moment a release is superseded is
  // the moment the new stylesheets went live. Registering it earlier would
  // count a release as expired while it is still referenced.
  const supersededDir = previousRelease?.dir ?? null;
  if (previousRelease) {
    markSuperseded(previousRelease.dir, new Date().toISOString(), liveFontDir);
  }
  registerRelease(liveFontDir, releaseDir, token, published, summary);

  // ── ⑪ the facts about the re-import ────────────────────────────────────
  const reimport: ReimportInfo = {
    required: true,
    command: `node scripts/fonts/import-webfont-release.mjs --release ${releaseDir}`,
    note:
      '产物已发布到服务器，但尚未回灌仓库；在回灌之前不要部署 —— 否则会把旧样式表覆盖回去。',
  };

  const rebaseline = buildRebaselineChecklist(liveFontDir, pageCost);

  return {
    ok: true,
    manifestVersion,
    releaseToken: token,
    releaseDir,
    rewrittenFaces,
    swept: [],
    supersededDir,
    error: null,
    summary,
    pageCost,
    reimport,
    rebaseline,
  };
}

/**
 * The release the live tree holds in its ledger that the stylesheets point
 * at, or `null` when there is none (the very first apply).
 */
function supersededReleaseOf(liveFontDir: string): ReleaseRecord | null {
  const releases = readReleases(liveFontDir);
  const liveReleaseDir = currentLiveReleaseDir(liveFontDir);
  if (liveReleaseDir === null) return null;
  return releases.find((release) => release.dir === liveReleaseDir) ?? null;
}

/**
 * Records the new release in the ledger.
 *
 * ⚠️ The ledger lives in the tree it describes — the live tree, which is a
 * TEMPORARY directory in the tests. The repository's
 * `public/font/releases.json` is never touched by an apply that runs
 * against another tree.
 */
function registerRelease(
  liveFontDir: string,
  releaseDir: string,
  token: string,
  published: { files: number; bytes: number },
  summary: ApplySummary,
): void {
  const releases = readReleases(liveFontDir);
  const existing = releases.find((release) => release.dir === releaseDir);
  const record: ReleaseRecord = {
    dir: releaseDir,
    token,
    publishedAt: new Date().toISOString(),
    supersededAt: null,
    deletedAt: null,
    files: published.files,
    bytes: summary.releaseBytes || published.bytes,
  };
  const updated = existing
    ? releases.map((release) => (release.dir === releaseDir ? record : release))
    : [...releases, record];
  writeReleases(updated, liveFontDir);
}

/**
 * Removes the release directory this apply created.
 *
 * ⚠️ This is the ONLY deletion an apply performs, and it removes ONLY the
 * directory it created itself — the rollback of a refused candidate. It
 * never sweeps an old release: that is the cleanup's job, with its own
 * gates, and an apply must never walk around them.
 */
function rollbackRelease(liveFontDir: string, releaseDir: string): void {
  const path = join(liveFontDir, 'web', releaseDir);
  rmSync(path, { recursive: true, force: true });
}
