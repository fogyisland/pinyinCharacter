import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SutraSearch } from '@/components/sutra/SutraSearch';
import { SutraCard } from '@/components/sutra/SutraCard';
import { SutraPagination } from '@/components/sutra/SutraPagination';
import { listSutras } from '@/lib/sutras';
import { SUTRA_PAGE_SIZE, buildSutraHref, parseSutraQuery } from '@/lib/sutra-url';

// The list is rendered on the server, so the route depends on the query
// string and cannot be prerendered.
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SutraListPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseSutraQuery(params);

  let result;
  try {
    result = await listSutras({
      q: query.q || undefined,
      page: query.page,
      pageSize: SUTRA_PAGE_SIZE,
    });
  } catch (error) {
    console.error('Failed to load the sutra list', error);
    return (
      <>
        <Header />
        <PageContainer>
          <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
          <SectionTitle subtitle="12 部经 · 分品块抄写">佛经选读</SectionTitle>
          <ErrorState
            message={error instanceof Error ? error.message : '经文加载失败'}
            retryHref={buildSutraHref(query)}
          />
        </PageContainer>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="12 部经 · 分品块抄写">佛经选读</SectionTitle>
        <SutraSearch query={query} />
        {result.items.length === 0 ? (
          <EmptyState title="无匹配经文" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {result.items.map((sutra) => (
                <SutraCard key={sutra.id} sutra={sutra} />
              ))}
            </div>
            <SutraPagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              buildHref={(target) => buildSutraHref(query, { page: target })}
            />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
