/**
 * The numbers the re-import script PRINTS, and the re-base checklist they
 * belong to (design §3.5.9, §3.7).
 *
 * ## The two halves of this file
 *
 *  1. **The printed numbers are the RIGHT numbers.** The script prints four
 *     values that a human pastes into `tests/unit/lib/fonts-css.test.ts`.
 *     If the script measured them differently from the way the test
 *     measures them, the pasted value would not satisfy the assertion it is
 *     meant to satisfy — the re-calibration would break the suite instead of
 *     fixing it. ⇒ The test computes the four values INDEPENDENTLY from the
 *     same tree and asserts that the script prints exactly those.
 *
 *     ⇒ It also asserts that the script's own manifest-version hash agrees
 *     with `manifestVersion()` of `build-webfont-subsets.mjs` — the drift
 *     guard between the two implementations of one rule. The script computes
 *     the hash with `node:crypto` and does NOT import the build script,
 *     because that script pulls `subset-font` (a wasm build) into it.
 *
 *  2. **The checklist's shape.** `lib/webfont/rebaseline.ts` (Task 6's
 *     module) holds the seven entries. The test asserts the DATA: exactly
 *     seven entries, and the two page-cost entries carry `expected: null`
 *     when the corpus did not change.
 *
 * ## ⚠️ The script PRINTS, it never WRITES
 *
 * The re-calibration of the pinned numbers is a separate, human-reviewed
 * change (design §3.7). The backend never rewrites `LIMITS` or the pinned
 * constants of the test — a gate that rewrites its own budget is a false
 * green light. ⇒ This test asserts that the pinned numbers of the
 * repository are EXACTLY what they are today.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PINNED, buildRebaselineChecklist } from '@/lib/webfont/rebaseline';
import { manifestVersion } from '@/scripts/fonts/build-webfont-subsets.mjs';
import { parseFaceUrl } from '@/scripts/fonts/verify-webfont-subsets.mjs';

/** The repository root of this project. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The script under test. */
const SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'import-webfont-release.mjs');

/** The three families of the site. */
const FAMILIES = ['sans', 'serif', 'wenkai'] as const;

/** The three stylesheets, by their file name — the key order of the V hash. */
const STYLESHEETS = ['fonts-sans.css', 'fonts-serif.css', 'fonts-wenkai.css'] as const;

/** A release token: twelve lowercase hex characters. */
const TOKEN = 'a1b2c3d4e5f6';

/** The release directory of that token. */
const RELEASE_DIR = `r${TOKEN}`;

/** The temporary directories this file created — they are removed afterwards. */
const temporaryDirs: string[] = [];

/**
 * The V hash of a set of stylesheet contents — the rule of
 * `manifestVersion()`, implemented here so the test can build a tree whose
 * manifest matches its stylesheets.
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

/** A temporary font tree with release 0 and one published release in it. */
type Tree = {
  /** The root of the tree — the repository the script runs in. */
  root: string;
  /** The font tree — `<root>/public/font`. */
  fontDir: string;
};

/**
 * Builds a temporary tree with a minimal font layout in it.
 *
 * ⚠️ The tree holds release 0 **and** one published release, so the
 * recursive numbers the script prints count BOTH — exactly the situation
 * of the re-import day (the repository holds release 0 until the import
 * has been committed).
 */
