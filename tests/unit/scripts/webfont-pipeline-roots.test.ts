/**
 * The roots of the font pipeline, and the page cost mode.
 *
 * Two things are proved here:
 *
 *   1. THE ROOT IS OVERRIDABLE. `WEBFONT_FONT_DIR` names the font root,
 *      and BOTH the subsetter and the verifier resolve it the same way —
 *      the same name, the same meaning, the same answer. A relative path
 *      is resolved against the REPOSITORY ROOT and not against the
 *      working directory, so a pipeline that runs from anywhere cuts and
 *      checks the same tree.
 *
 *   2. THE PAGE COST CAN BE REPORTED INSTEAD OF ENFORCED. The page cost
 *      is measured against the union sample of the LIVE pages, so it
 *      describes the shipped tree and not a candidate; a candidate build
 *      therefore reports it instead of failing on it. What that must NOT
 *      do is weaken the gate: the very same over-budget sample still
 *      fails in `enforce` mode, so the intrinsic checks are untouched.
 *
 * The licences travel with the fonts: every release directory has to
 * carry the licence of its family, so a release can be taken away as a
 * whole directory. The three licences on the root of the shipped tree
 * stay where they are — release 0 is not changed by this.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FAMILIES,
  resolveFontDir as resolveBuildFontDir,
} from '../../../scripts/fonts/build-webfont-subsets.mjs';
import {
  resolveFontDir as resolveVerifyFontDir,
  resolvePageCostMode,
} from '../../../scripts/fonts/verify-webfont-subsets.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'fonts', 'verify-webfont-subsets.mjs');
const SAMPLE_PATH = join(REPO_ROOT, 'data', 'font-page-sample.json');
const SHIPPED_WEB_DIR = join(REPO_ROOT, 'public', 'font', 'web');

/** The temporary directories this file created — they are removed after every test. */
const temporaryDirs: string[] = [];

/** The note the report mode prints, verbatim. */
const REPORT_NOTE =
  '[verify] note   : PAGE COST IS REPORTED, NOT ENFORCED — these numbers describe the LIVE tree, not the candidate';

/** Make a temporary directory that is removed when the test ends. */
function temporaryDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.WEBFONT_FONT_DIR;
  vi.resetModules();
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the font root is overridable, and both scripts agree on it', () => {
  it('defaults to public/font', () => {
    // The default must not change: the shipped tree is the tree the
    // pipeline works on today.
    expect(resolveBuildFontDir({})).toBe(join(REPO_ROOT, 'public', 'font'));
    expect(resolveVerifyFontDir({})).toBe(join(REPO_ROOT, 'public', 'font'));
  });

  it('resolves a relative override against the repository root', () => {
    // The working directory of a pipeline is not the repository root, so
    // a relative override is resolved against the ROOT and not against
    // the cwd — otherwise the same command would cut a different tree
    // depending on where it was started from.
    const build = resolveBuildFontDir({ WEBFONT_FONT_DIR: join('tmp', 'y') });
    const verify = resolveVerifyFontDir({ WEBFONT_FONT_DIR: join('tmp', 'y') });
    for (const dir of [build, verify]) {
      expect(isAbsolute(dir)).toBe(true);
      expect(dir.startsWith(REPO_ROOT)).toBe(true);
      expect(dir.endsWith(join('tmp', 'y'))).toBe(true);
    }
    // The same name, the same meaning, the same answer: the subsetter and
    // the verifier must point at ONE tree, or the checker would check a
    // tree nobody cut.
    expect(build).toBe(verify);
  });
});

describe('the page cost mode', () => {
  it('is enforced by default', () => {
    expect(resolvePageCostMode({})).toBe('enforce');
  });

  it('can be told to report instead', () => {
    expect(resolvePageCostMode({ WEBFONT_PAGE_COST: 'report' })).toBe('report');
  });

  it('refuses a misspelled mode instead of falling back to enforce', () => {
    // A typo must not silently turn the gate off — that would be a
    // green light nobody asked for.
    expect(() => resolvePageCostMode({ WEBFONT_PAGE_COST: 'nonsense' })).toThrow(
      /WEBFONT_PAGE_COST must be "enforce" or "report", got "nonsense"/,
    );
  });
});

