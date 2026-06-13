'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchRandomStory } from '@/lib/api-stories';
import { speak, stopSpeaking } from '@/lib/tts';
import { getReadChars, addReadChar } from '@/lib/story-history';
import type { RareCharClient } from '@/lib/api-rare-chars';

interface Props {
  initialChar: RareCharClient;
}

export function StoryClient({ initialChar }: Props) {
  const [current, setCurrent] = useState<RareCharClient>(initialChar);
  const [history, setHistory] = useState<RareCharClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [readCount, setReadCount] = useState(0);

  // mount: write initial char, sync count
  useEffect(() => {
    addReadChar(initialChar.char);
    setReadCount(getReadChars().length);
  }, [initialChar]);

  // cleanup TTS on unmount
  useEffect(() => () => stopSpeaking(), []);

  const handleNext = useCallback(async () => {
    setError(null);
    setLoading(true);
    stopSpeaking();
    setSpeaking(false);
    try {
      const next = await fetchRandomStory();
      setHistory((h) => [...h, current]);
      setCurrent(next);
      addReadChar(next.char);
      setReadCount(getReadChars().length);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [current]);

  const handlePrev = useCallback(() => {
    setError(null);
    stopSpeaking();
    setSpeaking(false);
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setCurrent(prev);
    setHistory((h) => h.slice(0, -1));
  }, [history]);

  const handleToggleSpeak = useCallback(() => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
    } else {
      const text = current.meaning ? `${current.meaning}。${current.story}` : current.story;
      speak(text, {
        rate: 0.85,
        onEnd: () => setSpeaking(false),
      });
      setSpeaking(true);
    }
  }, [speaking, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignore when typing in input/textarea
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleToggleSpeak();
      } else if (e.key === 'Escape') {
        stopSpeaking();
        setSpeaking(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev, handleToggleSpeak]);

  const canPrev = history.length > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 flex items-center justify-between text-sm text-ink-soft">
        <Link href="/rare-chars" className="hover:text-seal">← 返回字库</Link>
        <span aria-label="已读进度">已读 {readCount} 字</span>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <article className="card-paper text-center">
        <h1 className="font-kai text-9xl font-bold text-ink leading-none">{current.char}</h1>
        <p className="mt-4 text-3xl text-ink-soft">{current.pinyin}</p>
        {current.meaning && (
          <p className="mt-2 text-sm text-ink-faint">{current.meaning}</p>
        )}
        <p className="mt-8 whitespace-pre-line px-4 text-left font-serif text-base leading-relaxed text-ink">
          {current.story}
        </p>
      </article>

      <nav aria-label="故事操作" className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:justify-center">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!canPrev}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep disabled:opacity-40"
        >
          ← 上一个
        </button>
        <button
          type="button"
          onClick={handleToggleSpeak}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep"
          aria-pressed={speaking}
        >
          {speaking ? '停止' : '朗读'}
        </button>
        <Link
          href={`/worksheet?prefill=${encodeURIComponent(current.char)}`}
          className="rounded-md border border-ink/20 bg-paper-soft px-4 py-2 text-sm text-ink hover:bg-paper-deep"
        >
          加字帖 →
        </Link>
        <button
          type="button"
          onClick={handleNext}
          disabled={loading}
          className="btn-seal px-4 py-2 text-sm"
        >
          {loading ? '加载中…' : '下一个 →'}
        </button>
      </nav>

      <p className="mt-6 text-center text-xs text-ink-faint">
        快捷键: → 下一个 · ← 上一个 · L 朗读 · Esc 停止
      </p>
    </div>
  );
}