'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { DataTable } from '@/components/admin/DataTable';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';

interface EmailHistoryItem {
  id: number;
  to: string;
  subject: string;
  template: string | null;
  status: 'sent' | 'failed' | 'console';
  error: string | null;
  sentAt: string;
}

const STATUS_TONE: Record<EmailHistoryItem['status'], BadgeTone> = {
  sent: 'success',
  failed: 'danger',
  console: 'warning',
};

const STATUS_LABEL: Record<EmailHistoryItem['status'], string> = {
  sent: '已发送',
  failed: '失败',
  console: '控制台',
};

export function EmailHistory() {
  const [items, setItems] = useState<EmailHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setBusy(true);
    setErr(null);
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

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  return (
    <div className="rounded-lg border border-ink/10 bg-paper-soft p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-kai text-base text-ink inline-flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" />
          发送历史 (最近 50 条)
        </h2>
        <button
          type="button"
          onClick={() => void fetchItems()}
          disabled={busy}
          className="text-xs text-ink-soft hover:text-ink disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      {items.length === 0 && !err && (
        <EmptyState
          icon={Mail}
          title="暂无发送记录"
          description="触发一次密码重置或管理员发件测试后会出现。"
          className="py-8"
        />
      )}
      {items.length > 0 && (
        <DataTable
          rows={items}
          rowKey={(it) => it.id}
          caption="邮件发送历史"
          maxHeight="medium"
          empty={null}
          columns={[
            { key: 'sentAt', header: '时间', numeric: true, mobileHide: true },
            { key: 'to', header: '收件人', mobileTitle: true },
            { key: 'subject', header: '主题' },
            { key: 'template', header: '模板', mobileHide: true },
            { key: 'status', header: '状态' },
            { key: 'error', header: '错误', mobileHide: true },
          ]}
        >
          {(it) => (
            <>
              <span className="text-xs text-ink-soft whitespace-nowrap">
                {formatDateTime(it.sentAt)}
              </span>
              <span className="text-xs font-mono break-all">{it.to}</span>
              <span className="text-xs">{it.subject}</span>
              <span className="text-xs text-ink-soft">{it.template ?? '—'}</span>
              <StatusBadge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</StatusBadge>
              <span className="text-xs text-danger max-w-[200px] truncate" title={it.error ?? ''}>
                {it.error ?? '—'}
              </span>
            </>
          )}
        </DataTable>
      )}
    </div>
  );
}
