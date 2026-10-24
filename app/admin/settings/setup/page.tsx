import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { isSetupComplete, isSetupRouteEnabled } from '@/lib/setup';
import { SetupRouteToggle } from '@/components/admin/SetupRouteToggle';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminSetupPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const completed = await isSetupComplete();
  const enabled = await isSetupRouteEnabled();
  return (
    <div>
      <PageHeader
        title="初始化向导 (Setup Wizard)"
        description="首次部署完成后 /init 路由默认被锁定。需要重新运行 setup (例如重置 schema 或调试初始化流程) 时,先在此开启。"
      />
      <SetupRouteToggle initial={{ completed, enabled }} />
    </div>
  );
}
