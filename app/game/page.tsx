import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { GameModeTabs } from '@/components/game/GameModeTabs';

export const dynamic = 'force-dynamic';

export default function GamePage() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="声调·部首 或 拼音·字 两种玩法">趣味识字</SectionTitle>
        <div className="card-paper p-5">
          <GameModeTabs />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
