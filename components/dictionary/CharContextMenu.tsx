'use client';

import { useEffect, useRef } from 'react';

interface Props {
  x: number;
  y: number;
  char: string;
  onAdd: (char: string) => void;
  onClose: () => void;
}

export function CharContextMenu({ x, y, char, onAdd, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded shadow-lg bg-paper-warm border border-ink/30 py-1 text-sm"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onAdd(char); onClose(); }}
        className="block w-full text-left px-4 py-2 hover:bg-paper text-ink"
      >
        添加到「我的字帖」
      </button>
    </div>
  );
}
