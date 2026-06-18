'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Char } from '@/lib/chars-types';
import { useToastStore } from '@/lib/toast-store';
import { appendCharToMyWorksheetApi } from '@/lib/api-worksheet';
import { CharContextMenu } from './CharContextMenu';

interface MenuState { x: number; y: number; char: string; }

export function DictionaryCharGridClient({ chars }: { chars: Char[] }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const push = useToastStore((s) => s.push);

  const onContextMenu = (e: React.MouseEvent, c: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, char: c });
  };

  const handleAdd = async (char: string) => {
    try {
      const { added } = await appendCharToMyWorksheetApi(char);
      if (added) {
        push('success', `已添加「${char}」到「我的字帖」`);
      } else {
        push('info', `「${char}」已经在「我的字帖」里了`);
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'unauthorized') {
        push('error', '请先登录后再添加');
      } else {
        push('error', '添加失败,请重试');
      }
    }
  };

  if (chars.length === 0) {
    return <p className="text-ink-faint text-sm py-8 text-center">没有匹配的字</p>;
  }

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {chars.map((c) => (
          <Link
            key={c.char}
            href={`/dictionary/${encodeURIComponent(c.char)}`}
            onContextMenu={(e) => onContextMenu(e, c.char)}
            className="rounded border border-ink/10 p-2 text-center transition hover:border-seal hover:shadow-sm bg-paper"
          >
            <div className="text-2xl font-serif text-ink leading-none">{c.char}</div>
            <div className="text-xs text-ink-soft mt-1">{c.pinyin || '—'}</div>
          </Link>
        ))}
      </div>
      {menu && (
        <CharContextMenu
          x={menu.x}
          y={menu.y}
          char={menu.char}
          onAdd={handleAdd}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
