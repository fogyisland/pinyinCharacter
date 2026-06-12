'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SutraSearch } from '@/components/sutra/SutraSearch';
import { SutraCard } from '@/components/sutra/SutraCard';
import { SutraPagination } from '@/components/sutra/SutraPagination';
import { listSutrasRequest } from '@/lib/api-sutras';
import type { SutraListItem } from '@/lib/sutra-types';

export default function SutraListPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<SutraListItem[]>([]);
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
        const r = await listSutrasRequest({ q: q || undefined, page });
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
  }, [q, page, tick]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="12 部经 · 分品块抄写">佛经选读</SectionTitle>
        <SutraSearch
          q={q}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        {error ? (
          <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState title="无匹配经文" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {items.map((s) => (
                <SutraCard key={s.id} sutra={s} />
              ))}
            </div>
            <SutraPagination
              page={page}
              pageSize={12}
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
