import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getChar } from '@/lib/rare-chars';
import type { RareCharClient } from '@/lib/api-rare-chars';
import { StoryClient } from '../StoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function StoryForCharPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getChar(decoded);
  if (!data || !data.story) notFound();
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 一日一读</div>
        <SectionTitle subtitle="AI 生成的小故事">读故事</SectionTitle>
        <StoryClient initialChar={data as unknown as RareCharClient} />
      </PageContainer>
      <Footer />
    </>
  );
}