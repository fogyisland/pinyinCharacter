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

  // 防止菜单越过视口右/下边界。如果点击位置离右边/底部 < 240px,反转到左侧/上方
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const MENU_WIDTH = 200;
  const MENU_HEIGHT = 48;
  const safeLeft = Math.min(x, vw - MENU_WIDTH - 8);
  const safeTop = Math.min(y, vh - MENU_HEIGHT - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] max-w-[calc(100vw-1rem)] rounded shadow-lg bg-paper-warm border border-ink/30 py-1 text-sm"
      style={{ left: Math.max(8, safeLeft), top: Math.max(8, safeTop) }}
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
