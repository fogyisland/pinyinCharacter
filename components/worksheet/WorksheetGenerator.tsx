'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { PaperSize, FontFamily } from '@/lib/worksheet-types';
import { defaultToolFor, defaultPresentationFor, defaultFontFor, composeCellStyle, isBrushSize, paperSizeLabel, fontFamilyLabel } from '@/lib/worksheet-types';
import type { Tool, Presentation } from '@/lib/worksheet-types';
import { useAppStore } from '@/lib/store';
import { TextInputTab } from './TextInputTab';
import { LibrarySelectTab } from './LibrarySelectTab';
import { RandomTab } from './RandomTab';
import { ToolPicker } from './ToolPicker';
import { PresentationPicker } from './PresentationPicker';
import { PaperSizePicker } from './PaperSizePicker';
import { FontFamilyPicker } from './FontFamilyPicker';
import { WorksheetPreview } from './WorksheetPreview';
import type { ClassicDetail } from '@/lib/classics-types';
import { stripPunct, buildBreakpoints } from '@/lib/punctuation';

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
  const [tool, setTool] = useState<Tool>(defaultToolFor());
  const [presentation, setPresentation] = useState<Presentation>(defaultPresentationFor());
  const [paperSize, setPaperSize] = useState<PaperSize>(
    defaultToolFor() === 'brush' ? 'brush-12' : 'A4',
  );
  const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor(defaultToolFor()));
  const [view, setView] = useState<'form' | 'preview'>('form');
  const [saving, setSaving] = useState(false);
  const [authHint, setAuthHint] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [ancientBook, setAncientBook] = useState<ClassicDetail | null>(null);
  const [chapterIdx, setChapterIdx] = useState<number>(
    Number(sp.get('chapterIdx')) || 0,
  );

  const source = sp.get('source');
  const bookSlug = sp.get('book');
  const isAncient = source === 'ancient' && !!bookSlug;

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

  // Ancient mode: fetch the book once when the book (or isAncient flag) changes.
  // Chapter changes are handled by the next effect — they only re-derive content
  // from the already-loaded book, no network call.
  useEffect(() => {
    if (!isAncient || !bookSlug) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/classics/${bookSlug}`);
      const data = await res.json();
      if (cancelled || !data.ok) return;
      setAncientBook(data.data as ClassicDetail);
      setTab('text');
    })();
    return () => { cancelled = true; };
  }, [isAncient, bookSlug]);

  // Ancient mode: re-derive content + breakpoints when book or chapter changes.
  // Clamps chapterIdx into [0, chunks.length-1] so an out-of-range param can't
  // crash the render. No fetch here.
  useEffect(() => {
    if (!ancientBook) return;
    let cancelled = false;
    const idx = Math.max(0, Math.min(chapterIdx, ancientBook.chunks.length - 1));
    const chunk = ancientBook.chunks[idx];
    if (!chunk) return;
    const chars = chunk.content.flatMap(line => Array.from(stripPunct(line)));
    if (cancelled) return;
    setContent(chars);
    return () => { cancelled = true; };
  }, [ancientBook, chapterIdx]);

  // 改字体/工具/格子形式/纸张尺寸后，自动跳到预览页（已有内容时）
  // 跳过首次渲染，避免 prefill 时直接跳到预览
  const isFirstSettingsRender = useRef(true);
  useEffect(() => {
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      return;
    }
    if (view === 'form' && canPreview) {
      setView('preview');
    }
  }, [fontFamily, tool, presentation, paperSize]);

  function handleToolChange(next: Tool) {
    setTool(next);
    if (next === 'brush' && !isBrushSize(paperSize)) {
      setPaperSize('brush-12');
    } else if (next === 'pen' && isBrushSize(paperSize)) {
      setPaperSize('A4');
    }
    // fontFamily is preserved (user explicit decision 2026-06-20)
  }

  function handlePresentationChange(next: Presentation) {
    setPresentation(next);
    // paperSize unchanged
  }

  const canPreview = content.length > 0;

  const breakpoints = useMemo(() => {
    if (!isAncient || !ancientBook) return undefined;
    const chunk = ancientBook.chunks[chapterIdx];
    if (!chunk) return undefined;
    return buildBreakpoints(chunk);
  }, [isAncient, ancientBook, chapterIdx]);

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
      const cellStyle = composeCellStyle(tool, presentation);
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
        cellStyle={composeCellStyle(tool, presentation)}
        paperSize={paperSize}
        fontFamily={fontFamily}
        breakpoints={breakpoints}
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
          <label className="block text-sm font-medium text-ink-soft">工具</label>
          <div className="mt-2">
            <ToolPicker value={tool} onChange={handleToolChange} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">格子形式</label>
          <div className="mt-2">
            <PresentationPicker value={presentation} onChange={handlePresentationChange} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-ink-soft">
            纸张尺寸 <span className="text-xs text-ink-faint">(决定每页字数)</span>
          </label>
          <div className="mt-2">
            <PaperSizePicker value={paperSize} tool={tool} onChange={setPaperSize} />
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
        {isAncient && ancientBook && (
          <div className="flex gap-2 self-end">
            <button
              type="button"
              disabled={chapterIdx <= 0}
              onClick={() => setChapterIdx(i => i - 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              ← 上一章
            </button>
            <button
              type="button"
              disabled={chapterIdx >= ancientBook.chunks.length - 1}
              onClick={() => setChapterIdx(i => i + 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              下一章 →
            </button>
          </div>
        )}
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
