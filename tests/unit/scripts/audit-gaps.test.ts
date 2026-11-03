/**
 * scripts/audit-gaps.ts — the gap audit.
 *
 * The audit answers the question "is anything left unwritten or left
 * out?" after a batch of work. An audit that cannot fail is decoration,
 * so every rule here is exercised against a repository copy that has a
 * deliberate gap in it — not against the real repository, which happens
 * to be clean and would make a broken rule look fine.
 *
 * The scratch repository is built per test: `package.json`, a `scripts/`
 * directory, a `data/` directory, a `DEPLOY.md` and the packager's own
 * rule file (the audit reads the rules out of it rather than restating
 * them).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scriptNeedsDatabase,
  findScriptEnvGaps,
  findBrokenScriptReferences,
  findMissingNpmScriptTargets,
  findUnrunnableDocCommands,
  findMissingRuntimeData,
  setAuditRoot,
} from '@/scripts/audit-gaps';

let workDir: string;
let restoreRoot: () => void;

/** Write a file into the scratch repository, creating parents. */
function write(relativePath: string, content: string): string {
  const full = join(workDir, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

/** The packager rule file the audit parses. */
const PACKAGER = `EXCLUDE_DIRS = {
    'node_modules',
    'docs',
    'tests',
}

EXCLUDE_PATHS = {
    'scripts/fonts/staging',
}

EXCLUDE_FILES = {
    '.env',
    'vitest.config.ts',
}

GZIP_DIRS = {'data/classics', 'data/content'}
`;

/**
 * Build a scratch repository.
 *
 * `options` decides what the gap is: every rule needs a repository that
 * contains exactly one defect of the kind it looks for.
 */
function buildRepo(options: {
  scripts?: Record<string, string>;
  files?: Record<string, string>;
  docs?: Record<string, string>;
}): void {
  write('scripts/copy-to-up.py', PACKAGER);
  write(
    'package.json',
    JSON.stringify({ name: 'scratch', scripts: options.scripts ?? {} }, null, 2),
  );
  for (const [path, content] of Object.entries(options.files ?? {})) {
    write(path, content);
  }
  for (const [path, content] of Object.entries(options.docs ?? {})) {
    write(path, content);
  }
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'audit-gaps-'));
  restoreRoot = setAuditRoot(workDir);
});

afterEach(() => {
  restoreRoot();
  rmSync(workDir, { recursive: true, force: true });
});

describe('audit-gaps — which scripts reach the database', () => {
  it('detects a script that imports the db module', () => {
    const path = write('scripts/a.ts', "import { getPool } from '../lib/db';\n");
    expect(scriptNeedsDatabase(path)).toBe(true);
  });

  it('detects a script that uses mysql2 directly', () => {
    const path = write('scripts/b.ts', "import mysql from 'mysql2/promise';\n");
    expect(scriptNeedsDatabase(path)).toBe(true);
  });

  it('detects a script that reads DATABASE_URL', () => {
    const path = write('scripts/c.ts', 'const url = process.env.DATABASE_URL;\n');
    expect(scriptNeedsDatabase(path)).toBe(true);
  });

  it('does not flag a script that only touches files', () => {
    const path = write('scripts/d.ts', "import { readFileSync } from 'node:fs';\n");
    expect(scriptNeedsDatabase(path)).toBe(false);
  });

  it('does not flag a missing file', () => {
    expect(scriptNeedsDatabase(join(workDir, 'scripts', 'nope.ts'))).toBe(false);
  });
});

describe('audit-gaps — the env gap check', () => {
  it('reports a database script whose npm entry loads no env file', () => {
    write('scripts/x.ts', "import { getPool } from '../lib/db';\n");
    const gaps = findScriptEnvGaps({ scripts: { 'x:run': 'tsx scripts/x.ts' } });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].script).toBe('x:run');
  });

  it('accepts --env-file', () => {
    write('scripts/x.ts', "import { getPool } from '../lib/db';\n");
    const gaps = findScriptEnvGaps({
      scripts: { 'x:run': 'tsx --env-file=.env scripts/x.ts' },
    });
    expect(gaps).toHaveLength(0);
  });

  it('accepts --env-file-if-exists', () => {
    write('scripts/x.ts', "import { getPool } from '../lib/db';\n");
    const gaps = findScriptEnvGaps({
      scripts: { 'x:run': 'tsx --env-file-if-exists=.env scripts/x.ts' },
    });
    expect(gaps).toHaveLength(0);
  });

  it('does not demand an env file from a script that never reaches the db', () => {
    write('scripts/x.ts', "import { readFileSync } from 'node:fs';\n");
    const gaps = findScriptEnvGaps({ scripts: { 'x:run': 'tsx scripts/x.ts' } });
    expect(gaps).toHaveLength(0);
  });

  it('checks every npm script, not a hand-picked list', () => {
    write('scripts/brand-new.ts', "import { getPool } from '../lib/db';\n");
    const gaps = findScriptEnvGaps({
      scripts: { 'brand-new:run': 'tsx scripts/brand-new.ts' },
    });
    expect(gaps).toHaveLength(1);
  });
});

