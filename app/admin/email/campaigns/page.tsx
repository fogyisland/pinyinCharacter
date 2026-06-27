import Link from 'next/link';
import { listCampaigns } from '@/lib/email-campaigns';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  sending: '发送中',
  sent: '已发送',
  failed: '失败',
  cancelled: '已取消',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-paper-warm text-ink-soft',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-paper-warm text-ink-faint',
};

export default async function CampaignsPage() {
  const rows = await listCampaigns();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">营销邮件</h1>
        <Link
          href="/admin/email/campaigns/new"
          className="px-3 py-1.5 rounded-md bg-ink text-paper text-sm hover:opacity-90"
        >
          + 新建
        </Link>
      </div>
      <p className="text-sm text-ink-soft max-w-2xl">
        群发营销通知给订阅用户。默认所有用户都收(底部退订链接一键取消)。
        发送走 scheduler 异步任务,单次 tick 处理 50 封,可放心发万级邮件。
      </p>
      <div className="border border-paper-warm rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-warm text-ink-soft">
            <tr>
              <th className="text-left px-3 py-2 font-medium">ID</th>
              <th className="text-left px-3 py-2 font-medium">主题</th>
              <th className="text-left px-3 py-2 font-medium">受众</th>
              <th className="text-left px-3 py-2 font-medium">状态</th>
              <th className="text-right px-3 py-2 font-medium">收件人</th>
              <th className="text-right px-3 py-2 font-medium">成功/失败</th>
              <th className="text-left px-3 py-2 font-medium">创建时间</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-faint">还没有营销邮件</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-paper-warm hover:bg-paper-warm/30">
                <td className="px-3 py-2 text-ink-soft">#{c.id}</td>
                <td className="px-3 py-2">{c.subject}</td>
                <td className="px-3 py-2 text-ink-soft">{c.audience}</td>
                <td className="px-3 py-2">
                  <span className={'px-2 py-0.5 rounded text-xs ' + (STATUS_COLOR[c.status] ?? '')}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.total_recipients}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.sent_count}/{c.failed_count}
                </td>
                <td className="px-3 py-2 text-ink-soft text-xs">
                  {new Date(c.created_at).toLocaleString('zh-CN')}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/email/campaigns/${c.id}`} className="text-ink hover:underline">详情 →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}