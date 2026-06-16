import Link from 'next/link';
import { listPlans } from '@/lib/membership';
import { PlanRow } from '@/components/admin/memberships/PlanRow';
import { SeedPlansButton } from './SeedPlansButton';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const plans = await listPlans();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">套餐设置</h1>
          <p className="text-sm text-ink-soft">编辑 4 档会员套餐。点击「保存」提交单行 PATCH。</p>
        </div>
        <div className="flex gap-2">
          {plans.length === 0 && <SeedPlansButton />}
          <Link href="/admin/memberships" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 返回会员列表</Link>
        </div>
      </div>
      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
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
            {plans.map(p => <PlanRow key={p.id} plan={p} />)}
            {plans.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-faint">暂无套餐,点右上「初始化」</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
