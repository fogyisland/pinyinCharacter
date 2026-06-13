'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function DictionarySearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get('q') ?? '';
  const [q, setQ] = useState(initial);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (q.trim()) {
      params.set('q', q.trim());
    } else {
      params.delete('q');
    }
    params.delete('letter');
    params.delete('radical');
    router.push(`/dictionary?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜拼音 / 汉字 / 英文"
        maxLength={32}
        className="flex-1 rounded border border-ink/30 bg-paper px-3 py-2 text-sm focus:border-seal focus:outline-none"
      />
      <button type="submit" className="btn-seal text-sm px-4">搜索</button>
    </form>
  );
}