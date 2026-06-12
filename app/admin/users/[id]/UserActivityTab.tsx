'use client';

import { useState, useCallback } from 'react';
import { LogRow } from '@/components/admin/LogRow';
import { JsonPanel } from '@/components/admin/JsonPanel';
import { getUserActivityRequest, type UserActivityItem } from '@/lib/api-admin';

const PAGE_SIZE = 50;

export function UserActivityTab({ userId }: { userId: number }) {
  const [items, setItems] = useState<UserActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [selected, setSelected] = useState<UserActivityItem | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchPage = useCallback(async (after: string | undefined, append: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await getUserActivityRequest(userId, after);
      if (!r.ok) { setErr(r.error.message); return; }
      const newItems = r.data.items;
      setItems(prev => append ? [...prev, ...newItems] : newItems);
      if (newItems.length < PAGE_SIZE) setExhausted(true);
      setLoaded(true);
    } finally { setBusy(false); }
  }, [userId]);

  // Initial load: fetch page 1.
  if (!loaded && !busy && items.length === 0) {
    fetchPage(undefined, false);
  }

  function loadMore() {
    if (items.length === 0) return;
    const last = items[items.length - 1].createdAt;
    fetchPage(last, true);
  }

  return (
    <div className="space-y-3">
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
            {items.map(it => (
              <LogRow key={it.id} entry={it as any} onClick={setSelected as any} />
            ))}
            {loaded && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">暂无活动记录</td></tr>
            )}
            {!loaded && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">加载中…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={loadMore} disabled={busy || exhausted}
          className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep disabled:opacity-50">
          {exhausted ? '已加载全部' : busy ? '加载中…' : '加载更多'}
        </button>
        <span className="text-xs text-ink-faint">共 {items.length} 条</span>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-paper rounded-lg shadow-lg w-full max-w-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold">{selected.event}</h3>
              <button type="button" onClick={() => setSelected(null)} className="text-ink-faint hover:text-ink text-sm">关闭</button>
            </div>
            <div className="space-y-2 text-sm">
              <p><span className="text-ink-soft">来源:</span> {selected.source}</p>
              <p><span className="text-ink-soft">时间:</span> {new Date(selected.createdAt).toLocaleString('zh-CN')}</p>
              {selected.username && <p><span className="text-ink-soft">用户:</span> {selected.username}</p>}
              {selected.ip && <p><span className="text-ink-soft">IP:</span> {selected.ip}</p>}
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