import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listUserWorksheets } from '@/lib/worksheet';
import { hasFeature } from '@/lib/membership';
import { WorksheetHistoryList } from '@/components/worksheet/WorksheetHistoryList';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export const dynamic = 'force-dynamic';

export default async function WorksheetHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/?auth=login&next=/worksheet/history');
  const worksheets = await listUserWorksheets(user.id);
  const hasMulti = await hasFeature(user.id, 'multi_worksheet_print');
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="mb-4 flex items-end justify-between gap-3">
          <SectionTitle subtitle="保存的字帖，可继续编辑或打印">我的字帖</SectionTitle>
          <Link
            href="/worksheet"
            className="btn-seal text-sm shrink-0"
          >
            新建字帖
          </Link>
        </div>
        <div className="card-paper p-5">
          <WorksheetHistoryList worksheets={worksheets} hasMulti={hasMulti} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
