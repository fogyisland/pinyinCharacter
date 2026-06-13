import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';
import { EtymologyTimeline } from '@/components/etymology/EtymologyTimeline';
import { EtymologyPrevNext } from '@/components/etymology/EtymologyPrevNext';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function EtymologyPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const [etymology, adjacent] = await Promise.all([
    getEtymology(decoded),
    getAdjacentChars(decoded),
  ]);
  if (!etymology) notFound();
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="flex items-center justify-between mb-4">
          <Link
            href={`/dictionary/${encodeURIComponent(decoded)}`}
            className="text-sm text-ink-soft hover:text-ink"
          >
            ← 返回字典
          </Link>
          <span className="text-xs text-ink-faint tracking-widest">
            字 · 韵 · 字源
          </span>
        </div>
        <SectionTitle subtitle={etymology.story ? '字形演变故事' : '字源即将生成'}>
          字源
        </SectionTitle>
        <EtymologyTimeline
          char={etymology.char}
          eraGlyphs={etymology.eraGlyphs}
          story={etymology.story}
        />
        <EtymologyPrevNext prev={adjacent.prev} next={adjacent.next} />
      </PageContainer>
      <Footer />
    </>
  );
}
