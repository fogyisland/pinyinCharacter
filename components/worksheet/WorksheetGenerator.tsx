'use client';
/* eslint-disable react-hooks/rules-of-hooks -- useSearchParams wrapped in IIFE try/catch for happy-dom tests (lint false positive) */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { PaperSize, FontFamily } from '@/lib/worksheet-types';
import {
  defaultToolFor,
  defaultPresentationFor,
  defaultFontFor,
  composeCellStyle,
  isBrushSize,
  paperSizeLabel,
  fontFamilyLabel,
  cellsPerPage,
} from '@/lib/worksheet-types';
import type { Tool, Presentation } from '@/lib/worksheet-types';
import { useAppStore } from '@/lib/store';
import { TextInputTab } from './TextInputTab';
import { LibrarySelectTab } from './LibrarySelectTab';
import { RandomTab } from './RandomTab';
import { EnglishTraceTab } from './EnglishTraceTab';
import { ToolPicker } from './ToolPicker';
import { PresentationPicker } from './PresentationPicker';
import { TraceToggle } from './TraceToggle';
import { PaperSizePicker } from './PaperSizePicker';
import { FontFamilyPicker } from './FontFamilyPicker';
import { WorksheetPreview } from './WorksheetPreview';
import { AddToWorksheetDialog } from './AddToWorksheetDialog';
import type { ClassicChapterPayload } from '@/lib/classics-types';
import { stripPunct, buildBreakpoints } from '@/lib/punctuation';

type Tab = 'text' | 'library' | 'random' | 'english';

