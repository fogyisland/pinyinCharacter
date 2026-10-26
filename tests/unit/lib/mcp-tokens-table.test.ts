import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `mcp_tokens` table ships in two places: the migration file (for an
 * existing database) and scripts/init-db.ts (for a fresh install). Both have
 * to agree, otherwise one of the two install paths ends up without the table
 * and every MCP token request fails with ER_NO_SUCH_TABLE.
 *
 * The test reads the SQL as text rather than talking to a database, so it
 * runs everywhere — the live-database behaviour is covered by the integration
 * test in tests/integration/api/mcp-token-store.test.ts.
 */

const MIGRATION = 'scripts/migrations/2026-10-26-mcp-tokens.sql';

describe('the mcp_tokens table', () => {
  it('the migration creates the mcp_tokens table', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mcp_tokens');
    expect(sql).toContain('user_id BIGINT NOT NULL');
    expect(sql).toContain('token_hash CHAR(64) NOT NULL');
    expect(sql).toContain('last_used_at DATETIME NULL');
    expect(sql).toContain('revoked_at DATETIME NULL');
    expect(sql).toContain('UNIQUE KEY uniq_mcp_tokens_user (user_id)');
    expect(sql).toContain('UNIQUE KEY uniq_mcp_tokens_hash (token_hash)');
    expect(sql).toContain('REFERENCES users(id) ON DELETE CASCADE');
  });

  it('init-db.ts ships the same table', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts', 'init-db.ts'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mcp_tokens');
    expect(sql).toContain('token_hash CHAR(64) NOT NULL');
  });
});
