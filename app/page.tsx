import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { BentoGrid } from '@/components/BentoGrid';
import { ValueProps } from '@/components/ValueProps';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

/**
 * The home page's own metadata.
 *
 * `buildMetadata` supplies the canonical link plus the og/twitter tags. Without
 * it the page inherits the layout's title (which is the same string) but gets
 * NO canonical — and a missing canonical is a duplicate-page signal once the
 * site is linked from anywhere with a tracking parameter.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '字·韵 — 汉字与拼音互转',
    description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、听写练习、游戏识字。',
    path: '/',
    ogType: 'website',
  });
}

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
      </PageContainer>
      <Footer />
    </>
  );
}
