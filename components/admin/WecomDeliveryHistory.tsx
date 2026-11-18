'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { WECOM_CATEGORY_LABELS, isWecomCategory } from '@/lib/wecom-types';
import { Panel } from '@/components/admin/Panel';
import { AdminButton } from '@/components/admin/AdminButton';
import { LoadingState } from '@/components/admin/LoadingState';

/** One row of the delivery history, as the admin API returns it. */
interface DeliveryRow {
  id: number;
  webhook_id: number;
  name: string | null;
  category: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | Date | null;
  sent_at: string | Date | null;
  created_at: string | Date | null;
}

/** The Chinese name of a status, for the table. */
const STATUS_LABELS: Record<string, string> = {
  pending: '待推',
  sent: '已发送',
  failed: '失败',
};

/** The Chinese name of a category — unknown categories show their raw key. */
function categoryLabel(category: string): string {
  return isWecomCategory(category) ? WECOM_CATEGORY_LABELS[category] : category;
}

/** A date from the API, formatted for the table. */
function formatTime(value: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function WecomDeliveryHistory() {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/wecom/deliveries?limit=50');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '加载失败');
      setRows(j.data.deliveries as DeliveryRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(row: DeliveryRow) {
    setBusyId(row.id);
    try {
      const res = await fetch('/api/admin/wecom/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? '重推失败');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重推失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      title="转发记录"
      description="最近 50 条。每分钟推送一次，失败的会自己重试。"
      actions={
        <AdminButton
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => void load()}
        >
          刷新
        </AdminButton>
      }
    >
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      {rows === null && !error && <LoadingState variant="inline" label="正在读取记录…" />}
      {rows !== null && rows.length === 0 && (
        <p className="text-xs text-ink-faint">还没有转发记录 — 发一条通知试试。</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-ink-faint border-b border-ink/15">
                <th className="text-left py-1.5 pr-3 font-normal">时间</th>
                <th className="text-left py-1.5 pr-3 font-normal">群</th>
                <th className="text-left py-1.5 pr-3 font-normal">类别</th>
                <th className="text-left py-1.5 pr-3 font-normal">标题</th>
                <th className="text-left py-1.5 pr-3 font-normal">状态</th>
                <th className="text-left py-1.5 pr-3 font-normal">尝试</th>
                <th className="text-left py-1.5 pr-3 font-normal">错误</th>
                <th className="text-left py-1.5 font-normal" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink/8 align-top">
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                    {formatTime(row.created_at)}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{row.name ?? `#${row.webhook_id}`}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{categoryLabel(row.category)}</td>
                  <td className="py-1.5 pr-3 break-all">{row.subject}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span
                      className={
                        row.status === 'sent'
                          ? 'text-success'
                          : row.status === 'failed'
                            ? 'text-danger'
                            : 'text-ink-soft'
                      }
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono">{row.attempts}</td>
                  <td className="py-1.5 pr-3 break-all text-danger">
                    {row.last_error ?? '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    <AdminButton
                      size="sm"
                      variant="ghost"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      disabled={busyId !== null}
                      onClick={() => void retry(row)}
                    >
                      {busyId === row.id ? '重推中…' : '重推'}
                    </AdminButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
