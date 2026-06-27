import Link from 'next/link';
import { listCampaigns } from '@/lib/email-campaigns';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';

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
      <ResponsiveTable
        rows={rows}
        rowKey={(c) => c.id}
        emptyMessage="还没有营销邮件"
        columns={[
          { key: 'id', header: 'ID', mobileHide: true },
          { key: 'subject', header: '主题', mobileTitle: true },
          { key: 'audience', header: '受众' },
          { key: 'status', header: '状态' },
          { key: 'total', header: '收件人', headerClassName: 'text-right' },
          { key: 'sent', header: '成功/失败', headerClassName: 'text-right' },
          { key: 'createdAt', header: '创建时间', mobileHide: true },
        ]}
      >
        {(c) => (
          <>
            <span className="text-ink-soft">#{c.id}</span>
            <Link href={`/admin/email/campaigns/${c.id}`} className="text-ink hover:underline">{c.subject}</Link>
            <span className="text-ink-soft">{c.audience}</span>
            <span className={'px-2 py-0.5 rounded text-xs ' + (STATUS_COLOR[c.status] ?? '')}>
              {STATUS_LABEL[c.status] ?? c.status}
            </span>
            <span className="text-right tabular-nums block">{c.total_recipients}</span>
            <span className="text-right tabular-nums block">{`${c.sent_count}/${c.failed_count}`}</span>
            <span className="text-ink-soft text-xs">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
          </>
        )}
      </ResponsiveTable>
    </div>
  );
}