import { Download, Bot, AlertTriangle, Eye, Users, FileText, KeyRound, Activity } from 'lucide-react';
import { StatCard } from '@/components/admin/StatCard';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { getSystemStats } from '@/lib/admin';
import { getDownloadStats } from '@/lib/admin-downloads';
import { getAiStats } from '@/lib/admin-ai';
import { getAdminMcpTokenStats } from '@/lib/mcp-token-admin';
import { getPool } from '@/lib/db';
import { getPageViewStats } from '@/lib/admin-pageviews';

export const dynamic = 'force-dynamic';

export default async function AdminIndex() {
  // The MCP counters are read with their own guard: the `mcp_tokens`
  // table arrives with a migration, and the dashboard must not go down
  // because of it.
  const mcpStatsPromise = getAdminMcpTokenStats().catch((err: unknown) => {
    console.error('[admin] the mcp token counters could not be read', err);
    return null;
  });

  // Server component: call helpers directly (faster + simpler than /api/admin/stats fetch).
  const [systemStats, downloads, ai, disabledRows, pageViews, mcpStats] = await Promise.all([
    getSystemStats(),
    getDownloadStats(7),
    getAiStats(7),
    getPool().query<any[]>(`SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL`),
    getPageViewStats(7),
    mcpStatsPromise,
  ]);
  const disabledUsersCount = Number((disabledRows[0] as any[])[0]?.n ?? 0);
  const aiErrorRatePct = `${(ai.errorRate * 100).toFixed(1)}%`;

  const systemFigures = [
    { label: '用户', value: systemStats.users },
    { label: '管理员', value: systemStats.admins },
    { label: '历史记录', value: systemStats.history },
    { label: '收藏', value: systemStats.favorites },
    { label: '审计日志', value: systemStats.audit },
    { label: '已禁用用户', value: disabledUsersCount },
  ];

  return (
    <div>
      <PageHeader
        title="仪表盘"
        description="站点近况一览。数字取自数据库实时统计,点击卡片可跳转到对应的明细。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="下载 (7d)"
          value={downloads.total}
          icon={Download}
          href="/admin/downloads"
        />
        <StatCard label="AI 调用 (7d)" value={ai.total} icon={Bot} href="/admin/ai" />
        <StatCard
          label="AI 错误率 (7d)"
          value={aiErrorRatePct}
          icon={AlertTriangle}
          href="/admin/ai?status=error"
        />
        <StatCard label="今日 PV" value={pageViews.todayPv} icon={Eye} href="/admin/analytics" />
        <StatCard
          label="今日独立访客"
          value={pageViews.todayUv}
          icon={Users}
          href="/admin/analytics"
        />
        <StatCard
          label="热门页面"
          value={pageViews.topPaths[0]?.path ?? '—'}
          icon={FileText}
          href="/admin/analytics"
        />
        <StatCard
          label="MCP Token 持有者"
          value={mcpStats?.holders ?? '—'}
          icon={KeyRound}
          href="/admin/mcp"
        />
        <StatCard
          label="MCP 近 30 天使用"
          value={mcpStats?.usedRecently ?? '—'}
          icon={Activity}
          href="/admin/mcp"
        />
      </div>

      <Panel title="系统统计" description="全站累计数量">
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          {systemFigures.map((f) => (
            <div key={f.label}>
              <dt className="text-ink-soft text-xs">{f.label}</dt>
              <dd className="text-2xl text-ink font-serif tabular-nums mt-0.5">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
