import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { listHistory } from '@/lib/history';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HistoryList } from '@/components/HistoryList';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default async function HistoryPage(props: { searchParams: Promise<{ favorite?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const sp = await props.searchParams;
  const favorite = sp.favorite === 'true';

  const rows = await listHistory({ userId: session.userId, favoriteOnly: favorite, limit: 200 });

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="你的转换历史与收藏">
          {favorite ? '收藏夹' : '历史记录'}
        </SectionTitle>
        <div className="card-paper p-4">
          <HistoryList rows={rows} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}