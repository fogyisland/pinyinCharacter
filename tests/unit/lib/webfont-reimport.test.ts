/**
 * The re-import script and what it does to git (design §3.5.8, §3.5.9).
 *
 * ## Why the script exists
 *
 * The deploy syncs the repository to the server **without `--delete`**. So if
 * the repository still holds the OLD stylesheets, the next deploy overwrites
 * the server's NEW stylesheets with the old ones ⇒ the site keeps serving the
 * old fonts while the admin page says 「已发布」 ⇒ a **silent rollback**, and
 * the manifest version is rolled back with it.
 *
 * ⇒ The remedy is a **script plus a human**: the backend never touches git
 * (design §9, rule 5). The script VERIFIES the release, STAGES exactly the
 * right paths, PRINTS the numbers that have to be re-pinned, and only
 * commits when it is told to.
 *
 * ## Everything here runs in a TEMPORARY git repository
 *
 * The script runs `git add` / `git rm` / `git commit`. Running it against
 * this repository would stage real files — and the tree of this project
 * carries a permanently modified `data/sutras/manifest.json` that must never
 * be staged. ⇒ Every test below builds a **throw-away git repository** in a
 * temporary directory, lays out a minimal `public/font/` tree in it, and
 * asserts against THAT repository.
 *
 * ## The order of the checks is part of the contract
 *
 * The `--release` argument is user input, and the release directory name
 * reaches the delete path (via the ledger) and the read path (via the font
 * tree). ⇒ The **shape** of the argument is checked BEFORE anything is read
 * or written: a `../../evil` must not even be joined onto a path, because
 * the join itself is the traversal (the ledger had exactly that bug — see
 * `ledger-dir-traversal-deletedir`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root of this project. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The script under test. */
const SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'import-webfont-release.mjs');

/**
 * The timeout of every test of this file.
 *
 * ⚠️ Every test of this file spawns `git` several times in a TEMPORARY
 * repository — `git init`, `git add`, `git commit`, `git status`, `git rm`.
 * On a busy Windows box (a virus scanner walking the 7 982 woff2 files of
 * the WORKING tree while the test runs) a single commit takes seconds, not
 * milliseconds. The default 5 s timeout of vitest made this file fail for
 * reasons that have nothing to do with the code under test.
 *
 * ⇒ The budget is set explicitly and generously. It is not a licence to
 * make the script slower — the script's own work is measured by the
 * assertions, not by the clock.
 */
const TEST_TIMEOUT = 60_000;

/** The three families of the site — the stylesheets the script hashes. */
const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/** The six stylesheets, by their file name — the key order of the V hash. */
const STYLESHEETS = [
  'fonts-sans-hot.css',
  'fonts-sans-ext.css',
  'fonts-serif-hot.css',
  'fonts-serif-ext.css',
  'fonts-wenkai-hot.css',
  'fonts-wenkai-ext.css',
] as const;

/** A release token: twelve lowercase hex characters. */
const TOKEN = 'a1b2c3d4e5f6';

/** The release directory of that token. */
const RELEASE_DIR = `r${TOKEN}`;

/** The temporary repositories this file created — they are removed afterwards. */
const temporaryDirs: string[] = [];

/** One temporary git repository with a minimal font tree in it. */
type TempRepo = {
  /** The root of the repository — the `.git` directory lives here. */
  root: string;
  /** The font tree of the repository — `<root>/public/font`. */
  fontDir: string;
};

/**
 * Runs a git command inside a repository and returns its output.
 *
 * ⚠️ The command is an ARGV ARRAY, never a shell string: on Windows a shell
 * string means quoting bugs, and a temporary path may contain spaces.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** The output of `git status --porcelain` — the staged and the dirty paths. */
function statusOf(root: string): string {
  return git(root, ['status', '--porcelain']);
}

/**
 * The paths that are STAGED, one per line.
 *
 * ⚠️ This is the **index against HEAD** — the exact meaning of 「被 stage
 * 了」. `git status --porcelain` is not the same thing: its second column
 * holds the paths that are merely DIRTY in the working tree, and after an
 * apply the working tree is dirty by design (the new release and the new
 * stylesheets were just synced down) — whether they are staged or not is
 * the question this project actually asks.
 */
