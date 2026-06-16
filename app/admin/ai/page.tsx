'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot, AlertTriangle, ChevronLeft, ChevronRight, Filter, Check } from 'lucide-react';
import { StatCard } from '@/components/admin/StatCard';
import { JsonPanel } from '@/components/admin/JsonPanel';
import {
  listAiCallsRequest, getAiStatsRequest,
  getAiConfigRequest, updateAiConfigRequest,
  type AdminAiCallRow,
} from '@/lib/api-admin';

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
  'rate-limited': 'bg-yellow-100 text-yellow-800',
};
function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[status] ?? 'bg-paper-deep text-ink-soft'}`}>{status}</span>;
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ok', label: 'ok' },
  { value: 'error', label: 'error' },
  { value: 'rate-limited', label: 'rate-limited' },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function truncate(s: string | null, n = 100): string {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

type Tab = 'calls' | 'config';

export default function AdminAiPage() {
  const [tab, setTab] = useState<Tab>('calls');

  // --- Calls tab state ---
  const [feature, setFeature] = useState('');
  const [status, setStatus] = useState('');
  const [userQ, setUserQ] = useState('');
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [rows, setRows] = useState<AdminAiCallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedErr, setExpandedErr] = useState<string | null>(null);

  const [stats, setStats] = useState<{ total: number; errorRate: number; p95Duration: number | null } | null>(null);

  const fetchCalls = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await listAiCallsRequest({
        feature: feature || undefined,
        status: status || undefined,
        userId: /^\d+$/.test(userQ) ? Number(userQ) : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        page, pageSize,
      });
      if (!r.ok) { setErr(r.error.message); return; }
      setRows(r.data.rows);
      setTotal(r.data.total);
    } finally { setBusy(false); }
  }, [feature, status, userQ, from, to, page, pageSize]);

  const fetchStats = useCallback(async () => {
    const r = await getAiStatsRequest(7);
    if (!r.ok) return;
    const s = r.data as any;
    setStats({
      total: Number(s.total ?? 0),
      errorRate: Number(s.errorRate ?? 0),
      p95Duration: s.p95Duration ?? null,
    });
  }, []);

  useEffect(() => { if (tab === 'calls') { fetchCalls(); fetchStats(); } }, [tab, fetchCalls, fetchStats]);

  function applyCallFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchCalls();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // --- Config tab state ---
  const [config, setConfig] = useState<Record<string, string>>({});
  const [hasApiKey, setHasApiKey] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'config') return;
    setConfigMsg(null); setConfigErr(null);
    getAiConfigRequest().then(r => {
      if (!r.ok) setConfigErr(r.error.message);
      else { setConfig(r.data.config); setHasApiKey(r.data.hasApiKey); }
    });
  }, [tab]);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setConfigBusy(true); setConfigMsg(null); setConfigErr(null);
    // Skip empty fields so admin doesn't accidentally clear a configured secret
    // (ai.api_key is masked to '' in GET, would otherwise overwrite on save).
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(config)) {
      if (v !== '') body[k] = v;
    }
    if (Object.keys(body).length === 0) {
      setConfigMsg('未修改任何字段');
      setConfigBusy(false);
      return;
    }
    const r = await updateAiConfigRequest(body);
    setConfigBusy(false);
    if (!r.ok) setConfigErr(r.error.message);
    else { setConfig(r.data.config); setHasApiKey(r.data.hasApiKey); setConfigMsg('配置已保存'); }
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm border-b-2 -mb-px ${
      active ? 'border-ink text-ink font-semibold' : 'border-transparent text-ink-soft hover:text-ink'
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">AI</h1>

      <div className="flex border-b border-paper-warm">
        <button type="button" onClick={() => setTab('calls')} className={tabClass(tab === 'calls')}>调用记录</button>
        <button type="button" onClick={() => setTab('config')} className={tabClass(tab === 'config')}>配置</button>
      </div>

      {tab === 'calls' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label="调用总数 (7d)" value={stats?.total ?? '—'} icon={Bot} />
            <StatCard label="错误率 (7d)" value={stats ? `${(stats.errorRate * 100).toFixed(1)}%` : '—'} icon={AlertTriangle} />
            <StatCard label="P95 延迟 (7d)" value={stats?.p95Duration != null ? `${stats.p95Duration} ms` : '—'} icon={Bot} />
          </div>

          <form onSubmit={applyCallFilters} className="card-paper rounded-lg p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div>
              <label className="text-xs text-ink-soft">功能</label>
              <input value={feature} onChange={e => setFeature(e.target.value)}
                className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" placeholder="如 rare-char-story" />
            </div>
            <div>
              <label className="text-xs text-ink-soft">状态</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
            <button type="submit" disabled={busy}
              className="text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50 inline-flex items-center justify-center gap-1">
              <Filter className="h-3.5 w-3.5" />筛选
            </button>
          </form>

          {err && <p className="text-sm text-seal">{err}</p>}

          <div className="card-paper rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep text-left">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">功能</th>
                  <th className="px-3 py-2">模型</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">耗时</th>
                  <th className="px-3 py-2">错误</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                    <td className="px-3 py-2">
                      {r.username
                        ? <a href={`/admin/users/${r.userId}`} className="text-seal hover:underline">{r.username}</a>
                        : <span className="text-ink-faint">#{r.userId}</span>}
                    </td>
                    <td className="px-3 py-2">{r.feature}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{r.model ?? '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-xs">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</td>
                    <td className="px-3 py-2 text-xs max-w-md">
                      {r.error
                        ? <>
                            <span className="text-seal">{truncate(r.error, 100)}</span>
                            {r.error.length > 100 && (
                              <button type="button" onClick={() => setExpandedErr(expandedErr === String(r.id) ? null : String(r.id))}
                                className="ml-2 text-seal hover:underline">
                                {expandedErr === String(r.id) ? '收起' : '展开'}
                              </button>
                            )}
                            {expandedErr === String(r.id) && (
                              <div className="mt-1"><JsonPanel data={r.error} /></div>
                            )}
                          </>
                        : '—'}
                    </td>
                  </tr>
                ))}
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
        </div>
      )}

      {tab === 'config' && (
        <form onSubmit={saveConfig} className="card-paper rounded-lg p-4 space-y-3 max-w-xl">
          {configErr && <p className="text-sm text-seal">{configErr}</p>}
          {configMsg && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{configMsg}</p>}

          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-ink">AI 连接配置</h2>
            <p className="text-xs text-ink-soft">写入 <code>app_config</code> 表,优先级高于环境变量 <code>LLM_API_KEY</code> / <code>LLM_BASE_URL</code> / <code>LLM_MODEL</code>。</p>
          </div>
          <ConfigField label="端点 URL (Base URL)" hint="OpenAI 兼容 API 根地址" placeholder="https://api.openai.com/v1"
            value={config['ai.base_url'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.base_url': v }))} />
          <ConfigField label="连接 KEY (API Key)" hint={hasApiKey ? '已配置,留空不改' : '尚未配置'}
            type="password" value={config['ai.api_key'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.api_key': v }))} />
          <ConfigField label="模型" hint="模型标识,如 gpt-4o-mini" placeholder="gpt-4o-mini"
            value={config['ai.model'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.model': v }))} />

          <div className="pt-2 space-y-1">
            <h2 className="text-sm font-semibold text-ink">AI 运行参数</h2>
            <p className="text-xs text-ink-soft">LLM 调用层面的限速/超时/采样。</p>
          </div>
          <ConfigField label="限速 (次/用户/日)" placeholder="20"
            value={config['ai.rate_limit_per_user_per_day'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.rate_limit_per_user_per_day': v }))} />
          <ConfigField label="超时 (毫秒)" placeholder="30000"
            value={config['ai.timeout_ms'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.timeout_ms': v }))} />
          <ConfigField label="温度" placeholder="0.3"
            value={config['ai.temperature'] ?? ''}
            onChange={v => setConfig(c => ({ ...c, 'ai.temperature': v }))} />

          <button type="submit" disabled={configBusy}
            className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
            {configBusy ? '保存中…' : '保存'}
          </button>
        </form>
      )}
    </div>
  );
}

function ConfigField({
  label, hint, value, onChange, type = 'text', placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium">
        {label}
        {hint && <span className="ml-2 text-xs text-ink-soft">{hint}</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
      />
    </div>
  );
}