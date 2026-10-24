import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { runInitChecks } from '@/lib/init-checklist';
import { InitChecklist } from '@/components/admin/InitChecklist';
import { PageHeader } from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminInitPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') redirect('/?auth=login');
    redirect('/?error=forbidden');
  }
  const report = await runInitChecks();
  return (
    <div>
      <PageHeader
        title="初始化检查"
        description="自动检测当前部署的关键配置:数据库连接、必需表、管理员、站点 URL、邮件、AI、清单文件、JWT 密钥。只读 — 不会修改任何数据。绿色 ✓ = 通过, 黄色 ⚠ = 建议修复, 红色 ✗ = 必须修复才能上线。"
      />
      {/* InitChecklist brings its own panels — wrapping it again would stack
          a card inside a card. */}
      <InitChecklist report={report} />
    </div>
  );
}
