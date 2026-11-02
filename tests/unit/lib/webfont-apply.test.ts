import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * The publish step of the font pipeline (design §3.5.2).
 *
 * An apply takes a finished staging build and makes it live. It does that in
 * the only order that can be safe: **build first, verify second, swap last**.
 * Nothing under the live tree changes until the candidate has passed the
 * wave-2 gate.
 *
 * ## The one invariant: G-3
 *
 * A visitor who cached the OLD stylesheet must never get a 404. Every woff2
 * the old stylesheet named has to still be there, **byte for byte**, after
 * the apply. That is why an apply publishes a NEW release directory
 * (`web/r<token>/`) and rewrites the stylesheets to point at it — it never
 * overwrites a file an old stylesheet names, and it never deletes anything.
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
 * ## Everything here runs in temporary directories
 *
 * The live tree is `public/font`, and the tests point `liveFontDir` at a
 * temporary directory instead. The ledger follows the tree it describes
 * (R-44), so the test's ledger lands in the temp directory too — the real
 * `public/font/releases.json` must not exist after a test run.
 */
import {
  applyStagedBuild,
  countFaceRules,
  manifestVersionOf,
  rewriteStylesheetUrls,
  type ApplyResult,
} from '@/lib/webfont/apply';
import { readReleases, planCleanup } from '@/lib/webfont/releases';
import { REPO_ROOT } from '@/lib/webfont/paths';
import { PINNED, PINNED_LINES, buildRebaselineChecklist } from '@/lib/webfont/rebaseline';
import { parseFaces, LIMITS } from '@/scripts/fonts/verify-webfont-subsets.mjs';
import { manifestVersion } from '@/scripts/fonts/build-webfont-subsets.mjs';

/** The three families the site ships. */
const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/** The three stylesheets, by their file name — the key of the V hash. */
const STYLESHEETS = ['fonts-sans.css', 'fonts-serif.css', 'fonts-wenkai.css'] as const;

/** What a fake gate reports back. */
type FakeRun = {
  code: number;
  stdout: string;
  stderr: string;
  /** What the fake saw — the test asserts on it. */
  calls: Array<{ bin: string; args: string[]; opts?: { cwd?: string; env?: Record<string, string> } }>;
};

/** Builds a fake gate that records its calls. */
function fakeGate(result: Partial<FakeRun> = {}): {
  run: FakeRun['calls'] extends never ? never : FakeRun;
  command: (
    bin: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
} {
  const calls: FakeRun['calls'] = [];
  return {
    run: { code: 0, stdout: '', stderr: '', calls },
    command: async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return {
        code: result.code ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    },
  };
}

/** The temporary trees of one test. */
type Trees = {
  root: string;
  live: string;
  staged: string;
};

let trees: Trees;

/** Creates the temporary trees of one test. */
function makeTrees(): Trees {
  const root = mkdtempSync(join(tmpdir(), 'webfont-apply-'));
  const live = join(root, 'live');
  const staged = join(root, 'staged');
  mkdirSync(live, { recursive: true });
  mkdirSync(staged, { recursive: true });
  return { root, live, staged };
}

/** The CSS of one family of the staged tree, with one face. */
function stylesheetFor(family: string, file: string, version: string): string {
  return [
    `/* fonts-${family}.css — test */`,
    '@font-face {',
    "  font-family: 'Noto Sans SC';",
    '  font-style: normal;',
    '  font-weight: 400 700;',
    '  font-display: swap;',
    `  src: url(/font/web/${family}/${file}?v=${version}) format('woff2');`,
    '  unicode-range: U+4E00;',
    '}',
    '',
  ].join('\n');
}

/**
 * Fills a tree with one stylesheet, one manifest and one subset file per
 * family — the smallest thing that can be published.
 */
function fillTree(
  dir: string,
  options: { version: string; subsetBytes: string },
): void {
  mkdirSync(join(dir, 'web'), { recursive: true });
  const files: Record<string, string> = {};
  for (const family of FAMILIES) {
    const familyDir = join(dir, 'web', family);
    mkdirSync(familyDir, { recursive: true });
    writeFileSync(join(familyDir, 'hot.woff2'), options.subsetBytes);
    writeFileSync(join(familyDir, `OFL-${family}.txt`), `licence of ${family}\n`);
    writeFileSync(
      join(dir, `fonts-${family}.css`),
      stylesheetFor(family, 'hot.woff2', options.version),
    );
    files[family] = `/font/fonts-${family}.css`;
  }
  writeFileSync(join(dir, 'web', 'OFL-sans.txt'), 'licence of sans\n');
  writeFileSync(join(dir, 'web', 'OFL-serif.txt'), 'licence of serif\n');
  writeFileSync(join(dir, 'web', 'OFL-wenkai.txt'), 'licence of wenkai\n');
  writeFileSync(
    join(dir, 'fonts-manifest.json'),
    `${JSON.stringify({ version: options.version, files }, null, 2)}\n`,
  );
}

/** Every file of a tree, with its bytes — the "nothing changed" fingerprint. */
function fingerprint(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const key = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) {
        walk(full, key);
      } else {
        map.set(key, readFileSync(full).toString('base64'));
      }
    }
  };
  walk(dir, '');
  return map;
}

