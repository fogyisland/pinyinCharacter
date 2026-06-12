import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getChar } from '@/lib/rare-chars';
import { RareCharDetail } from '@/components/rare/RareCharDetail';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function RareCharDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data) notFound();
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <RareCharDetail data={data} />
      </PageContainer>
      <Footer />
    </>
  );
}
