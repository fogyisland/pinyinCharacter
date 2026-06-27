'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { renameWorksheetApi } from '@/lib/api-worksheet';

interface Props {
  id: number;
  currentTitle: string;
}

export function RenameWorksheetButton({ id, currentTitle }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentTitle);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            setErr('名字不能为空');
            return;
          }
          if (trimmed === currentTitle) {
            setEditing(false);
            setErr(null);
            return;
          }
          setBusy(true);
          setErr(null);
          try {
            await renameWorksheetApi(id, trimmed);
            setEditing(false);
            router.refresh();
          } catch (e: any) {
            if (e?.code === 'duplicate_title') {
              setErr('已存在同名字帖');
            } else {
              setErr(e?.message ?? '重命名失败');
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          autoFocus
          disabled={busy}
          className="border border-ink/20 rounded px-2 py-1 text-sm bg-paper w-40"
        />
        <button type="submit" disabled={busy} className="p-1 text-green-700 hover:bg-paper-deep rounded">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button type="button" disabled={busy}
          onClick={() => { setEditing(false); setValue(currentTitle); setErr(null); }}
          className="p-1 text-ink-faint hover:bg-paper-deep rounded">
          <X className="h-3.5 w-3.5" />
        </button>
        {err && <span className="text-xs text-seal ml-1">{err}</span>}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="p-1.5 text-ink-soft hover:text-ink hover:bg-paper-deep rounded"
      title="重命名"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}