/** The files of a tree that changed between two fingerprints. */
function changedFiles(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const name of names) {
    if (before.get(name) !== after.get(name)) changed.push(name);
  }
  return changed.sort();
}

beforeEach(() => {
  trees = makeTrees();
});

afterEach(() => {
  rmSync(trees.root, { recursive: true, force: true });
});

describe('applyStagedBuild', () => {
  it('publishes a new release directory and leaves the old bytes alone', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-1',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();

    // G-3: the file the old stylesheet named still holds the OLD bytes.
    expect(readFileSync(join(trees.live, 'web', 'sans', 'hot.woff2'), 'utf8')).toBe('OLD');

    // The new release carries the NEW bytes.
    const releaseDir = result.releaseDir;
    expect(releaseDir).toBe('ra1b2c3d4e5f6');
    expect(readFileSync(join(trees.live, 'web', releaseDir!, 'sans', 'hot.woff2'), 'utf8')).toBe(
      'NEW',
    );

    // Every woff2 URL of the live stylesheet now points at the release.
    const css = readFileSync(join(trees.live, 'fonts-sans.css'), 'utf8');
    expect(css).toContain(`/font/web/${releaseDir}/sans/hot.woff2`);
    expect(css).not.toContain('/font/web/sans/hot.woff2');

    // The manifest version changed, and it is V — not the staging token.
    const manifest = JSON.parse(
      readFileSync(join(trees.live, 'fonts-manifest.json'), 'utf8'),
    ) as { version: string; files: Record<string, string> };
    expect(manifest.version).toBe(result.manifestVersion);
    expect(manifest.version).not.toBe('a1b2c3d4e5f6');
    expect(manifest.version).toMatch(/^[0-9a-f]{12}$/);

    // The manifest still points at the published stylesheets.
    expect(manifest.files.sans).toBe('/font/fonts-sans.css');
  });

  it('keeps every URL of the old stylesheet alive, byte for byte', async () => {
    // The old stylesheet declares TWO faces, so "every URL" is two URLs and
    // not one — a test that only checks the first one proves nothing.
    const liveCss = [
      '@font-face {',
      "  font-family: 'Noto Sans SC';",
      '  src: url(/font/web/sans/hot.woff2?v=oldtoken) format(\'woff2\');',
      '}',
      '@font-face {',
      "  font-family: 'Noto Sans SC';",
      '  src: url(/font/web/sans/ext-001.woff2?v=oldtoken) format(\'woff2\');',
      '}',
      '',
    ].join('\n');
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    writeFileSync(join(trees.live, 'fonts-sans.css'), liveCss);
    mkdirSync(join(trees.live, 'web', 'sans'), { recursive: true });
    writeFileSync(join(trees.live, 'web', 'sans', 'ext-001.woff2'), 'OLD-EXT');

    // The bytes of every URL of the OLD stylesheet, before the apply.
    const oldUrls = Array.from(liveCss.matchAll(/url\(([^)]+)\)/g)).map((m) => m[1]);
    expect(oldUrls).toHaveLength(2);
    const before = new Map<string, string>();
    for (const url of oldUrls) {
      const path = url.split('?')[0].replace(/^\/font\//, '');
      before.set(path, readFileSync(join(trees.live, path)).toString('base64'));
    }

    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();
    const result = await applyStagedBuild({
      jobId: 'job-2',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });
    expect(result.ok).toBe(true);

    // Every URL of the old stylesheet still resolves, with the same bytes.
    for (const [path, bytes] of before) {
      expect(existsSync(join(trees.live, path))).toBe(true);
      expect(readFileSync(join(trees.live, path)).toString('base64')).toBe(bytes);
    }
  });

  it('sweeps nothing: four old release directories all survive', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    // Four old releases, with an mtime far in the past — a cleanup would
    // remove them, an apply must not.
    for (const token of ['raaaaaaaaaaa', 'rbbbbbbbbbbb', 'rccccccccccc', 'rddddddddddd']) {
      const dir = join(trees.live, 'web', token);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'marker.txt'), token);
    }
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-3',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    expect(result.swept).toEqual([]);
    for (const token of ['raaaaaaaaaaa', 'rbbbbbbbbbbb', 'rccccccccccc', 'rddddddddddd']) {
      expect(existsSync(join(trees.live, 'web', token))).toBe(true);
    }
  });

  it('never touches release 0', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    const before = fingerprint(join(trees.live, 'web', 'sans'));
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-4',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    for (const family of FAMILIES) {
      expect(existsSync(join(trees.live, 'web', family))).toBe(true);
    }
    expect(fingerprint(join(trees.live, 'web', 'sans'))).toEqual(before);
  });

  it('writes the licences in both places of the release', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-5',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    const releaseRoot = join(trees.live, 'web', result.releaseDir!);
    for (const family of FAMILIES) {
      // On the root of the release …
      expect(existsSync(join(releaseRoot, `OFL-${family}.txt`))).toBe(true);
      // … and inside the directory of the family.
      expect(existsSync(join(releaseRoot, family, `OFL-${family}.txt`))).toBe(true);
    }
    // Release 0's licences are never touched.
    expect(existsSync(join(trees.live, 'web', 'OFL-sans.txt'))).toBe(true);
  });

  it('refuses to publish when the gate fails, and changes nothing', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const before = fingerprint(trees.live);

    const gate = fakeGate({
      code: 1,
      stdout:
        '[verify]   [sans] the face hot.woff2 is missing\n' +
        '[verify]   [serif] the face hot.woff2 is missing\n' +
        '[verify] 3 error(s)\n',
      stderr: 'C:\\secret\\path\\stack\\trace\n',
    });

    const result = await applyStagedBuild({
      jobId: 'job-6',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('the face hot.woff2 is missing');
    // The stderr is never pasted into the user-facing message.
    expect(result.error).not.toContain('stack');

    // The release directory that was created for the candidate is gone.
    expect(existsSync(join(trees.live, 'web', 'ra1b2c3d4e5f6'))).toBe(false);

    // Nothing else under the live tree changed — byte for byte.
    const after = fingerprint(trees.live);
    expect(changedFiles(before, after)).toEqual([]);
  });

  it('refuses to publish the same build twice', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const first = await applyStagedBuild({
      jobId: 'job-7',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });
    expect(first.ok).toBe(true);

    const afterFirst = fingerprint(trees.live);
    const second = await applyStagedBuild({
      jobId: 'job-8',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(second.ok).toBe(false);
    expect(second.error).toContain('线上已经是这一份');
    // The second apply did not touch a single byte of the live tree.
    expect(changedFiles(afterFirst, fingerprint(trees.live))).toEqual([]);
  });

  it('runs the gate in report mode with the candidate as its font dir', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    await applyStagedBuild({
      jobId: 'job-9',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(gate.run.calls).toHaveLength(1);
    const call = gate.run.calls[0];
    // The gate is started with the ABSOLUTE path of the current node.
    expect(call.bin).toBe(process.execPath);
    expect(call.args[0]).toContain(join('scripts', 'fonts', 'verify-webfont-subsets.mjs'));
    // The candidate's page cost is REPORTED, never enforced.
    expect(call.opts?.env?.WEBFONT_PAGE_COST).toBe('report');
    // The gate reads the CANDIDATE, not the live tree.
    expect(call.opts?.env?.WEBFONT_FONT_DIR).toBeTruthy();
    expect(call.opts?.env?.WEBFONT_FONT_DIR).not.toBe(trees.live);
  });

  it('takes the page cost out of the gate output', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate({
      stdout:
        '[verify] pagecost: {"bytes":{"/":838960},"files":{"/":175},' +
        '"budgetBytes":{"/":839680},"budgetFiles":255}\n',
    });

    const result = await applyStagedBuild({
      jobId: 'job-10',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.pageCost).not.toBeNull();
    expect(result.pageCost!.bytes['/']).toBe(838960);
    expect(result.pageCost!.files['/']).toBe(175);
    expect(result.pageCost!.budgetBytes['/']).toBe(839680);
    expect(result.pageCost!.budgetFiles).toBe(255);
  });

  it('reports no page cost when the gate printed none', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-11',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.pageCost).toBeNull();
  });

  it('fails when the staging tree has no manifest', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    mkdirSync(trees.staged, { recursive: true });
    const gate = fakeGate();
    const before = fingerprint(trees.live);

    const result = await applyStagedBuild({
      jobId: 'job-12',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('manifest');
    expect(gate.run.calls).toHaveLength(0);
    expect(changedFiles(before, fingerprint(trees.live))).toEqual([]);
  });

  it('fails when a stylesheet has faces but no URL to rewrite', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    // A stylesheet whose faces point somewhere else entirely.
    writeFileSync(
      join(trees.staged, 'fonts-sans.css'),
      [
        '@font-face {',
        "  font-family: 'Noto Sans SC';",
        "  src: url(/elsewhere/sans/hot.woff2) format('woff2');",
        '}',
        '',
      ].join('\n'),
    );
    const gate = fakeGate();
    const before = fingerprint(trees.live);

    const result = await applyStagedBuild({
      jobId: 'job-13',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(false);
    expect(gate.run.calls).toHaveLength(0);
    expect(changedFiles(before, fingerprint(trees.live))).toEqual([]);
  });

  it('registers the superseded time in the ledger of the live tree', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    // The live stylesheet points at an OLD release, and the ledger holds it.
    // ⚠️ The release directory name has to be `r` plus LOWERCASE HEX — the
    // ledger refuses anything else, because the name reaches the delete path.
    const previousDir = 'r0a1b2c3d4e5f';
    writeFileSync(
      join(trees.live, 'fonts-sans.css'),
      stylesheetFor('sans', 'hot.woff2', '0123456789ab').replace(
        '/font/web/sans/',
        `/font/web/${previousDir}/sans/`,
      ),
    );
    writeFileSync(
      join(trees.live, 'releases.json'),
      `${JSON.stringify(
        {
          releases: [
            {
              dir: previousDir,
              token: '0a1b2c3d4e5f',
              publishedAt: '2026-10-01T00:00:00.000Z',
              supersededAt: null,
              deletedAt: null,
              files: 1,
              bytes: 3,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-14',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    expect(result.supersededDir).toBe(previousDir);

    const releases = readReleases(trees.live);
    const old = releases.find((release) => release.dir === previousDir);
    expect(old).toBeDefined();
    expect(old!.supersededAt).not.toBeNull();
    // The supersession was stamped AFTER the stylesheets went live.
    const stylesheetMtime = statSync(join(trees.live, 'fonts-sans.css')).mtimeMs;
    expect(Date.parse(old!.supersededAt!)).toBeGreaterThanOrEqual(stylesheetMtime - 1000);

    // The NEW release is in the ledger too, and it is not superseded.
    const fresh = releases.find((release) => release.dir === 'ra1b2c3d4e5f6');
    expect(fresh).toBeDefined();
    expect(fresh!.supersededAt).toBeNull();
  });

  it('writes the ledger into the live tree and not into the repository', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();
    const repoLedger = resolve(REPO_ROOT, 'public', 'font', 'releases.json');
    const existedBefore = existsSync(repoLedger);

    const result = await applyStagedBuild({
      jobId: 'job-15',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.ok).toBe(true);
    // The ledger of the live tree is written.
    expect(existsSync(join(trees.live, 'releases.json'))).toBe(true);
    // The repository's ledger is NOT created by a test.
    expect(existsSync(repoLedger)).toBe(existedBefore);
  });

  it('never writes the gate budget', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();
    const verifier = resolve(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs');
    const verifierTypes = resolve(
      REPO_ROOT,
      'scripts',
      'fonts',
      'verify-webfont-subsets.d.mts',
    );
    const before = {
      verifier: readFileSync(verifier),
      verifierTypes: readFileSync(verifierTypes),
    };

    await applyStagedBuild({
      jobId: 'job-16',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(readFileSync(verifier)).toEqual(before.verifier);
    expect(readFileSync(verifierTypes)).toEqual(before.verifierTypes);
  });

  it('summarises the live tree, the new product and the release', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-17',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.summary).not.toBeNull();
    // Three live files before the apply, three new ones in the product.
    expect(result.summary!.liveFiles).toBe(3);
    expect(result.summary!.liveBytes).toBe(9);
    expect(result.summary!.newFiles).toBe(3);
    expect(result.summary!.newBytes).toBe(9);
    expect(result.summary!.releaseBytes).toBeGreaterThan(0);
  });

  it('carries the re-import command and the rebase checklist', async () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    fillTree(trees.staged, { version: 'a1b2c3d4e5f6', subsetBytes: 'NEW' });
    const gate = fakeGate();

    const result = await applyStagedBuild({
      jobId: 'job-18',
      stagedFontDir: trees.staged,
      liveFontDir: trees.live,
      runCommand: gate.command,
    });

    expect(result.reimport.required).toBe(true);
    expect(result.reimport.command).toBe(
      'node scripts/fonts/import-webfont-release.mjs --release ra1b2c3d4e5f6',
    );
    expect(result.reimport.note).toContain('回灌');

    // The checklist has exactly SEVEN entries.
    expect(result.rebaseline).toHaveLength(7);
    for (const entry of result.rebaseline) {
      expect(entry.file).toBeTruthy();
      expect(entry.what).toBeTruthy();
      expect(typeof entry.always).toBe('boolean');
    }
  });
});

describe('rewriteStylesheetUrls', () => {
  it('rewrites every URL and keeps the query string', () => {
    const css = [
      '@font-face { src: url(/font/web/sans/hot.woff2?v=abc123) format(\'woff2\'); }',
      '@font-face { src: url(/font/web/sans/ext-001.woff2?v=abc123) format(\'woff2\'); }',
      '',
    ].join('\n');

    const result = rewriteStylesheetUrls(css, '/font/web/r0a1b2c3d4e5f');

    expect(result.expected).toBe(2);
    expect(result.rewritten).toBe(2);
    expect(result.css).toContain('/font/web/r0a1b2c3d4e5f/sans/hot.woff2?v=abc123');
    expect(result.css).toContain('/font/web/r0a1b2c3d4e5f/sans/ext-001.woff2?v=abc123');
    expect(result.css).not.toContain('/font/web/sans/hot.woff2');
  });

  it('reports expected > 0 and rewritten === 0 when there is nothing to rewrite', () => {
    const css = "@font-face { src: url(/elsewhere/hot.woff2) format('woff2'); }\n";

    const result = rewriteStylesheetUrls(css, '/font/web/r0a1b2c3d4e5f');

    expect(result.expected).toBe(1);
    expect(result.rewritten).toBe(0);
  });
});

describe('countFaceRules', () => {
  it('counts the faces of the three real stylesheets like the verifier does', () => {
    for (const file of STYLESHEETS) {
      const css = readFileSync(resolve(REPO_ROOT, 'public', 'font', file), 'utf8');
      expect(countFaceRules(css)).toBe(parseFaces(css).length);
    }
  });
});

describe('the manifest version', () => {
  it('agrees with wave-2 manifestVersion() over the three real stylesheets', () => {
    // The drift guard: the local implementation of the V hash must agree
    // with the authoritative one. ⚠️ The local copy exists because the
    // wave-2 scripts would drag `subset-font` (a wasm build) into the
    // server bundle; the copy is pinned HERE instead.
    const cssByFile: Record<string, string> = {};
    for (const file of STYLESHEETS) {
      cssByFile[file] = readFileSync(resolve(REPO_ROOT, 'public', 'font', file), 'utf8');
    }

    expect(manifestVersionOf(cssByFile)).toBe(manifestVersion(cssByFile));
    expect(manifestVersionOf(cssByFile)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('depends on the ORDER the keys sort into', () => {
    // The keys only decide the order — the hash is over the CSS contents.
    // Two key sets whose SORTED order differs therefore hash differently,
    // which is why the keys have to be the stylesheets' file names.
    const byFileName = {
      'fonts-sans.css': 'a',
      'fonts-serif.css': 'b',
      'fonts-wenkai.css': 'c',
    };
    const byOtherName = {
      'a.css': 'a',
      'b.css': 'b',
      'c.css': 'c',
    };

    expect(manifestVersionOf(byFileName)).toBe(manifestVersion(byFileName));
    expect(manifestVersionOf(byOtherName)).toBe(manifestVersion(byOtherName));
    // The two sets carry the same contents under the same sorted order,
    // so their hashes agree — the keys matter only through the order.
    expect(manifestVersionOf(byFileName)).toBe(manifestVersionOf(byOtherName));
    // Change the ORDER and the hash moves.
    expect(manifestVersionOf({ 'fonts-sans.css': 'a', 'fonts-serif.css': 'c' })).not.toBe(
      manifestVersionOf({ 'fonts-serif.css': 'a', 'fonts-sans.css': 'c' }),
    );
  });
});

describe('the rebase checklist (R-54)', () => {
  it('pins the numbers the repository pins today', () => {
    // ⚠️ THE DRIFT GUARD. `lib/webfont/rebaseline.ts` holds COPIES of the
    // numbers the repository pins — parsing the TypeScript test file at
    // runtime would be brittle and would make it a second source of truth.
    // ⇒ The copies live in one place, and this test says they are still
    // equal to what the repository pins. When one of them moves in the
    // repository and the copy does not, THIS test goes red.
    //
    // The numbers below are the ones `tests/unit/lib/fonts-css.test.ts`
    // asserts today (they are read from that file by eye, not parsed).
    expect(PINNED.subsetFiles).toBe(7981);
    expect(PINNED.subsetBytes).toBe(28236168);
    expect(PINNED.cssBytes).toBe(2023175);
    expect([...PINNED.cssGzipBytes]).toEqual([55821, 64536, 38491]);

    // And the two numbers that live in the verifier's LIMITS are read from
    // the verifier itself — it is importable, so there is no copy here.
    expect([...PINNED.unionSampleBytes]).toEqual([
      LIMITS.unionSampleBytes['/'],
      LIMITS.unionSampleBytes['/dictionary'],
      LIMITS.unionSampleBytes['/poetry'],
      LIMITS.unionSampleBytes['/stories'],
    ]);
    expect(PINNED.maxUnionSampleFilesPerPage).toBe(LIMITS.maxUnionSampleFilesPerPage);
  });

  it('names the lines the numbers live on', () => {
    expect(PINNED_LINES.subsetFiles).toBe(310);
    expect(PINNED_LINES.subsetBytes).toBe(311);
    expect(PINNED_LINES.cssBytes).toBe(298);
    expect([...PINNED_LINES.cssGzipBytes]).toEqual([73, 82, 91]);
  });

  it('builds exactly seven entries', () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    const checklist = buildRebaselineChecklist(trees.live, null);

    expect(checklist).toHaveLength(7);
    expect(checklist.map((entry) => entry.file)).toEqual([
      'tests/unit/lib/fonts-css.test.ts',
      'tests/unit/lib/fonts-css.test.ts',
      'tests/unit/lib/fonts-css.test.ts',
      'tests/unit/lib/fonts-css.test.ts',
      'scripts/fonts/verify-webfont-subsets.mjs',
      'scripts/fonts/verify-webfont-subsets.mjs',
      'tests/unit/deploy/nginx-config.test.ts',
    ]);
  });

  it('measures the live tree for the four numbers that always move', () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    const checklist = buildRebaselineChecklist(trees.live, null);

    // Three subset files of three bytes each.
    expect(checklist[0].expected).toBe(3);
    expect(checklist[1].expected).toBe(9);
    // The raw bytes of the three stylesheets of the tree.
    expect(checklist[2].expected).toBe(
      FAMILIES.reduce(
        (total, family) =>
          total + readFileSync(join(trees.live, `fonts-${family}.css`)).length,
        0,
      ),
    );
    // The gzipped bytes, in the family order sans → serif → wenkai.
    expect(checklist[3].expected).toHaveLength(3);
    for (const family of FAMILIES) {
      expect(checklist[3].expected).toContain(
        gzipSync(readFileSync(join(trees.live, `fonts-${family}.css`))).length,
      );
    }
  });

  it('says 未判定 when the page cost could not be measured', () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    const checklist = buildRebaselineChecklist(trees.live, null);

    // The two page-cost entries keep `expected: null` — the type does not
    // change — and the NOTE says the number was not measured. ⚠️ That is
    // the difference between 「未判定」 and 「不用改」: the panel must not
    // render a number nobody measured as "nothing to do".
    expect(checklist[4].expected).toBeNull();
    expect(checklist[5].expected).toBeNull();
    expect(checklist[4].note).toContain('未判定');
    expect(checklist[5].note).toContain('未判定');
  });

  it('says 不用改 when the corpus did not change', () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    // A page cost that measures exactly the pinned budgets.
    const checklist = buildRebaselineChecklist(trees.live, {
      bytes: {
        '/': PINNED.unionSampleBytes[0],
        '/dictionary': PINNED.unionSampleBytes[1],
        '/poetry': PINNED.unionSampleBytes[2],
        '/stories': PINNED.unionSampleBytes[3],
      },
      files: { '/': PINNED.maxUnionSampleFilesPerPage },
    });

    expect(checklist[4].expected).toBeNull();
    expect(checklist[5].expected).toBeNull();
    // The note that says 「未判定」 is NOT there — the number WAS measured.
    expect(checklist[4].note).toBeUndefined();
    expect(checklist[5].note).toBeUndefined();
  });

  it('carries the new numbers when the corpus did change', () => {
    fillTree(trees.live, { version: '0123456789ab', subsetBytes: 'OLD' });
    const checklist = buildRebaselineChecklist(trees.live, {
      bytes: {
        '/': 838960,
        '/dictionary': 330752,
        '/poetry': 241664,
        '/stories': 1214464,
      },
      files: { '/': 175, '/dictionary': 250 },
    });

    // The array keeps the key order of `current`.
    expect(checklist[4].expected).toEqual([838960, 330752, 241664, 1214464]);
    // The file budget is compared against the MAX over the pages.
    expect(checklist[5].expected).toBe(250);
  });
});

describe('the release ledger ranks by mtime, never by token (review focus #11)', () => {
  it('keeps the three most recent DIRECTORIES, whatever their tokens say', () => {
    // The publish token is a HASH — it is not monotonic. Ranking by it
    // would keep the wrong three, and deleting one of them hands a visitor
    // who cached the stylesheet a 404.
    const fontDir = join(trees.root, 'ledger');
    mkdirSync(join(fontDir, 'web'), { recursive: true });

    // Three release directories whose tokens sort in the OPPOSITE order of
    // their mtimes: the newest directory has the SMALLEST token.
    const dirs = ['rfffffffffff', 'r00000000000', 'r88888888888'];
    const now = Date.now();
    dirs.forEach((dir, index) => {
      const path = join(fontDir, 'web', dir);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'marker.txt'), dir);
      // The LAST directory is the newest.
      const mtime = new Date(now - (dirs.length - 1 - index) * 60_000);
      utimesSync(path, mtime, mtime);
    });

    // A ledger in which all three are old enough to go — but the newest
    // three directories are kept, and there are exactly three directories
    // ⇒ nothing qualifies.
    writeFileSync(
      join(fontDir, 'releases.json'),
      `${JSON.stringify(
        {
          releases: dirs.map((dir) => ({
            dir,
            token: dir.slice(1),
            publishedAt: '2026-01-01T00:00:00.000Z',
            supersededAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
            files: 1,
            bytes: 1,
          })),
        },
        null,
        2,
      )}\n`,
    );

    // Every one of them was superseded more than 30 days ago — the age
    // alone would qualify them all. The three most recent directories are
    // kept, so NONE of them may be cleaned.
    expect(planCleanup(new Date(), fontDir)).toEqual([]);
  });
});
