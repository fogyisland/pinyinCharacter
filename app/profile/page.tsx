import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getStats } from '@/lib/history';
import { listUserWorksheets } from '@/lib/worksheet';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { WorksheetHistoryList } from '@/components/worksheet/WorksheetHistoryList';
import { MembershipStatusCard } from '@/components/membership/MembershipStatusCard';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect('/?auth=login');

  const stats = await getStats(session.userId);
  const worksheets = await listUserWorksheets(session.userId);

  const statCards = [
    { label: '总字数', value: stats.total },
    { label: '收藏字数', value: stats.favorites },
    { label: '已存字帖', value: worksheets.length },
  ];

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="你的汉字学习足迹">个人主页</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          {statCards.map(s => (
            <div key={s.label} className="card-paper p-4 text-center">
              <div className="font-kai text-3xl text-ink">{s.value}</div>
              <div className="text-xs text-ink-soft mt-1">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <MembershipStatusCard userId={session.userId} />
        </div>
        <div className="mt-10 mb-4 flex items-end justify-between gap-3">
          <SectionTitle subtitle="保存的字帖，可继续编辑或打印">我的字帖</SectionTitle>
          <Link href="/worksheet" className="btn-seal text-sm shrink-0">
            新建字帖
          </Link>
        </div>
        <div className="card-paper p-5">
          <WorksheetHistoryList worksheets={worksheets} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}