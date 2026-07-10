import { getPool } from '@/lib/db';

export interface PageViewEntry {
  userId: number | null;
  path: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Records a single page view into the `page_views` table.
 *
 * Called from the POST /api/track/pageview route. The API route is
 * responsible for sanitizing / truncating `path`, `ip`, and `userAgent`
 * before they reach here, so this function only concerns itself with
 * the SQL itself: a single INSERT of the four columns.
 *
 * For analytics queries (today PV/UV, top paths) see `lib/admin-pageviews.ts`.
 */
export async function recordPageView(entry: PageViewEntry): Promise<void> {
  await getPool().execute(
    `INSERT INTO page_views (user_id, path, ip, user_agent)
     VALUES (?, ?, ?, ?)`,
    [entry.userId, entry.path, entry.ip, entry.userAgent],
  );
}