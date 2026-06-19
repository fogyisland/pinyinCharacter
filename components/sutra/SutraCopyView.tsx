'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SutraChunk } from '@/lib/sutra-types';
import type { SutraReading } from '@/lib/sutra-reading';
import type { CopyProgress } from '@/lib/sutra-copy-progress';
import { CopySeal } from './CopySeal';

interface Props {
  chunk: SutraChunk;
  sutraId: number;
  sutraSlug: string;
  userId: number | null;
  reading: SutraReading;
  onExit: () => void;
}

type Phase = 'copying' | 'collapsing' | 'sealed';

const WRITING_MODE: Record<SutraReading, string> = {
  'horizontal': 'horizontal-tb',
  'vertical-rtl': 'vertical-rl',
  'vertical-ltr': 'vertical-lr',
};

const DEBOUNCE_MS = 500;
const COLLAPSE_MS = 1200;

function flatChars(chunk: SutraChunk): string[] {
  return chunk.content.join('').split('');
}

function charClass(idx: number, written: boolean, disabled: boolean): string {
  const base = 'copy-char inline-block px-1.5 py-1 transition-colors duration-400';
  if (disabled) return `${base} copy-char--disabled`;
  return written
    ? `${base} copy-char--written text-[#2c251e]`
    : `${base} text-[rgba(0,0,0,0.15)] hover:bg-[rgba(222,203,183,0.15)] cursor-pointer`;
}

export function SutraCopyView({ chunk, sutraId, sutraSlug, userId, reading, onExit }: Props) {
  const chars = flatChars(chunk);
  const total = chars.length;
  const [writtenChars, setWrittenChars] = useState<boolean[]>(() => new Array(total).fill(false));
  const [phase, setPhase] = useState<Phase>('copying');
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from API on mount + on chunk.id change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/sutra/${sutraSlug}/copy-progress?chunk=${chunk.id}`);
      if (cancelled) return;
      if (res.status === 401 || !res.ok) {
        // Anonymous or failure: stay all-false
        setWrittenChars(new Array(total).fill(false));
        return;
      }
      const body = await res.json();
      const p: CopyProgress | null = body?.data?.progress ?? null;
      const arr = p?.writtenChars?.length === total ? p.writtenChars : new Array(total).fill(false);
      setWrittenChars(arr);
      if (p?.completedAt) setPhase('sealed');
    }
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk.id, sutraId]);

  // Trigger collapse when all written.
  const writtenCount = writtenChars.filter(Boolean).length;
  useEffect(() => {
    if (phase === 'copying' && total > 0 && writtenCount === total) {
      setPhase('collapsing');
    }
  }, [writtenCount, total, phase]);

  // Schedule collapse → sealed.
  useEffect(() => {
    if (phase !== 'collapsing') return;
    collapseTimerRef.current = setTimeout(() => {
      setPhase('sealed');
      void fetch(`/api/sutra/${sutraSlug}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, writtenChars, completed: true }),
      });
    }, COLLAPSE_MS);
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Debounced POST on writtenChars change.
  useEffect(() => {
    if (!userId) return;
    if (phase !== 'copying') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/sutra/${sutraSlug}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, writtenChars }),
      }).then(r => {
        if (!r.ok) setError('进度保存失败');
      });
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [writtenChars, sutraId, chunk.id, userId, phase]);

  const handleCharClick = useCallback((idx: number) => {
    if (!userId) return;
    setPhase('copying'); // reset from sealed if user re-clicks after a reset
    setWrittenChars(prev => {
      if (prev[idx]) return prev;
      const next = prev.slice();
      next[idx] = true;
      return next;
    });
  }, [userId]);

  const handleReset = useCallback(() => {
    if (!window.confirm('将清除本段抄经进度，确定？')) return;
    setWrittenChars(new Array(total).fill(false));
    setPhase('copying');
    if (userId) {
      void fetch(`/api/sutra/${sutraSlug}/copy-progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chunkIdx: chunk.id, reset: true }),
      });
    }
  }, [sutraId, chunk.id, userId, total]);

  const disabled = userId === null;
  const pct = total > 0 ? Math.round((writtenCount / total) * 100) : 0;

  if (phase === 'sealed') {
    return (
      <div
        data-testid="copy-view"
        data-reading={reading}
        className="copy-view copy-view--sealed fixed inset-0 z-10 flex flex-col items-center justify-center bg-paper-warm/95"
      >
        <CopySeal className="copy-seal--enter" />
        <div className="mt-8 flex gap-3">
          <button type="button" onClick={handleReset} className="rounded-md border border-ink/20 px-4 py-2 hover:bg-ink/5">
            重新抄写
          </button>
          <button type="button" onClick={onExit} className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80">
            退出抄经
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="copy-view"
      data-reading={reading}
      className={
        'copy-view' +
        (phase === 'collapsing' ? ' copy-view--collapse copy-view--collapsing' : '')
      }
    >
      <div className="copy-progress mb-3">
        <div className="h-1 w-full rounded bg-ink/10">
          <div
            className="h-1 rounded bg-seal transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-ink-faint">已抄 {writtenCount} / {total} 字</p>
      </div>

      {disabled && (
        <div
          role="alert"
          className="mb-3 rounded border-l-4 border-seal bg-paper-warm p-3 text-sm text-ink-soft"
        >
          请登录后开始抄经，进度将自动保存。
          <a className="ml-2 text-seal underline" href={`/login?next=${encodeURIComponent(`/sutra/${sutraId}?chunk=${chunk.id}`)}`}>
            登录
          </a>
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div
        data-testid="copy-body"
        className="copy-body font-serif text-lg sm:text-xl leading-loose text-ink"
        style={{ writingMode: WRITING_MODE[reading] as any }}
      >
        {chunk.content.map((line, li) => (
          <p key={li} className={reading === 'horizontal' ? 'my-1.5' : 'mx-3 inline-block align-top'}>
            {[...line].map((ch, ci) => {
              const safeIdx = lineStartsAt(chunk, li) + ci;
              return (
                <span
                  key={ci}
                  data-idx={safeIdx}
                  data-testid={`copy-char-${safeIdx}`}
                  className={charClass(safeIdx, writtenChars[safeIdx] === true, disabled)}
                  onClick={() => handleCharClick(safeIdx)}
                >
                  {ch}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}

function lineStartsAt(chunk: SutraChunk, lineIndex: number): number {
  let acc = 0;
  for (let k = 0; k < lineIndex; k++) acc += chunk.content[k]!.length;
  return acc;
}
