'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PoemSearch } from '@/components/poetry/PoemSearch';
import { PoemCard } from '@/components/poetry/PoemCard';
import { PoemPagination } from '@/components/poetry/PoemPagination';
import { listPoemsRequest } from '@/lib/api-poetry';
import type { Dynasty, PoemListItem } from '@/lib/poetry-types';

export default function PoetryListPage() {
  const [dynasty, setDynasty] = useState<Dynasty>('tang');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PoemListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const r = await listPoemsRequest({ dynasty, q: q || undefined, page });
        if (!cancelled) {
          setItems(r.items);
          setTotal(r.total);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [dynasty, q, page, tick]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="诗三百首 · 词三百首 · 打印字帖">古诗词</SectionTitle>
        <PoemSearch
          dynasty={dynasty}
          q={q}
          onDynastyChange={(d) => { setDynasty(d); setPage(1); }}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        {error ? (
          <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState title="无匹配诗作" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {items.map((p) => (
                <PoemCard key={p.id} poem={p} />
              ))}
            </div>
            <PoemPagination
              page={page}
              pageSize={24}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
