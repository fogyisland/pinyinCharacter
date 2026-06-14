'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  char: string;
  className?: string;
};

export function StrokeOrderCard({ char, className }: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const writerRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!r.ok) {
          setError('unsupported');
          setIsLoading(false);
          return;
        }
        // TODO: dynamic import hanzi-writer + create writer
        // (implemented in Task 6)
        if (cancelled) return;
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError('network');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [char]);

  if (error) {
    return (
      <article className={className}>
        <p role="alert">暂无该字笔画数据</p>
      </article>
    );
  }

  if (isLoading) {
    return (
      <article className={className}>
        <div role="status" aria-label="Loading" className="spinner" />
      </article>
    );
  }

  // TODO: render canvas + controls (Task 6+7)
  return (
    <article className={className}>
      <div ref={containerRef} />
    </article>
  );
}