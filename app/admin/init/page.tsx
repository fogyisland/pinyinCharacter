import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { runInitChecks } from '@/lib/init-checklist';
import { InitChecklist } from '@/components/admin/InitChecklist';

export const dynamic = 'force-dynamic';

export default async function AdminInitPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const report = await runInitChecks();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">初始化检查</h1>
        <p className="text-sm text-ink-soft max-w-2xl mt-1">
          自动检测当前部署的关键配置:数据库连接、必需表、管理员、站点 URL、邮件、AI、清单文件、JWT 密钥。
          只读 — 不会修改任何数据。绿色 ✓ = 通过, 黄色 ⚠ = 建议修复, 红色 ✗ = 必须修复才能上线。
        </p>
      </div>
      <InitChecklist report={report} />
    </div>
  );
}
