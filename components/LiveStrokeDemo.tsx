'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  char: string;
  size?: number;
  className?: string;
  loopIntervalMs?: number;
}

interface HanziWriterLike {
  loopCharacterAnimation: () => void;
  pauseAnimation: () => void;
}

const STROKE_COLOR = '#3A2A14';
const OUTLINE_COLOR = 'rgba(58, 42, 20, 0.18)';
const ANIMATION_SPEED = 1.4;
const DELAY_BETWEEN_STROKES = 220;

export function LiveStrokeDemo({
  char,
  size = 220,
  className = '',
  loopIntervalMs = 4000,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<HanziWriterLike | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasStrokeData, setHasStrokeData] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterLike | null = null;

    if (containerRef.current) containerRef.current.innerHTML = '';
    setIsReady(false);

    (async () => {
      try {
        const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!r.ok) {
          setHasStrokeData(false);
          return;
        }
        const strokeData = await r.json();
        const HanziWriterMod = await import('hanzi-writer');
        const HanziWriter = HanziWriterMod.default;
        if (cancelled || !containerRef.current) return;

        writer = HanziWriter.create(containerRef.current, char, {
          width: size,
          height: size,
          padding: 4,
          showOutline: true,
          strokeAnimationSpeed: ANIMATION_SPEED,
          delayBetweenStrokes: DELAY_BETWEEN_STROKES,
          strokeColor: STROKE_COLOR,
          outlineColor: OUTLINE_COLOR,
          charDataLoader: (cb: (data: unknown) => void) => cb(strokeData),
          onLoadCharDataError: () => {
            if (!cancelled) setHasStrokeData(false);
          },
        } as any) as unknown as HanziWriterLike;

        if (cancelled) {
          writer.pauseAnimation();
          return;
        }
        writerRef.current = writer;
        setIsReady(true);
        writer.loopCharacterAnimation();
      } catch {
        if (!cancelled) setHasStrokeData(false);
      }
    })();

    const loop = setInterval(() => {
      if (writerRef.current && isReady) {
        writerRef.current.loopCharacterAnimation();
      }
    }, loopIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(loop);
      if (writer) writer.pauseAnimation();
      writerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, size]);

  if (!hasStrokeData) {
    return (
      <div
        className={`flex items-center justify-center font-serif text-ink ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.7 }}
        aria-label={char}
      >
        {char}
      </div>
    );
  }

  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(58,42,20,0.18)" strokeWidth="0.3" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(58,42,20,0.18)" strokeWidth="0.3" />
      </svg>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
