import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard: every SQL migration must be re-runnable.
 *
 * The /init wizard runs `runMigrations()` on every deploy (and again on a
 * re-run of the wizard), and migrate.ts documents the contract:
 *
 *   "Each migration file is idempotent ... so re-running is safe — every
 *    statement is a no-op once the schema is current."
 *
 * A bare `ALTER TABLE ... ADD COLUMN` breaks that contract twice:
 *   1. re-running the wizard on an already-migrated DB → ER_DUP_FIELDNAME,
 *      which aborts the whole file and leaves setup.completed=false;
 *   2. a fresh DB where scripts/init-db.ts already ships the column
 *      (ai_calls.ip) → same error on the very first install.
 *
 * Both happened in the wild (2026-08-05-ai-calls-ip.sql). The fix is the
 * information_schema guard idiom introduced by 2026-06-27-02-email-campaigns.sql.
 * This test locks the invariant in place so a future migration cannot
 * reintroduce unguarded DDL.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'scripts', 'migrations');

/** DDL that creates a schema object and therefore fails on a re-run. */
const CREATING_DDL = [
  'ADD COLUMN',
  'ADD KEY',
  'ADD INDEX',
  'ADD UNIQUE',
  'CREATE INDEX',
  'CREATE UNIQUE INDEX',
  'DROP COLUMN',
  'DROP KEY',
];

interface MigrationFile {
  name: string;
  lines: string[];
  text: string;
}

function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      return { name, text, lines: text.split(/\r?\n/) };
    });
}

describe('migrations are re-runnable', () => {
  const migrations = readMigrations();

  it('finds the migration directory', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('guards every object-creating statement with an information_schema check', () => {
    const offenders: string[] = [];

    for (const file of migrations) {
      const createsObjects = CREATING_DDL.some((kw) => file.text.includes(kw));
      if (!createsObjects) continue;

      const hasGuard = file.text.includes('information_schema');
      // Every creating statement must live inside a quoted DDL literal —
      // that is how the guard idiom expresses it:
      //   SET @ddl := IF(@col_exists = 0, 'ALTER TABLE ... ADD COLUMN ...', 'SELECT 1');
      const bareStatements = file.lines.filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('--')) return false;
        const hit = CREATING_DDL.some((kw) => trimmed.includes(kw));
        if (!hit) return false;
        // Quoted literal → guarded. Otherwise it is a bare statement.
        return !trimmed.includes("'");
      });

      if (!hasGuard || bareStatements.length > 0) {
        offenders.push(
          `${file.name}: ${
            hasGuard ? 'unguarded statement' : 'no information_schema guard'
          } → ${bareStatements.join(' | ') || 'n/a'}`,
        );
      }
    }

    expect(offenders, `unguarded migration DDL:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the two historically broken migrations guarded', () => {
    for (const name of [
      '2026-07-04-hsk-level.sql',
      '2026-08-05-ai-calls-ip.sql',
    ]) {
      const file = migrations.find((m) => m.name === name);
      expect(file, `${name} must exist`).toBeDefined();
      expect(file!.text).toContain('information_schema');
      expect(file!.text).toContain('PREPARE stmt FROM @ddl');
    }
  });
});