function makeTree(): Tree {
  const root = mkdtempSync(join(tmpdir(), 'webfont-rebaseline-'));
  temporaryDirs.push(root);

  // ⚠️ The script stages paths with git ⇒ it needs a repository to work in.
  // This one is THROWAWAY: the tree of this project is never touched.
  execFileSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Webfont Test'], { cwd: root, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'webfont@example.invalid'], {
    cwd: root,
    encoding: 'utf8',
  });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, encoding: 'utf8' });

  const fontDir = join(root, 'public', 'font');
  mkdirSync(join(fontDir, 'web'), { recursive: true });

  const cssByFile: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const family of FAMILIES) {
    const familyDir = join(fontDir, 'web', family);
    mkdirSync(familyDir, { recursive: true });
    writeFileSync(join(familyDir, 'hot.woff2'), 'OLD');
    cssByFile[`fonts-${family}.css`] = stylesheetFor(family, 'hot.woff2', TOKEN, RELEASE_DIR);
    files[family] = `/font/fonts-${family}.css`;
    writeFileSync(join(fontDir, `fonts-${family}.css`), cssByFile[`fonts-${family}.css`]);
  }

  for (const family of FAMILIES) {
    const releaseFamily = join(fontDir, 'web', RELEASE_DIR, family);
    mkdirSync(releaseFamily, { recursive: true });
    writeFileSync(join(releaseFamily, 'hot.woff2'), 'NEW');
  }

  writeFileSync(
    join(fontDir, 'fonts-manifest.json'),
    `${JSON.stringify({ version: hashOf(cssByFile), files }, null, 2)}\n`,
  );
  writeFileSync(
    join(fontDir, 'releases.json'),
    `${JSON.stringify({ releases: [] }, null, 2)}\n`,
  );

  return { root, fontDir };
}

/**
 * Runs the script and returns its output.
 *
 * ⚠️ The script has to run inside a git repository (it stages paths), so the
 * tree is initialised as one before the script runs.
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

/**
 * Reads one value out of the script's parseable output block.
 *
 * The block is one `key: value` per line, between the two markers, so the
 * value of a key is the text behind it, up to the end of the line. ⚠️ Only
 * the block is read: the prose around it is for the operator, and a line
 * there that happens to carry the same word must not be mistaken for the
 * contract.
 */
function valueOf(output: string, key: string): string {
  const block = /--- webfont-reimport: begin ---\n([\s\S]*?)--- webfont-reimport: end ---/.exec(
    output,
  );
  if (!block) throw new Error(`the output carries no parseable block:\n${output}`);
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block[1]);
  if (!match) throw new Error(`the output block carries no "${key}" line:\n${block[1]}`);
  return match[1].trim();
}

/**
 * The recursive `*.woff2` count and byte total of a font tree — the
 * measurement of `allSubsetFiles()` in `tests/unit/lib/fonts-css.test.ts`.
 */
