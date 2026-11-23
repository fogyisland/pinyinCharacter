import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '字帖生成器 — 毛笔格 · 田字格 · 打印友好 | 字·韵',
    description: '选字、选格、直接打印。田字格与毛笔格字帖，支持笔顺动画与描红，老师上课用不着另外排版。',
    path: '/worksheet',
    ogType: 'website',
  });
}

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
          {/* WorksheetGenerator calls useSearchParams() internally, which
              would trigger a Next.js <Suspense fallback> boundary. To keep
              the form visible on first paint (no flash of "加载中..."),
              the page intentionally does not wrap the component — Next.js
              will silently render the form on SSR and hydrate the URL
              params after mount (see WorksheetGenerator's useEffect). */}
          <WorksheetGenerator />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
