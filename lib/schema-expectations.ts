/**
 * `lib/schema-expectations.ts` — what the schema is supposed to look like.
 *
 * The admin seed screen has to answer one question: **is the database
 * behind the code?** The old answer was a hand-written table count
 * (`EXPECTED_TABLES = 22`, which used to live in
 * `lib/init-checklist.ts` and has since been removed) compared against
 * `COUNT(*) FROM information_schema.tables`. That check has two holes:
 *
 *  1. **A count cannot name what is missing.** "21 / 22" tells the admin
 *     nothing about *which* table. With forty-odd tables the operator has
 *     to diff the schema by hand.
 *  2. **A missing column does not move the count at all.** `chars` losing
 *     `hsk_level` leaves the table count unchanged, so the check stays
 *     green while `/game` answers 404 on every tier and 503 on every
 *     round. That is the "schema behind code" failure this module exists
 *     to make visible.
 *
 * So the expectation has to be **per table and per column**, and it has to
 * be **derived from the repository** — the same rule `lib/seed-registry.ts`
 * follows for content counts. A hand-written list of forty tables and two
 * hundred columns would drift on the first migration, and a drifted
 * expectation is worse than none: it reports a table that was never
 * supposed to exist.
 *
 * ## Where the expectation comes from
 *
 * Two places in the repository create schema:
 *
 *  - `scripts/init-db.ts` holds the `DDL` array — the base tables
 *    (`chars`, `users`, `worksheets`, …) that every install has.
 *  - `scripts/migrations/*.sql` hold the incremental changes — the tables
 *    and columns added after the base schema shipped.
 *
 * This module parses both and returns one flat list of expectations. It
 * parses **three** shapes of DDL, which is all the repository actually
 * contains:
 *
 *  - `CREATE TABLE [IF NOT EXISTS] <name> ( … )` — the table and its
 *    columns;
 *  - `ALTER TABLE <name> ADD COLUMN <col>` — a column added later,
 *    including the ones buried inside a `PREPARE`/`EXECUTE` guard;
 *  - `ALTER TABLE <name> MODIFY [COLUMN] <col> …` — a **type** change.
 *    `MODIFY` never adds or removes a column, so it contributes nothing
 *    to "does this column exist" and is deliberately skipped.
 *
 * ## Why not execute the migrations to find out
 *
 * The obvious alternative is to ask the database which migrations have
 * been applied. There is no migration tracking table in this repository
 * (the migrations are idempotent instead — each file checks
 * `information_schema` itself), so "which migrations ran" is not a fact
 * the database holds. Deriving the expectation from the SQL is both
 * possible and testable, where a tracking table would be a schema change
 * of its own.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** One thing the schema must have: a table, or a column of a table. */
export interface SchemaExpectation {
  /** The table the expectation is about. */
  table: string;
  /** The column, or null when the expectation is "the table exists". */
  column: string | null;
  /** The file that created it — `scripts/migrations/<file>` or `scripts/init-db.ts`. */
  source: string;
  /**
   * Every file that declares it.
   *
   * The base schema in `scripts/init-db.ts` and the early migrations
   * create the same tables: a migration was written first, and the base
   * schema absorbed it later. Reporting both sources is the honest
   * thing — it says "two places in this repository promise this table",
   * which is the fact that lets the two drift apart.
   */
  sources: string[];
}

/** A migration file and the schema it declares. */
export interface MigrationSummary {
  /** The file name, e.g. `2026-11-19-idioms.sql`. */
  file: string;
  /** The tables this file creates. */
  tables: string[];
  /** The columns this file adds, as `table.column`. */
  columns: string[];
  /** The columns this file's `CREATE TABLE` declares. */
  createdColumns: string[];
  /** The columns this file's `ALTER TABLE … ADD COLUMN` declares. */
  addedColumns: string[];
}

const MIGRATIONS_DIR = join(process.cwd(), 'scripts', 'migrations');
const INIT_DB_PATH = join(process.cwd(), 'scripts', 'init-db.ts');

/** Keywords that introduce a table constraint, not a column. */
const CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'INDEX',
  'CONSTRAINT',
  'FULLTEXT',
  'SPATIAL',
  'CHECK',
  'FOREIGN',
]);

