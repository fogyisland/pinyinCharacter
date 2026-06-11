'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteWorksheetApi } from '@/lib/api-worksheet';

export function DeleteWorksheetButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (!confirm('确定要删除这张字帖吗?')) return;
    setBusy(true);
    try {
      await deleteWorksheetApi(id);
      router.push('/worksheet/history');
    } catch {
      alert('删除失败');
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-red-300 px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? '删除中...' : '删除'}
    </button>
  );
}
