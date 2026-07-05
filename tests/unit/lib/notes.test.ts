// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Force DB-dependent branches to skip when DATABASE_URL is unset.
const integrationSkip = !process.env.DATABASE_URL;
const DB_URL = process.env.DATABASE_URL ?? 'mysql://root:Admin909217@127.0.0.1:3306/piyin_deploy_test';

describe.skipIf(integrationSkip)('lib/notes — rate limit + insert', () => {
  it('insertNote + listActiveNotes round-trip', async () => {
    const { insertNote, listActiveNotes } = await import('@/lib/notes');
    const mysqlMod = await import('mysql2/promise');
    const conn = await mysqlMod.default.createConnection(DB_URL);
    try {
      // Pick any real user id (or fall back to NULL deleted_by). ON DELETE SET NULL
      // means deleted_by can be NULL, so we don't need to satisfy the FK strictly.
      const [u] = await conn.query<any[]>('SELECT id FROM users ORDER BY id LIMIT 1');
      const realUserId = (u as any[])[0]?.id ?? null;

      const inserted = await insertNote({
        authorUserId: null,
        authorName: 'Unit测试',
        authorEmail: null,
        content: 'unit test content',
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
      const id = inserted.id;
      expect(id).toBeGreaterThan(0);
      expect(inserted.authorName).toBe('Unit测试');
      expect(inserted.content).toBe('unit test content');
      expect(inserted.deletedAt).toBeNull();
      const before = await listActiveNotes({ limit: 100 });
      expect(before.find((n) => n.id === id)).toBeTruthy();

      // Soft-delete via raw SQL with the real user id (or NULL if no users).
      const [res] = await conn.query<any>(
        'UPDATE notes SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
        [realUserId, id]
      );
      expect(res.affectedRows).toBe(1);

      const [rows] = await conn.query('SELECT deleted_at FROM notes WHERE id = ?', [id]);
      expect((rows as any[])[0]?.deleted_at).not.toBeNull();

      await conn.query('DELETE FROM notes WHERE id = ?', [id]);
    } finally {
      await conn.end();
    }
  });

  it('checkRateLimit allows first post from new IP', async () => {
    const { checkRateLimit } = await import('@/lib/notes');
    const verdict = await checkRateLimit({ ip: '203.0.113.99', email: null });
    expect(verdict.allow).toBe(true);
  });

  it('checkRateLimit denies when ip minute window saturated', async () => {
    const { checkRateLimit, bumpRateLimit } = await import('@/lib/notes');
    await bumpRateLimit({ ip: '203.0.113.100', email: null });
    const verdict = await checkRateLimit({ ip: '203.0.113.100', email: null });
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.reason).toMatch(/分钟/);
    }
  });
});