'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The delete button of one note row.
 *
 * The note list itself is rendered on the server and paginated there — the
 * page used to serialise 200 full notes (each one carrying its complete
 * body) into the client bundle and render all of them in the browser. Only
 * this button is a client island; after a successful delete it asks the
 * server for a fresh render, so the row updates with the rest of the list.
 */
export function NoteDeleteButton({ noteId }: { noteId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `确认删除留言 #${noteId}?该留言将从公共列表中移除,但审计日志里仍可查看。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notes/${noteId}`, { method: 'DELETE' });
      if (res.status === 401) {
        setError('请重新登录');
        return;
      }
      if (res.status >= 500) {
        setError('服务器错误,请稍后重试');
        return;
      }
      const body = await res
        .json()
        .catch(() => ({}) as { ok?: boolean; error?: { message?: string } });
      if (!body.ok) {
        setError(body.error?.message ?? '删除失败');
        return;
      }
      router.refresh();
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="px-2 py-1 text-xs border rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {busy ? '删除中…' : '删除'}
      </button>
      {error && (
        <p className="text-red-600 text-xs mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
