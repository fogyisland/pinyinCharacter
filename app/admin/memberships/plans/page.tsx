import { Crown } from 'lucide-react';
import { listPlans } from '@/lib/membership';
import { PlanRow } from '@/components/admin/memberships/PlanRow';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { EmptyState } from '@/components/admin/EmptyState';
import { AdminLink } from '@/components/admin/AdminButton';
import { SeedPlansButton } from './SeedPlansButton';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const plans = await listPlans();
  return (
    <div>
      <PageHeader
        title="套餐设置"
        description="编辑 4 档会员套餐。点击「保存」提交单行 PATCH。"
        actions={
          <>
            {plans.length === 0 && <SeedPlansButton />}
            <AdminLink href="/admin/memberships" variant="secondary" size="sm">
              ← 返回会员列表
            </AdminLink>
          </>
        }
      />

      <Panel title="会员套餐" description="价格、时长、排序与附带的权限。" flush>
        {plans.length === 0 ? (
          <EmptyState
            icon={Crown}
            title="暂无套餐"
            description="点右上「初始化 4 档套餐」写入默认的四档会员套餐。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="rt-table w-full text-sm">
              <thead className="bg-paper-deep text-left">
                <tr>
                  <th className="px-3 py-2">plan_key</th>
                  <th className="px-3 py-2">显示名</th>
                  <th className="px-3 py-2">天数</th>
                  <th className="px-3 py-2">金额</th>
                  <th className="px-3 py-2">启用</th>
                  <th className="px-3 py-2">排序</th>
                  <th className="px-3 py-2">权限</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <PlanRow key={p.id} plan={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
