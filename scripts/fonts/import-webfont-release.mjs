#!/usr/bin/env node
/**
 * Re-import a published webfont release into the repository.
 *
 * ## Why this script exists
 *
 * The deploy syncs the repository to the server **without `--delete`**. So
 * if the repository still holds the OLD stylesheets, the next deploy
 * overwrites the server's NEW stylesheets with the old ones ⇒ the site keeps
 * serving the old fonts while the admin page says 「已发布」 ⇒ a **silent
 * rollback**, and the manifest version is rolled back with it.
 *
 * ⇒ The remedy is a **script plus a human**. The backend NEVER touches git
 * (design §9, rule 5) — this script is the only place in the whole wave
 * where git is touched, and a human runs it on purpose.
 *
 * ## What the script does — five steps
 *
 *  1. validates the `--release` argument (see below — this happens FIRST);
 *  2. verifies that the release directory is there and that the manifest's
 *     version equals the hash of the three stylesheets ⇒ otherwise it
 *     refuses and **stages nothing**;
 *  3. stages EXACTLY six paths, and `git rm -r`s the release directories the
 *     server has already deleted;
 *  4. PRINTS the four numbers that have to be re-pinned in
 *     `tests/unit/lib/fonts-css.test.ts` — it never writes them anywhere;
 *  5. stages by default; `--commit` commits.
 *
 * ## ⚠️ The order of the checks is part of the contract (R-206a)
 *
 * The `--release` argument is USER INPUT, and the release directory name
 * reaches the read path (the font tree) and the delete path (via the
 * ledger). ⇒ The **shape** of the argument is checked BEFORE anything is
 * read, written or spawned:
 *
 *   parse argv → validate the shape → and only THEN read the ledger, look
 *   at the directory, compute the hash and run git.
 *
 * ⚠️ It is NOT acceptable to build the path first and check it afterwards:
 * once `join(root, 'public', 'font', 'web', arg)` has been evaluated, a
 * `../../..` has already read OUTSIDE the font tree — even if the value is
 * rejected one line later. The ledger of this project had exactly that bug
 * (`ledger-dir-traversal-deletedir`): a `dir` of `../../etc` made the
 * cleanup delete a directory outside the font tree.
 *
 * ## ⚠️ What this script does to the ledger: it only READS it
 *
 * This script NEVER writes the ledger. Its only writes are to the git
 * INDEX (`git add` / `git rm`) — the ledger is among the six paths it
 * stages, and it is staged exactly as the operator synced it down.
 *
 * ⇒ The `dir` inside the ledger is written by `lib/webfont/apply.ts`
 * (`registerRelease()`; the name is `r${token}`, built from the staging
 * manifest's version), NOT by this script and NOT from the `--release`
 * argument. ⇒ This script reads the ledger, checks every `dir` against the
 * release-directory shape, and refuses the whole run if one of them does
 * not match — it never reconstructs a directory name from a token.
 *
 * ## The hash rule
 *
 * The manifest's version is the sha256 of the three stylesheet **contents**,
 * in **sorted file-name order**, cut to **twelve** characters. ⚠️ The
 * contents are **LF-normalized** before they are hashed, because the
 * repository sets `core.autocrlf=true` and a Windows checkout holds CRLF
 * while the manifest was computed from the LF the build wrote. The same
 * normalization applies to every SIZE the script measures: they are
 * properties of the content, not of the checkout.
 *
 * ⚠️ The rule is implemented HERE, with `node:crypto` — the build script is
 * NOT imported. `build-webfont-subsets.mjs` pulls `subset-font` (a wasm
 * build) at its top, and a script that only needs a hash must not drag a
 * font-subsetting dependency in. The two implementations of the rule are
 * kept apart by a **drift-guard test** (`tests/unit/lib/webfont-rebaseline.test.ts`),
 * which is the pattern this repository uses everywhere.
 *
 * ## The staged paths
 *
 *   1. `public/font/web/r<T>/`        the new release directory
 *   2. `public/font/fonts-<family>-hot.css`   the hot tier, for each
 *      family (`sans`, `serif`, `wenkai`)
 *   3. `public/font/fonts-<family>-ext.css`   the ext tier, for each
 *      family — six stylesheets in all, since the ext tier was split out
 *      of the render-blocking one (2026-11-18)
 *   4. `public/font/fonts-manifest.json`
 *   5. `public/font/releases.json`    the ledger
 *
 * The list itself is `STYLESHEETS` below — the comment names the shape,
 * the constant is the truth.
 *
 * ⚠️ NEVER `git add .` and NEVER `git add -A`: the tree of this project
 * carries a permanently modified `data/sutras/manifest.json` that must never
 * be staged, and an explicit list is the only thing that can guarantee it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * The shape of a release directory name: `r` and twelve lowercase hex
 * characters.
 *
 * ⚠️ It is deliberately narrow. The publish token is the first twelve
 * characters of a sha256, so a real release always matches it. Anything
 * else — `../../evil`, `rABCDEF`, `web`, `sans`, the empty string — is
 * refused BEFORE it reaches a path.
 */