export function WorksheetGenerator() {
  // useSearchParams returns null in happy-dom (no Next router context); the
  // try/catch wrapper lets unit tests mount this component without errors.
  // The parent page (app/worksheet/page.tsx) intentionally does NOT wrap us
  // in <Suspense>, so SSR renders the form (sp is null on server) and the
  // client hydrates with the real URL params on first paint.
  const sp = (() => {
    try {
      return useSearchParams();
    } catch {
      return null;
    }
  })();
  const prefill = sp?.get('prefill') ?? null;
  const previewText = sp?.get('previewText') ?? null;
  const initialBookSlug = sp?.get('book') ?? null;
  const initialChapterIdx = Number(sp?.get('chapterIdx')) || 0;

  const router = useRouter();
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);

  // Initial state from URL params. useState initializers run once per
  // component instance — for URL changes after mount the useEffect below
  // syncs (mirrors PracticeTemplate's pattern).
  const [tab, setTab] = useState<Tab>(prefill ? 'library' : previewText ? 'english' : 'text');
  const [content, setContent] = useState<string[]>(
    prefill ? [prefill] : previewText ? previewText.split('') : [],
  );
  const [view, setView] = useState<'form' | 'preview'>(previewText ? 'preview' : 'form');
  const [chapterIdx, setChapterIdx] = useState<number>(initialChapterIdx);
  // The book comes from the URL and is never changed by the UI — reading it
  // straight from the params keeps it in sync when the URL changes.
  const bookSlug = initialBookSlug;
  const isAncient = !!bookSlug;

  // Sync URL params → state when they change after mount (browser nav,
  // headless screenshot tool firing different URL params, etc.).
  useEffect(() => {
    if (prefill) {
      setTab('library');
      setContent((cur) => (cur.includes(prefill) ? cur : [prefill, ...cur]));
    }
    if (previewText) {
      setTab('english');
      setContent(previewText.split(''));
      setView('preview');
      // English trace (4-line) only renders on pen papers (A3/A4/B5).
      // Default paperSize is brush-12, whose rowsPerPage is 0 and would
      // produce an empty preview. Force A4 here so /worksheet?previewText
      // renders the full ruled paper.
      setPaperSize((cur) => (isBrushSize(cur) ? 'A4' : cur));
    }
    setChapterIdx(initialChapterIdx);
  }, [prefill, previewText, initialChapterIdx]);

  const [title, setTitle] = useState('');
  const [tool, setTool] = useState<Tool>(defaultToolFor());
  const [presentation, setPresentation] = useState<Presentation>(defaultPresentationFor());
  const [paperSize, setPaperSize] = useState<PaperSize>(
    defaultToolFor() === 'brush' ? 'brush-12' : 'A4',
  );
  const [fontFamily, setFontFamily] = useState<FontFamily>(defaultFontFor(defaultToolFor()));
  const [trace, setTrace] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [authHint, setAuthHint] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [ancientChapter, setAncientChapter] = useState<ClassicChapterPayload | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [appendDialogOpen, setAppendDialogOpen] = useState(false);

  // 登录后清掉提示
  useEffect(() => {
    if (user) {
      setAuthHint(false);
      setErrorMsg(null);
    }
  }, [user]);

  // Ancient mode: fetch the chapter that is about to be typeset.
  //
  // The generator used to download the whole book (up to 8 MB of JSON) and
  // pick one chapter out of it. It now asks for that chapter alone — the
  // response carries the chapter's lines, its label and the book's chapter
  // count (for the 上一章 / 下一章 buttons).
  useEffect(() => {
    if (!isAncient || !bookSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/classics/${bookSlug}/chunk/${chapterIdx}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setChapterError(data.error?.message ?? '章节加载失败');
          return;
        }
        const chapter = data.data as ClassicChapterPayload;
        setChapterError(null);
        setAncientChapter(chapter);
        setTab('text');
        setContent(chapter.content.flatMap((line) => Array.from(stripPunct(line))));
      } catch (err) {
        if (!cancelled) setChapterError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAncient, bookSlug, chapterIdx]);

  // 改字体/工具/格子形式/纸张尺寸/描红 后, 不再自动跳到预览页.
  // 预览仅在用户点 "生成字帖" 按钮 (或 RandomTab 的 "随机生成/重新生成" 按钮) 时进入.
  function handleToolChange(next: Tool) {
    setTool(next);
    if (next === 'brush' && !isBrushSize(paperSize)) {
      setPaperSize('brush-12');
    } else if (next === 'pen' && isBrushSize(paperSize)) {
      setPaperSize('A4');
      setTrace(false); // pen has no trace mode
    }
    // fontFamily is preserved (user explicit decision 2026-06-20)
  }

  function handlePresentationChange(next: Presentation) {
    setPresentation(next);
    // paperSize unchanged
  }

  // When the user enters the 英文描红 tab, lock cellStyle to 'pen-english' so
  // WorksheetPreview renders the 4-line branch. Also force fontFamily to a
  // hard-pen (霞鹜文楷) — brush faces like Ma Shan Zheng render Latin letters
  // as glyph fallbacks and look like Chinese ink rather than English text.
  // Switch paperSize from brush-* to A4 so the 4-line paper actually fills
  // the page (brush papers have rowsPerPage=0 for 4-line, would render empty).
  function handleEnglishTabEnter() {
    setTab('english');
    setFontFamily('wenkai-gb');
    setPaperSize((cur) => (isBrushSize(cur) ? 'A4' : cur));
  }

  const canPreview = content.length > 0;
  const isEnglishTab = tab === 'english';

  const breakpoints = useMemo(() => {
    if (!isAncient || !ancientChapter) return undefined;
    return buildBreakpoints(ancientChapter);
  }, [isAncient, ancientChapter]);

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
      // In English tab, force cellStyle to 'pen-english' regardless of the
      // tool/presentation state — the CJK pickers are hidden, but their state
      // is still 'brush'/'square'/false from a prior session.
      const cellStyle = isEnglishTab ? 'pen-english' : composeCellStyle(tool, presentation, trace);
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || `字帖 ${new Date().toLocaleDateString()}`,
          content,
          cellStyle,
          paperSize,
          fontFamily,
        }),
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
      <>
        <WorksheetPreview
          title={title}
          content={content}
          cellStyle={isEnglishTab ? 'pen-english' : composeCellStyle(tool, presentation, trace)}
          paperSize={paperSize}
          fontFamily={fontFamily}
          breakpoints={breakpoints}
          onBack={() => setView('form')}
          onSave={handleSave}
          onAppend={user ? () => setAppendDialogOpen(true) : undefined}
          saving={saving}
          savedId={savedId}
        />
        <AddToWorksheetDialog
          open={appendDialogOpen}
          chars={content}
          title="追加到现有字帖"
          onClose={() => setAppendDialogOpen(false)}
        />
      </>
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
        <button
          type="button"
          onClick={handleEnglishTabEnter}
          className={`px-4 py-2 ${tab === 'english' ? 'border-b-2 border-seal font-medium' : 'text-ink-faint'}`}
        >
          英文描红
        </button>
      </div>

      {tab === 'text' ? (
        <TextInputTab value={content} onChange={setContent} />
      ) : tab === 'library' ? (
        <LibrarySelectTab selected={content} onChange={setContent} />
      ) : tab === 'english' ? (
        <EnglishTraceTab value={content} onChange={setContent} />
      ) : (
        <RandomTab
          title={title}
          onTitleChange={setTitle}
          paperSize={paperSize}
          hasContent={content.length > 0}
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
        {!isEnglishTab && (
          <>
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
            {tool === 'brush' && (
              <div>
                <label className="block text-sm font-medium text-ink-soft">描红</label>
                <div className="mt-2">
                  <TraceToggle value={trace} onChange={setTrace} />
                </div>
              </div>
            )}
          </>
        )}
        {isEnglishTab && (
          <div className="rounded-md border border-ink/15 bg-paper-deep px-3 py-2 text-xs text-ink-soft">
            英文描红 (4 线格) · {paperSizeLabel(paperSize)} · 自动适配 {cellsPerPage(paperSize)} 字
            / 页
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-ink-soft">
            纸张尺寸 <span className="text-xs text-ink-faint">(决定每页字数)</span>
          </label>
          <div className="mt-2">
            <PaperSizePicker
              value={paperSize}
              tool={isEnglishTab ? 'pen' : tool}
              onChange={setPaperSize}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">字体</label>
          <div className="mt-2">
            <FontFamilyPicker tool={tool} value={fontFamily} onChange={setFontFamily} />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        {isAncient && ancientChapter && (
          <div className="flex gap-2 self-end">
            <button
              type="button"
              disabled={chapterIdx <= 0}
              onClick={() => setChapterIdx((i) => i - 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              ← 上一章
            </button>
            <button
              type="button"
              disabled={chapterIdx >= ancientChapter.chunkCount - 1}
              onClick={() => setChapterIdx((i) => i + 1)}
              className="rounded border border-ink/20 px-3 py-1.5 text-sm hover:bg-paper-deep disabled:opacity-40"
            >
              下一章 →
            </button>
          </div>
        )}
        {chapterError && <p className="text-sm text-red-600">{chapterError}</p>}
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
        {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
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