function allSubsetFiles(fontDir: string): { count: number; bytes: number } {
  const root = join(fontDir, 'web');
  let count = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
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

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the numbers the re-import script prints (brief case 5)', () => {
  it('prints the recursive all-release file count and byte total', () => {
    const tree = makeTree();

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);
    expect(run.status).toBe(0);

    // The test measures the tree INDEPENDENTLY, exactly the way
    // `allSubsetFiles()` of the repository's own test does.
    const expected = allSubsetFiles(tree.fontDir);

    // ⚠️ The count is the ALL-RELEASE count (release 0 AND the new release),
    // not the count of the new release alone — the assertion in the
    // repository counts the whole tree.
    expect(expected.count).toBe(6);
    expect(Number(valueOf(run.output, 'subsetFiles'))).toBe(expected.count);
    expect(Number(valueOf(run.output, 'subsetBytes'))).toBe(expected.bytes);
  });

  it('prints the raw bytes of the three stylesheets together', () => {
    const tree = makeTree();

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);
    expect(run.status).toBe(0);

    // The measurement of `cssBytes` in the repository's own test: the RAW
    // bytes of the three stylesheets, LF-normalized.
    let expected = 0;
    for (const file of STYLESHEETS) {
      expected += Buffer.byteLength(
        readFileSync(join(tree.fontDir, file), 'utf8').replace(/\r\n/g, '\n'),
        'utf8',
      );
    }

    expect(Number(valueOf(run.output, 'cssBytes'))).toBe(expected);
  });

  it('prints the gzipped bytes of each stylesheet at the zlib default level', () => {
    const tree = makeTree();

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);
    expect(run.status).toBe(0);

    // ⚠️ The measurement is `gzipSync(Buffer.from(css, 'utf8')).length` —
    // the zlib DEFAULT level, with NO options object. A `{ level: 9 }`
    // would print a different number, and the pasted value would not
    // satisfy the assertion it is meant to satisfy.
    for (const family of FAMILIES) {
      const css = readFileSync(join(tree.fontDir, `fonts-${family}.css`), 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      const expected = gzipSync(Buffer.from(css, 'utf8')).length;
      expect(Number(valueOf(run.output, `gzipBytes_${family}`))).toBe(expected);
    }
  });

  it('names the place every printed number goes', () => {
    const tree = makeTree();

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);
    expect(run.status).toBe(0);

    // The operator must not have to remember where a number belongs.
    expect(run.output).toContain('tests/unit/lib/fonts-css.test.ts');
  });

  it('agrees with the build script about the manifest version', () => {
    // ⚠️ THE DRIFT GUARD. The script computes the V hash itself, with
    // `node:crypto`, because importing `build-webfont-subsets.mjs` would
    // drag `subset-font` into it. ⇒ The two implementations of the rule
    // have to agree, and this is where that is proved.
    const tree = makeTree();

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);
    expect(run.status).toBe(0);

    const cssByFile: Record<string, string> = {};
    for (const file of STYLESHEETS) {
      cssByFile[file] = readFileSync(join(tree.fontDir, file), 'utf8').replace(/\r\n/g, '\n');
    }

    // The script's own hash.
    expect(valueOf(run.output, 'manifestVersion')).toBe(manifestVersion(cssByFile));
    // And it is the version the manifest carries — the script refused
    // nothing, so the two agreed.
    expect(valueOf(run.output, 'manifestVersion')).toBe(
      JSON.parse(readFileSync(join(tree.fontDir, 'fonts-manifest.json'), 'utf8')).version,
    );
  });
});

