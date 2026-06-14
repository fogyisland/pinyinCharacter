'use client';

import { useEffect, useRef, useState } from 'react';

const SIZE = 280;
const STROKE_ANIMATION_SPEED = 1;
const DELAY_BETWEEN_STROKES = 400;
const STROKE_COLOR = '#1a1a1a';
const RADICAL_COLOR = '#168F4F';
const OUTLINE_COLOR = '#ddd';

type Props = {
  char: string;
  className?: string;
};

interface HanziWriterLike {
  loopCharacterAnimation: () => void;
  animateCharacter: () => void;
  pauseAnimation: () => void;
  getNumStrokes: () => number;
}

export function StrokeOrderCard({ char, className }: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(0);
  const [totalStrokes, setTotalStrokes] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const writerRef = useRef<HanziWriterLike | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Main lifecycle: dynamic import + fetch + create writer
  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterLike | null = null;

    setIsLoading(true);
    setError(null);
    setIsReady(false);
    setCurrentStroke(0);
    setTotalStrokes(0);
    writerRef.current = null;
    if (containerRef.current) containerRef.current.innerHTML = '';

    (async () => {
      try {
        const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!r.ok) {
          setError('unsupported');
          setIsLoading(false);
          return;
        }
        const strokeData = await r.json();

        const HanziWriterMod = await import('hanzi-writer');
        const HanziWriter = HanziWriterMod.default;
        if (cancelled || !containerRef.current) return;

        writer = HanziWriter.create(containerRef.current, char, {
          width: SIZE,
          height: SIZE,
          padding: 8,
          showOutline: true,
          strokeAnimationSpeed: STROKE_ANIMATION_SPEED,
          delayBetweenStrokes: DELAY_BETWEEN_STROKES,
          strokeColor: STROKE_COLOR,
          radicalColor: RADICAL_COLOR,
          outlineColor: OUTLINE_COLOR,
          charDataLoader: (_char: string, onLoad: (data: unknown) => void) => onLoad(strokeData),
          onLoadCharDataError: () => {
            if (!cancelled) {
              setError('load_failed');
              setIsLoading(false);
            }
          },
          onCompleteStroke: ({ strokeNum }: { strokeNum: number; strokeCount: number }) => {
            if (!cancelled) setCurrentStroke(strokeNum);
          },
        } as any) as unknown as HanziWriterLike;

        if (cancelled) {
          writer.pauseAnimation();
          return;
        }
        writerRef.current = writer;
        setTotalStrokes(writer.getNumStrokes());
        setIsReady(true);
        setIsLoading(false);
        if (loopEnabled) writer.loopCharacterAnimation();
        else writer.animateCharacter();
      } catch (e) {
        if (!cancelled) {
          setError('init_failed');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (writer) writer.pauseAnimation();
      writerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char]);

  // React to loopEnabled changes
  useEffect(() => {
    const w = writerRef.current;
    if (!w || !isReady) return;
    if (loopEnabled) {
      w.loopCharacterAnimation();
    } else {
      w.pauseAnimation();
      setCurrentStroke(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled]);

  function replay() {
    const w = writerRef.current;
    if (!w) return;
    w.pauseAnimation();
    setCurrentStroke(0);
    if (loopEnabled) w.loopCharacterAnimation();
    else w.animateCharacter();
  }

  function toggleLoop() {
    setLoopEnabled((v) => !v);
  }

  if (error) {
    return (
      <article className={className}>
        <p role="alert">暂无该字笔画数据 <span className="text-xs text-ink-faint">[{error}]</span></p>
      </article>
    );
  }

  return (
    <article className={className}>
      <header className="flex items-center justify-between mb-4">
        <h3>笔画顺序</h3>
        <span className="badge">新功能</span>
      </header>
      <div className="flex flex-col md:flex-row gap-6 items-center">
        <div
          className="relative"
          style={{ width: SIZE, height: SIZE }}
        >
          <svg
            className="absolute inset-0 pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line x1="50" y1="0" x2="50" y2="100" stroke="#666" strokeWidth="0.4" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="#666" strokeWidth="0.4" />
          </svg>
          <div
            ref={containerRef}
            className={`absolute inset-0 ${isReady ? '' : 'invisible'}`}
          />
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div role="status" aria-label="Loading" className="spinner" />
            </div>
          )}
        </div>
        {isReady && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <button
                onClick={replay}
                aria-label="重新播放笔画动画"
                className="btn"
              >
                ⟲
              </button>
              <button
                onClick={toggleLoop}
                aria-pressed={loopEnabled}
                aria-label="循环播放"
                className="btn"
              >
                ♻
              </button>
            </div>
            <span aria-live="polite" className="text-sm text-ink/70">
              {currentStroke || totalStrokes} / {totalStrokes} 画
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
