'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { X, FilePlus2, FolderOpen, Loader2, Check } from 'lucide-react';
import { listWorksheetsLightweight, appendCharToWorksheetApi, type WorksheetSummary } from '@/lib/api-worksheet';

interface Props {
  open: boolean;
  char: string;
  onClose: () => void;
  /** Called when the append succeeds so the parent can refresh its state. */
  onAdded?: (result: { worksheetId: number; title: string; added: boolean; created: boolean }) => void;
}

type Mode = 'existing' | 'new';

export function AddToWorksheetDialog({ open, char, onClose, onAdded }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<WorksheetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('existing');
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setSuccess(null);
    setSelectedId('');
    setNewTitle('');
    setLoading(true);
    listWorksheetsLightweight()
      .then((rows) => {
        setItems(rows);
        if (rows.length > 0) {
          setMode('existing');
          setSelectedId(rows[0].id);
        } else {
          setMode('new');
        }
      })
      .catch((e: any) => {
        if (e?.code === 'unauthorized') {
          router.push(`/login?next=${encodeURIComponent(pathname)}`);
          onClose();
          return;
        }
        setErr(e?.message ?? '加载字帖列表失败');
      })
      .finally(() => setLoading(false));
  }, [open, router, pathname, onClose]);

  if (!open) return null;

  async function go() {
    setErr(null);
    setSuccess(null);
    if (mode === 'existing' && !selectedId) {
      setErr('请选择一个字帖');
      return;
    }
    if (mode === 'new' && newTitle.trim().length === 0) {
      setErr('请输入字帖名称');
      return;
    }
    setBusy(true);
    try {
      const result = await appendCharToWorksheetApi({
        char,
        worksheetId: mode === 'existing' ? Number(selectedId) : undefined,
        newTitle: mode === 'new' ? newTitle.trim() : undefined,
      });
      const msg = result.added
        ? `已添加到「${result.title}」`
        : `「${char}」已在「${result.title}」中`;
      setSuccess(msg);
      onAdded?.(result);
      setTimeout(onClose, 700);
    } catch (e: any) {
      if (e?.code === 'unauthorized') {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        onClose();
        return;
      }
      if (e?.code === 'duplicate_title') {
        setErr('已存在同名字帖，请换一个名字');
      } else {
        setErr(e?.message ?? '添加失败');
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && (mode === 'new' ? newTitle.trim().length > 0 : !!selectedId);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-lg w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-semibold">添加「{char}」到字帖</h3>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {err && <p className="text-sm text-seal mb-2">{err}</p>}
        {success && (
          <p className="text-sm text-green-700 mb-2 inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />{success}
          </p>
        )}

        {loading ? (
          <div className="text-sm text-ink-soft py-6 text-center inline-flex items-center gap-2 justify-center w-full">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="add-mode"
                value="existing"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
                disabled={items.length === 0}
              />
              <span className="inline-flex items-center gap-1">
                <FolderOpen className="h-3.5 w-3.5" /> 添加到已有字帖
              </span>
            </label>
            {mode === 'existing' && items.length > 0 && (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
                className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.title} ({it.charCount} 字)
                  </option>
                ))}
              </select>
            )}
            {items.length === 0 && mode === 'existing' && (
              <p className="text-xs text-ink-faint ml-6">还没有字帖，请先新建一个</p>
            )}

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="add-mode"
                value="new"
                checked={mode === 'new'}
                onChange={() => setMode('new')}
              />
              <span className="inline-flex items-center gap-1">
                <FilePlus2 className="h-3.5 w-3.5" /> 新建字帖
              </span>
            </label>
            {mode === 'new' && (
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例如：我的字帖 / 佛经·心经"
                maxLength={80}
                className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
              />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-1.5 text-sm border rounded hover:bg-paper-deep">取消</button>
          <button type="button" onClick={go} disabled={!canSubmit}
            className="px-3 py-1.5 text-sm text-white bg-seal rounded hover:bg-seal/80 disabled:opacity-50">
            {busy ? '添加中…' : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}