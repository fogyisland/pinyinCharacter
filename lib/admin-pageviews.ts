import { getPool } from '@/lib/db';

export interface PageViewStats {
  todayPv: number;
  todayUv: number;
  topPaths: Array<{ path: string; count: number }>;
}

/**
 * Aggregates `page_views` for the admin dashboard's 3 PV/UV StatCards.
 *
 *  - todayPv:  COUNT(*) of rows with created_at >= today's midnight
 *  - todayUv:  COUNT(DISTINCT COALESCE(user_id, ip)) for the same window
 *              (logged-in users counted by id, anonymous by IP)
 *  - topPaths: top 5 paths by COUNT(*) over the last `days` days
 *              (defaults to 7)
 */
export async function getPageViewStats(days: number = 7): Promise<PageViewStats> {
  const pool = getPool();
  const [[{ today_pv }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS today_pv FROM page_views WHERE created_at >= CURDATE()`,
  );
  const [[{ today_uv }]] = await pool.query<any[]>(
    `SELECT COUNT(DISTINCT COALESCE(user_id, ip)) AS today_uv
       FROM page_views WHERE created_at >= CURDATE()`,
  );
  const [rows] = await pool.query<any[]>(
    `SELECT path, COUNT(*) AS count FROM page_views
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY path ORDER BY count DESC LIMIT 5`,
    [days],
  );
  return {
    todayPv: Number(today_pv),
    todayUv: Number(today_uv),
    topPaths: rows.map((r: any) => ({ path: r.path, count: Number(r.count) })),
  };
}