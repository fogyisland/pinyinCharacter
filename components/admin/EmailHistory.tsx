'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mail, RefreshCw } from 'lucide-react';

interface EmailHistoryItem {
  id: number;
  to: string;
  subject: string;
  template: string | null;
  status: 'sent' | 'failed' | 'console';
  error: string | null;
  sentAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  console: 'bg-yellow-100 text-yellow-800',
};

export function EmailHistory() {
  const [items, setItems] = useState<EmailHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/admin/email/history?limit=50');
      const j = await r.json();
      if (j?.ok) setItems(j.data.items);
      else setErr(j?.error?.message ?? '加载失败');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  return (
    <div className="card-paper rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-soft inline-flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" />发送历史 (最近 50 条)
        </h2>
        <button type="button" onClick={() => void fetchItems()} disabled={busy}
          className="text-xs text-ink-soft hover:text-ink disabled:opacity-50 inline-flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />刷新
        </button>
      </div>
      {err && <p className="text-xs text-seal">{err}</p>}
      {items.length === 0 && !err && (
        <p className="text-xs text-ink-faint">暂无发送记录 — 触发一次密码重置或管理员发件测试后会出现。</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep text-left text-xs">
              <tr>
                <th className="px-2 py-1">时间</th>
                <th className="px-2 py-1">收件人</th>
                <th className="px-2 py-1">主题</th>
                <th className="px-2 py-1">模板</th>
                <th className="px-2 py-1">状态</th>
                <th className="px-2 py-1">错误</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-t">
                  <td className="px-2 py-1 text-xs text-ink-soft whitespace-nowrap">{new Date(it.sentAt).toLocaleString('zh-CN')}</td>
                  <td className="px-2 py-1 text-xs font-mono">{it.to}</td>
                  <td className="px-2 py-1 text-xs">{it.subject}</td>
                  <td className="px-2 py-1 text-xs text-ink-soft">{it.template ?? '—'}</td>
                  <td className="px-2 py-1 text-xs">
                    <span className={`inline-block px-1.5 py-0.5 rounded ${STATUS_COLORS[it.status] ?? 'bg-paper-deep'}`}>{it.status}</span>
                  </td>
                  <td className="px-2 py-1 text-xs text-seal max-w-[200px] truncate" title={it.error ?? ''}>
                    {it.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}