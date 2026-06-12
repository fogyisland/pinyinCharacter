import { Suspense } from 'react';
import { DragMatchGame } from '@/components/game/DragMatchGame';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default function GamePage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="把拼音拖到对应的字上">趣味识字</SectionTitle>
        <div className="card-paper p-5">
          <DragMatchGame />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
