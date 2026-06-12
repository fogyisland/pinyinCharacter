import { Suspense } from 'react';
import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default function WorksheetPage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="毛笔格 · 田字格 · 打印友好">字帖生成</SectionTitle>
        <div className="card-paper p-5">
          <Suspense fallback={<div>加载中...</div>}>
            <WorksheetGenerator />
          </Suspense>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
