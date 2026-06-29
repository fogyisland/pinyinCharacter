'use client';

import { useRouter, usePathname } from 'next/navigation';
import { appendCharToWorksheetApi } from '@/lib/api-worksheet';
import { useToastStore } from '@/lib/toast-store';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pushToast = useToastStore((s) => s.push);

  // Silent add to default worksheet (auto-created as "默认字帖" on first call).
  const handleAdd = async () => {
    try {
      const result = await appendCharToWorksheetApi({ char });
      pushToast(
        'success',
        result.added ? `已添加到「${result.title}」` : `「${char}」已在「${result.title}」中`,
      );
    } catch (e: any) {
      if (e?.code === 'unauthorized') {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      pushToast('error', e?.message ?? '添加失败');
    }
  };

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
    >
      + 字帖
    </button>
  );
}