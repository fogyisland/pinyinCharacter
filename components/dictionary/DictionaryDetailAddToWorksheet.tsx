'use client';

import { useState } from 'react';
import { useToastStore } from '@/lib/toast-store';
import { appendCharToMyWorksheetApi } from '@/lib/api-worksheet';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="px-3 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-50"
    >
      {busy ? '添加中…' : '+ 字帖'}
    </button>
  );
}
