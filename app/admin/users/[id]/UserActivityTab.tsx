'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { JsonPanel } from '@/components/admin/JsonPanel';
import { getUserActivityRequest } from '@/lib/api-admin';
import { formatDateTime } from '@/lib/format';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { LoadingState } from '@/components/admin/LoadingState';
import { SourceBadge } from '@/components/admin/SourceBadge';
import { AdminButton } from '@/components/admin/AdminButton';
import { History } from 'lucide-react';
import type { UnifiedLogEntry } from '@/lib/admin-logs-types';

const PAGE_SIZE = 50;

export function UserActivityTab({ userId }: { userId: number }) {
  const [items, setItems] = useState<UnifiedLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [selected, setSelected] = useState<UnifiedLogEntry | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchPage = useCallback(
    async (after: string | undefined, append: boolean) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await getUserActivityRequest(userId, after);
        if (!r.ok) {
          setErr(r.error.message);
          return;
        }
        const newItems = r.data.items;
        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        if (newItems.length < PAGE_SIZE) setExhausted(true);
        setLoaded(true);
      } catch (error) {
        console.error('Failed to load the activity log', error);
        setErr(error instanceof Error ? error.message : '加载失败');
        setLoaded(true);
      } finally {
        setBusy(false);
      }
    },
    [userId],
  );

  // Initial load: fetch page 1. This used to run in the render body, which
  // fired the request again on every re-render until the response had
  // arrived — the tab sent the same request several times.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void fetchPage(undefined, false);
  }, [fetchPage]);

  function loadMore() {
    if (items.length === 0) return;
    const last = items[items.length - 1].createdAt;
    void fetchPage(last, true);
  }

  return (
    <div className="space-y-3">
      {err && (
        <p className="text-sm text-danger rounded border border-danger/30 bg-danger/8 px-3 py-2">
          {err}
        </p>
      )}

      <DataTable
        rows={items}
        rowKey={(it) => it.id}
        caption="用户活动记录"
        maxHeight="medium"
        empty={
          loaded ? (
            <EmptyState
              icon={History}
              title="暂无活动记录"
              description="这位用户还没有留下任何日志。"
              className="py-8"
            />
          ) : (
            <LoadingState label="正在读取活动记录…" className="py-8" />
          )
        }
        columns={[
          { key: 'createdAt', header: '时间', numeric: true, mobileHide: true },
          { key: 'source', header: '来源' },
          { key: 'event', header: '事件', mobileTitle: true },
          { key: 'user', header: '用户', mobileHide: true },
          { key: 'ip', header: 'IP', mobileHide: true },
        ]}
      >
        {(it) => (
          <>
            <span className="text-xs text-ink-soft whitespace-nowrap">
              {formatDateTime(it.createdAt)}
            </span>
            <SourceBadge source={it.source} />
            <button
              type="button"
              onClick={() => setSelected(it)}
              className="text-left text-seal hover:underline"
              title="查看完整元数据"
            >
              {it.event}
            </button>
            {it.username ? (
              <span className="text-sm">{it.username}</span>
            ) : (
              <span className="text-ink-faint">—</span>
            )}
            <span className="text-xs font-mono text-ink-soft">{it.ip ?? '—'}</span>
          </>
        )}
      </DataTable>

      <div className="flex items-center justify-between">
        <AdminButton
          onClick={loadMore}
          disabled={busy || exhausted || items.length === 0}
          variant="secondary"
          size="sm"
        >
          {exhausted ? '已加载全部' : busy ? '加载中…' : '加载更多'}
        </AdminButton>
        <span className="text-xs text-ink-faint">共 {items.length} 条</span>
      </div>

      {selected && (
        <div
          className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-paper-soft rounded-lg shadow-paper-lg w-full max-w-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-kai text-base text-ink">{selected.event}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-ink-faint hover:text-ink text-sm"
              >
                关闭
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-ink-soft">来源:</span> {selected.source}
              </p>
              <p>
                <span className="text-ink-soft">时间:</span>{' '}
                {formatDateTime(selected.createdAt)}
              </p>
              {selected.username && (
                <p>
                  <span className="text-ink-soft">用户:</span> {selected.username}
                </p>
              )}
              {selected.ip && (
                <p>
                  <span className="text-ink-soft">IP:</span> {selected.ip}
                </p>
              )}
              <div>
                <span className="text-ink-soft">元数据:</span>
                <JsonPanel data={selected.metadata} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