const RELEASE_DIR_PATTERN = /^r[0-9a-f]{12}$/;

/** The three families of the site — the stylesheets the script hashes. */
const FAMILIES = ['sans', 'serif', 'wenkai'];

/**
 * The stylesheets, by their file name — the key order of the V hash.
 *
 * Every family has TWO stylesheets since the ext tier was split out of
 * the render-blocking one: the hot tier and the ext tier. Both go into
 * the hash — a stylesheet that is not hashed is a stylesheet whose bytes
 * can change without the `?v=` token changing, and the browser would
 * then keep the old file for a year.
 */
const STYLESHEETS = FAMILIES.flatMap((family) => [
  `fonts-${family}-hot.css`,
  `fonts-${family}-ext.css`,
]);

/** The name of the ledger, inside the font tree. */
const LEDGER_FILE = 'releases.json';

/** The name of the manifest, inside the font tree. */
const MANIFEST_FILE = 'fonts-manifest.json';

/**
 * The failure of the script.
 *
 * Every refusal is a `UserError`: it prints a Chinese message the operator
 * can act on, and it exits NON-ZERO. A script that exits 0 while it refused
 * to stage is the worst outcome of all — the operator would deploy a tree
 * that does not hold the release.
 */
class UserError extends Error {}

/**
 * Runs a git command.
 *
 * ⚠️ The command is an ARGV ARRAY, never a shell string: on Windows a shell
 * string means quoting bugs, and the repository path may contain spaces.
 *
 * @param {string} cwd the repository the command runs in
 * @param {string[]} args the arguments of the command
 * @param {{ allowFailure?: boolean }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
function git(cwd, args, options = {}) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8' });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const failure = err;
    const stderr = `${failure.stderr ?? ''}${failure.stdout ?? ''}`.trim();
    if (options.allowFailure) {
      return { ok: false, stdout: '', stderr };
    }
    throw new UserError(
      `git ${args.join(' ')} 失败：${stderr || (failure.message ?? String(failure))}`,
    );
  }
}

/**
 * The root of the repository the script works in.
 *
 * ⚠️ The root is resolved with `git rev-parse --show-toplevel` **from the
 * directory the script was started in**, not from the place of the script.
 * The script is copied into the repository it works on (the deploy bundle
 * does that), and the operator runs it from the repository root. ⇒ The
 * working directory is what the operator MEANS, and it is the only thing
 * that can say which tree is to be staged.
 *
 * @param {string} cwd the directory the script was started in
 * @returns {string} the root of the repository
 */
