'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function RareCharSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get('q') ?? '');

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (value) params.set('q', value);
      else params.delete('q');
      params.delete('page');
      router.replace(`/rare-chars?${params.toString()}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, router, sp]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="按字或拼音搜索..."
      className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
    />
  );
}
