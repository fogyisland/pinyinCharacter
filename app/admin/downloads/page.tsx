'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import { StatCard } from '@/components/admin/StatCard';
import { SourceBadge } from '@/components/admin/SourceBadge';
import { listAdminDownloadsRequest, getDownloadStatsRequest, type AdminDownloadRow } from '@/lib/api-admin';

const SOURCE_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'worksheet', label: '字帖' },
  { value: 'poem', label: '古诗' },
  { value: 'sutra', label: '佛经' },
  { value: 'rare-char-card', label: '生字卡' },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (sourceType === 'worksheet') return `/worksheet/${encodeURIComponent(sourceId)}`;
  if (sourceType === 'poem') return `/poetry/${encodeURIComponent(sourceId)}`;
  if (sourceType === 'sutra') {
    const slug = sourceId.split('#')[0];
    return `/sutra/${encodeURIComponent(slug)}`;
  }
  if (sourceType === 'rare-char-card') {
    try { return `/rare-chars/${encodeURIComponent(decodeURIComponent(sourceId))}`; }
    catch { return `/rare-chars/${encodeURIComponent(sourceId)}`; }
  }
  return null;
}

function statusBadge(status: string) {
  const color = status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${color}`}>{status}</span>;
}

export default function AdminDownloadsPage() {
  const [sourceType, setSourceType] = useState('');
  const [userQ, setUserQ] = useState('');
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [rows, setRows] = useState<AdminDownloadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [stats, setStats] = useState<{ total: number; bySourceType: Record<string, number>; topUsers: { userId: number; username: string | null; count: number }[] } | null>(null);
  const [todayCount, setTodayCount] = useState<number>(0);

  const fetchPage = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await listAdminDownloadsRequest({
        sourceType: sourceType || undefined,
        // userId is numeric in our wrapper, so we resolve the typed search loosely by
        // trusting numeric input. Non-numeric strings are ignored client-side.
        userId: /^\d+$/.test(userQ) ? Number(userQ) : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        page, pageSize,
      });
      if (!r.ok) { setErr(r.error.message); return; }
      setRows(r.data.items);
      setTotal(r.data.total);
    } finally { setBusy(false); }
  }, [sourceType, userQ, from, to, page, pageSize]);

  const fetchStats = useCallback(async () => {
    const r = await getDownloadStatsRequest(7);
    if (!r.ok) return;
    const s = r.data as any;
    setStats({
      total: Number(s.total ?? 0),
      bySourceType: s.bySourceType ?? {},
      topUsers: s.topUsers ?? [],
    });
  }, []);

  const fetchToday = useCallback(async () => {
    const today = isoDate(new Date());
    const r = await listAdminDownloadsRequest({ from: new Date(today).toISOString(), pageSize: 1 });
    if (!r.ok) return;
    setTodayCount(r.data.total);
  }, []);

  useEffect(() => { fetchPage(); }, [fetchPage]);
  useEffect(() => { fetchStats(); fetchToday(); }, [fetchStats, fetchToday]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchPage();
  }
  function resetFilters() {
    setSourceType(''); setUserQ('');
    setFrom(isoDate(new Date(Date.now() - 7 * 86400_000)));
    setTo(isoDate(new Date()));
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const topSrc = stats ? Object.entries(stats.bySourceType).sort((a, b) => b[1] - a[1])[0] : null;
  const topUser = stats?.topUsers?.[0];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">下载</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总下载 (7d)" value={stats?.total ?? '—'} icon={Download} />
        <StatCard label="今日下载" value={todayCount} icon={Download} />
        <StatCard label="最多用户 (7d)" value={topUser ? `${topUser.username ?? `#${topUser.userId}`} (${topUser.count})` : '—'} icon={Download} />
        <StatCard label="最常用源 (7d)" value={topSrc ? `${topSrc[0]} (${topSrc[1]})` : '—'} icon={Download} />
      </div>

      <form onSubmit={applyFilters} className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <label className="text-xs text-ink-soft">来源类型</label>
          <select value={sourceType} onChange={e => setSourceType(e.target.value)}
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
            {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-soft">用户 ID</label>
          <input value={userQ} onChange={e => setUserQ(e.target.value)} type="text" placeholder="数字 ID"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div>
          <label className="text-xs text-ink-soft">从</label>
          <input value={from} onChange={e => setFrom(e.target.value)} type="date"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div>
          <label className="text-xs text-ink-soft">至</label>
          <input value={to} onChange={e => setTo(e.target.value)} type="date"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={busy}
            className="flex-1 text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50 inline-flex items-center justify-center gap-1">
            <Filter className="h-3.5 w-3.5" />筛选
          </button>
          <button type="button" onClick={resetFilters} disabled={busy}
            className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">重置</button>
        </div>
      </form>

      {err && <p className="text-sm text-seal">{err}</p>}

      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">格式</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">耗时</th>
              <th className="px-3 py-2">资源</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const href = sourceHref(r.sourceType, r.sourceId);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="px-3 py-2">
                    {r.username
                      ? <a href={`/admin/users/${r.userId}`} className="text-seal hover:underline">{r.username}</a>
                      : <span className="text-ink-faint">#{r.userId}</span>}
                  </td>
                  <td className="px-3 py-2"><SourceBadge source="download" /></td>
                  <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-paper-deep">{r.format}</span></td>
                  <td className="px-3 py-2">{statusBadge(r.status)}</td>
                  <td className="px-3 py-2 text-xs">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.sourceId
                      ? href
                        ? <a href={href} className="text-seal hover:underline">{r.sourceType}#{r.sourceId}</a>
                        : <span>{r.sourceType}#{r.sourceId}</span>
                      : <span className="text-ink-faint">—</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !busy && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-faint">无数据</td></tr>
            )}
            {busy && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-faint">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-faint inline-flex items-center gap-1"><Search className="h-3.5 w-3.5" />共 {total} 条 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={busy || page <= 1}
            className="text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-1">
            <ChevronLeft className="h-3.5 w-3.5" />上一页
          </button>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={busy || page >= totalPages}
            className="text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep disabled:opacity-50 inline-flex items-center gap-1">
            下一页<ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}