function repositoryRoot(cwd) {
  const result = git(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (!result.ok || result.stdout.trim() === '') {
    throw new UserError(
      `当前目录不是 git 仓库（${cwd}）—— 回灌脚本只能在仓库根目录下运行。`,
    );
  }
  return resolve(result.stdout.trim());
}

/**
 * Parses the arguments of the script.
 *
 * ⚠️ The parse is STRICT: an unknown flag is a refusal, not a shrug. A typo
 * like `--relesae` must not look like a run that staged nothing.
 *
 * @param {string[]} argv the arguments, without the script and the node
 * @returns {{ release: string, commit: boolean }} what the operator asked for
 */
function parseArgs(argv) {
  let release = null;
  let commit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--commit') {
      commit = true;
      continue;
    }
    if (argument === '--release') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UserError('--release 后面必须给出发布目录名，例如 --release r0123456789ab。');
      }
      release = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--release=')) {
      release = argument.slice('--release='.length);
      continue;
    }
    throw new UserError(`无法识别的参数「${argument}」—— 只支持 --release <目录名> 和 --commit。`);
  }

  if (release === null) {
    throw new UserError('缺少参数 --release <发布目录名>，例如 --release r0123456789ab。');
  }
  return { release, commit };
}

/**
 * Checks the shape of the release argument.
 *
 * ⚠️ THIS IS THE FIRST THING THAT HAPPENS, before any path is built, any
 * file is read and any child process is spawned. The shape is the ONLY
 * thing that keeps `../../evil` out of the font tree.
 *
 * @param {string} release the argument, as the operator typed it
 * @returns {string} the validated release directory name
 */
function validateReleaseName(release) {
  if (!RELEASE_DIR_PATTERN.test(release)) {
    throw new UserError(
      `「${release}」不是合法的发布目录名—— 发布目录必须是 r 加 12 位小写十六进制（例如 r0123456789ab）。`,
    );
  }
  return release;
}

/**
 * The font tree of a repository: `<root>/public/font`.
 *
 * @param {string} root the root of the repository
 * @returns {string} the font tree
 */
function fontDirOf(root) {
  return join(root, 'public', 'font');
}

/**
 * Reads a stylesheet with its line endings normalized to LF.
 *
 * ⚠️ The repository sets `core.autocrlf=true`, so a Windows checkout holds
 * CRLF while the manifest's version was computed from the LF the build
 * wrote. Everything that is measured — the hash AND the sizes — is a
 * property of the CONTENT, not of the checkout.
 *
 * @param {string} path the path of the stylesheet
 * @returns {string} the content, LF-normalized
 */