describe('audit-gaps — the broken reference check', () => {
  it('reports a reference to a script that does not exist', () => {
    buildRepo({
      docs: { 'DEPLOY.md': 'run `npx tsx scripts/does-not-exist.ts`\n' },
    });

    const broken = findBrokenScriptReferences();

    expect(broken).toHaveLength(1);
    expect(broken[0].refersTo).toBe('scripts/does-not-exist.ts');
    expect(broken[0].from).toBe('DEPLOY.md');
  });

  it('does not report a reference that resolves', () => {
    buildRepo({
      files: { 'scripts/real.ts': 'export const x = 1;\n' },
      docs: { 'DEPLOY.md': 'run `npx tsx scripts/real.ts`\n' },
    });

    expect(findBrokenScriptReferences()).toHaveLength(0);
  });

  it('resolves a path with a trailing expression to the file name', () => {
    buildRepo({
      files: { 'scripts/init-db.ts': 'export const x = 1;\n' },
      docs: { 'DEPLOY.md': 'see `scripts/init-db.ts::initDb(`\n' },
    });

    expect(findBrokenScriptReferences()).toHaveLength(0);
  });
});

describe('audit-gaps — the npm target check', () => {
  it('reports an npm script pointing at a file that is gone', () => {
    buildRepo({ scripts: { gone: 'tsx scripts/definitely-not-here.ts' } });

    const missing = findMissingNpmScriptTargets();

    expect(missing).toHaveLength(1);
    expect(missing[0].script).toBe('gone');
    expect(missing[0].target).toContain('definitely-not-here.ts');
  });

  it('does not report an npm script whose target exists', () => {
    buildRepo({
      scripts: { ok: 'tsx scripts/here.ts' },
      files: { 'scripts/here.ts': 'export const x = 1;\n' },
    });

    expect(findMissingNpmScriptTargets()).toHaveLength(0);
  });
});

describe('audit-gaps — the runtime data check', () => {
  it('reports a data file the module reads that the packager excludes', () => {
    buildRepo({
      files: {
        'lib/seed-registry.ts':
          "const DATA_DIR = join(process.cwd(), 'data');\n" +
          "const p = join(DATA_DIR, 'hsk-vocab.json');\n",
        'docs/notes.md': 'x',
      },
    });

    const missing = findMissingRuntimeData();

    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((m) => m.path.includes('hsk-vocab.json'))).toBe(true);
  });

  it('reports a data file that is simply absent', () => {
    buildRepo({
      files: {
        'lib/seed-registry.ts':
          "const DATA_DIR = join(process.cwd(), 'data');\n" +
          "const p = join(DATA_DIR, 'missing-file.json');\n",
      },
    });

    const missing = findMissingRuntimeData();

    expect(missing.some((m) => m.path.includes('missing-file.json'))).toBe(true);
  });

  it('does not report a data file that is present', () => {
    buildRepo({
      files: {
        'lib/seed-registry.ts':
          "const DATA_DIR = join(process.cwd(), 'data');\n" +
          "const p = join(DATA_DIR, 'hsk-vocab.json');\n",
        'data/hsk-vocab.json': '{}',
      },
    });

    expect(findMissingRuntimeData()).toHaveLength(0);
  });

  it('accepts a gzipped data file', () => {
    buildRepo({
      files: {
        'lib/seed-registry.ts':
          "const DATA_DIR = join(process.cwd(), 'data');\n" +
          "const p = join(DATA_DIR, 'hsk-vocab.json');\n",
        'data/hsk-vocab.json.gz': '',
      },
    });

    expect(findMissingRuntimeData()).toHaveLength(0);
  });

  it('does not report the real repository', () => {
    restoreRoot();
    restoreRoot = setAuditRoot(process.cwd());

    expect(findMissingRuntimeData()).toHaveLength(0);
  });
});

describe('audit-gaps — the unrunnable command check', () => {
  it('reports a command whose script does not exist', () => {
    buildRepo({
      docs: { 'DEPLOY.md': 'npx tsx scripts/never-existed.ts\n' },
    });

    const problems = findUnrunnableDocCommands();

    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('does not exist');
  });

  it('reports an npm run of a script package.json does not define', () => {
    buildRepo({
      scripts: { real: 'node x.js' },
      docs: { 'DEPLOY.md': 'npm run not-defined\n' },
    });

    const problems = findUnrunnableDocCommands();

    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('not-defined');
  });

  it('reports a command with a trailing bracket', () => {
    buildRepo({
      files: { 'scripts/migrate.ts': 'export const x = 1;\n' },
      docs: { 'DEPLOY.md': 'npx tsx scripts/migrate.ts（\n' },
    });

    const problems = findUnrunnableDocCommands();

    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('bracket');
  });

  it('does not report a clean command', () => {
    buildRepo({
      files: { 'scripts/migrate.ts': 'export const x = 1;\n' },
      scripts: { 'db:migrate': 'tsx scripts/migrate.ts' },
      docs: { 'DEPLOY.md': 'npx tsx scripts/migrate.ts\nnpm run db:migrate\n' },
    });

    expect(findUnrunnableDocCommands()).toHaveLength(0);
  });

  it('the command prefix does not swallow the path', () => {
    buildRepo({
      files: { 'scripts/migrate.ts': 'export const x = 1;\n' },
      docs: {
        'DEPLOY.md':
          'npx tsx scripts/migrate.ts\n' +
          'node scripts/migrate.ts\n' +
          'npx tsx --env-file=.env scripts/migrate.ts\n',
      },
    });

    // The scripts exist, so nothing is reported — but the check must have
    // looked at each line rather than matched none of them.
    expect(findUnrunnableDocCommands()).toHaveLength(0);
  });

  it('does not report the real repository', () => {
    restoreRoot();
    restoreRoot = setAuditRoot(process.cwd());

    expect(findUnrunnableDocCommands()).toHaveLength(0);
  });
});
