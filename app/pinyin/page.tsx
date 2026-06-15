import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { TextToPinyin } from '@/components/TextToPinyin';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

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
