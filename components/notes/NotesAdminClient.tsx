'use client';
import { useState } from 'react';

export interface AdminNoteRow {
  id: number;
  authorName: string;
  authorEmail: string | null;
  content: string;
  createdAt: string;       // ISO
  deletedAt: string | null; // ISO or null
}

interface NotesAdminClientProps { initial: AdminNoteRow[]; }

export function NotesAdminClient({ initial }: NotesAdminClientProps) {
  const [notes, setNotes] = useState<AdminNoteRow[]>(initial);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: number) {
    if (!confirm(`确认删除留言 #${id}?该留言将从公共列表中移除,但审计日志里仍可查看。`)) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? '删除失败');
        return;
      }
      setNotes((cur) =>
        cur.map((n) => (n.id === id ? { ...n, deletedAt: new Date().toISOString() } : n))
      );
    } catch {
      setError('网络错误');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2">#</th>
            <th>作者</th>
            <th>时间</th>
            <th>内容</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {notes.length === 0 && (
            <tr><td colSpan={6} className="py-4 text-center text-gray-500">暂无留言</td></tr>
          )}
          {notes.map((n) => (
            <tr key={n.id} className="border-b align-top">
              <td className="py-2 pr-2">{n.id}</td>
              <td className="pr-2">{n.authorName}{n.authorEmail && <span className="text-gray-500"> &lt;{n.authorEmail}&gt;</span>}</td>
              <td className="pr-2 whitespace-nowrap">{fmtTime(n.createdAt)}</td>
              <td className="pr-2">
                <div className="max-w-md whitespace-pre-wrap break-words">{n.content}</div>
              </td>
              <td className="pr-2">{n.deletedAt ? <span className="text-red-600">已删除 {fmtTime(n.deletedAt)}</span> : <span className="text-green-700">活跃</span>}</td>
              <td>
                {!n.deletedAt && (
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    disabled={pendingId === n.id}
                    className="px-2 py-1 text-xs border rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50">
                    {pendingId === n.id ? '删除中…' : '删除'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}