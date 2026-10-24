'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PoemSearch } from './PoemSearch';
import { FormFilterBar } from './FormFilterBar';
import { buildPoetryHref, type PoetryQuery } from '@/lib/poetry-url';

interface Props {
  query: PoetryQuery;
  availableForms: string[];
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The filter bar of the /poetry list.
 *
 * The list itself is rendered on the server, so this island only owns the
 * filter controls. Every change is written to the URL, which makes the
 * server re-render the list with the new filter.
 */
export function PoetryFilters({ query, availableForms }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(query.q);
  // The q that was last written to the URL. The server sends it back as a
  // prop; a different value means the visitor navigated (back / forward)
  // and the input has to follow.
  const pushed = useRef(query.q);

  useEffect(() => {
    if (query.q === pushed.current) return;
    pushed.current = query.q;
    setValue(query.q);
  }, [query.q]);

  // The search box is debounced so that a burst of keystrokes results in a
  // single navigation.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === query.q.trim()) return;
    const handle = setTimeout(() => {
      pushed.current = trimmed;
      router.replace(buildPoetryHref(query, { q: trimmed, page: 1 }), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, query, router]);

  function navigate(overrides: Partial<PoetryQuery>) {
    const trimmed = value.trim();
    pushed.current = trimmed;
    router.replace(buildPoetryHref(query, { q: trimmed, page: 1, ...overrides }));
  }

  function handleDynastyChange(dynasty: string) {
    // A dynasty has its own set of forms, so the form filter is dropped.
    navigate({ dynasty, forms: [] });
  }

  function handleFormChange(forms: string[]) {
    navigate({ forms });
  }

  return (
    <>
      <PoemSearch
        dynasty={query.dynasty}
        q={value}
        onDynastyChange={handleDynastyChange}
        onQChange={(next) => setValue(next)}
      />
      <FormFilterBar
        category={query.dynasty}
        availableForms={availableForms}
        selectedForms={query.forms}
        onChange={handleFormChange}
      />
    </>
  );
}
