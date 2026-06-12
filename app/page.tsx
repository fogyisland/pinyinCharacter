import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { BentoGrid } from '@/components/BentoGrid';
import { ValueProps } from '@/components/ValueProps';
import { Footer } from '@/components/Footer';
import { TextToPinyin } from '@/components/TextToPinyin';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <Hero />
        <BentoGrid />
        <ValueProps />

        <section className="mt-8">
          <SectionTitle subtitle="试试看">字 → 拼音 互转</SectionTitle>
          <TextToPinyin />
        </section>
      </PageContainer>
      <Footer />
    </>
  );
}