/** `CREATE TABLE [IF NOT EXISTS] name (` */
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(/gi;
/** `ALTER TABLE name ADD [COLUMN] col ` */
const ADD_COLUMN_RE = /ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+(?:COLUMN\s+)?`?(\w+)`?\s/gi;

/**
 * Split a `CREATE TABLE` body on its top-level commas.
 *
 * The body holds column definitions and table constraints, and the two
 * are separated by commas that may themselves be nested inside a
 * `DECIMAL(10, 2)` or an `ENUM('a', 'b')`. Only commas at depth zero
 * separate two definitions.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * The text of the `CREATE TABLE` body that starts at `start` (the index
 * just after its opening parenthesis) and ends at its matching close.
 *
 * Returns null when the parentheses never balance — a malformed file
 * must not make the parser swallow the rest of the repository.
 */
function readParenBody(sql: string, start: number): { body: string; end: number } | null {
  let depth = 1;
  let index = start;
  while (index < sql.length && depth > 0) {
    if (sql[index] === '(') depth += 1;
    else if (sql[index] === ')') depth -= 1;
    index += 1;
  }
  if (depth !== 0) return null;
  return { body: sql.slice(start, index - 1), end: index };
}

/** Remove the `--` line comments so their text cannot be parsed as SQL. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Undo the JavaScript escape on MySQL's identifier quotes.
 *
 * The base DDL lives in `scripts/init-db.ts` as JavaScript template
 * strings, so MySQL's backtick quoting appears in the SOURCE FILE as
 * backslash-backtick. The parser reads that file as text, so it sees the
 * backslash — and a column it reported as "\char\" never matched the
 * database, which calls the column "char". Every such column then
 * looked missing, on a database that was perfectly complete.
 *
 * Only backslash-backtick is touched. The other escapes in these
 * templates are not SQL, and the migration files are plain SQL where a
 * backtick is a real backtick — so this belongs to the TypeScript side
 * of the parser, not to `parseMigrationSql`.
 */
function unescapeIdentifierQuotes(source: string): string {
  return source.replace(/\\`/g, '`');
}

/**
 * The columns a `CREATE TABLE` body declares.
 *
 * A definition whose first word is a constraint keyword (`PRIMARY KEY`,
 * `UNIQUE KEY`, `KEY`, …) is a table constraint, not a column.
 *
 * The keyword check needs one more thing to be right: a column whose
 * NAME is a keyword. `app_config.key` is a real column — `key` is a
 * reserved word, which is exactly why it is written with backtick
 * quotes. Matching the bare word against the keyword list dropped it,
 * and a column the database really has went missing from the
 * expectation.
 *
 * Backtick quoting settles it: a definition whose first token is
 * wrapped in backticks is a column, whatever the name inside says.
 */
function columnsOfCreateBody(body: string): string[] {
  const columns: string[] = [];
  for (const definition of splitTopLevel(body)) {
    const trimmed = definition.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0];
    const isQuoted = firstToken.startsWith('`') && firstToken.endsWith('`');
    const firstWord = firstToken.replace(/`/g, '');
    if (!isQuoted && CONSTRAINT_KEYWORDS.has(firstWord.toUpperCase())) continue;
    columns.push(firstWord);
  }
  return columns;
}

/**
 * Parse one migration file into the tables and columns it declares.
 *
 * `MODIFY COLUMN` statements are skipped on purpose: they change a
 * column's type, never its existence.
 *
 * The columns come in two kinds, and the difference matters:
 *
 *  - `createdColumns` — the columns a `CREATE TABLE` declares. These
 *    only reach the database if the table does not exist yet.
 *  - `addedColumns` — the columns an `ALTER TABLE … ADD COLUMN`
 *    declares. These reach the database unconditionally, whether the
 *    table was created by this file or by an earlier one.
 *
 * `columns` is the union of the two, for callers that only need the
 * set.
 */
export function parseMigrationSql(sql: string): {
  tables: string[];
  columns: string[];
  createdColumns: string[];
  addedColumns: string[];
} {
  const body = stripComments(sql);
  const tables = new Set<string>();
  const createdColumns = new Set<string>();
  const addedColumns = new Set<string>();

  CREATE_TABLE_RE.lastIndex = 0;
  let createMatch: RegExpExecArray | null;
  while ((createMatch = CREATE_TABLE_RE.exec(body)) !== null) {
    const table = createMatch[1];
    const parsed = readParenBody(body, createMatch.index + createMatch[0].length);
    if (!parsed) continue;
    tables.add(table);
    for (const column of columnsOfCreateBody(parsed.body)) {
      createdColumns.add(`${table}.${column}`);
    }
  }

  ADD_COLUMN_RE.lastIndex = 0;
  let alterMatch: RegExpExecArray | null;
  while ((alterMatch = ADD_COLUMN_RE.exec(body)) !== null) {
    const table = alterMatch[1];
    const column = alterMatch[2];
    // `ADD KEY idx_… ` is an index, not a column.
    if (CONSTRAINT_KEYWORDS.has(column.toUpperCase())) continue;
    addedColumns.add(`${table}.${column}`);
  }

  const columns = new Set([...createdColumns, ...addedColumns]);
  return {
    tables: [...tables].sort(),
    columns: [...columns].sort(),
    createdColumns: [...createdColumns].sort(),
    addedColumns: [...addedColumns].sort(),
  };
}

/**
 * Parse the `DDL` array of `scripts/init-db.ts` — the base tables.
 *
 * The base schema is TypeScript, not SQL, so it is read as text. The
 * `CREATE TABLE` statements in it use the same shape as the migration
 * files, so the same body reader applies.
 */
export function parseInitDbDdl(source: string): {
  tables: string[];
  columns: string[];
  createdColumns: string[];
  addedColumns: string[];
} {
  const arrayMatch = source.match(/const\s+DDL[^=]*=\s*\[/);
  if (!arrayMatch || arrayMatch.index === undefined) {
    return { tables: [], columns: [], createdColumns: [], addedColumns: [] };
  }
  const body = stripComments(
    unescapeIdentifierQuotes(source.slice(arrayMatch.index + arrayMatch[0].length)),
  );
  const parsed = parseMigrationSql(body);
  return parsed;
}

/**
 * Every migration file in the repository, in the order the migrate
 * script applies them (lexical, which the `YYYY-MM-DD-` prefix makes
 * chronological).
 */
export function listMigrationFiles(migrationsDir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/**
 * A summary of every migration file: what it declares, and where it
 * lives.
 */
export function summarizeMigrations(migrationsDir: string = MIGRATIONS_DIR): MigrationSummary[] {
  return listMigrationFiles(migrationsDir).map((file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const parsed = parseMigrationSql(sql);
    return {
      file,
      tables: parsed.tables,
      columns: parsed.columns,
      createdColumns: parsed.createdColumns,
      addedColumns: parsed.addedColumns,
    };
  });
}

/**
 * Every table and column the repository's schema declares.
 *
 * The base tables come from `scripts/init-db.ts`; the incremental ones
 * from `scripts/migrations/*.sql`.
 *
 * A table both places create appears **once**, with both sources
 * listed: the early migrations were written before the base schema
 * absorbed them, so the repository genuinely declares those tables
 * twice. Deduplicating keeps the report readable; keeping both sources
 * keeps the fact visible.
 *
 * ## Which version of a table counts
 *
 * When the base schema and a migration declare the SAME table with
 * DIFFERENT columns, the base schema wins — because it runs first on
 * every deploy (`initDb()` at boot) and `CREATE TABLE IF NOT EXISTS`
 * leaves an existing table exactly as it is.
 *
 * `scripts/migrations/2026-06-20-classics.sql` creates `classics` with
 * a `chunks` column; the current base schema creates it without. The
 * database has the base schema's version, the migration would not
 * change it (`IF NOT EXISTS`), and nothing else adds `chunks` — so
 * expecting it would report a column that is permanently missing and
 * that no run of the migrations could ever create.
 *
 * A column an `ALTER TABLE … ADD COLUMN` declares is different: it
 * applies whether or not the table already exists, so those always
 * count.
 */
export function collectSchemaExpectations(
  initDbPath: string = INIT_DB_PATH,
  migrationsDir: string = MIGRATIONS_DIR,
): SchemaExpectation[] {
  /** table -> column (or null for the table itself) -> the files declaring it. */
  const declared = new Map<string, Map<string | null, Set<string>>>();

  const declare = (table: string, column: string | null, source: string): void => {
    let columns = declared.get(table);
    if (!columns) {
      columns = new Map<string | null, Set<string>>();
      declared.set(table, columns);
    }
    let sources = columns.get(column);
    if (!sources) {
      sources = new Set<string>();
      columns.set(column, sources);
    }
    sources.add(source);
  };

  const initDbSource = readFileSync(initDbPath, 'utf8');
  const base = parseInitDbDdl(initDbSource);
  const baseTables = new Set(base.tables);
  for (const table of base.tables) {
    declare(table, null, 'scripts/init-db.ts');
  }
  for (const column of base.columns) {
    const dot = column.indexOf('.');
    declare(column.slice(0, dot), column.slice(dot + 1), 'scripts/init-db.ts');
  }

  for (const summary of summarizeMigrations(migrationsDir)) {
    const source = `scripts/migrations/${summary.file}`;
    for (const table of summary.tables) {
      declare(table, null, source);
    }
    // A column the migration's own `CREATE TABLE` declares only reaches
    // the database if the table is not already there — and the base
    // schema creates it first. The base schema's version of the table
    // is the one that exists.
    for (const column of summary.createdColumns) {
      const dot = column.indexOf('.');
      const table = column.slice(0, dot);
      if (baseTables.has(table)) continue;
      declare(table, column.slice(dot + 1), source);
    }
    // An `ALTER TABLE … ADD COLUMN` applies unconditionally.
    for (const column of summary.addedColumns) {
      const dot = column.indexOf('.');
      declare(column.slice(0, dot), column.slice(dot + 1), source);
    }
  }

  const expectations: SchemaExpectation[] = [];
  for (const [table, columns] of declared) {
    for (const [column, sources] of columns) {
      const sorted = [...sources].sort();
      expectations.push({
        table,
        column,
        source: sorted[0],
        sources: sorted,
      });
    }
  }
  return expectations;
}
