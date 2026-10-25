import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { QuestTabs } from '@/components/game/quest/QuestTabs';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '汉字小游戏',
    description: '一字一关的汉字闯关：读音、声调、部首、词义四关全考，通关的字会收进字卡册。',
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
        <SectionTitle subtitle="一字一关 · 读音 声调 部首 词义">趣味识字</SectionTitle>
        <div className="card-paper p-5">
          <QuestTabs />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
