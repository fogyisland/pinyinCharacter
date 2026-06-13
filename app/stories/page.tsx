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
          <SectionTitle subtitle="AI 生成的汉字故事">读故事</SectionTitle>
          <EmptyState
            title="暂无可读的故事"
            description="故事库还是空的,去字库逛逛看?"
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
        <SectionTitle subtitle="从 rare_chars 表中随机翻一个故事读">读故事</SectionTitle>
        <StoryClient initialChar={initial as unknown as RareCharClient} />
      </PageContainer>
      <Footer />
    </>
  );
}