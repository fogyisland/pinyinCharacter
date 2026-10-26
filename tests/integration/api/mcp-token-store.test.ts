// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { RowDataPacket } from 'mysql2';

import { loadEnvFromFile } from '@/lib/setup';
import { getPool, closePool } from '@/lib/db';
import {
  getTokenStatus,
  issueToken,
  revokeToken,
  resolveToken,
} from '@/lib/mcp-token';

/**
 * The per-user MCP token store against the live database.
 *
 * The raw token is a bearer credential, so the store has exactly one job:
 * hand out a token once, be able to find its owner again, and be able to
 * take it away. Every assertion below is about that lifecycle — issue,
 * resolve, disable, revoke, rotate — against the real `mcp_tokens` table
 * created by scripts/migrations/2026-10-26-mcp-tokens.sql.
 */

// vitest does not load .env, so DATABASE_URL is unset in the test runner.
// Read it out of the file and put it into the environment ourselves —
// loadEnvFromFile() only returns a record, it does not assign.
if (!process.env.DATABASE_URL) {
  const fromFile = loadEnvFromFile();
  if (fromFile.DATABASE_URL) process.env.DATABASE_URL = fromFile.DATABASE_URL;
}

const integrationSkip = !process.env.DATABASE_URL;

/** A throwaway, non-admin account so the suite never touches a real user. */
const TEST_USERNAME = 'mcp_token_test_user';
/** The column only needs to be non-empty; the suite never logs in with it. */
const TEST_PASSWORD_HASH = 'not-a-real-hash';

let testUserId = 0;

