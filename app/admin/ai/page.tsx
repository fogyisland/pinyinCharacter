import Link from 'next/link';
import { AlertTriangle, Bot } from 'lucide-react';
import { getAiStats, listAiCalls } from '@/lib/admin-ai';
import { getAllConfig, getConfig } from '@/lib/config';
import { hasAiApiKey, maskAiConfig } from '@/lib/ai-config';
import { StatCard } from '@/components/admin/StatCard';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { Toolbar } from '@/components/admin/Toolbar';
import { AiCallsFilterBar } from '@/components/admin/AiCallsFilterBar';
import { AiConfigForm } from '@/components/admin/AiConfigForm';
import { AiMockToggle } from '@/components/admin/AiMockToggle';
import { AI_TABS, buildAiHref, parseAiCallsQuery, parseAiTab } from '@/lib/admin-ai-url';
import { dateRangeToIso, parseUserId, readParam } from '@/lib/admin-url';
import { formatDateTime } from '@/lib/format';
import type { AiCallRow, AiStats } from '@/lib/admin-ai';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 50;

/**
 * How a call's status is coloured.
 *
 * The page used to hand-write a pale green / pale red / pale yellow pill per
 * status — a palette that existed nowhere else in the admin, and one the
 * theme never defined, so the pills had no background of their own.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  ok: 'success',
  error: 'danger',
  'rate-limited': 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  ok: '成功',
  error: '失败',
  'rate-limited': '限流',
};

function truncate(text: string, n = 100): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

export default async function AdminAiPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = parseAiTab(readParam(params, 'tab'));
  const query = parseAiCallsQuery(params);

  let rows: AiCallRow[] = [];
  let total = 0;
  let stats: AiStats | null = null;
  let error: string | null = null;

  if (tab === 'calls') {
    const range = dateRangeToIso(query.from, query.to);
    try {
      const [list, stat] = await Promise.all([
        listAiCalls({
          feature: query.feature || undefined,
          status: query.status || undefined,
          userId: parseUserId(query.userId),
          from: range.from,
          to: range.to,
          page: query.page,
          pageSize: PAGE_SIZE,
        }),
        getAiStats(7),
      ]);
      rows = list.rows;
      total = list.total;
      stats = stat;
    } catch (err) {
      console.error('[admin/ai] failed to list the AI calls:', err);
      error = (err as Error).message || '调用记录查询失败';
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="AI"
        description="查看 LLM 调用记录、配置连接参数,以及切换 Mock 模式做离线调试。"
      />

      <div className="space-y-4">
        <nav className="flex flex-wrap border-b border-ink/10" aria-label="AI 页签">
          {AI_TABS.map((t) => {
            const active = tab === t.value;
            return (
              <Link
                key={t.value}
                href={buildAiHref(t.value, query)}
                aria-current={active ? 'page' : undefined}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-seal text-ink font-semibold'
                    : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {tab === 'calls' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard label="调用总数 (7d)" value={stats?.total ?? '—'} icon={Bot} />
              <StatCard
                label="错误率 (7d)"
                value={stats ? `${(stats.errorRate * 100).toFixed(1)}%` : '—'}
                icon={AlertTriangle}
              />
              <StatCard
                label="P95 延迟 (7d)"
                value={stats?.p95Duration != null ? `${stats.p95Duration} ms` : '—'}
                icon={Bot}
              />
            </div>

            <Toolbar>
              <AiCallsFilterBar key={buildAiHref('calls', query)} query={query} />
            </Toolbar>

            {error && (
              <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
                调用记录查询失败：{error}
              </p>
            )}

            <Panel title="调用记录" description="按时间倒序排列的每一次 LLM 调用。" flush>
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                caption="AI 调用记录"
                framed={false}
                empty={
                  <EmptyState
                    icon={Bot}
                    title="暂无调用记录"
                    description="换个时间范围或功能名再试,或者放宽状态筛选。"
                  />
                }
                columns={[
                  { key: 'feature', header: '功能', mobileTitle: true },
                  { key: 'status', header: '状态' },
                  { key: 'user', header: '用户', mobileHide: true },
                  { key: 'model', header: '模型', mobileHide: true },
                  { key: 'duration', header: '耗时', numeric: true, mobileHide: true },
                  { key: 'createdAt', header: '时间', numeric: true, mobileHide: true },
                  { key: 'error', header: '错误', mobileHide: true },
                ]}
              >
                {(r) => (
                  <>
                    <span className="text-sm">{r.feature}</span>
                    <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </StatusBadge>
                    {r.username ? (
                      <a href={`/admin/users/${r.userId}`} className="text-seal hover:underline">
                        {r.username}
                      </a>
                    ) : (
                      <span className="text-ink-faint">#{r.userId}</span>
                    )}
                    <span className="text-xs text-ink-soft">{r.model ?? '—'}</span>
                    <span className="text-xs">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</span>
                    <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span>
                    {r.error ? (
                      <div className="text-danger">
                        {truncate(r.error)}
                        <details>
                          <summary className="cursor-pointer hover:underline">展开完整错误</summary>
                          <pre className="mt-1 p-2 bg-paper-deep rounded overflow-auto text-xs whitespace-pre-wrap">
                            {r.error}
                          </pre>
                        </details>
                      </div>
                    ) : (
                      '—'
                    )}
                  </>
                )}
              </DataTable>
            </Panel>

            <Pagination
              page={query.page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              buildHref={(target) =>
                buildAiHref('calls', query, {
                  page: Math.min(totalPages, Math.max(1, target)),
                })
              }
            />
          </>
        )}

        {tab === 'config' && <ConfigTab />}

        {tab === 'mock' && <MockTab />}
      </div>
    </div>
  );
}

/**
 * The configuration tab. The values are read here (on the server) and handed
 * to the form island, so opening the tab needs no extra request.
 */
async function ConfigTab() {
  let config: Record<string, string> | null = null;
  let hasApiKey = false;
  let error: string | null = null;

  try {
    const all = await getAllConfig();
    config = maskAiConfig(all);
    hasApiKey = hasAiApiKey(all);
  } catch (err) {
    console.error('[admin/ai] failed to read the AI config:', err);
    error = (err as Error).message || '配置读取失败';
  }

  if (error || !config) {
    return (
      <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
        配置读取失败：{error ?? '未知错误'}
      </p>
    );
  }

  return <AiConfigForm initialConfig={config} initialHasApiKey={hasApiKey} />;
}

/** The mock mode tab — `ai.mock_mode` decides whether the LLM calls are stubbed. */
async function MockTab() {
  let enabled = false;
  let error: string | null = null;

  try {
    enabled = (await getConfig('ai.mock_mode')) === 'true';
  } catch (err) {
    console.error('[admin/ai] failed to read the mock mode:', err);
    error = (err as Error).message || 'Mock 状态读取失败';
  }

  if (error) {
    return (
      <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
        Mock 状态读取失败：{error}
      </p>
    );
  }

  return <AiMockToggle initialEnabled={enabled} />;
}
