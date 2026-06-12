// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../../lib/db';
import { listDownloads, getDownloadStats } from '../../../lib/admin-downloads';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('admin-downloads', () => {
  let userId: number;
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('dl_u', 'x')`);
    const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number(r[0].id);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'poem', '1')`, [userId]);
    await pool.query(`INSERT INTO downloads (user_id, format, source_type, source_id) VALUES (?, 'print', 'worksheet', '5')`, [userId]);
  });
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM downloads WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('listDownloads filters by sourceType', async () => {
    const result = await listDownloads({ userId, sourceType: 'poem' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe('poem');
  });

  it('getDownloadStats aggregates by source_type and top user', async () => {
    const stats = await getDownloadStats(7);
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.bySourceType.poem).toBeGreaterThanOrEqual(1);
    expect(stats.bySourceType.worksheet).toBeGreaterThanOrEqual(1);
    const topUser = stats.topUsers.find(u => u.userId === userId);
    expect(topUser).toBeTruthy();
    expect(topUser!.count).toBeGreaterThanOrEqual(2);
  });
});