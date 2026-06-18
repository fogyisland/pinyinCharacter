import { Suspense } from 'react';
import type { RareCharClient } from '@/lib/api-rare-chars';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getRandomStoryChar } from '@/lib/rare-chars';
import { StoryClient } from './StoryClient';

export const dynamic = 'force-dynamic';

export default async function StoriesPage() {
  const initial = await getRandomStoryChar();
  if (!initial) {
    return (
      <>
        <Suspense><Header /></Suspense>
        <PageContainer>
          <SectionTitle subtitle="字源演变故事">读故事</SectionTitle>
          <EmptyState
            title="暂无可读的故事"
            description="字源故事还在生成中,稍后再来?"
          />
        </PageContainer>
        <Footer />
      </>
    );
  }
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 一日一读</div>
        <SectionTitle subtitle="字源演变故事 · 任意字">读故事</SectionTitle>
        <StoryClient initialChar={initial as unknown as RareCharClient} />
      </PageContainer>
      <Footer />
    </>
  );
}