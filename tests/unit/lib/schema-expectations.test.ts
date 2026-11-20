/**
 * `lib/schema-expectations.ts` — the derived schema expectation.
 *
 * The admin seed screen reports whether the database is behind the code.
 * To report *which* table or column is missing, the expectation has to
 * be per-table and per-column, and it has to come from the repository's
 * own schema sources rather than from a hand-written list that would
 * drift on the first migration.
 *
 * These tests pin three things:
 *
 *  1. the parser understands the three DDL shapes the repository uses;
 *  2. the derived expectation covers the real repository — including the
 *     table that only a migration creates, which is exactly the case the
 *     old table-count check could not see;
 *  3. the derivation cannot silently lose a table or a column.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  parseMigrationSql,
  parseInitDbDdl,
  collectSchemaExpectations,
  summarizeMigrations,
  listMigrationFiles,
} from '@/lib/schema-expectations';

const ROOT = process.cwd();

describe('parseMigrationSql', () => {
  it('reads the table and its columns out of a CREATE TABLE', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS idioms (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        word       VARCHAR(16)  NOT NULL,
        meaning    VARCHAR(512) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        UNIQUE KEY uk_idioms_word (word),
        KEY idx_idioms_level (level)
      ) ENGINE=InnoDB;
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.tables).toEqual(['idioms']);
    // The three constraints are table constraints, not columns.
    expect(parsed.columns).toEqual(['idioms.id', 'idioms.meaning', 'idioms.word']);
  });

  it('reads a column added by a later ALTER TABLE', () => {
    const sql = `ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL;`;
    const parsed = parseMigrationSql(sql);
    expect(parsed.tables).toEqual([]);
    expect(parsed.columns).toEqual(['chars.hsk_level']);
  });

  it('reads a column added inside a PREPARE guard', () => {
    // The shape every guarded migration actually uses: the ALTER lives
    // inside a string literal that a PREPARE statement executes.
    const sql = `
      SET @col_exists := (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email_verified_at'
      );
      SET @ddl := IF(@col_exists = 0,
        'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER email',
        'SELECT 1');
      PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.columns).toEqual(['users.email_verified_at']);
  });

  it('does not mistake an index for a column', () => {
    const sql = `
      ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at);
      ALTER TABLE users ADD INDEX idx_users_created (created_at);
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.columns).toEqual([]);
  });

  it('ignores a MODIFY COLUMN, which changes a type and not an existence', () => {
    const sql = `
      ALTER TABLE worksheets
        MODIFY cell_style ENUM('brush','square','pen','brush-cross') NOT NULL DEFAULT 'square';
      ALTER TABLE downloads
        MODIFY COLUMN source_type ENUM('worksheet','classic') NOT NULL;
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.tables).toEqual([]);
    expect(parsed.columns).toEqual([]);
  });

  it('does not read a table out of a comment', () => {
    const sql = `
      -- CREATE TABLE IF NOT EXISTS not_a_table (
      --   id INT
      -- );
      CREATE TABLE IF NOT EXISTS real_table (id INT);
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.tables).toEqual(['real_table']);
  });

  it('keeps a comma inside a column definition from splitting it', () => {
    const sql = `
      CREATE TABLE measurements (
        id     INT UNSIGNED NOT NULL,
        weight DECIMAL(10, 2) NOT NULL DEFAULT 0,
        tag   ENUM('a', 'b') NOT NULL
      );
    `;
    const parsed = parseMigrationSql(sql);
    expect(parsed.columns).toEqual([
      'measurements.id',
      'measurements.tag',
      'measurements.weight',
    ]);
  });
});

describe('parseInitDbDdl', () => {
  it('reads the base tables out of the DDL array', () => {
    const source = `
      const DDL = [
        \`CREATE TABLE IF NOT EXISTS chars (
          \`char\` VARCHAR(8) NOT NULL,
          level INT NOT NULL,
          PRIMARY KEY (\`char\`)
        )\`,
        \`CREATE TABLE IF NOT EXISTS users (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          username VARCHAR(64) NOT NULL,
          PRIMARY KEY (id)
        )\`,
      ];
    `;
    const parsed = parseInitDbDdl(source);
    expect(parsed.tables).toEqual(['chars', 'users']);
    expect(parsed.columns).toContain('chars.level');
    expect(parsed.columns).toContain('users.username');
  });

  it('reads nothing when there is no DDL array', () => {
    const parsed = parseInitDbDdl('export const nothing = 1;');
    expect(parsed.tables).toEqual([]);
    expect(parsed.columns).toEqual([]);
  });
});

describe('the real repository', () => {
  it('lists the migration files in the order the migrate script applies them', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    // Lexical order, which the YYYY-MM-DD- prefix makes chronological.
    expect([...files].sort()).toEqual(files);
    expect(files.every((f) => f.endsWith('.sql'))).toBe(true);
  });

  it('derives the expectation from the base schema and the migrations', () => {
    const expectations = collectSchemaExpectations();
    expect(expectations.length).toBeGreaterThan(0);

    const tables = new Set(
      expectations.filter((e) => e.column === null).map((e) => e.table),
    );
    const columns = new Set(
      expectations.filter((e) => e.column !== null).map((e) => `${e.table}.${e.column}`),
    );

    // The base tables the boot path creates.
    expect(tables.has('chars')).toBe(true);
    expect(tables.has('users')).toBe(true);
    // A table only a migration creates — the case the old table count
    // could not name.
    expect(tables.has('idioms')).toBe(true);
    // The columns the guarded migrations add.
    expect(columns.has('chars.hsk_level')).toBe(true);
    expect(columns.has('users.email_verified_at')).toBe(true);
    expect(columns.has('downloads.user_agent')).toBe(true);
  });

  it('names the source of every expectation', () => {
    const expectations = collectSchemaExpectations();
    for (const expectation of expectations) {
      expect(expectation.source).toMatch(/^(scripts\/init-db\.ts|scripts\/migrations\/[\w.-]+\.sql)$/);
      expect(expectation.sources.length).toBeGreaterThan(0);
      expect(expectation.sources).toContain(expectation.source);
    }
  });

  it('declares no table twice', () => {
    const expectations = collectSchemaExpectations();
    const tableSources = expectations.filter((e) => e.column === null).map((e) => e.table);
    expect(new Set(tableSources).size).toBe(tableSources.length);
  });

  it('declares no column twice', () => {
    const expectations = collectSchemaExpectations();
    const columnKeys = expectations
      .filter((e) => e.column !== null)
      .map((e) => `${e.table}.${e.column}`);
    expect(new Set(columnKeys).size).toBe(columnKeys.length);
  });

  it('keeps both sources when the base schema and a migration declare the same table', () => {
    // The early migrations were written before `init-db.ts` absorbed
    // those tables, so the repository declares them twice. Reporting
    // one entry with two sources is the honest form — it says "two
    // places promise this table", which is the fact that lets them drift.
    const expectations = collectSchemaExpectations();
    const classics = expectations.find(
      (e) => e.table === 'classics' && e.column === null,
    );
    expect(classics).toBeDefined();
    expect(classics!.sources).toContain('scripts/init-db.ts');
    expect(classics!.sources.some((s) => s.startsWith('scripts/migrations/'))).toBe(true);
  });

  it('finds every table a migration file creates', () => {
    // Every migration that creates a table must have that table in the
    // expectation. A parser that silently drops a CREATE TABLE would
    // leave the admin screen reporting a table that does not exist —
    // a worse failure than no check at all.
    const expectations = collectSchemaExpectations();
    const tables = new Set(
      expectations.filter((e) => e.column === null).map((e) => e.table),
    );
    for (const summary of summarizeMigrations()) {
      for (const table of summary.tables) {
        expect(tables.has(table)).toBe(true);
      }
    }
  });

  it('finds every column a migration file adds', () => {
    const expectations = collectSchemaExpectations();
    const columns = new Set(
      expectations.filter((e) => e.column !== null).map((e) => `${e.table}.${e.column}`),
    );
    for (const summary of summarizeMigrations()) {
      for (const column of summary.columns) {
        expect(columns.has(column)).toBe(true);
      }
    }
  });

  it('parses the real init-db.ts into base tables', () => {
    const source = require('node:fs').readFileSync(
      join(ROOT, 'scripts', 'init-db.ts'),
      'utf8',
    );
    const parsed = parseInitDbDdl(source);
    expect(parsed.tables.length).toBeGreaterThan(10);
    expect(parsed.tables).toContain('chars');
    expect(parsed.tables).toContain('app_config');
  });
});
