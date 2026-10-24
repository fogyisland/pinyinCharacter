import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PoetryFilters } from '@/components/poetry/PoetryFilters';
import { PoemCard } from '@/components/poetry/PoemCard';
import { PoemPagination } from '@/components/poetry/PoemPagination';
import { getAvailableForms, listPoems } from '@/lib/poetry';
import {
  POETRY_PAGE_SIZE,
  buildPoetryHref,
  parsePoetryQuery,
  type PoetryQuery,
} from '@/lib/poetry-url';

// The list is rendered on the server, so the route depends on the query
// string and cannot be prerendered.
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PoetryListPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parsePoetryQuery(params);
  const availableForms = await getAvailableForms(query.dynasty);
  // A form that the current dynasty does not offer is dropped, so the URL
  // and the filter bar always agree.
  const effectiveQuery: PoetryQuery = {
    ...query,
    forms: query.forms.filter((form) => availableForms.includes(form)),
  };

  let result;
  try {
    result = await listPoems({
      dynasty: effectiveQuery.dynasty,
      q: effectiveQuery.q || undefined,
      forms: effectiveQuery.forms.length > 0 ? effectiveQuery.forms : undefined,
      page: effectiveQuery.page,
      pageSize: POETRY_PAGE_SIZE,
    });
  } catch (error) {
    console.error('Failed to load the poem list', error);
    return (
      <>
        <Header />
        <PageContainer>
          <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
          <SectionTitle subtitle="诗三百首 · 词三百首 · 打印字帖">古诗词</SectionTitle>
          <ErrorState
            message={error instanceof Error ? error.message : '诗词加载失败'}
            retryHref={buildPoetryHref(effectiveQuery)}
          />
        </PageContainer>
        <Footer />
      </>
    );
  }

  const backHref = buildPoetryHref(effectiveQuery);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="诗三百首 · 词三百首 · 打印字帖">古诗词</SectionTitle>
        <PoetryFilters query={effectiveQuery} availableForms={availableForms} />
        {result.items.length === 0 ? (
          <EmptyState title="无匹配诗作" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {result.items.map((poem) => (
                <PoemCard key={poem.id} poem={poem} backHref={backHref} />
              ))}
            </div>
            <PoemPagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              buildHref={(target) => buildPoetryHref(effectiveQuery, { page: target })}
            />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