function stagedPaths(root: string): string[] {
  const out = git(root, ['diff', '--cached', '--name-only']);
  return out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * The paths that are staged, read from the FIRST COLUMN of the porcelain
 * status.
 *
 * ⚠️ Two independent readings of the same question: `git diff --cached` and
 * the status column have to agree. A test that only looked at one of them
 * could go blind while the other stayed green.
 */
function stagedColumn(root: string): string[] {
  return statusOf(root)
    .split('\n')
    .map((line) => line.slice(0, 2))
    .filter((code) => code !== '' && code[0] !== ' ' && code[0] !== '?')
    .map((code) => code.trim());
}

/**
 * The V hash of a set of stylesheet contents — the rule of
 * `build-webfont-subsets.mjs`'s `manifestVersion()`, implemented here so the
 * test can build a tree whose manifest matches its stylesheets.
 */
function hashOf(cssByFile: Record<string, string>): string {
  const hash = createHash('sha256');
  for (const key of Object.keys(cssByFile).sort()) {
    hash.update(cssByFile[key]);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The CSS of one family of the test tree.
 *
 * @param release the release segment of the URL — empty for release 0
 */
function stylesheetFor(family: string, file: string, version: string, release: string): string {
  const segment = release === '' ? '' : `${release}/`;
  return [
    `/* fonts-${family}.css — test */`,
    '@font-face {',
    "  font-family: 'Noto Sans SC';",
    '  font-style: normal;',
    '  font-weight: 400 700;',
    '  font-display: swap;',
    `  src: url(/font/web/${segment}${family}/${file}?v=${version}) format('woff2');`,
    '  unicode-range: U+4E00;',
    '}',
    '',
  ].join('\n');
}

/**
 * Builds a temporary git repository with a minimal font tree in it.
 *
 * The tree holds release 0 (`web/sans`, `web/serif`, `web/wenkai`) **and** one
 * published release (`web/r<TOKEN>`), plus the three stylesheets, the
 * manifest and the ledger — everything the script reads.
 *
 * @param options.manifestVersion the version the manifest carries; `null`
 *   writes a version that does NOT match the stylesheets (the mismatch case)
 */
function makeRepo(options: { manifestVersion?: string | null } = {}): TempRepo {
  const root = mkdtempSync(join(tmpdir(), 'webfont-reimport-'));
  temporaryDirs.push(root);

  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Webfont Test']);
  git(root, ['config', 'user.email', 'webfont@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);

  const fontDir = join(root, 'public', 'font');
  mkdirSync(join(fontDir, 'web'), { recursive: true });

  // ── the state of the repository BEFORE the re-import ────────────────────
  //
  // ⚠️ The repository holds release 0 and the OLD stylesheets. The new
  // release and the new stylesheets are what the OPERATOR has just synced
  // down from the server — they are not in the repository yet. That is the
  // whole point of the script.
  const cssByFile: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const family of FAMILIES) {
    const familyDir = join(fontDir, 'web', family);
    mkdirSync(familyDir, { recursive: true });
    writeFileSync(join(familyDir, 'hot.woff2'), 'OLD');
    writeFileSync(join(familyDir, 'ext-001.woff2'), 'OLD');
    files[family] = `/font/fonts-${family}-hot.css`;
    files[`${family}Ext`] = `/font/fonts-${family}-ext.css`;
    // The OLD stylesheets point at release 0.
    for (const tier of ['hot', 'ext'] as const) {
      const subset = tier === 'hot' ? 'hot.woff2' : 'ext-001.woff2';
      writeFileSync(
        join(fontDir, `fonts-${family}-${tier}.css`),
        stylesheetFor(family, subset, '000000000000', ''),
      );
    }
  }
  writeFileSync(
    join(fontDir, 'fonts-manifest.json'),
    `${JSON.stringify({ version: '000000000000', files }, null, 2)}\n`,
  );
  writeFileSync(join(fontDir, 'releases.json'), `${JSON.stringify({ releases: [] }, null, 2)}\n`);

  // A file that must NEVER be staged — the trap of this project. It is
  // committed CLEAN here, so that `git status --porcelain` is empty until a
  // test dirties it on purpose.
  mkdirSync(join(root, 'data', 'sutras'), { recursive: true });
  writeFileSync(join(root, 'data', 'sutras', 'manifest.json'), '{"clean":true}\n');

  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'chore: the state before the re-import']);

  // ── the state of the WORKING TREE AFTER the apply ───────────────────────
  //
  // The new release directory is UNTRACKED (it was just synced down), and
  // the three stylesheets and the manifest are NEW (the apply rewrote them).
  for (const family of FAMILIES) {
    const releaseFamily = join(fontDir, 'web', RELEASE_DIR, family);
    mkdirSync(releaseFamily, { recursive: true });
    writeFileSync(join(releaseFamily, 'hot.woff2'), 'NEW');
    writeFileSync(join(releaseFamily, 'ext-001.woff2'), 'NEW');
  }
  for (const family of FAMILIES) {
    for (const tier of ['hot', 'ext'] as const) {
      const subset = tier === 'hot' ? 'hot.woff2' : 'ext-001.woff2';
      const name = `fonts-${family}-${tier}.css`;
      cssByFile[name] = stylesheetFor(family, subset, TOKEN, RELEASE_DIR);
      writeFileSync(join(fontDir, name), cssByFile[name]);
    }
  }
  const version = options.manifestVersion === undefined ? hashOf(cssByFile) : options.manifestVersion;
  writeFileSync(
    join(fontDir, 'fonts-manifest.json'),
    `${JSON.stringify({ version, files }, null, 2)}\n`,
  );
  writeFileSync(
    join(fontDir, 'releases.json'),
    `${JSON.stringify(
      {
        releases: [
          {
            dir: RELEASE_DIR,
            token: TOKEN,
            publishedAt: '2026-11-02T00:00:00.000Z',
            supersededAt: null,
            deletedAt: null,
            files: 3,
            bytes: 9,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  return { root, fontDir };
}

/**
 * Runs the script inside a repository.
 *
 * @param cwd the repository the script runs in
 * @param args the arguments of the script
 */
function runScript(cwd: string, args: string[]): { status: number | null; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? null,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

beforeEach(() => {
  // Each test gets a clean slate; the repositories are removed afterwards.
});

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the re-import script (R-87)', () => {
  it('refuses a release whose manifest version does not match the stylesheets', () => {
    // ⚠️ The manifest carries a version the stylesheets do not hash to. The
    // script must REFUSE — and it must refuse BEFORE it stages anything.
    const repo = makeRepo({ manifestVersion: 'ffffffffffff' });

    const run = runScript(repo.root, ['--release', RELEASE_DIR]);

    expect(run.status).not.toBe(0);
    // The message names the expected version and the computed one.
    expect(run.output).toContain('ffffffffffff');
    expect(run.output).toMatch(/[0-9a-f]{12}/);
    // ⚠️ NOT ONE BYTE IS STAGED — read twice, two ways.
    expect(stagedPaths(repo.root)).toEqual([]);
    expect(stagedColumn(repo.root)).toEqual([]);
  }, TEST_TIMEOUT);

  it('stages the release and only stages — it does not commit', () => {
    const repo = makeRepo();

    const before = git(repo.root, ['rev-parse', 'HEAD']);
    const run = runScript(repo.root, ['--release', RELEASE_DIR]);

    expect(run.status).toBe(0);
    // The commit did NOT happen.
    expect(git(repo.root, ['rev-parse', 'HEAD'])).toBe(before);

    // The six paths of the contract are staged.
    const staged = stagedPaths(repo.root);
    expect(staged).toContain(`public/font/web/${RELEASE_DIR}/sans/hot.woff2`);
    expect(staged).toContain('public/font/fonts-sans-hot.css');
    expect(staged).toContain('public/font/fonts-sans-ext.css');
    expect(staged).toContain('public/font/fonts-serif-hot.css');
    expect(staged).toContain('public/font/fonts-serif-ext.css');
    expect(staged).toContain('public/font/fonts-wenkai-hot.css');
    expect(staged).toContain('public/font/fonts-wenkai-ext.css');
    expect(staged).toContain('public/font/fonts-manifest.json');
    expect(staged).toContain('public/font/releases.json');
  }, TEST_TIMEOUT);

  it('stages nothing beyond the six paths — and never the sutras manifest', () => {
    // ⚠️ R-97: the script stages EXPLICIT paths. `git add .` would stage
    // the dirty `data/sutras/manifest.json` of this project with it.
    const repo = makeRepo();
    // The file is dirty — exactly as it is in this project, permanently.
    writeFileSync(join(repo.root, 'data', 'sutras', 'manifest.json'), '{"dirty":true}\n');

    const run = runScript(repo.root, ['--release', RELEASE_DIR]);

    expect(run.status).toBe(0);
    expect(stagedPaths(repo.root)).not.toContain('data/sutras/manifest.json');

    // Nothing beyond the six paths is staged: every staged path is under
    // `public/font/`, and the release directory is staged as a whole.
    for (const path of stagedPaths(repo.root)) {
      expect(path.startsWith('public/font/')).toBe(true);
    }
    // The untouched file is still dirty, but NOT staged.
    expect(statusOf(repo.root)).toContain('data/sutras/manifest.json');
  }, TEST_TIMEOUT);

  it('commits with the expected subject and attribution when it is told to', () => {
    const repo = makeRepo();

    const run = runScript(repo.root, ['--release', RELEASE_DIR, '--commit']);

    expect(run.status).toBe(0);
    const subject = git(repo.root, ['log', '-1', '--format=%s']).trim();
    const body = git(repo.root, ['log', '-1', '--format=%b']);

    // The subject carries the release and a local timestamp.
    expect(subject).toMatch(
      new RegExp(`^feat\\(fonts\\): publish webfont release ${RELEASE_DIR} \\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}\\.[0-9]{2}\\]$`),
    );
    // The body ends with the attribution.
    expect(body).toContain('Co-Authored-By: Claude Code <noreply@anthropic.com>');
    // And the commit really happened: the index is clean against the new
    // HEAD, and the release is IN the commit.
    expect(stagedPaths(repo.root)).toEqual([]);
    const committed = git(repo.root, ['show', '--name-only', '--format=', 'HEAD']);
    expect(committed).toContain(`public/font/web/${RELEASE_DIR}/sans/hot.woff2`);
    expect(committed).toContain('public/font/fonts-manifest.json');
    // The sutras manifest was never part of it.
    expect(committed).not.toContain('data/sutras/manifest.json');
  }, TEST_TIMEOUT);
});

describe('the release argument is checked BEFORE anything is read (R-206a)', () => {
  // ⚠️ What this group proves: the script refuses a malformed `--release`
  // argument **before** it derives any path from it.
  //
  // ⚠️ The observable is the REFUSAL MESSAGE. The script can refuse for
  // exactly three reasons, and each of them proves something different:
  //
  //   「不是合法的发布目录名」  the shape check fired — nothing was derived;
  //   「当前目录不是 git 仓库」  the script had already SPAWNED git, which
  //                             means it had already got past the shape
  //                             check and had ALREADY derived the path
  //                             (`repositoryRoot()` runs before `join()`);
  //   「发布目录 … 不在 …」      the path was derived AND probed on the disk.
  //
  // ⇒ A test that only asserts 「it refused, non-zero, nothing staged」
  // cannot tell these apart — that is the hole the review found.
  it('refuses a path traversal without staging anything', () => {
    // ⚠️ THE test of this task. `--release ../../evil` must be refused
    // before the script joins it onto any path — the join IS the traversal.
    const repo = makeRepo();
    // ⚠️ THE CANARY HAS TO BE WHERE THE TRAVERSAL ACTUALLY REACHES.
    //
    // The script joins the argument onto `<repo>/public/font/web` ⇒
    // `../../evil` resolves to `<repo>/public/evil` — INSIDE the repository.
    // A canary in an unrelated temp directory is a canary the traversal
    // can NEVER reach, and asserting on it proves nothing.
    const evil = join(repo.root, 'public', 'evil');
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, 'secret.txt'), 'secret\n');

    const run = runScript(repo.root, ['--release', '../../evil']);

    expect(run.status).not.toBe(0);
    // A Chinese message that says what is wrong.
    expect(run.output).toMatch(/[一-鿿]/);
    // ⚠️ The RAW argument is named — that is the expected behaviour.
    expect(run.output).toContain('../../evil');
    // ⚠️ The refusal must be the SHAPE refusal. If the script had got
    // past the shape check it would have refused for some OTHER reason
    // (「不是 git 仓库」/「发布目录 … 不在 …」) — and then the traversal
    // would already have happened.
    expect(run.output).toContain('不是合法的发布目录名');
    // ⚠️ NOT ONE BYTE IS STAGED — read twice, two ways.
    expect(stagedPaths(repo.root)).toEqual([]);
    expect(stagedColumn(repo.root)).toEqual([]);
    // ⚠️ THE POINT OF THIS ASSERTION: the script must refuse BEFORE it
    // joins the argument onto any path. If it joined first, the release
    // path would be `<repo>/public/evil` and the error message would NAME
    // it — the message at scripts/fonts/import-webfont-release.mjs:465
    // carries `${releasePath}`.
    //
    // ⇒ The output must not carry the JOINED path, and it must not carry
    // the canary's file name either (a script that READ the tree outside
    // the font tree would have to name what it read).
    //
    // ⚠️ The ABSOLUTE path is the assertion that has teeth on Windows:
    // `join()` writes `public\evil` there, so the forward-slash spelling
    // below would never match it.
    expect(run.output).not.toContain(evil);
    expect(run.output).not.toContain('public/evil');
    expect(run.output).not.toContain('secret.txt');
    // And the canary at the reachable path is still there — the script did
    // not delete it.
    expect(existsSync(join(evil, 'secret.txt'))).toBe(true);
  }, TEST_TIMEOUT);

  it('refuses the traversal BEFORE it spawns git or touches the disk', () => {
    // ⚠️ THE GUARD WITH TEETH. The case above cannot tell 「refused on the
    // shape」 from 「refused for some later reason」: a script that joined
    // the argument onto a path FIRST and validated it afterwards would
    // still exit non-zero, stage nothing, and print a Chinese message.
    //
    // ⇒ The discriminating observable is WHICH refusal it is. Run the
    // script in a directory that is NOT a git repository:
    //
    //   • the correct script refuses on the SHAPE and never spawns git ⇒
    //     the message is 「不是合法的发布目录名」;
    //   • a script that derived the path first calls `repositoryRoot()`
    //     first, which spawns `git rev-parse` ⇒ the message is
    //     「当前目录不是 git 仓库」 — the traversal has already happened.
    //
    // ⇒ This assertion has teeth: moving `validateReleaseName()` after
    // `join(fontDir, 'web', dir)` turns it red.
    const outside = mkdtempSync(join(tmpdir(), 'webfont-not-a-repo-'));
    temporaryDirs.push(outside);
    // ⚠️ The directory has to be OUTSIDE any git repository — otherwise
    // `git rev-parse --show-toplevel` would succeed and the refusal would
    // be a different one. Fail loudly rather than quietly prove nothing.
    let repoOf = '';
    try {
      repoOf = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: outside,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      repoOf = '';
    }
    expect(repoOf, 'the temporary directory must be outside any git repository').toBe('');

    const run = runScript(outside, ['--release', '../../evil']);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('不是合法的发布目录名');
    // ⚠️ It must NOT be the repository refusal — that would mean git was
    // already spawned, which means the path was already derived.
    expect(run.output).not.toContain('不是 git 仓库');
    // ⚠️ And the path must not be named at all.
    expect(run.output).not.toContain('public/evil');
    expect(run.output).not.toContain('secret.txt');
  }, TEST_TIMEOUT);

  it('refuses every malformed release argument', () => {
    const repo = makeRepo();

    for (const argument of ['../../evil', 'rABCDEF', 'web', '', 'r', 'rZZZZZZZZZZZZ', 'r../../etc']) {
      const run = runScript(repo.root, ['--release', argument]);
      expect(run.status, `the argument ${JSON.stringify(argument)} must be refused`).not.toBe(0);
      // ⚠️ The two readings of "staged" are asserted SEPARATELY — one of
      // them going blind must not be hidden by the other staying green.
      expect(
        stagedPaths(repo.root),
        `the argument ${JSON.stringify(argument)} must stage nothing`,
      ).toEqual([]);
      expect(
        stagedColumn(repo.root),
        `the argument ${JSON.stringify(argument)} must stage nothing`,
      ).toEqual([]);
    }
  }, TEST_TIMEOUT);

  it('refuses an unknown flag instead of silently staging nothing', () => {
    // ⚠️ A typo like `--relesae` must not look like a successful run.
    const repo = makeRepo();

    const run = runScript(repo.root, ['--relesae', RELEASE_DIR]);

    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/[一-鿿]/);
    expect(stagedPaths(repo.root)).toEqual([]);
    expect(stagedColumn(repo.root)).toEqual([]);
  }, TEST_TIMEOUT);
});

describe('the git rm rule (R-206c)', () => {
  it('removes the release directories the server has deleted', () => {
    const repo = makeRepo();

    // The server deleted an old release and stamped the ledger. The
    // directory is still in the repository (the deploy has not run yet).
    const oldDir = 'r0123456789ab';
    mkdirSync(join(repo.fontDir, 'web', oldDir, 'sans'), { recursive: true });
    writeFileSync(join(repo.fontDir, 'web', oldDir, 'sans', 'hot.woff2'), 'GONE');
    git(repo.root, ['add', '--all']);
    git(repo.root, ['commit', '--quiet', '-m', 'chore: a release the server deleted']);

    const ledger = JSON.parse(readFileSync(join(repo.fontDir, 'releases.json'), 'utf8'));
    ledger.releases.push({
      dir: oldDir,
      token: oldDir.slice(1),
      publishedAt: '2026-10-01T00:00:00.000Z',
      supersededAt: '2026-10-02T00:00:00.000Z',
      deletedAt: '2026-11-01T00:00:00.000Z',
      files: 1,
      bytes: 4,
    });
    writeFileSync(join(repo.fontDir, 'releases.json'), `${JSON.stringify(ledger, null, 2)}\n`);

    const run = runScript(repo.root, ['--release', RELEASE_DIR]);

    expect(run.status).toBe(0);
    // The deletion is STAGED — that is the whole point: the repository and
    // the server agree afterwards. `git rm -r` takes the path out of the
    // index AND off the disk.
    expect(stagedPaths(repo.root)).toContain(`public/font/web/${oldDir}/sans/hot.woff2`);
    // And the file is really gone from the working tree.
    expect(existsSync(join(repo.fontDir, 'web', oldDir, 'sans', 'hot.woff2'))).toBe(false);
  }, TEST_TIMEOUT);

  it('refuses a ledger entry whose directory is not a release directory', () => {
    // ⚠️ The ledger is external input too: the backend writes it, but the
    // script does not ASSUME the backend is right. A hostile `dir` must be
    // SKIPPED with an error — never `git rm -r`'d.
    const repo = makeRepo();

    const ledger = JSON.parse(readFileSync(join(repo.fontDir, 'releases.json'), 'utf8'));
    ledger.releases.push({
      dir: '../../etc',
      token: 'etc',
      publishedAt: '2026-10-01T00:00:00.000Z',
      supersededAt: '2026-10-02T00:00:00.000Z',
      deletedAt: '2026-11-01T00:00:00.000Z',
      files: 1,
      bytes: 4,
    });
    writeFileSync(join(repo.fontDir, 'releases.json'), `${JSON.stringify(ledger, null, 2)}\n`);

    const run = runScript(repo.root, ['--release', RELEASE_DIR]);

    // The run says what it refused.
    expect(run.output).toContain('../../etc');
    // And the ledger is NOT staged — a hostile entry does not go into the
    // repository, where `readReleases` would throw on it.
    expect(stagedPaths(repo.root)).not.toContain('public/font/releases.json');
  }, TEST_TIMEOUT);
});
