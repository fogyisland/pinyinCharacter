import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getHanziStory } from '@/lib/story';
import type { RareCharClient } from '@/lib/api-rare-chars';
import { buildMetadata } from '@/lib/seo/metadata';
import { StoryClient } from '../StoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

/** Each story page needs its own title; ~7900 of them share this route. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getHanziStory(decoded);
  if (!data || !data.story) return { title: `${decoded} | 字·韵` };
  const pinyin = data.pinyin ? `（${data.pinyin}）` : '';
  const summary = Array.from(data.story).slice(0, 90).join('');
  return buildMetadata({
    title: `「${decoded}」${pinyin}的字源故事 | 字·韵`,
    description: summary,
    path: `/stories/${char}`,
    ogType: 'article',
  });
}

export default async function StoryForCharPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getHanziStory(decoded);
  if (!data || !data.story) notFound();

  // StoryClient expects RareCharClient shape (char/pinyin/meaning/story + bookkeeping).
  // HanziStory is slimmer — adapt the three content fields and provide safe defaults
  // for the bookkeeping fields StoryClient doesn't read (needsReview/generatedBy/At/createdAt).
  const adapted: RareCharClient = {
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
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">
          字 · 韵 · 一日一读
        </div>
        <SectionTitle subtitle="字源演变故事">读故事</SectionTitle>
        <StoryClient initialChar={adapted} />
      </PageContainer>
      <Footer />
    </>
  );
}
