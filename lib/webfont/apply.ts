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
 * ## What this module does NOT do
 *
 *  - It does not delete old releases. `removeReleaseDirs` is deliberately
 *    NOT imported here: the cleanup has its own gates (design §4.2), and an
 *    apply that "just happens to tidy up" would walk straight through them.
 *    The ONE deletion this module performs is its own rollback: the release
 *    directory it just created, when the gate refuses it.
 *  - It does not run git. The backend never touches the repository
 *    (design §9, rule 5) — it only says what a human has to do.
 *
 * ## THE SPLIT
 *
 * This module is the ORCHESTRATION: it reads the staging build, decides
 * the order of the eleven steps, and reports what happened. The two kinds
 * of work it used to hold now live elsewhere:
 *
 *   - `release-text.ts` — the PURE half: the stylesheet rewrite, the V
 *     hash, the reading of the verifier's output. No disk, no clock;
 *   - `release-publish.ts` — the DISK half: the copy into a new release
 *     directory, the candidate tree, the ledger.
 *
 * Every export of the original module is still exported from here, so
 * `import { applyStagedBuild } from '@/lib/webfont/apply'` keeps working
 * unchanged.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LIVE_FONT_DIR, REPO_ROOT } from './paths';
import { runCommand as defaultRunCommand } from './run-command';
import { buildRebaselineChecklist, type RebaselineEntry } from './rebaseline';
import {
  STYLESHEETS,
  buildCandidate,
  currentLiveReleaseDir,
  directoryBytes,
  markReleaseSuperseded,
  publishRelease,
  registerRelease,
  removeCandidate,
  rollbackRelease,
  supersededReleaseOf,
  woff2FilesOf,
} from './release-publish';
import {
  describeGateFailure,
  findPageCostLine,
  manifestVersionOf,
  parsePageCost,
  rewriteStylesheetUrls,
} from './release-text';
import type { PageCostReport } from '@/scripts/fonts/verify-webfont-subsets.d.mts';

export {
  countFaceRules,
  describeGateFailure,
  manifestVersionOf,
  parsePageCost,
  rewriteStylesheetUrls,
} from './release-text';

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
    markReleaseSuperseded(liveFontDir, previousRelease.dir, new Date().toISOString());
  }
  registerRelease(liveFontDir, releaseDir, token, published, summary.releaseBytes);

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
 * The release the live stylesheets currently point at, or `null`.
 *
 * Re-exported for the tests that assert the live tree's release, and for
 * any caller that wants to know what is live without reading the ledger.
 */
export { currentLiveReleaseDir };
