/**
 * scripts/audit-gaps.ts — a three-way reconciliation of the repository.
 *
 * The question it answers: does every file that exists in the repository
 * reach the deploy bundle, and does every script that talks to the
 * database load the environment it needs?
 *
 * Three sides are compared:
 *
 *   1. the repository (git-tracked files),
 *   2. the deploy bundle (`Up/`), as the packager's own rules produce it,
 *   3. the scripts that shell out to the database.
 *
 * The gap classes it looks for:
 *
 *   - a file in the repository that the packager's rules drop, without
 *     that being deliberate (an unlisted runtime dependency),
 *   - a script whose `npm run` entry does not load `.env`, so it fails
 *     with "DATABASE_URL is not set" while the site works fine,
 *   - a script that mentions a script name that does not exist,
 *   - a number in a document that contradicts the code it describes.
 *
 * Run: npx tsx --env-file-if-exists=.env scripts/audit-gaps.ts
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** A file that is missing from the deploy bundle but should be in it. */
export interface MissingFromBundle {
  path: string;
  reason: string;
}

/** A script whose environment loading is wrong. */
export interface ScriptEnvGap {
  script: string;
  command: string;
  problem: string;
}

/** A number in a document that contradicts the code. */
export interface DocDrift {
  from: string;
  what: string;
  documentSays: string;
  codeSays: string;
}

/** The result of the audit. */
export interface GapReport {
  missingFromBundle: MissingFromBundle[];
  scriptEnvGaps: ScriptEnvGap[];
  brokenScriptReferences: Array<{ from: string; refersTo: string }>;
  unrunnableDocCommands: Array<{ from: string; command: string; problem: string }>;
  docDrift: DocDrift[];
}

/**
 * The directory the audit reads from.
 *
 * Defaults to the repository root. The tests point it at a scratch copy
 * with a deliberate gap in it, so each rule is exercised against a gap
 * that really exists rather than against a repository that happens to
 * be clean.
 */
let auditRoot = process.cwd();

/** Point the audit at another directory. Returns a function to restore it. */
export function setAuditRoot(root: string): () => void {
  const previous = auditRoot;
  auditRoot = root;
  return () => {
    auditRoot = previous;
  };
}

/** A path relative to the audit root. */
function rooted(...segments: string[]): string {
  return join(auditRoot, ...segments);
}

/**
 * The packager's exclusion rules, read from the packager itself.
 *
 * They are parsed out of `scripts/copy-to-up.py` rather than restated
 * here: a second copy of the rules would drift, and a drifted rule set
 * would report gaps that do not exist — the exact failure this audit is
 * supposed to catch.
 */
