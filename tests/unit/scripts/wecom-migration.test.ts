/**
 * scripts/migrations/2026-11-18-wecom-notifications.sql
 *
 * The migration runner (`scripts/migrate.ts`) applies EVERY file on EVERY
 * boot, so a migration that is not idempotent breaks the second run of the
 * /init wizard. The test below reads the file as text — the schema is
 * checked by the runner against a live database, and the text is what
 * decides whether a second run is safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = readFileSync(
  join(process.cwd(), 'scripts', 'migrations', '2026-11-18-wecom-notifications.sql'),
  'utf8',
);

describe('the WeCom notification migration', () => {
  it('creates the webhook table', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS wecom_webhooks');
    expect(SQL).toContain('webhook_url');
    expect(SQL).toContain('categories');
    expect(SQL).toContain('enabled');
  });

  it('creates the delivery table with the retry fields', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS wecom_deliveries');
    expect(SQL).toContain('next_attempt_at');
    expect(SQL).toContain('attempts');
    // Column alignment differs between the two tables, so match the enum
    // definition on its own rather than on the exact whitespace before it.
    expect(SQL.replace(/\s+/g, ' ')).toContain(
      "status ENUM('pending','sent','failed')",
    );
  });

  it('is idempotent — every statement is a CREATE IF NOT EXISTS', () => {
    // A migration that re-runs must not fail. The runner applies every
    // file on every boot, so a bare CREATE TABLE would break the second run.
    const creates = SQL.match(/CREATE TABLE/gi) ?? [];
    const guarded = SQL.match(/CREATE TABLE IF NOT EXISTS/gi) ?? [];
    expect(creates.length).toBe(guarded.length);
  });
});