describe('the page cost of a candidate is reported, not enforced', () => {
  /**
   * A sample that paints far more Ext blocks than it may.
   *
   * The characters come from ANOTHER page of the same sample, so every
   * one of them is a character a real page really painted: it is claimed
   * by a subset and it pulls a real file into the page. A character no
   * face claims would add no bytes at all, and the test would prove
   * nothing.
   */
  function writeOverBudgetSample(): string {
    const dir = temporaryDir('webfont-pipeline-sample-');
    const value = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
    value.pages['/'].serif = value.pages['/'].serif + value.pages['/stories'].serif;
    const path = join(dir, 'font-page-sample.json');
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  /** Run the verifier over a sample, with the environment of the caller. */
  function runVerifier(samplePath: string, extra: Record<string, string> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, WEBFONT_SAMPLE_PATH: samplePath };
    // ⚠️ The enforce run must run WITHOUT the override: the default is
    // what is being proved.
    delete env.WEBFONT_PAGE_COST;
    Object.assign(env, extra);
    const result = spawnSync(process.execPath, [VERIFY_SCRIPT], {
      env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it(
    'fails the over-budget sample when the page cost is enforced',
    () => {
      const run = runVerifier(writeOverBudgetSample());
      expect(run.status).not.toBe(0);
      expect(run.output).toContain('the budget is');
    },
    300_000,
  );

  it(
    'reports the same over-budget sample instead of failing on it',
    () => {
      // The very same sample: the only defect of it is the page cost, so
      // in report mode everything else stays green and the exit code is
      // zero. The page cost layer is gone; the intrinsic checks are not.
      const run = runVerifier(writeOverBudgetSample(), { WEBFONT_PAGE_COST: 'report' });
      expect(run.status).toBe(0);
      // ⚠️ The error text of the enforce mode must NOT leak into the
      // report mode — that is the proof that the page cost was taken out
      // of the errors and not merely re-worded.
      expect(run.output).not.toContain('the budget is');
      expect(run.output).toContain(REPORT_NOTE);
      // The machine readable line: Task 6 takes the new numbers from it
      // and nowhere else, so its shape is pinned.
      expect(run.output).toMatch(/^\[verify\] pagecost: \{.*\}$/m);
      expect(run.output).toContain('"budgetFiles":255');
    },
    300_000,
  );

  it(
    'prints no pagecost line at all when there is no page cost to print',
    () => {
      // ⚠️ The machine readable line is either ONE LINE OF VALID JSON or
      // it is absent. When a fixture cannot be read there is no page
      // cost, and "pagecost: null" is not JSON — a parser that reads the
      // line would choke on it. The run fails anyway in that case, and
      // the failure is on its own line.
      const missing = join(temporaryDir('webfont-pipeline-missing-'), 'no-such-sample.json');
      const run = runVerifier(missing, { WEBFONT_PAGE_COST: 'report' });

      // The fixture really is missing, so the run failed.
      expect(run.status).not.toBe(0);
      // ⚠️ The line must be ABSENT, not reworded.
      expect(run.output).not.toContain('pagecost: null');
      expect(run.output).not.toMatch(/^\[verify\] pagecost:/m);
    },
    300_000,
  );
});

describe('every release directory carries the licence of its family', () => {
  it(
    'writes the licence into the root of the tree AND into the family directory',
    async () => {
      const fontDir = temporaryDir('webfont-pipeline-fonts-');
      const stagingDir = join(fontDir, 'staging');
      mkdirSync(stagingDir, { recursive: true });
      for (const family of FAMILIES) {
        writeFileSync(join(stagingDir, family.license), `the licence of ${family.key}\n`);
      }

      // The module is imported WITH the override in place, so its output
      // root is the temporary tree and the shipped tree is not touched.
      process.env.WEBFONT_FONT_DIR = fontDir;
      vi.resetModules();
      const build = await import('../../../scripts/fonts/build-webfont-subsets.mjs');

      for (const family of FAMILIES) {
        await build.copyFamilyLicences(family, stagingDir);
        const onTheRoot = join(fontDir, 'web', `OFL-${family.key}.txt`);
        const inTheFamily = join(fontDir, 'web', family.dir, `OFL-${family.key}.txt`);
        expect(existsSync(onTheRoot)).toBe(true);
        expect(existsSync(inTheFamily)).toBe(true);
        expect(readFileSync(inTheFamily, 'utf8')).toBe(readFileSync(onTheRoot, 'utf8'));
      }
    },
    300_000,
  );

  it('keeps the three licences on the root of the shipped tree', () => {
    // The copy inside the family directory is ADDITIVE: the three
    // licences on the root of the shipped tree stay where they are.
    for (const family of FAMILIES) {
      const path = join(SHIPPED_WEB_DIR, `OFL-${family.key}.txt`);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0);
    }
  });
});