function readStylesheet(path) {
  if (!existsSync(path)) {
    throw new UserError(`样式表不存在：${path}`);
  }
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The manifest version of a set of stylesheets: the sha256 of their
 * contents, in sorted file-name order, cut to twelve characters.
 *
 * ⚠️ This is the rule of `build-webfont-subsets.mjs`'s `manifestVersion()`,
 * implemented here with `node:crypto` — see the header of the file for why
 * the build script is not imported.
 *
 * @param {Record<string, string>} cssByFile the content of every stylesheet
 * @returns {string} the twelve lowercase hex characters
 */
function manifestVersionOf(cssByFile) {
  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The `.woff2` files of a font tree, with their bytes.
 *
 * ⚠️ The walk is RECURSIVE over `web/`, so it counts EVERY release on the
 * disk — release 0 and every published one. That is the number the
 * repository's own test counts (`allSubsetFiles()`), and it is why the
 * count is roughly DOUBLE after the first re-import. The number of the new
 * release alone would not fit the assertion it has to satisfy.
 *
 * @param {string} fontDir the font tree
 * @returns {{ count: number, bytes: number }}
 */
function allSubsetFiles(fontDir) {
  const root = join(fontDir, 'web');
  if (!existsSync(root)) return { count: 0, bytes: 0 };

  let count = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.woff2')) {
        count += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walk(root);
  return { count, bytes };
}

/**
 * The sizes of the three stylesheets: the raw bytes together and the
 * gzipped bytes of each.
 *
 * ⚠️ The gzip measurement is `gzipSync(Buffer.from(css, 'utf8')).length` —
 * the zlib DEFAULT level, with NO options object. The number the repository
 * pins was measured that way, and a `{ level: 9 }` would print a different
 * one ⇒ the pasted value would not satisfy the assertion it is meant to
 * satisfy.
 *
 * @param {string} fontDir the font tree
 * @returns {{ rawBytes: number, gzipBytes: Record<string, number> }}
 */
function stylesheetSizes(fontDir) {
  let rawBytes = 0;
  const gzipBytes = {};

  for (const family of FAMILIES) {
    const sheets = STYLESHEETS.filter((file) => file.startsWith(`fonts-${family}-`));
    let raw = 0;
    let gzip = 0;
    // ⚠️ The two tiers are measured SEPARATELY, and then added up.
    // The browser downloads them as two responses with two gzip streams,
    // so the number that describes what the browser pays is the sum of
    // the two — not the gzip of the two concatenated.
    for (const file of sheets) {
      const css = readStylesheet(join(fontDir, file));
      raw += Buffer.byteLength(css, 'utf8');
      gzip += gzipSync(Buffer.from(css, 'utf8')).length;
    }
    rawBytes += raw;
    gzipBytes[family] = gzip;
  }

  return { rawBytes, gzipBytes };
}

/**
 * Reads the ledger of the releases.
 *
 * ⚠️ The ledger is OPTIONAL for the staging step — a tree that never had a
 * release has no ledger, and that is not an error. Only the `git rm` step
 * needs it.
 *
 * ⚠️ The ledger is EXTERNAL INPUT: the backend writes it, but this script
 * does not assume the backend is right. A `dir` that is not a release
 * directory name is refused here, with a message — it must never reach
 * `git rm -r`.
 *
 * @param {string} fontDir the font tree
 * @returns {{ entries: Array<{ dir: string, deletedAt: string | null }>, hostile: string[] }}
 */
function readLedger(fontDir) {
  const path = join(fontDir, LEDGER_FILE);
  if (!existsSync(path)) return { entries: [], hostile: [] };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UserError(`发布台账 ${path} 不是合法 JSON：${err.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.releases)) {
    throw new UserError(`发布台账 ${path} 不是一个带 releases 数组的对象。`);
  }

  const entries = [];
  const hostile = [];
  for (const entry of parsed.releases) {
    if (typeof entry !== 'object' || entry === null) continue;
    const dir = typeof entry.dir === 'string' ? entry.dir : '';
    if (!RELEASE_DIR_PATTERN.test(dir)) {
      hostile.push(dir);
      continue;
    }
    entries.push({
      dir,
      deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : null,
    });
  }
  return { entries, hostile };
}

/**
 * The release directories the server has already deleted.
 *
 * A directory qualifies only when it (a) has a `deletedAt` in the ledger,
 * (b) still EXISTS in the working tree, and (c) is TRACKED by git. ⇒ The
 * repository and the server agree afterwards.
 *
 * ⚠️ The source is the LEDGER, never the command line, and never a scan of
 * the directory by its mtime.
 *
 * @param {string} root the root of the repository
 * @param {string} fontDir the font tree
 * @returns {string[]} the directories to `git rm -r`
 */
function deletedReleaseDirs(root, fontDir) {
  const { entries } = readLedger(fontDir);
  const dirs = [];

  for (const entry of entries) {
    if (!entry.deletedAt) continue;
    const path = join(fontDir, 'web', entry.dir);
    if (!existsSync(path)) continue;
    const tracked = git(root, ['ls-files', '--error-unmatch', `public/font/web/${entry.dir}`], {
      allowFailure: true,
    });
    if (!tracked.ok) continue;
    dirs.push(entry.dir);
  }
  return dirs;
}

/**
 * The commit message of the `--commit` run.
 *
 * @param {string} dir the release directory name
 * @returns {string} the message
 */
function commitMessageOf(dir) {
  const stamp = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const when =
    `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ` +
    `${pad(stamp.getHours())}.${pad(stamp.getMinutes())}`;
  return (
    `feat(fonts): publish webfont release ${dir} [${when}]\n\n` +
    'Co-Authored-By: Claude Code <noreply@anthropic.com>\n'
  );
}

/**
 * Runs the script.
 *
 * @param {string[]} argv the arguments, without the script and the node
 * @param {string} cwd the directory the script was started in
 * @returns {number} the exit code
 */
function run(argv, cwd) {
  const log = (line) => process.stdout.write(`${line}\n`);

  // ── ① the arguments, and their shape, BEFORE anything else ──────────────
  const { release, commit } = parseArgs(argv);
  const dir = validateReleaseName(release);

  // ── ② the repository, and the release itself ─────────────────────────────
  const root = repositoryRoot(cwd);
  const fontDir = fontDirOf(root);
  const releasePath = join(fontDir, 'web', dir);

  if (!existsSync(releasePath)) {
    throw new UserError(
      `发布目录 ${dir} 不在 ${releasePath} —— 请先把服务器上的产物同步到工作区，脚本不会自己创建发布目录。`,
    );
  }

  const cssByFile = {};
  for (const file of STYLESHEETS) {
    cssByFile[file] = readStylesheet(join(fontDir, file));
  }
  const computedVersion = manifestVersionOf(cssByFile);

  const manifestPath = join(fontDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new UserError(`字体清单不存在：${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new UserError(`字体清单 ${manifestPath} 不是合法 JSON：${err.message}`);
  }
  const expectedVersion = typeof manifest.version === 'string' ? manifest.version : '';

  if (expectedVersion !== computedVersion) {
    throw new UserError(
      `清单版本与三份样式表不一致，拒绝回灌（一个字节都不会 stage）：\n` +
        `  清单里的版本：${expectedVersion}\n` +
        `  算出来的版本：${computedVersion}\n` +
        `  参与计算的样式表：${STYLESHEETS.join('、')}`,
    );
  }

  // ── ③ the hostile ledger entries, and the deleted releases ──────────────
  const { hostile } = readLedger(fontDir);
  for (const bad of hostile) {
    log(`[webfont] 台账里的目录名「${bad}」不是发布目录，已跳过（不会 git rm）。`);
  }
  if (hostile.length > 0) {
    throw new UserError(
      `发布台账里有 ${hostile.length} 条非法的目录名（${hostile.join('、')}）—— ` +
        '请先修好台账再回灌，否则台账一旦进了仓库，后台的台账读取会直接 500。',
    );
  }

  const removed = deletedReleaseDirs(root, fontDir);

  // ── ④ the staging — EXPLICIT paths, never `git add .` ───────────────────
  const stagedPaths = [
    `public/font/web/${dir}`,
    ...STYLESHEETS.map((file) => `public/font/${file}`),
    `public/font/${MANIFEST_FILE}`,
    `public/font/${LEDGER_FILE}`,
  ];
  for (const path of stagedPaths) {
    if (!existsSync(join(root, path))) {
      log(`[webfont] ${path} 不在工作区，跳过（没有的东西无法 stage）。`);
    }
  }
  const present = stagedPaths.filter((path) => existsSync(join(root, path)));
  git(root, ['add', '--', ...present]);

  for (const removedDir of removed) {
    const result = git(root, ['rm', '-r', '--ignore-unmatch', '--', `public/font/web/${removedDir}`], {
      allowFailure: true,
    });
    if (!result.ok) {
      throw new UserError(
        `无法从暂存区移除服务器已删除的发布目录 ${removedDir}：${result.stderr}`,
      );
    }
  }

  // ── ⑤ the numbers a human has to re-pin ─────────────────────────────────
  const subsets = allSubsetFiles(fontDir);
  const sizes = stylesheetSizes(fontDir);

  log('');
  log('[webfont] 回灌完成，下面这些「钉死的数字」需要人工重标定。');
  log('[webfont] （本脚本只打印，不写进任何源文件。）');
  log('');
  log('  tests/unit/lib/fonts-css.test.ts');
  log('    subsetFiles          <- subsets.length');
  log('    subsetBytes          <- 总字节');
  log('    cssBytes             <- cssBytes（原始）');
  log('    gzipBytes_sans/serif/wenkai  <- 三个 gzipBytes');
  log('  ⚠️ 每一行在哪：');
  log('    subsetFiles     -> tests/unit/lib/fonts-css.test.ts:372');
  log('    subsetBytes     -> tests/unit/lib/fonts-css.test.ts:373');
  log('    cssBytes        -> tests/unit/lib/fonts-css.test.ts:359');
  log('    gzipBytes_sans  -> tests/unit/lib/fonts-css.test.ts:84');
  log('    gzipBytes_serif -> tests/unit/lib/fonts-css.test.ts:95');
  log('    gzipBytes_wenkai -> tests/unit/lib/fonts-css.test.ts:106');
  log('');
  log('  scripts/fonts/verify-webfont-subsets.mjs');
  log('    LIMITS.unionSampleBytes        <- 只有语料变了才要改（候选校验 report 模式的 [verify] pagecost）');
  log('    LIMITS.maxUnionSampleFilesPerPage <- 只有语料变了才要改（同上）');
  log('');
  log('  tests/unit/deploy/nginx-config.test.ts');
  log('    读盘路径（第 688 行）  <- 不用改 —— 它已经跟着样式表里的 face.release 走了。');
  log('');
  // ⚠️ THE PARSEABLE BLOCK. One `key: value` per line, at the start of the
  // line, between the markers — a machine reads it, a human skips it. The
  // block is the CONTRACT (design §3.5.9); the prose above is for the
  // operator.
  log('--- webfont-reimport: begin ---');
  log(`subsetFiles: ${subsets.count}`);
  log(`subsetBytes: ${subsets.bytes}`);
  log(`cssBytes: ${sizes.rawBytes}`);
  for (const family of FAMILIES) {
    log(`gzipBytes_${family}: ${sizes.gzipBytes[family]}`);
  }
  log(`manifestVersion: ${computedVersion}`);
  log('--- webfont-reimport: end ---');
  log('');

  const stagedList = git(root, ['diff', '--cached', '--name-only']).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  log(`[webfont] 已暂存 ${stagedList.length} 个路径：`);
  for (const path of stagedList) log(`  ${path}`);
  if (removed.length > 0) {
    log(`[webfont] 服务器已删除、已从暂存区移除的发布目录：${removed.join('、')}`);
  }
  log('');

  // ── ⑥ the commit, only when it is asked for ─────────────────────────────
  if (commit) {
    git(root, ['commit', '-m', commitMessageOf(dir)]);
    const subject = git(root, ['log', '-1', '--format=%s']).stdout.trim();
    log(`[webfont] 已提交：${subject}`);
  } else {
    log('[webfont] 只暂存，没有提交。要提交请自己执行：');
    log(`  git commit -m "feat(fonts): publish webfont release ${dir} [YYYY-MM-DD HH.MM]"`);
  }

  return 0;
}

/**
 * The entry point of the script.
 *
 * @param {string[]} argv the arguments, without the script and the node
 * @param {string} [cwd] the directory the script works in — the repository
 *   root. It defaults to the working directory, and a test passes the root
 *   of its TEMPORARY repository explicitly.
 */
export function main(argv, cwd = process.cwd()) {
  try {
    process.exitCode = run(argv, cwd);
  } catch (err) {
    const message = err instanceof UserError ? err.message : `[webfont] 回灌脚本失败：${err.message}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
  return process.exitCode;
}

// The script runs itself when it is the entry point — and it does nothing
// when a test imports it.
if (process.argv[1] && process.argv[1].endsWith('import-webfont-release.mjs')) {
  main(process.argv.slice(2));
}
