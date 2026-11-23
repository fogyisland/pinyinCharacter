import { Suspense } from 'react';
import type { Metadata } from 'next';
import type { RareCharClient } from '@/lib/api-rare-chars';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getRandomStoryChar } from '@/lib/rare-chars';
import { buildMetadata } from '@/lib/seo/metadata';
import { StoryClient } from './StoryClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '读故事 — 字源演变 | 字·韵',
    description: '从甲骨文到楷书：每个字为什么长这样。按字读故事，配合字形演变与部首解析。',
    path: '/stories',
    ogType: 'website',
  });
}

export default async function StoriesPage() {
  const initial = await getRandomStoryChar();
  if (!initial) {
    return (
      <>
        <Suspense>
          <Header />
        </Suspense>
        <PageContainer>
          <SectionTitle subtitle="字源演变故事">读故事</SectionTitle>
          <EmptyState title="暂无可读的故事" description="字源故事还在生成中,稍后再来?" />
        </PageContainer>
        <Footer />
      </>
    );
  }
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">
          字 · 韵 · 一日一读
        </div>
        <SectionTitle subtitle="字源演变故事 · 任意字">读故事</SectionTitle>
        <StoryClient initialChar={initial as unknown as RareCharClient} />
      </PageContainer>
      <Footer />
    </>
  );
}
