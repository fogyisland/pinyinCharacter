'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { CellStyle, PaperSize, FontFamily } from '@/lib/worksheet-types';
import { defaultFontFor, isBrushSize, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import { useAppStore } from '@/lib/store';
import { TextInputTab } from './TextInputTab';
import { LibrarySelectTab } from './LibrarySelectTab';
import { RandomTab } from './RandomTab';
import { StylePicker } from './StylePicker';
import { PaperSizePicker } from './PaperSizePicker';
import { FontFamilyPicker } from './FontFamilyPicker';
import { WorksheetPreview } from './WorksheetPreview';

type Tab = 'text' | 'library' | 'random';

export function WorksheetGenerator() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const prefill = sp.get('prefill');

  const user = useAppStore(s => s.user);

  const [tab, setTab] = useState<Tab>(prefill ? 'library' : 'text');
  const [content, setContent] = useState<string[]>(prefill ? [prefill] : []);
  const [title, setTitle] = useState('');
  const [cellStyle, setCellStyle] = useState<CellStyle>('brush');
  const [paperSize, setPaperSize] = useState<PaperSize>('brush-12');
  const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor('brush'));
  const [view, setView] = useState<'form' | 'preview'>('form');
  const [saving, setSaving] = useState(false);
  const [authHint, setAuthHint] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    if (prefill) {
      setTab('library');
      setContent((cur) => (cur.includes(prefill) ? cur : [prefill, ...cur]));
    }
  }, [prefill]);

  // 登录后清掉提示
  useEffect(() => {
    if (user) {
      setAuthHint(false);
      setErrorMsg(null);
    }
  }, [user]);

  function handleCellStyleChange(next: CellStyle) {
    setCellStyle(next);
    if (next === 'brush' && !isBrushSize(paperSize)) {
      setPaperSize('brush-12');
    } else if (next !== 'brush' && isBrushSize(paperSize)) {
      setPaperSize('A4');
    }
    setFontFamily(defaultFontFor(next));
  }

  const canPreview = content.length > 0;

  const openLogin = () => {
    setAuthHint(true);
    setErrorMsg(null);
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
  };

  const handleSave = async () => {
    if (!user) {
      openLogin();
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || `字帖 ${new Date().toLocaleDateString()}`, content, cellStyle, paperSize, fontFamily }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedId(data.data.id);
        router.push(`/worksheet/${data.data.id}`);
      } else if (res.status === 401 || data.error?.code === 'unauthenticated') {
        openLogin();
      } else {
        setErrorMsg(data.error?.message ?? '保存失败, 请稍后重试');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (view === 'preview') {
    return (
      <WorksheetPreview
        title={title}
        content={content}
        cellStyle={cellStyle}
        paperSize={paperSize}
        fontFamily={fontFamily}
        onBack={() => setView('form')}
        onSave={handleSave}
        saving={saving}
        savedId={savedId}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab('text')}
          className={`px-4 py-2 ${tab === 'text' ? 'border-b-2 border-seal font-medium' : 'text-ink-faint'}`}
        >
          自由输入
        </button>
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-4 py-2 ${tab === 'library' ? 'border-b-2 border-seal font-medium' : 'text-ink-faint'}`}
        >
          从字库选
        </button>
        <button
          type="button"
          onClick={() => setTab('random')}
          className={`px-4 py-2 ${tab === 'random' ? 'border-b-2 border-seal font-medium' : 'text-ink-faint'}`}
        >
          随机生成
        </button>
      </div>

      {tab === 'text' ? (
        <TextInputTab value={content} onChange={setContent} />
      ) : tab === 'library' ? (
        <LibrarySelectTab selected={content} onChange={setContent} />
      ) : (
        <RandomTab
          title={title}
          onTitleChange={setTitle}
          onPicked={(chars) => {
            setContent(chars);
            setView('preview');
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tab !== 'random' && (
          <div>
            <label className="block text-sm font-medium text-ink-soft">标题(可选)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="给字帖起个名字..."
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-ink-soft">格子样式</label>
          <div className="mt-2">
            <StylePicker value={cellStyle} onChange={handleCellStyleChange} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-ink-soft">
            纸张尺寸 <span className="text-xs text-ink-faint">(决定每页字数)</span>
          </label>
          <div className="mt-2">
            <PaperSizePicker value={paperSize} cellStyle={cellStyle} onChange={setPaperSize} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">字体</label>
          <div className="mt-2">
            <FontFamilyPicker value={fontFamily} onChange={setFontFamily} />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        {authHint && !user && (
          <p className="text-sm text-ink-soft">
            需要登录才能保存。已为你打开登录窗口 —
            <button
              type="button"
              onClick={openLogin}
              className="ml-1 text-seal underline hover:text-seal/80"
            >
              重新打开
            </button>
          </p>
        )}
        {errorMsg && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}
        <p className="text-xs text-ink-faint self-end">
          预览: {paperSizeLabel(paperSize)} · {fontFamilyLabel(fontFamily)}
        </p>
        <button
          type="button"
          onClick={() => setView('preview')}
          disabled={!canPreview}
          className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          生成字帖
        </button>
      </div>
    </div>
  );
}