describe('the re-base checklist (brief case 9, at the data level)', () => {
  it('has exactly seven entries', () => {
    const tree = makeTree();
    const checklist = buildRebaselineChecklist(tree.fontDir, null);

    expect(checklist).toHaveLength(7);
  });

  it('says 不用改 for the two page-cost entries when the corpus did not change', () => {
    // ⚠️ Brief case 9: the entries whose `expected` is `null` are the ones
    // the corpus did not change. The RENDERING of 「不用改」 is Task 8's
    // case 8; here it is the DATA.
    const tree = makeTree();
    const checklist = buildRebaselineChecklist(tree.fontDir, {
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

  it('always moves the four numbers that the import changes', () => {
    const tree = makeTree();
    const checklist = buildRebaselineChecklist(tree.fontDir, null);

    // The first four entries are the ones a human has to re-pin after EVERY
    // import — the file count, the byte total, the raw CSS bytes and the
    // three gzipped sizes.
    for (const entry of checklist.slice(0, 4)) {
      expect(entry.always).toBe(true);
    }
    // The two page-cost entries only move when the corpus changed.
    expect(checklist[4].always).toBe(false);
    expect(checklist[5].always).toBe(false);
    // And the read path of the nginx test needs nothing (Task 2 made it
    // follow the stylesheet on its own).
    expect(checklist[6].expected).toBeNull();
  });
});

describe('the release-aware read path of the repository test (R-91)', () => {
  it('reads the family directory the stylesheet points at', () => {
    // ⚠️ After an apply the stylesheets point at `/font/web/r<token>/<fam>/`,
    // and the family directory has to be located FROM THE STYLESHEET. The
    // repository's own test (`tests/unit/lib/fonts-css.test.ts`) does that
    // now — this test is the drift guard between its LOCAL parse and the
    // authoritative one (`parseFaceUrl()` of the verifier, Task 2's).
    const tree = makeTree();

    // The stylesheet of the tree points at the release.
    const css = readFileSync(join(tree.fontDir, 'fonts-sans.css'), 'utf8');
    const face = /src:\s*url\(([^)]*)\)/.exec(css);
    expect(face).not.toBeNull();

    // The verifier's parser reads the release segment out of it.
    const parsed = parseFaceUrl(face![1].trim());
    expect(parsed).not.toBeNull();
    expect(parsed!.release).toBe(RELEASE_DIR);
    expect(parsed!.dir).toBe('sans');

    // ⇒ the family directory is `web/<release>/<family>`.
    const familyDir = join(tree.fontDir, 'web', parsed!.release, parsed!.dir);
    expect(existsSync(familyDir)).toBe(true);
    expect(readdirSync(familyDir).filter((name) => name.endsWith('.woff2'))).toHaveLength(1);
  });

  it('leaves the release-0 path byte-identical to what it was', () => {
    // ⚠️ The guarantee of R-91: with an EMPTY release segment the path is
    // exactly the one the repository used before the release directory
    // model existed — `web/sans`, not `web//sans` and not `web/sans/`.
    const tree = makeTree();

    const css = [
      '@font-face {',
      '  src: url(/font/web/sans/hot.woff2?v=000000000000) format(\'woff2\');',
      '}',
      '',
    ].join('\n');
    const face = /src:\s*url\(([^)]*)\)/.exec(css);
    const parsed = parseFaceUrl(face![1].trim());

    expect(parsed!.release).toBe('');
    expect(parsed!.dir).toBe('sans');
    // The path the repository's test builds: `web/` + the empty segment +
    // the family — which is `web/sans`.
    const segment = parsed!.release === '' ? '' : `${parsed!.release}/`;
    expect(`web/${segment}${parsed!.dir}`).toBe('web/sans');
  });
});

describe('the pinned numbers of the repository (R-94)', () => {
  it('are exactly what the repository pins today', () => {
    // ⚠️ The script PRINTS; it never writes. The re-calibration is a
    // separate, human-reviewed change (design §3.7) ⇒ the numbers in the
    // repository are still the ones of the shipped build.
    const testFile = readFileSync(
      join(REPO_ROOT, 'tests', 'unit', 'lib', 'fonts-css.test.ts'),
      'utf8',
    );

    expect(testFile).toContain('expect(subsets.length).toBe(7981);');
    expect(testFile).toContain('expect(subsets.reduce((total, file) => total + file.bytes, 0)).toBe(28236168);');
    expect(testFile).toContain('expect(cssBytes).toBe(2023175);');
    expect(testFile).toContain('gzipBytes: 55821,');
    expect(testFile).toContain('gzipBytes: 64536,');
    expect(testFile).toContain('gzipBytes: 38491,');
  });

  it('leaves the verifier budgets alone', () => {
    const verifier = readFileSync(
      join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs'),
      'utf8',
    );

    expect(verifier).toContain("'/': 839680");
    expect(verifier).toContain("'/dictionary': 330752");
    expect(verifier).toContain("'/poetry': 241664");
    expect(verifier).toContain("'/stories': 1214464");
    expect(verifier).toContain('maxUnionSampleFilesPerPage: 255');
  });
});

describe('the script refuses to work outside a git repository', () => {
  it('says so instead of failing silently', () => {
    // A directory that is not a repository ⇒ there is nothing to stage in
    // ⇒ the run must fail with a message that says why.
    const outside = mkdtempSync(join(tmpdir(), 'webfont-norepo-'));
    temporaryDirs.push(outside);

    const run = runScript(outside, ['--release', RELEASE_DIR]);

    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/[一-鿿]/);
  });

  it('does not need the repository to have a release directory it did not write', () => {
    // The release directory has to be THERE — the script verifies, it does
    // not create. A missing directory is a clear failure, not a silent one.
    const tree = makeTree();
    rmSync(join(tree.fontDir, 'web', RELEASE_DIR), { recursive: true, force: true });

    const run = runScript(tree.root, ['--release', RELEASE_DIR]);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(RELEASE_DIR);
  });
});
