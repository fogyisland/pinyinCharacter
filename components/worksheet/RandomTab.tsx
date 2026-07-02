'use client';

import { useEffect, useState } from 'react';
import type { PaperSize } from '@/lib/worksheet-types';
import { cellsPerPage, paperSizeLabel } from '@/lib/worksheet-types';

interface RandomChar {
  char: string;
  pinyin: string;
  meaningZh: string | null;
}

interface Props {
  title: string;
  onTitleChange: (v: string) => void;
  onPicked: (chars: string[]) => void;
  /** Drives the auto-derived 字数 from cellsPerPage(paperSize) — no manual input. */
  paperSize: PaperSize;
  /** When true, the action button relabels to 重新生成 to indicate it'll
   *  replace existing content. Defaults to false (label is 随机生成). */
  hasContent?: boolean;
}

const DIFFICULTY_LABELS = {
  easy: '简单 (level 1 常用字)',
  medium: '中等 (level 1+2)',
  hard: '困难 (level 1+2+3 全字库)',
} as const;

export function RandomTab({ title, onTitleChange, onPicked, paperSize, hasContent = false }: Props) {
  // 字数 is fully derived from the selected paper size — no manual input,
  // no 100-char cap (A3 = 168, A4 = 88, B5 = 48, brush-12/24/28 = 12/24/28).
  const count = cellsPerPage(paperSize);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
  }, [title]);

  async function handleGenerate() {
    if (title.trim() === '') {
      setErr('请先填写字帖标题');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/chars/random?count=${count}&difficulty=${difficulty}`);
      const j = await res.json();
      if (!j.ok) { setErr(j.error?.message ?? '生成失败'); return; }
      const chars = (j.data.chars as RandomChar[]).map(c => c.char);
      onPicked(chars);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">从字库随机抽字,自动填入字帖。</p>
      <div>
        <label className="text-sm font-medium text-ink-soft">
          标题 <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => onTitleChange(e.target.value.slice(0, 80))}
          maxLength={80}
          placeholder="给字帖起个名字..."
          className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-ink-soft">字数 (随纸张自动)</label>
          <p className="mt-1 w-full rounded-md border border-ink/10 bg-paper-deep/40 px-3 py-2 text-sm text-ink">
            <span className="font-medium tabular-nums">{count}</span>
            <span className="ml-2 text-xs text-ink-faint">字 / {paperSizeLabel(paperSize)}</span>
          </p>
        </div>
        <div>
          <label className="text-sm font-medium text-ink-soft">难度</label>
          <select
            value={difficulty} onChange={e => setDifficulty(e.target.value as any)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          >
            {(['easy', 'medium', 'hard'] as const).map(d => (
              <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="button" onClick={handleGenerate} disabled={busy}
        className="rounded-md bg-ink px-4 py-2 text-paper-soft hover:bg-ink/80 disabled:opacity-50"
      >
        {busy ? '抽字中…' : (hasContent ? '重新生成' : '随机生成')}
      </button>
    </div>
  );
}
