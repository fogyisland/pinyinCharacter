import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { GameModeTabs } from '@/components/game/GameModeTabs';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '汉字小游戏',
    description: '声调匹配、部首匹配、拼音接龙, 在游戏中学习汉字。',
    path: '/game',
    ogType: 'website',
  });
}

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
