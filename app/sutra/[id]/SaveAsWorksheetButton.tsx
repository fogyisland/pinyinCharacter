'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import type { SutraChunk } from '@/lib/sutra-types';

interface Props {
  id: number;
  title: string;
  chunk: SutraChunk;
}

export function SaveAsWorksheetButton({ id, title, chunk }: Props) {
  const router = useRouter();
  const user = useAppStore(s => s.user);
  const setAuthOpen = useAppStore(s => s.setAuthOpen);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user) {
      setHint('需要登录才能保存');
      setAuthOpen(true);
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      // chunk.content paragraphs are joined with '\n'; the API validator
      // rejects non-CJK chars, so filter to SINGLE_CJK (CJK ideographs +
      // CJK punctuation + fullwidth) before sending.
      const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;
      const chars = Array.from(chunk.content.join('')).filter(ch => SINGLE_CJK.test(ch));
      // Schema max=500 chars per worksheet. Split long sutra chunks into
      // multiple worksheets titled "《XXX》Y (1/3)" etc, so users can save
      // the whole chunk instead of getting 400 "Invalid input".
      const SLICE = 500;
      const slices: string[][] = [];
      for (let i = 0; i < chars.length; i += SLICE) {
        slices.push(chars.slice(i, i + SLICE));
      }
      const baseTitle = `《${title}》${chunk.label}`;
      const fullTitle = slices.length > 1 ? `${baseTitle} (1/${slices.length})` : baseTitle;
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fullTitle,
          content: slices[0],
          cellStyle: 'brush',
        }),
      });
      const data = await res.json();
      if (res.status === 401 || data.error?.code === 'unauthenticated') {
        setHint('需要登录才能保存');
        setAuthOpen(true);
        return;
      }
      if (!data.ok) {
        setHint(data.error?.message ?? '保存失败');
        return;
      }
      // Save remaining slices sequentially in the background
      const firstId = data.data.id as number;
      for (let i = 1; i < slices.length; i++) {
        await fetch('/api/worksheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${baseTitle} (${i + 1}/${slices.length})`,
            content: slices[i],
            cellStyle: 'brush',
          }),
        });
      }
      router.push(`/worksheet/${firstId}`);
    } catch (err) {
      setHint((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-seal px-5 py-2 text-white hover:bg-seal/80 disabled:bg-seal/40 disabled:cursor-not-allowed"
      >
        {saving ? '保存中…' : '保存到字帖'}
      </button>
      {hint && !user && (
        <span className="text-xs text-ink-soft">{hint}</span>
      )}
    </div>
  );
}