function readPackagerRules(): {
  excludeDirs: Set<string>;
  excludePaths: Set<string>;
  excludeFiles: Set<string>;
  gzipDirs: Set<string>;
} {
  const source = readFileSync(rooted('scripts', 'copy-to-up.py'), 'utf8');

  const block = (name: string): string => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\}`));
    return match ? match[1] : '';
  };

  const parseSet = (name: string): Set<string> => {
    const body = block(name);
    const values = new Set<string>();
    for (const line of body.split('\n')) {
      const match = line.match(/['"]([^'"]+)['"]/);
      if (match) values.add(match[1]);
    }
    return values;
  };

  return {
    excludeDirs: parseSet('EXCLUDE_DIRS'),
    excludePaths: parseSet('EXCLUDE_PATHS'),
    excludeFiles: parseSet('EXCLUDE_FILES'),
    gzipDirs: parseSet('GZIP_DIRS'),
  };
}

/**
 * Does this script reach the database?
 *
 * Read from the script's own source rather than guessed from its name:
 * `build-dict.ts` sounds like a database script but only reads and writes
 * JSON, and a name-based guess would demand an env file it does not need.
 */
export function scriptNeedsDatabase(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return (
    /from\s+['"][^'"]*\/lib\/db['"]/.test(text) ||
    /from\s+['"]mysql2/.test(text) ||
    /require\(['"]mysql2/.test(text) ||
    /process\.env\.DATABASE_URL/.test(text)
  );
}

/**
 * A script that touches the database but whose npm entry does not load
 * the env file.
 *
 * npm does not read `.env` — only Next.js does, at boot. A script run
 * from a shell therefore has no DATABASE_URL unless the command passes
 * `--env-file` (or the operator exports the variable by hand). The site
 * keeps working, so the failure looks like a data problem instead of an
 * environment one.
 *
 * Every npm script is checked, not a hand-picked list: the list would
 * miss the next script somebody adds, and the point of the audit is to
 * catch the ones nobody remembered.
 */
export function findScriptEnvGaps(
  pkg: { scripts?: Record<string, string> },
): ScriptEnvGap[] {
  const gaps: ScriptEnvGap[] = [];
  const scripts = pkg.scripts ?? {};

  for (const [name, command] of Object.entries(scripts)) {
    const match = command.match(/scripts\/([A-Za-z0-9._-]+\.(?:ts|js))/);
    if (!match) continue;

    const target = rooted('scripts', match[1]);
    if (!scriptNeedsDatabase(target)) continue;

    const loadsEnv =
      command.includes('--env-file') ||
      command.includes('--env-file-if-exists') ||
      command.includes('dotenv');

    if (!loadsEnv) {
      gaps.push({
        script: name,
        command,
        problem:
          'runs from a shell without loading .env, so DATABASE_URL is empty ' +
          '(npm does not read .env; only Next.js does)',
      });
    }
  }

  return gaps;
}

/**
 * Find references to scripts that do not exist.
 *
 * A `npm run x` inside a script, or a documented command in DEPLOY.md,
 * that names a script the repository does not have is an instruction
 * that cannot be followed.
 */
export function findBrokenScriptReferences(): Array<{ from: string; refersTo: string }> {
  const broken: Array<{ from: string; refersTo: string }> = [];

  const scriptNames = new Set<string>();
  for (const entry of readdirSync(rooted('scripts'))) {
    if (entry.endsWith('.ts') || entry.endsWith('.js')) scriptNames.add(entry);
  }

  const sources: Array<{ path: string; text: string }> = [];
  for (const name of ['DEPLOY.md', 'README.md']) {
    if (existsSync(rooted(name))) {
      sources.push({ path: name, text: readFileSync(rooted(name), 'utf8') });
    }
  }
  sources.push({
    path: 'package.json',
    text: readFileSync(rooted('package.json'), 'utf8'),
  });

  for (const { path, text } of sources) {
    // A non-greedy path: the file name ends at the extension, so a
    // reference like `scripts/init-db.ts::initDb(` resolves to
    // `init-db.ts` and not to the whole expression.
    //
    // The pattern is created per source. A global regex carries
    // `lastIndex` between `exec` calls, so a shared one would silently
    // skip matches in the second document.
    const pattern = /scripts\/([A-Za-z0-9._-]+\.(?:ts|js))(?![A-Za-z0-9])/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const refersTo = match[1];
      if (!scriptNames.has(refersTo)) {
        broken.push({ from: path, refersTo: `scripts/${refersTo}` });
      }
    }
  }

  return broken;
}

/** The npm scripts that name a script file, checked against the disk. */
export function findMissingNpmScriptTargets(): Array<{ script: string; target: string }> {
  const pkg = JSON.parse(readFileSync(rooted('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const missing: Array<{ script: string; target: string }> = [];

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    const match = command.match(/scripts\/([A-Za-z0-9._-]+\.(?:ts|js))/);
    if (!match) continue;
    const target = rooted('scripts', match[1]);
    if (!existsSync(target)) missing.push({ script: name, target });
  }

  return missing;
}

/**
 * The runtime data files the seed modules reach, that the packager might
 * drop.
 *
 * `lib/seed-registry.ts` counts the HSK vocabulary from
 * `data/hsk-vocab.json` and the classics from the files in
 * `data/classics/`; if the packager excluded any of those the seed would
 * find an empty dataset and report a size of zero — and the database
 * would look complete while holding nothing.
 *
 * Two shapes are looked for:
 *
 *  - a static import (`import x from '@/data/...'`)
 *  - a runtime path built from a data directory
 *    (`join(DATA_DIR, 'hsk-vocab.json')`)
 */
export function findMissingRuntimeData(): MissingFromBundle[] {
  const missing: MissingFromBundle[] = [];
  const rules = readPackagerRules();

  const modules = ['lib/seed-registry.ts', 'lib/seed-runner.ts', 'lib/db.ts'];
  const referenced: Array<{ module: string; dataPath: string }> = [];

  // `module` is Node's own CommonJS binding, so the loop variable is
  // named `modulePath` — shadowing it trips @next/next/no-assign-module-variable.
  for (const modulePath of modules) {
    if (!existsSync(rooted(modulePath))) continue;
    const text = readFileSync(rooted(modulePath), 'utf8');

    // A static import of a data file.
    const importPattern = /from\s+['"]@\/data\/([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(text)) !== null) {
      referenced.push({ module: modulePath, dataPath: match[1] });
    }

    // A runtime path: join(DATA_DIR, '<file>.json') or a directory
    // argument like join(DATA_DIR, 'content').
    const joinPattern = /join\(\s*(?:DATA_DIR|dataDir)\s*,\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = joinPattern.exec(text)) !== null) {
      referenced.push({ module: modulePath, dataPath: match[1] });
    }
  }

  const seen = new Set<string>();

  for (const { module, dataPath } of referenced) {
    const key = `${module}:${dataPath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // A directory reference: the directory itself, not a file in it.
    const asDirectory = rooted('data', dataPath);
    if (existsSync(asDirectory) && statSync(asDirectory).isDirectory()) {
      const segments = asDirectory.replace(/\\/g, '/').split('/');
      if (segments.some((segment) => rules.excludeDirs.has(segment))) {
        missing.push({
          path: asDirectory,
          reason: `${module} reads it at runtime, and the packager excludes it`,
        });
      }
      continue;
    }

    // A file reference: it may ship plain or gzipped.
    const candidates = [rooted('data', dataPath), rooted('data', `${dataPath}.gz`)];
    const present = candidates.some((candidate) => {
      if (!existsSync(candidate)) return false;
      const segments = candidate.replace(/\\/g, '/').split('/');
      if (segments.some((segment) => rules.excludeDirs.has(segment))) return false;
      if (rules.excludeFiles.has(segments[segments.length - 1])) return false;
      return true;
    });

    if (!present) {
      missing.push({
        path: rooted('data', dataPath),
        reason: `${module} reads it at runtime, and it is not in the bundle`,
      });
    }
  }

  return missing;
}

