import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStats } from '@/lib/history';
import { Header } from '@/components/Header';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const stats = await getStats(session.userId);

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">我的主页</h1>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500">总字数</p>
            <p className="text-4xl font-bold mt-2">{stats.total}</p>
          </div>
          <div className="bg-white border rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500">收藏字数</p>
            <p className="text-4xl font-bold mt-2">{stats.favorites}</p>
          </div>
        </div>
      </main>
    </>
  );
}