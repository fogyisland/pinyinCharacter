'use client';

import { useEffect, useRef, useState } from 'react';
import type { CharacterJson } from 'hanzi-writer';

interface Props {
  char: string;
  size?: number;
  className?: string;
  loopIntervalMs?: number;
}

/**
 * The two members of hanzi-writer this component uses. Both return a
 * promise, which has to be handled — an unhandled rejection in a cleanup
 * path would surface as a global error.
 */
interface HanziWriterLike {
  loopCharacterAnimation: () => Promise<unknown>;
  pauseAnimation: () => Promise<unknown>;
}

const STROKE_COLOR = '#3A2A14';
const OUTLINE_COLOR = 'rgba(58, 42, 20, 0.18)';
const ANIMATION_SPEED = 1.4;
const DELAY_BETWEEN_STROKES = 220;

export function LiveStrokeDemo({ char, size = 220, className = '', loopIntervalMs = 4000 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasStrokeData, setHasStrokeData] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterLike | null = null;

    if (containerRef.current) containerRef.current.innerHTML = '';

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
          // hanzi-writer loops the character animation on its own; the pause
          // between two repetitions is its own option. The component used to
          // restart the animation from a setInterval instead — that timer
          // never fired (its closure captured a stale `isReady`), and it
          // would have restarted a running loop anyway.
          delayBetweenLoops: loopIntervalMs,
          strokeColor: STROKE_COLOR,
          outlineColor: OUTLINE_COLOR,
          // hanzi-writer calls the loader as (char, onLoad, onError) — the
          // first argument is the character, not a callback. Handing the
          // pre-fetched stroke data to `onLoad` is what makes the writer
          // render it.
          charDataLoader: (_char, onLoad) => onLoad(strokeData as CharacterJson),
          onLoadCharDataError: () => {
            if (!cancelled) setHasStrokeData(false);
          },
        });

        if (cancelled) {
          void writer.pauseAnimation().catch((err: unknown) => {
            console.error('暂停笔画动画失败', err);
          });
          return;
        }
        void writer.loopCharacterAnimation().catch((err: unknown) => {
          console.error('笔画动画播放失败', err);
        });
      } catch (err) {
        console.error('笔画动画初始化失败', err);
        if (!cancelled) setHasStrokeData(false);
      }
    })();

    return () => {
      cancelled = true;
      if (writer) {
        void writer.pauseAnimation().catch((err: unknown) => {
          console.error('暂停笔画动画失败', err);
        });
      }
    };
  }, [char, size, loopIntervalMs]);

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
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
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
