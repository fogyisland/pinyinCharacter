'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: number;
  title: string;
  author: string;
  content: string[];
}

export function SaveAsWorksheetButton({ id, title, author, content }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
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
      if (res.status === 401) {
        router.push(`/?auth=login&next=/poetry/${id}`);
        return;
      }
      if (!data.ok) {
        alert('保存失败: ' + (data.error?.message ?? '未知错误'));
        return;
      }
      router.push(`/worksheet/${data.data.id}`);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className="rounded-md bg-seal px-5 py-2 text-white hover:bg-seal/80 disabled:bg-seal/40 disabled:cursor-not-allowed"
    >
      {saving ? '保存中…' : '保存到字帖'}
    </button>
  );
}
