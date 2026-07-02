'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Char } from '@/lib/chars-types';
import { CharContextMenu } from './CharContextMenu';
import { appendCharToWorksheetApi } from '@/lib/api-worksheet';
import { useToastStore } from '@/lib/toast-store';
import { prefetchTts } from '@/lib/tts-cache';

const LIST_PREFETCH_CAP = 24;

interface MenuState { x: number; y: number; char: string; }

export function DictionaryCharGridClient({ chars }: { chars: Char[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const pushToast = useToastStore((s) => s.push);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const onContextMenu = (e: React.MouseEvent, c: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, char: c });
  };

  // Silent add to default worksheet (auto-created as "默认字帖" on first call).
  // No dialog, no redirect — matches the bulk flow's UX expectation.
  const handleAdd = async (c: string) => {
    try {
      const result = await appendCharToWorksheetApi({ char: c });
      pushToast(
        'success',
        result.added ? `已添加到「${result.title}」` : `「${c}」已在「${result.title}」中`,
      );
    } catch (e: any) {
      if (e?.code === 'unauthorized') {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      pushToast('error', e?.message ?? '添加失败');
    }
  };

  // Idle-callback prefetch: warm cache for the first LIST_PREFETCH_CAP chars
  // so click-to-play is instant. Skips chars already cached (prefetchTts no-ops).
  // requestIdleCallback keeps it off the main thread; falls back to setTimeout.
  useEffect(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    const cic = (window as unknown as { cancelIdleCallback?: (handle: number) => void })
      .cancelIdleCallback;

    const schedule = (cb: () => void): number | undefined =>
      ric ? ric(cb, { timeout: 2500 }) : (setTimeout(cb, 250) as unknown as number);
    const cancel = (handle: number | undefined): void => {
      if (handle === undefined) return;
      if (cic) cic(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    };

    const targets = chars
      .slice(0, LIST_PREFETCH_CAP)
      .map((c) => c.char)
      .filter((t) => t.length > 0);

    const handles = targets.map((text) =>
      schedule(() => {
        prefetchTts('female', text).catch(() => {});
      }),
    );

    return () => {
      handles.forEach(cancel);
    };
  }, [chars]);

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