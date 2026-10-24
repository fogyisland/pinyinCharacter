'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildSutraHref, type SutraQuery } from '@/lib/sutra-url';

interface Props {
  query: SutraQuery;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The search box of the /sutra list.
 *
 * The list itself is rendered on the server, so the search term is written
 * to the URL and the server re-renders the list. The write is debounced so
 * that a burst of keystrokes results in a single navigation.
 */
export function SutraSearch({ query }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(query.q);
  // The term that was last written to the URL. The server sends it back as
  // a prop; a different value means the visitor navigated (back / forward)
  // and the input has to follow.
  const pushed = useRef(query.q);

  useEffect(() => {
    if (query.q === pushed.current) return;
    pushed.current = query.q;
    setValue(query.q);
  }, [query.q]);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === query.q.trim()) return;
    const handle = setTimeout(() => {
      pushed.current = trimmed;
      router.replace(buildSutraHref(query, { q: trimmed, page: 1 }), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, query, router]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="搜索经名..."
      className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2 text-base focus:border-seal focus:outline-none"
    />
  );
}
