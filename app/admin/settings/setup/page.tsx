import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { isSetupComplete, isSetupRouteEnabled } from '@/lib/setup';
import { SetupRouteToggle } from '@/components/admin/SetupRouteToggle';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">初始化向导 (Setup Wizard)</h1>
      <p className="text-sm text-ink-soft max-w-2xl">
        首次部署完成后,<code>/init</code> 路由默认被锁定。需要重新运行 setup
        (例如重置 schema 或调试初始化流程) 时,先在此开启。
      </p>
      <SetupRouteToggle initial={{ completed, enabled }} />
    </div>
  );
}