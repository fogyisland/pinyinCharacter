'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';

interface Props {
  /** The book's title, e.g. 《论语》. */
  title: string;
  /** The chapter label, e.g. 学而第一. */
  chapterLabel: string;
  /** The chapter's text, one string per line. */
  content: string[];
}

/**
 * CJK ideographs, CJK punctuation and fullwidth forms.
 *
 * The worksheet API rejects anything outside this set, so the chapter text
 * has to be filtered before it is sent — a classic chapter carries all
 * sorts of punctuation and the occasional editorial bracket.
 */
const SINGLE_CJK = /^[㐀-鿿　-〿＀-￯]$/;

/** The API's cap on the characters of one worksheet. */
const SLICE = 500;

/**
 * Saves the current chapter as a worksheet.
 *
 * The classics are the longest text on the site — a chapter can run to
 * hundreds of lines — so the text is split into as many worksheets as it
 * needs. The first one is opened; the rest are saved behind it.
 */
export function SaveAsWorksheetButton({ title, chapterLabel, content }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const goLogin = () => router.push(`/login?next=${encodeURIComponent(pathname)}`);

  const handleSave = async () => {
    if (!user) {
      setHint('需要登录才能保存');
      goLogin();
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const chars = Array.from(content.join('')).filter((ch) => SINGLE_CJK.test(ch));
      if (chars.length === 0) {
        setHint('这一章没有可练习的汉字');
        return;
      }
      const slices: string[][] = [];
      for (let i = 0; i < chars.length; i += SLICE) {
        slices.push(chars.slice(i, i + SLICE));
      }
      const baseTitle = `《${title}》${chapterLabel}`;
      const firstTitle =
        slices.length > 1 ? `${baseTitle} (1/${slices.length})` : baseTitle;

      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: firstTitle,
          content: slices[0],
          cellStyle: 'brush-cross',
        }),
      });
      const data = await res.json();
      if (res.status === 401 || data.error?.code === 'unauthenticated') {
        setHint('需要登录才能保存');
        goLogin();
        return;
      }
      if (!data.ok) {
        setHint(data.error?.message ?? '保存失败');
        return;
      }
      const firstId = data.data.id as number;
      // The remaining slices are saved one after another. A failure here is
      // not fatal to the first worksheet — it is already saved and the
      // reader is taken to it — so the error is reported, not thrown.
      for (let i = 1; i < slices.length; i++) {
        try {
          await fetch('/api/worksheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `${baseTitle} (${i + 1}/${slices.length})`,
              content: slices[i],
              cellStyle: 'brush-cross',
            }),
          });
        } catch (err) {
          setHint(`第 ${i + 1} 份保存失败：${(err as Error).message}`);
        }
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
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </div>
  );
}
