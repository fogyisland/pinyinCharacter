import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getHanziStory } from '@/lib/story';
import { StoryClient } from '../StoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function StoryForCharPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getHanziStory(decoded);
  if (!data || !data.story) notFound();

  // StoryClient expects RareCharClient shape (char/pinyin/meaning/story + bookkeeping).
  // HanziStory is slimmer — adapt the three content fields and provide safe defaults
  // for the bookkeeping fields StoryClient doesn't read (needsReview/generatedBy/At/createdAt).
  const adapted = {
    char: data.char,
    story: data.story,
    pinyin: data.pinyin ?? '',
    meaning: '',
    needsReview: false,
    generatedBy: null,
    generatedAt: null,
    createdAt: '',
  };

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 一日一读</div>
        <SectionTitle subtitle="AI 生成的小故事">读故事</SectionTitle>
        <StoryClient initialChar={adapted as any} />
      </PageContainer>
      <Footer />
    </>
  );
}