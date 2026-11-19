'use client';

/**
 * MagicCharGlyph — one character, drawn.
 *
 * The glyph is drawn by `hanzi-writer` from the site's own stroke data
 * (`public/strokes/<char>.json`), so the character the player sees is
 * the same character the relation table was computed from. Drawing the
 * strokes (rather than showing the font glyph) is what makes the game
 * about strokes.
 *
 * The character is shown WITHOUT animation — the game asks "which one is
 * one stroke away", and a moving stroke order would be noise.
 *
 * It never fails: if the character has no stroke data, or the writer
 * fails to load, the plain character is shown instead. A character must
 * not be able to break the game around it.
 */

import { useEffect, useRef, useState } from 'react';

const SIZE = 120;
const PADDING = 8;
const STROKE_COLOR = '#3a2a14';
const OUTLINE_COLOR = '#ddd';

type Props = {
  /** The character to draw. */
  char: string;
  /** Extra classes for the wrapper. */
  className?: string;
};

/** The subset of the `hanzi-writer` API this component uses. */
interface HanziWriterLike {
  showCharacter: () => unknown;
  pauseAnimation: () => unknown;
}

/** The static `create` factory the module exposes. */
interface HanziWriterFactory {
  create(target: HTMLElement, char: string, options: Record<string, unknown>): HanziWriterLike;
}

export function MagicCharGlyph({ char, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterLike | null = null;

    setDrawn(false);
    if (containerRef.current) containerRef.current.innerHTML = '';

    (async () => {
      try {
        const response = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!response.ok) return;
        const strokeData = await response.json();
        if (cancelled) return;

        const writerModule = await import('hanzi-writer');
        const HanziWriter = ((writerModule as { default?: unknown }).default ??
          writerModule) as unknown as HanziWriterFactory;
        if (cancelled || !containerRef.current) return;

        writer = HanziWriter.create(containerRef.current, char, {
          width: SIZE,
          height: SIZE,
          padding: PADDING,
          showOutline: true,
          strokeAnimationSpeed: 0,
          delayBetweenStrokes: 0,
          strokeColor: STROKE_COLOR,
          outlineColor: OUTLINE_COLOR,
          charDataLoader: (_char: string, onLoad: (data: unknown) => void) => onLoad(strokeData),
          onLoadCharDataError: () => {
            // The stroke data was there but the writer could not use it.
            // The plain character is already on screen.
          },
        });

        if (cancelled) {
          writer.pauseAnimation();
          return;
        }
        // Draw the finished character, with no animation.
        writer.showCharacter();
        setDrawn(true);
      } catch {
        // The writer could not start. The plain character is on screen.
      }
    })();

    return () => {
      cancelled = true;
      if (writer) writer.pauseAnimation();
    };
  }, [char]);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className ?? ''}`}
      style={{ width: SIZE, height: SIZE }}
      aria-label={char}
      role="img"
    >
      {/* The plain character, always there: it is the fallback AND the
          accessible name's visible twin while the strokes load. */}
      <span
        data-testid="magic-glyph-fallback"
        className={`font-kai leading-none ${drawn ? 'invisible' : ''}`}
        style={{ fontSize: SIZE * 0.72 }}
      >
        {char}
      </span>
      <div
        ref={containerRef}
        className={`absolute inset-0 ${drawn ? '' : 'invisible'}`}
        data-testid="magic-glyph-drawing"
      />
    </div>
  );
}
