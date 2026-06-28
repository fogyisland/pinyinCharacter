import { Suspense } from 'react';
import { PracticeTemplate } from '@/components/worksheet/PracticeTemplate';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

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
