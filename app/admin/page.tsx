import { Download, Bot, AlertTriangle, UserX } from 'lucide-react';
import { StatCard } from '@/components/admin/StatCard';
import { getSystemStats } from '@/lib/admin';
import { getDownloadStats } from '@/lib/admin-downloads';
import { getAiStats } from '@/lib/admin-ai';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminIndex() {
  // Server component: call helpers directly (faster + simpler than /api/admin/stats fetch).
  const [systemStats, downloads, ai, disabledRows] = await Promise.all([
    getSystemStats(),
    getDownloadStats(7),
    getAiStats(7),
    getPool().query<any[]>(
      `SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL`,
    ),
  ]);
  const disabledUsersCount = Number((disabledRows[0] as any[])[0]?.n ?? 0);
  const aiErrorRatePct = `${(ai.errorRate * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <h1 className="font-kai text-2xl text-ink">仪表盘</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="下载 (7d)" value={downloads.total} icon={Download} href="/admin/downloads" />
        <StatCard label="AI 调用 (7d)" value={ai.total} icon={Bot} href="/admin/ai" />
        <StatCard
          label="AI 错误率 (7d)"
          value={aiErrorRatePct}
          icon={AlertTriangle}
          href="/admin/ai?status=error"
        />
        <StatCard
          label="已禁用用户"
          value={disabledUsersCount}
          icon={UserX}
          href="/admin/users?disabled=true"
        />
      </div>
      <section className="rounded-lg border border-paper-warm bg-paper p-4">
        <h2 className="font-serif text-lg text-ink mb-3">系统统计</h2>
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <dt className="text-ink-soft text-xs">用户</dt>
            <dd className="text-xl text-ink font-serif">{systemStats.users}</dd>
          </div>
          <div>
            <dt className="text-ink-soft text-xs">管理员</dt>
            <dd className="text-xl text-ink font-serif">{systemStats.admins}</dd>
          </div>
          <div>
            <dt className="text-ink-soft text-xs">历史记录</dt>
            <dd className="text-xl text-ink font-serif">{systemStats.history}</dd>
          </div>
          <div>
            <dt className="text-ink-soft text-xs">收藏</dt>
            <dd className="text-xl text-ink font-serif">{systemStats.favorites}</dd>
          </div>
          <div>
            <dt className="text-ink-soft text-xs">审计日志</dt>
            <dd className="text-xl text-ink font-serif">{systemStats.audit}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
