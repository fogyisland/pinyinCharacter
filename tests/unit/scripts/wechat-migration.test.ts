/**
 * scripts/migrations/2026-11-20-wechat-broadcast.sql
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
  join(process.cwd(), 'scripts', 'migrations', '2026-11-20-wechat-broadcast.sql'),
  'utf8',
);

describe('the WeChat broadcast migration', () => {
  it('creates the broadcast table', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS wechat_broadcasts');
    expect(SQL).toContain('title');
    expect(SQL).toContain('template_id');
    expect(SQL).toContain('url');
  });

  it('stores the template data as a JSON column', () => {
    expect(SQL).toMatch(/data\s+JSON\s+NOT NULL/i);
  });

  it('counts the four numbers separately', () => {
    // The four counts answer four different questions: how many were
    // addressed, how many the platform accepted, how many were skipped
    // (the follower left), and how many failed.
    expect(SQL).toContain('total_recipients');
    expect(SQL).toContain('accepted_count');
    expect(SQL).toContain('skipped_count');
    expect(SQL).toContain('failed_count');
  });

  it('gives the status column a closed set of values', () => {
    // Column alignment differs between columns, so match the enum
    // definition on its own rather than on the exact whitespace before it.
    expect(SQL.replace(/\s+/g, ' ')).toContain(
      "status ENUM('draft','queued','sending','sent','failed','cancelled')",
    );
  });

  it('references the admin who wrote it', () => {
    expect(SQL).toContain('created_by');
    expect(SQL).toContain('FOREIGN KEY (created_by)');
    expect(SQL).toContain('REFERENCES users(id)');
  });

  it('is idempotent — every statement is a CREATE IF NOT EXISTS', () => {
    // A migration that re-runs must not fail. The runner applies every
    // file on every boot, so a bare CREATE TABLE would break the second run.
    const creates = SQL.match(/CREATE TABLE/gi) ?? [];
    const guarded = SQL.match(/CREATE TABLE IF NOT EXISTS/gi) ?? [];
    expect(creates.length).toBe(guarded.length);
  });

  it('says in a comment that there is no per-recipient table, and why', () => {
    // The absence of a per-recipient table is a decision, not an
    // oversight. A future reader who adds one should have to read why
    // it was not there.
    expect(SQL).toContain('NO per-recipient table');
    expect(SQL).toContain('no per-person delivery receipt');
  });
});
