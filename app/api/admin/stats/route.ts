import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSystemStats } from '@/lib/admin';
import { getDownloadStats } from '@/lib/admin-downloads';
import { getAiStats } from '@/lib/admin-ai';
import { getPool } from '@/lib/db';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // Run system stats, downloads, AI, and disabled-users count in parallel.
  const [systemStats, downloads, ai, disabledRows] = await Promise.all([
    getSystemStats(),
    getDownloadStats(7),
    getAiStats(7),
    getPool().query<any[]>(
      `SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL`,
    ),
  ]);
  const disabledUsersCount = Number((disabledRows[0] as any[])[0]?.n ?? 0);

  return NextResponse.json({
    ok: true,
    data: {
      ...systemStats,
      downloads7d: downloads.total,
      aiCalls7d: ai.total,
      aiErrorRate7d: ai.errorRate,
      disabledUsersCount,
    },
  });
}
