import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { listChars } from '@/lib/chars';
import { DictionaryClient } from '@/components/dictionary/DictionaryClient';
import { DictionarySearch } from '@/components/dictionary/DictionarySearch';
import { EmptyState } from '@/components/common/EmptyState';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; letter?: string; radical?: string; level?: string; page?: string; view?: string }>;
}

export default async function DictionaryPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = sp.view === 'radical' ? 'radical' : 'pinyin';
  const result = await listChars({
    q: sp.q,
    letter: view === 'pinyin' ? sp.letter : undefined,
    radical: view === 'radical' ? sp.radical : undefined,
    level: sp.level ? (Number(sp.level) as 1 | 2 | 3) : undefined,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 通用规范字典</div>
        <SectionTitle subtitle="通用规范汉字表 · 8105 字">字典</SectionTitle>

        <Suspense>
          <DictionarySearch />
        </Suspense>

        {result.chars.length === 0 ? (
          <EmptyState
            title="没有匹配的字"
            description={sp.q ? `没有匹配 "${sp.q}" 的字。` : '字典为空。'}
          />
        ) : (
          <DictionaryClient
            chars={result.chars}
            total={result.total}
            page={result.page}
            pageSize={result.pageSize}
          />
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
