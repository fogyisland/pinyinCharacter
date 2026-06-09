'use client';

import { useState } from 'react';
import type { HistoryRow } from '@/lib/api-history';
import { setFavoriteRequest, deleteHistoryRequest } from '@/lib/api-history';

function timeAgo(iso: string | Date): string {
  const t = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function HistoryList({ rows: initial }: { rows: HistoryRow[] }) {
  const [rows, setRows] = useState(initial);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">还没有记录，先去试试上面的工具。</p>;
  }

  async function toggleFav(id: number, current: 0 | 1) {
    const newVal = current === 1 ? false : true;
    // 乐观更新
    setRows(rs => rs.map(r => r.id === id ? { ...r, is_favorite: newVal ? 1 : 0 } : r));
    const r = await setFavoriteRequest(id, newVal);
    if (!r.ok) {
      // 回滚
      setRows(rs => rs.map(rr => rr.id === id ? { ...rr, is_favorite: current } : rr));
    }
  }

  async function del(id: number) {
    setRows(rs => rs.filter(r => r.id !== id));
    const r = await deleteHistoryRequest(id);
    if (!r.ok) {
      // 失败就重 fetch
      window.location.reload();
    }
  }

  return (
    <ul className="divide-y">
      {rows.map(r => (
        <li key={r.id} className="py-3 flex items-center gap-3">
          <span className="text-xs text-gray-500 w-16 shrink-0">{r.kind === 'text2pinyin' ? '字→拼' : '拼→字'}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm">{r.input}</div>
            {r.output && <div className="truncate text-xs text-gray-500">→ {r.output}</div>}
          </div>
          <span className="text-xs text-gray-500 shrink-0">{r.char_count} 字</span>
          <span className="text-xs text-gray-400 shrink-0 w-16 text-right">{timeAgo(r.created_at)}</span>
          <button
            type="button"
            onClick={() => toggleFav(r.id, r.is_favorite)}
            className={`text-lg shrink-0 ${r.is_favorite ? 'text-yellow-500' : 'text-gray-300 hover:text-gray-400'}`}
            aria-label={r.is_favorite ? '取消收藏' : '收藏'}
            title={r.is_favorite ? '取消收藏' : '收藏'}
          >★</button>
          <button
            type="button"
            onClick={() => del(r.id)}
            className="text-gray-400 hover:text-red-500 shrink-0"
            aria-label="删除"
            title="删除"
          >🗑</button>
        </li>
      ))}
    </ul>
  );
}
