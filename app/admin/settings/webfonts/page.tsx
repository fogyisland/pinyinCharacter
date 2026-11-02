import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listJobs } from '@/lib/webfont/jobs';
import { PageHeader } from '@/components/admin/PageHeader';
import WebfontPipelinePanel from '@/components/admin/WebfontPipelinePanel';

export const dynamic = 'force-dynamic';

/**
 * The admin font pipeline page.
 *
 * ⚠️ The page does NOT render `<AdminShell>` — `app/admin/layout.tsx`
 * already wraps every admin page in it, and a second one would put a second
 * sidebar on the screen.
 *
 * The last ten jobs are read on the server and handed over as
 * `initialJobs`, so the first paint needs no extra round trip.
 */
export default async function AdminWebfontsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect('/login');
  const jobs = await listJobs(10);
  return (
    <div>
      <PageHeader
        title="网站字体"
        description="把「下载 → 裁轴 → 切分 → 校验」这一条流水线跑起来，然后把产物发布到服务器。发布只改服务器上的文件，回灌仓库要人工来做。"
      />
      <WebfontPipelinePanel initialJobs={jobs} />
    </div>
  );
}
