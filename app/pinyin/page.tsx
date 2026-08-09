import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { TextToPinyin } from '@/components/TextToPinyin';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '汉字拼音互转工具',
    description: '汉字与拼音实时互转, 支持多音字识别、AI 拍照识别、AI 字义解释。',
    path: '/pinyin',
    ogType: 'website',
  });
}

export default function PinyinPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <SectionTitle subtitle="整句智能转换">字 → 拼音 互转</SectionTitle>
        <TextToPinyin />
      </PageContainer>
      <Footer />
    </>
  );
}
