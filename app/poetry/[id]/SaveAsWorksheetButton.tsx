'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';

interface Props {
  id: number;
  title: string;
  author: string;
  content: string[];
}

export function SaveAsWorksheetButton({ id, title, author, content }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAppStore(s => s.user);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const goLogin = () => router.push(`/login?next=${encodeURIComponent(pathname)}`);

  const handleSave = async () => {
    if (!user) {
      setHint('需要登录才能保存');
      goLogin();
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const chars = content.join('').split('');
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `《${title}》${author}`,
          content: chars,
          cellStyle: 'brush',
        }),
      });
      const data = await res.json();
      if (res.status === 401 || data.error?.code === 'unauthenticated') {
        setHint('需要登录才能保存');
        goLogin();
        return;
      }
      if (!data.ok) {
        setHint(data.error?.message ?? '保存失败');
        return;
      }
      router.push(`/worksheet/${data.data.id}`);
    } catch (err) {
      setHint((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-seal px-5 py-2 text-white hover:bg-seal/80 disabled:bg-seal/40 disabled:cursor-not-allowed"
      >
        {saving ? '保存中…' : '保存到字帖'}
      </button>
      {hint && !user && (
        <span className="text-xs text-ink-soft">{hint}</span>
      )}
    </div>
  );
}
