import Link from 'next/link';
import {
  getAdminMcpTokenStats,
  listAdminMcpTokens,
  type AdminMcpTokenFilter,
  type AdminMcpTokenRow,
  type AdminMcpTokenStats,
} from '@/lib/mcp-token-admin';
import { McpCapabilityList } from '@/components/admin/mcp/McpCapabilityList';
import { RevokeMcpTokenButton } from '@/components/admin/mcp/RevokeMcpTokenButton';
import { DataTable } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatCard } from '@/components/admin/StatCard';
import { FilterChip } from '@/components/admin/FilterChip';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { Toolbar } from '@/components/admin/Toolbar';
import { AdminButton, AdminLink } from '@/components/admin/AdminButton';
import { Users, KeyRound, Ban, Activity, Plug, SearchX, UserX } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';
import { MCP_CAPABILITIES } from '@/mcp/capabilities';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/** The counters of an empty (or unreadable) token table. */
const EMPTY_STATS: AdminMcpTokenStats = {
  totalUsers: 0,
  holders: 0,
  active: 0,
  disabled: 0,
  revoked: 0,
  usedRecently: 0,
};

interface PageProps {
  searchParams: Promise<{ state?: string; q?: string; page?: string }>;
}

export default async function AdminMcpPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const state: AdminMcpTokenFilter =
    sp.state === 'active' || sp.state === 'disabled' || sp.state === 'revoked'
      ? sp.state
      : 'all';
  const q = sp.q?.trim() || undefined;
  // The page number is a whole number — a fractional one would make the
  // offset fractional too, and MySQL's LIMIT takes whole numbers.
  const pageRaw = Number(sp.page);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // The `mcp_tokens` table arrives with a migration. A database that has
  // not been migrated yet must not take the whole admin down — the page
  // says so and shows the tool catalogue, which needs no table at all.
  let stats = EMPTY_STATS;
  let items: AdminMcpTokenRow[] = [];
  let total = 0;
  let tableError = false;
  try {
    const [loadedStats, list] = await Promise.all([
      getAdminMcpTokenStats(),
      listAdminMcpTokens({
        state,
        q,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    ]);
    stats = loadedStats;
    items = list.items;
    total = list.total;
  } catch (err) {
    tableError = true;
    console.error('[admin] the mcp token table could not be read', err);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const endpoint = await resolveMcpEndpoint();

  return (
    <div>
      <PageHeader
        title="MCP 管理"
        description="站点自带 MCP 服务(/mcp)。用户可在自己的页面上申请 Token;这里看谁持有 Token、是否仍在使用,并可以随时吊销。"
        actions={
          <AdminLink href="/admin/users" variant="secondary" size="sm">
            用户列表
          </AdminLink>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="注册用户" value={stats.totalUsers} icon={Users} />
        <StatCard label="持有 Token" value={stats.holders} icon={KeyRound} />
        <StatCard label="生效中" value={stats.active} icon={Plug} />
        <StatCard label="账号停用" value={stats.disabled} icon={UserX} />
        <StatCard label="已吊销" value={stats.revoked} icon={Ban} />
      </div>

      <Toolbar className="mb-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          {state !== 'all' && <input type="hidden" name="state" value={state} />}
          <input
            type="text"
            name="q"
            placeholder="搜索用户名"
            defaultValue={q ?? ''}
            aria-label="搜索用户名"
            className="adm-input w-64 max-w-full"
          />
          <AdminButton type="submit" variant="primary" size="sm">
            搜索
          </AdminButton>
          {q ? (
            <AdminLink href={buildHref({ state })} variant="ghost" size="sm">
              清空
            </AdminLink>
          ) : null}
        </form>
      </Toolbar>

      <div className="flex gap-2 mb-4 flex-wrap">
        <FilterChip active={state === 'all'} href={buildHref({ state: 'all', q })}>
          全部 ({stats.holders})
        </FilterChip>
        <FilterChip active={state === 'active'} href={buildHref({ state: 'active', q })}>
          生效中 ({stats.active})
        </FilterChip>
        <FilterChip active={state === 'disabled'} href={buildHref({ state: 'disabled', q })}>
          账号停用 ({stats.disabled})
        </FilterChip>
        <FilterChip active={state === 'revoked'} href={buildHref({ state: 'revoked', q })}>
          已吊销 ({stats.revoked})
        </FilterChip>
        {stats.usedRecently > 0 ? (
          <span className="text-xs text-ink-faint inline-flex items-center gap-1 self-center">
            <Activity className="h-3 w-3" />
            近 30 天有 {stats.usedRecently} 个 Token 被使用
          </span>
        ) : null}
      </div>

      <Panel title="Token 持有者" description="按签发时间倒序排列。吊销后 Token 立即失效,记录会保留。" flush>
        {tableError ? (
          <EmptyState
            icon={KeyRound}
            title="Token 表暂时不可用"
            description="数据库可能还没有执行 mcp_tokens 的迁移。请先运行迁移,然后刷新本页。"
          />
        ) : (
          <DataTable
            rows={items}
            rowKey={(r) => r.userId}
            caption="MCP Token 持有者"
            framed={false}
            empty={
              q ? (
                <EmptyState
                  icon={SearchX}
                  title="没有匹配的用户"
                  description={`没有用户名包含「${q}」的 Token 记录。换个关键词,或清空搜索看全部。`}
                />
              ) : (
                <EmptyState
                  icon={KeyRound}
                  title="还没有人申请 Token"
                  description="用户在 /profile 页面上申请后,这里会出现记录。"
                />
              )
            }
            columns={[
              { key: 'user', header: '用户', mobileTitle: true },
              { key: 'state', header: '状态' },
              { key: 'createdAt', header: '签发时间', numeric: true, mobileHide: true },
              { key: 'lastUsedAt', header: '最近使用', numeric: true, mobileHide: true },
              { key: 'revokedAt', header: '吊销时间', numeric: true, mobileHide: true },
              { key: 'actions', header: '操作', mobileHide: true },
            ]}
          >
            {(r) => (
              <>
                <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                  {r.username}
                </Link>
                {r.state === 'revoked' ? (
                  <StatusBadge tone="danger">已吊销</StatusBadge>
                ) : r.disabled ? (
                  <StatusBadge tone="warning">账号停用</StatusBadge>
                ) : (
                  <StatusBadge tone="success">生效中</StatusBadge>
                )}
                <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span>
                <span className="text-xs text-ink-soft">{formatDateTime(r.lastUsedAt)}</span>
                <span className="text-xs text-ink-soft">{formatDateTime(r.revokedAt)}</span>
                {r.state === 'active' ? (
                  <RevokeMcpTokenButton userId={r.userId} username={r.username} />
                ) : (
                  <span className="text-xs text-ink-faint">—</span>
                )}
              </>
            )}
          </DataTable>
        )}
      </Panel>

      <div className="mt-4">
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          unit="个"
          buildHref={(target) => buildHref({ state, q }, { page: String(target) })}
        />
      </div>

      <div className="mt-6">
        <Panel
          title="MCP 提供的能力"
          description={
            <>
              端点 <code className="text-seal">{endpoint}</code>
              ，共 {MCP_CAPABILITIES.length} 个工具,全部只读:除语音合成外的工具都从站点自己的文件里取数。
            </>
          }
        >
          <McpCapabilityList />
        </Panel>
      </div>
    </div>
  );
}

/**
 * The href of a filter chip or a page link.
 *
 * The active filter travels with every link, so a chip never drops the
 * search term and a page link never drops the filter.
 */
function buildHref(
  base: { state: AdminMcpTokenFilter; q?: string },
  override: { state?: AdminMcpTokenFilter; q?: string | null; page?: string } = {},
): string {
  const params = new URLSearchParams();
  const state = override.state ?? base.state;
  if (state !== 'all') params.set('state', state);
  const q = override.q !== undefined ? override.q : base.q;
  if (q) params.set('q', q);
  if (override.page) params.set('page', override.page);
  const qs = params.toString();
  return qs ? `/admin/mcp?${qs}` : '/admin/mcp';
}
