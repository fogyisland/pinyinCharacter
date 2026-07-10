import { getPool } from '@/lib/db';

export interface PageViewEntry {
  userId: number | null;
  path: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Stub implementation (Task 2). Task 4 will replace this body with the full
 * transactional implementation + denormalized helpers + analytics queries.
 */
export async function recordPageView(entry: PageViewEntry): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO page_views (user_id, path, ip, user_agent)
     VALUES (?, ?, ?, ?)`,
    [entry.userId, entry.path, entry.ip, entry.userAgent],
  );
}