import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PracticeTemplate } from '@/components/worksheet/PracticeTemplate';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '练字模板 — 空格子反复临摹 | 字·韵',
    description: '空格子练字模板：田字格、米字格、四线格。适合反复临摹与课堂抄写练习，打开即打印。',
    path: '/worksheet/practice',
    ogType: 'website',
  });
}

export default function PracticeTemplatePage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="空格子模板 · 适合反复临摹">练字模板</SectionTitle>
        <PracticeTemplate />
      </PageContainer>
      <Footer />
    </>
  );
}
