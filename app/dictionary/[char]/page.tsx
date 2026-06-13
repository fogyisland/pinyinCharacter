import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getCharDetail } from '@/lib/chars';
import { DictionaryDetailTabs } from '@/components/dictionary/DictionaryDetailTabs';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function DictionaryDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getCharDetail(decoded);
  if (!data) notFound();
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <SectionTitle subtitle={`${data.unicodeCodepoint} · 通用规范 ${data.level} 级`}>
          <span className="text-7xl font-serif text-ink mr-3">{data.char}</span>
        </SectionTitle>
        <DictionaryDetailTabs char={data} />
      </PageContainer>
      <Footer />
    </>
  );
}