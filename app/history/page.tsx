import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { listHistory } from '@/lib/history';
import { Header } from '@/components/Header';
import { HistoryList } from '@/components/HistoryList';

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
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">{favorite ? '收藏夹' : '历史记录'}</h1>
        <div className="bg-white border rounded-lg p-4">
          <HistoryList rows={rows as unknown as Parameters<typeof HistoryList>[0]['rows']} />
        </div>
      </main>
    </>
  );
}