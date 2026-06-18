'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { LogRow } from '@/components/admin/LogRow';
import { JsonPanel } from '@/components/admin/JsonPanel';
import { listAdminLogsRequest, type AdminLogRow } from '@/lib/api-admin';
import { formatLogMessage } from '@/lib/audit-format';

// AuditEvent union from lib/audit.ts, plus synthetic events for download/ai_call.
const EVENT_TYPES = [
  '',
  'register', 'login', 'logout',
  'history_create', 'history_delete',
  'password_reset_request', 'password_reset_complete',
  'admin_user_delete', 'admin_user_password_reset',
  'admin_user_promote', 'admin_user_demote',
  'user_disabled', 'user_reenabled',
  'ai_config_updated', 'ai_call_logged',
  'tts_config_updated',
  'scheduler_config_updated', 'scheduler_manual_trigger',
  'worksheet_saved', 'worksheet_deleted',
  'poem_saved', 'sutra_saved', 'rare_char_card_saved',
  'download_logged',
  'membership_granted', 'membership_granted_paypal', 'membership_revoked',
  'membership_checkout_started',
  'paypal_config_updated', 'paypal_webhook_received', 'paypal_webhook_rejected',
  'admin_chars_generated', 'admin_chars_init_seed',
  'admin_membership_plans_seeded',
];

const SOURCE_TYPES = [
  { value: '', label: '全部来源' },
  { value: 'audit', label: '审计日志' },
  { value: 'download', label: '下载' },
  { value: 'ai_call', label: 'AI 调用' },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AdminLogsPage() {
  const [source, setSource] = useState('');
  const [type, setType] = useState('');
  const [userId, setUserId] = useState('');
  const [ip, setIp] = useState('');
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [rows, setRows] = useState<AdminLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminLogRow | null>(null);

  const fetchPage = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await listAdminLogsRequest({
        source: source || undefined,
        type: type || undefined,
        userId: userId ? Number(userId) : undefined,
        ip: ip || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        page, pageSize,
      });
      if (!r.ok) { setErr(r.error.message); return; }
      setRows(r.data.items);
      setTotal(r.data.total);
    } finally { setBusy(false); }
  }, [source, type, userId, ip, from, to, page, pageSize]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    // fetchPage will fire via state change.
    fetchPage();
  }
  function resetFilters() {
    setSource(''); setType(''); setUserId(''); setIp('');
    setFrom(isoDate(new Date(Date.now() - 7 * 86400_000)));
    setTo(isoDate(new Date()));
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">日志</h1>

      <form onSubmit={applyFilters} className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-7 gap-2 items-end">
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">来源</label>
          <select value={source} onChange={e => setSource(e.target.value)}
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
            {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">事件</label>
          <select value={type} onChange={e => setType(e.target.value)}
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t || '全部事件'}</option>)}
          </select>
        </div>
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">用户 ID</label>
          <input value={userId} onChange={e => setUserId(e.target.value)} type="number"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">IP</label>
          <input value={ip} onChange={e => setIp(e.target.value)}
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">从</label>
          <input value={from} onChange={e => setFrom(e.target.value)} type="date"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div className="md:col-span-1">
          <label className="text-xs text-ink-soft">至</label>
          <input value={to} onChange={e => setTo(e.target.value)} type="date"
            className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
        </div>
        <div className="md:col-span-1 flex gap-2">
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
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">事件</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">元数据</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <LogRow key={r.id} entry={r as any} onClick={setSelected as any} />
            ))}
            {rows.length === 0 && !busy && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">无数据</td></tr>
            )}
            {busy && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-faint">共 {total} 条 · 第 {page} / {totalPages} 页</span>
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

      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-paper rounded-lg shadow-lg w-full max-w-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold inline-flex items-center gap-1"><Search className="h-4 w-4" />{selected.event}</h3>
              <button type="button" onClick={() => setSelected(null)} className="text-ink-faint hover:text-ink text-sm">关闭</button>
            </div>
            <div className="space-y-2 text-sm">
              <p className="rounded bg-paper-deep px-3 py-2 text-ink">
                {selected.source === 'audit'
                  ? formatLogMessage(selected.event, selected.metadata)
                  : selected.event}
              </p>
              <p><span className="text-ink-soft">来源:</span> {selected.source}</p>
              <p><span className="text-ink-soft">时间:</span> {new Date(selected.createdAt).toLocaleString('zh-CN')}</p>
              {selected.username && <p><span className="text-ink-soft">用户:</span> {selected.username}</p>}
              {selected.ip && <p><span className="text-ink-soft">IP:</span> {selected.ip}</p>}
              <div>
                <span className="text-ink-soft">元数据 (原始):</span>
                <JsonPanel data={selected.metadata} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}