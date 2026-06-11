import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listUserWorksheets } from '@/lib/worksheet';
import { WorksheetHistoryList } from '@/components/worksheet/WorksheetHistoryList';

export const dynamic = 'force-dynamic';

export default async function WorksheetHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/?auth=login&next=/worksheet/history');
  const worksheets = await listUserWorksheets(user.id);
  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的字帖</h1>
        <Link href="/worksheet" className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">
          新建字帖
        </Link>
      </div>
      <WorksheetHistoryList worksheets={worksheets} />
    </div>
  );
}