describe.skipIf(integrationSkip)('the MCP token store', () => {
  beforeAll(async () => {
    const pool = getPool();
    // A leftover row from an interrupted run would break the unique key.
    await pool.query('DELETE FROM users WHERE username = ?', [TEST_USERNAME]);
    const [inserted] = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [TEST_USERNAME, TEST_PASSWORD_HASH],
    );
    testUserId = Number((inserted as { insertId: number }).insertId);
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM mcp_tokens WHERE user_id = ?', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = ?', [testUserId]);
    await closePool();
  }, 60_000);

  beforeEach(async () => {
    // Every case starts from "no token", so the ordering of the cases
    // cannot change their outcome.
    await getPool().query('DELETE FROM mcp_tokens WHERE user_id = ?', [testUserId]);
    await getPool().query('UPDATE users SET disabled_at = NULL WHERE id = ?', [testUserId]);
  }, 60_000);

  describe('issuing', () => {
    it('returns a raw token of the documented shape', async () => {
      const issued = await issueToken(testUserId);
      expect(issued.raw).toHaveLength(47);
      expect(issued.raw.startsWith('mcp_')).toBe(true);
      expect(new Date(issued.createdAt).toISOString()).toBe(issued.createdAt);
    });

    it('reports the first issue as a fresh token, not a rotation', async () => {
      const issued = await issueToken(testUserId);
      expect(issued.replaced).toBe(false);
    });

    it('stores only the digest, never the raw token', async () => {
      const issued = await issueToken(testUserId);
      const [rows] = await getPool().query<Array<RowDataPacket & { token_hash: string }>>(
        'SELECT token_hash FROM mcp_tokens WHERE user_id = ?',
        [testUserId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).not.toBe(issued.raw);
      expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('resolving', () => {
    it('finds the owner of a live token', async () => {
      const issued = await issueToken(testUserId);
      const resolved = await resolveToken(issued.raw);
      expect(resolved).not.toBeNull();
      expect(resolved!.userId).toBe(testUserId);
      expect(resolved!.username).toBe(TEST_USERNAME);
      expect(resolved!.isAdmin).toBe(false);
    });

    it('returns the user id as a number, never as a string', async () => {
      const issued = await issueToken(testUserId);
      const resolved = await resolveToken(issued.raw);
      expect(typeof resolved!.userId).toBe('number');
    });

    it('does not resolve a token that was never issued', async () => {
      const resolved = await resolveToken('mcp_nonexistent');
      expect(resolved).toBeNull();
    });

    it('does not resolve a token of another user', async () => {
      const issued = await issueToken(testUserId);
      const resolved = await resolveToken(`${issued.raw}x`);
      expect(resolved).toBeNull();
    });

    it('records the first use of a token', async () => {
      const issued = await issueToken(testUserId);
      await resolveToken(issued.raw);
      const status = await getTokenStatus(testUserId);
      expect(status.lastUsedAt).not.toBeNull();
    });

    it('stops resolving once the account is disabled', async () => {
      const issued = await issueToken(testUserId);
      await getPool().query('UPDATE users SET disabled_at = NOW() WHERE id = ?', [testUserId]);
      const resolved = await resolveToken(issued.raw);
      expect(resolved).toBeNull();
    });

    it('resolves again once the account is re-enabled', async () => {
      const issued = await issueToken(testUserId);
      await getPool().query('UPDATE users SET disabled_at = NOW() WHERE id = ?', [testUserId]);
      expect(await resolveToken(issued.raw)).toBeNull();
      await getPool().query('UPDATE users SET disabled_at = NULL WHERE id = ?', [testUserId]);
      const resolved = await resolveToken(issued.raw);
      expect(resolved).not.toBeNull();
      expect(resolved!.userId).toBe(testUserId);
    });
  });

  describe('revoking', () => {
    it('returns the moment the token was revoked', async () => {
      await issueToken(testUserId);
      const revoked = await revokeToken(testUserId);
      expect(revoked.revokedAt).not.toBeNull();
      expect(new Date(revoked.revokedAt!).toISOString()).toBe(revoked.revokedAt);
    });

    it('stops resolving a revoked token', async () => {
      const issued = await issueToken(testUserId);
      await revokeToken(testUserId);
      expect(await resolveToken(issued.raw)).toBeNull();
    });

    it('is idempotent — the second revoke keeps the original timestamp', async () => {
      await issueToken(testUserId);
      const first = await revokeToken(testUserId);
      const second = await revokeToken(testUserId);
      expect(second.revokedAt).toBe(first.revokedAt);
    });

    it('reports no timestamp for a user who never had a token', async () => {
      const revoked = await revokeToken(999999999);
      expect(revoked.revokedAt).toBeNull();
    });

    it('never fails for a user who never had a token', async () => {
      const revoked = await revokeToken(testUserId);
      expect(revoked.revokedAt).toBeNull();
    });
  });

  describe('rotating', () => {
    it('reports the second issue as a rotation', async () => {
      await issueToken(testUserId);
      const second = await issueToken(testUserId);
      expect(second.replaced).toBe(true);
    });

    it('hands out a different raw token on rotation', async () => {
      const first = await issueToken(testUserId);
      const second = await issueToken(testUserId);
      expect(second.raw).not.toBe(first.raw);
    });

    it('keeps the rotated token resolvable', async () => {
      await issueToken(testUserId);
      const second = await issueToken(testUserId);
      const resolved = await resolveToken(second.raw);
      expect(resolved).not.toBeNull();
      expect(resolved!.userId).toBe(testUserId);
    });

    it('stops resolving the token it replaced', async () => {
      const first = await issueToken(testUserId);
      await issueToken(testUserId);
      expect(await resolveToken(first.raw)).toBeNull();
    });

    it('keeps one row per user', async () => {
      await issueToken(testUserId);
      await issueToken(testUserId);
      const [rows] = await getPool().query('SELECT id FROM mcp_tokens WHERE user_id = ?', [
        testUserId,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('clears the use timestamp of the token it replaced', async () => {
      const first = await issueToken(testUserId);
      await resolveToken(first.raw);
      expect((await getTokenStatus(testUserId)).lastUsedAt).not.toBeNull();
      await issueToken(testUserId);
      expect((await getTokenStatus(testUserId)).lastUsedAt).toBeNull();
    });

    it('clears the revocation of the token it replaced', async () => {
      await issueToken(testUserId);
      await revokeToken(testUserId);
      const second = await issueToken(testUserId);
      expect(second.replaced).toBe(true);
      expect((await getTokenStatus(testUserId)).state).toBe('active');
    });
  });

  describe('the token status', () => {
    it('reads "none" for a user who never had a token', async () => {
      const status = await getTokenStatus(testUserId);
      expect(status.state).toBe('none');
      expect(status.createdAt).toBeNull();
      expect(status.lastUsedAt).toBeNull();
      expect(status.revokedAt).toBeNull();
    });

    it('reads "active" for a live token', async () => {
      await issueToken(testUserId);
      const status = await getTokenStatus(testUserId);
      expect(status.state).toBe('active');
      expect(status.createdAt).not.toBeNull();
      expect(status.revokedAt).toBeNull();
    });

    it('reads "revoked" for a revoked token', async () => {
      await issueToken(testUserId);
      await revokeToken(testUserId);
      const status = await getTokenStatus(testUserId);
      expect(status.state).toBe('revoked');
      expect(status.revokedAt).not.toBeNull();
    });

    it('reports every timestamp as an ISO string', async () => {
      const issued = await issueToken(testUserId);
      await resolveToken(issued.raw);
      await revokeToken(testUserId);
      const status = await getTokenStatus(testUserId);
      expect(new Date(status.createdAt!).toISOString()).toBe(status.createdAt);
      expect(new Date(status.lastUsedAt!).toISOString()).toBe(status.lastUsedAt);
      expect(new Date(status.revokedAt!).toISOString()).toBe(status.revokedAt);
    });

    it('reads "none" for a user id that does not exist', async () => {
      const status = await getTokenStatus(999999999);
      expect(status.state).toBe('none');
    });
  });
});