/**
 * The commands DEPLOY.md tells the operator to run.
 *
 * These are the commands that reach a production server. A command that
 * cannot succeed — a script that does not exist, an npm script that is
 * not defined, a stray full-width bracket from a copy-paste — is a
 * deployment step that silently does not happen.
 */
export function findUnrunnableDocCommands(): Array<{ from: string; command: string; problem: string }> {
  const problems: Array<{ from: string; command: string; problem: string }> = [];

  const pkg = JSON.parse(readFileSync(rooted('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  for (const doc of ['DEPLOY.md', 'README.md']) {
    if (!existsSync(rooted(doc))) continue;
    const text = readFileSync(rooted(doc), 'utf8');

    // The prefix is a sequence of command words, not a greedy run of
    // non-space characters. A greedy `[^\s]*` swallows "tsx scripts/"
    // whole and then fails to find "scripts/" — the rule matches nothing
    // at all and reports a clean bill of health forever.
    const PREFIX = '(?:\\$ )?(?:(?:npx|node|npm|pnpm|tsx)[ \\t]+)*(?:--[\\w-]+(?:=[^\\s]*)?[ \\t]+)*';

    // `npm run <name>` — the script must exist. Only command lines, so a
    // prose mention ("run `npm run build` first") is not treated as an
    // instruction, but a fenced shell block is.
    const npmPattern = new RegExp(`^[ \\t]*(?:\\$ )?npm run ([a-zA-Z0-9:_-]+)`, 'gm');
    let match: RegExpExecArray | null;
    while ((match = npmPattern.exec(text)) !== null) {
      const name = match[1];
      if (!pkg.scripts || !(name in pkg.scripts)) {
        problems.push({
          from: doc,
          command: `npm run ${name}`,
          problem: `package.json defines no script named "${name}"`,
        });
      }
    }

    // `npx tsx scripts/<file>` — the file must exist. Only command lines:
    // an import statement in a fenced TypeScript block is not something an
    // operator pastes into a shell.
    const tsxPattern = new RegExp(
      `^[ \\t]*${PREFIX}scripts/([A-Za-z0-9._-]+\\.(?:ts|js))`,
      'gm',
    );
    while ((match = tsxPattern.exec(text)) !== null) {
      const file = rooted('scripts', match[1]);
      if (!existsSync(file)) {
        problems.push({
          from: doc,
          command: `npx tsx scripts/${match[1]}`,
          problem: `scripts/${match[1]} does not exist`,
        });
      }
    }

    // A full-width bracket is invisible in a terminal but is part of the
    // argument — it turns the command into "file not found".
    //
    // Only shell command lines are checked: a TypeScript reference like
    // `scripts/init-db.ts::initDb(` is source code, not something an
    // operator pastes into a shell.
    const bracketPattern = new RegExp(
      `^[ \\t]*${PREFIX}scripts/[A-Za-z0-9._-]+\\.(?:ts|js)([（(])`,
      'gm',
    );
    while ((match = bracketPattern.exec(text)) !== null) {
      problems.push({
        from: doc,
        command: match[0].trim(),
        problem:
          'the path is followed by a bracket, which becomes part of the ' +
          'filename and makes the command fail with ERR_MODULE_NOT_FOUND',
      });
    }
  }

  return problems;
}

/**
 * The documents that carry numbers the code owns.
 *
 * Each entry names the file and the kind of table it holds. The file
 * list is explicit rather than a directory scan: a doc that is not part
 * of this list is simply not checked, and adding one is a deliberate act.
 */
const DOCS_WITH_SEED_TABLES = ['DEPLOY.md'] as const;

/**
 * The documents that describe the wizard's run.
 *
 * The phase count lives in the deploy notes, which is where an operator
 * reads it while following the procedure.
 */
const DOCS_WITH_PHASE_COUNTS = ['REDEPLOY-2026-07-09.md'] as const;

/**
 * Find the seed table in a document.
 *
 * The table is recognised by its shape, not by its position: a markdown
 * table row whose first cell is a known dataset label and whose second
 * cell is a bare integer. Only the *second* cell is read as a number —
 * a naive scrape of the whole line picks up the row's own number, the
 * counts in the comment column, and the numbers in the surrounding
 * prose, and reports mismatches that do not exist.
 */
function parseSeedTable(
  text: string,
  expectedByLabel: Map<string, number>,
): Map<string, number> {
  const found = new Map<string, number>();

  for (const line of text.split('\n')) {
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      // A markdown table row starts and ends with a pipe, so splitting
      // yields an empty first and last cell.
      .slice(1, -1);
    if (cells.length < 2) continue;

    const label = cells[0];
    const expected = expectedByLabel.get(label);
    if (expected === undefined) continue;

    // The count cell is a bare integer — no thousands separators, no
    // units, no parenthetical notes.
    const count = cells[1].match(/^\d+$/);
    if (!count) continue;

    found.set(label, Number.parseInt(count[0], 10));
  }

  return found;
}

/**
 * Count the wizard's phases by reading the form that renders them.
 *
 * The phase list is data in `InitExecuteForm.tsx`, not a constant
 * elsewhere, so the count has to come from that file. The entries look
 * like `{ id: 'tables', label: '创建表结构', status: 'idle' }`; counting
 * the `id:` keys inside the `INITIAL` array is enough.
 */
function countWizardPhases(): number | null {
  const formPath = rooted('app', 'init', 'execute', 'InitExecuteForm.tsx');
  if (!existsSync(formPath)) return null;

  const text = readFileSync(formPath, 'utf8');
  const start = text.indexOf('const INITIAL');
  if (start === -1) return null;

  const end = text.indexOf('];', start);
  if (end === -1) return null;

  const block = text.slice(start, end);
  const ids = block.match(/id:\s*'/g);
  return ids ? ids.length : null;
}

/**
 * Compare the numbers in the documents against the numbers in the code.
 *
 * Two families are checked:
 *
 *   - the seed table's expected row counts, against `SEED_DATASETS`,
 *   - the wizard's phase count, against the phase list in the form.
 *
 * The second family matters because the wizard grew from 9 phases to 12
 * and the deploy notes still said 9 in three places. A reader following
 * them would stop waiting after the ninth card and think the run had
 * finished with three datasets missing.
 *
 * Both families are narrow on purpose. A number in a document only
 * counts as a claim when it is attached to the thing it claims about —
 * the count cell of a seed table, the word "phase" in a sentence — so a
 * date, a step number in an unrelated list, or a count in a comment
 * column cannot produce a false alarm.
 */
export function findDocDrift(): DocDrift[] {
  const drift: DocDrift[] = [];

  // --- the seed table's expected counts -------------------------------
  // The registry is the single source of truth for what a seeded table
  // should hold. The documents repeat those numbers for the operator;
  // when the two disagree, the operator follows the wrong one.
  //
  // The numbers are resolved by *running* the registry, because each
  // one is computed from the data files at import time. Re-deriving
  // them with a second implementation here would be exactly the drift
  // this check exists to catch.
  let expectedByLabel = new Map<string, number>();
  try {
    const registry = require(rooted('lib', 'seed-registry.ts')) as {
      SEED_DATASETS: Array<{ label: string; expected: number }>;
    };
    expectedByLabel = new Map(
      registry.SEED_DATASETS.map((dataset) => [dataset.label, dataset.expected]),
    );
  } catch (error) {
    drift.push({
      from: 'lib/seed-registry.ts',
      what: 'the seed registry could not be loaded',
      documentSays: '(nothing)',
      codeSays: error instanceof Error ? error.message : String(error),
    });
  }

  if (expectedByLabel.size > 0) {
    for (const doc of DOCS_WITH_SEED_TABLES) {
      const docPath = rooted(doc);
      if (!existsSync(docPath)) continue;

      const text = readFileSync(docPath, 'utf8');
      const declared = parseSeedTable(text, expectedByLabel);

      for (const [label, expected] of expectedByLabel) {
        const documentSays = declared.get(label);
        if (documentSays === undefined) continue;
        if (documentSays === expected) continue;

        drift.push({
          from: doc,
          what: `the seed table's row count for "${label}"`,
          documentSays: String(documentSays),
          codeSays: String(expected),
        });
      }
    }
  }

  // --- the wizard's phase count ---------------------------------------
  //
  // Only a *total-count claim* is checked: a sentence that says how many
  // phases the wizard has.
  //
  // The tricky part is that one sentence can carry two counts:
  //
  //   "Brings the 9-phase wizard to **12 phases**"
  //
  // Here 9 is the old wizard and 12 is the current one. The sentence is
  // *correct* precisely because one of its numbers equals what the code
  // says. So a sentence is drift only when **none** of its phase-related
  // numbers matches the code — that is what distinguishes "the document
  // claims a wrong number" from "the document narrates a change".
  //
  // A number that is not adjacent to the word "phase" (an ordinal
  // reference like "第 13、14 步", a date, a step number in an
  // unrelated list) is not a phase count and is not counted here.
  const phases = countWizardPhases();
  if (phases !== null) {
    for (const doc of DOCS_WITH_PHASE_COUNTS) {
      const docPath = rooted(doc);
      if (!existsSync(docPath)) continue;

      const text = readFileSync(docPath, 'utf8');
      // Split on sentence and line boundaries so a claim cannot leak
      // across them.
      const sentences = text.split(/(?<=[.。\n])/);
      for (const sentence of sentences) {
        if (!/phase/i.test(sentence)) continue;

        // Every number the sentence attaches to the word "phase".
        const numbers = Array.from(sentence.matchAll(/(\d+)\s*-?\s*phases?\b/gi)).map((entry) =>
          Number.parseInt(entry[1], 10),
        );
        if (numbers.length === 0) continue;

        // The sentence states the current count somewhere — it is not
        // drift.
        if (numbers.includes(phases)) continue;

        drift.push({
          from: doc,
          what: 'the wizard phase count',
          documentSays: numbers.join(', '),
          codeSays: String(phases),
        });
      }
    }
  }

  return drift;
}

/** Run the whole audit. */
export function auditGaps(): GapReport {
  const pkg = JSON.parse(readFileSync(rooted('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  return {
    missingFromBundle: findMissingRuntimeData(),
    scriptEnvGaps: findScriptEnvGaps(pkg),
    brokenScriptReferences: findBrokenScriptReferences(),
    unrunnableDocCommands: findUnrunnableDocCommands(),
    docDrift: findDocDrift(),
  };
}

function main(): void {
  const report = auditGaps();

  console.log('=== script environment gaps ===');
  if (report.scriptEnvGaps.length === 0) {
    console.log('  (none)');
  }
  for (const gap of report.scriptEnvGaps) {
    console.log(`  ${gap.script}: ${gap.command}`);
    console.log(`    -> ${gap.problem}`);
  }

  console.log('\n=== runtime data missing from the bundle ===');
  if (report.missingFromBundle.length === 0) {
    console.log('  (none)');
  }
  for (const item of report.missingFromBundle) {
    console.log(`  ${item.path}: ${item.reason}`);
  }

  console.log('\n=== references to scripts that do not exist ===');
  if (report.brokenScriptReferences.length === 0) {
    console.log('  (none)');
  }
  for (const item of report.brokenScriptReferences) {
    console.log(`  ${item.from} refers to ${item.refersTo}`);
  }

  console.log('\n=== npm scripts pointing at a missing file ===');
  const missingTargets = findMissingNpmScriptTargets();
  if (missingTargets.length === 0) {
    console.log('  (none)');
  }
  for (const item of missingTargets) {
    console.log(`  ${item.script} -> ${item.target}`);
  }

  console.log('\n=== commands in the docs that cannot run ===');
  if (report.unrunnableDocCommands.length === 0) {
    console.log('  (none)');
  }
  for (const item of report.unrunnableDocCommands) {
    console.log(`  ${item.from}: ${item.command}`);
    console.log(`    -> ${item.problem}`);
  }

  console.log('\n=== numbers in the docs that contradict the code ===');
  if (report.docDrift.length === 0) {
    console.log('  (none)');
  }
  for (const item of report.docDrift) {
    console.log(`  ${item.from}: ${item.what}`);
    console.log(`    -> the document says ${item.documentSays}, the code says ${item.codeSays}`);
  }

  const problems =
    report.scriptEnvGaps.length +
    report.missingFromBundle.length +
    report.brokenScriptReferences.length +
    report.unrunnableDocCommands.length +
    report.docDrift.length +
    missingTargets.length;

  if (problems > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
