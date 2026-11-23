import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChar } from '@/lib/rare-chars';
import { RareCharDetail } from '@/components/rare/RareCharDetail';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

/**
 * The rare character page's own metadata.
 *
 * Without it every one of the ~1400 rare characters shared the home page's
 * title and had no canonical — a crawler sees 1400 duplicates of one page.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data) return { title: `${decoded} | 字·韵` };
  // The story text is the only prose this record carries; cut it to a
  // description rather than shipping a whole paragraph into the <head>.
  const summary = Array.from(data.story ?? '').slice(0, 80).join('');
  return buildMetadata({
    title: `${decoded} - 拼音 ${data.pinyin} - 罕见字 | 字·韵`,
    description: summary.length > 0 ? `罕见字「${decoded}」：${summary}` : `罕见字「${decoded}」的读音与字源故事。`,
    path: `/rare-chars/${char}`,
    ogType: 'article',
  });
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
