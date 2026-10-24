import Link from 'next/link';
import { AlertTriangle, Bot } from 'lucide-react';
import { getAiStats, listAiCalls } from '@/lib/admin-ai';
import { getAllConfig, getConfig } from '@/lib/config';
import { hasAiApiKey, maskAiConfig } from '@/lib/ai-config';
import { StatCard } from '@/components/admin/StatCard';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
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

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
  'rate-limited': 'bg-yellow-100 text-yellow-800',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[status] ?? 'bg-paper-deep text-ink-soft'}`}
    >
      {status}
    </span>
  );
}

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
          pageSize: 50,
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

  const totalPages = Math.max(1, Math.ceil(total / 50));
  const navClass = (disabled: boolean) =>
    `text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep inline-flex items-center gap-1 ${
      disabled ? 'opacity-50 pointer-events-none' : ''
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">AI</h1>

      <div className="flex border-b border-paper-warm">
        {AI_TABS.map((t) => (
          <Link
            key={t.value}
            href={buildAiHref(t.value, query)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.value
                ? 'border-ink text-ink font-semibold'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'calls' && (
        <div className="space-y-4">
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

          <AiCallsFilterBar key={buildAiHref('calls', query)} query={query} />

          {error && <p className="text-sm text-seal">调用记录查询失败：{error}</p>}

          <ResponsiveTable
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="无数据"
            columns={[
              { key: 'feature', header: '功能', mobileTitle: true },
              { key: 'status', header: '状态' },
              { key: 'user', header: '用户', mobileHide: true },
              { key: 'model', header: '模型', mobileHide: true },
              { key: 'duration', header: '耗时', mobileHide: true },
              { key: 'createdAt', header: '时间', mobileHide: true },
              { key: 'error', header: '错误', mobileHide: true },
            ]}
          >
            {(r) => (
              <>
                <span className="text-sm">{r.feature}</span>
                <StatusBadge status={r.status} />
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
                  <div className="text-seal">
                    {truncate(r.error)}
                    <details>
                      <summary className="cursor-pointer hover:underline">展开完整错误</summary>
                      <pre className="mt-1 p-2 bg-paper-warm rounded overflow-auto text-xs whitespace-pre-wrap">
                        {r.error}
                      </pre>
                    </details>
                  </div>
                ) : (
                  '—'
                )}
              </>
            )}
          </ResponsiveTable>

          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              共 {total} 条 · 第 {query.page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Link
                href={buildAiHref('calls', query, { page: Math.max(1, query.page - 1) })}
                className={navClass(query.page <= 1)}
              >
                上一页
              </Link>
              <Link
                href={buildAiHref('calls', query, { page: Math.min(totalPages, query.page + 1) })}
                className={navClass(query.page >= totalPages)}
              >
                下一页
              </Link>
            </div>
          </div>
        </div>
      )}

      {tab === 'config' && <ConfigTab />}

      {tab === 'mock' && <MockTab />}
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
    return <p className="text-sm text-seal">配置读取失败：{error ?? '未知错误'}</p>;
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
    return <p className="text-sm text-seal">Mock 状态读取失败：{error}</p>;
  }

  return <AiMockToggle initialEnabled={enabled} />;
}
