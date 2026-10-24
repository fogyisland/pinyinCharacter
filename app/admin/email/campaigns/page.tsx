import Link from 'next/link';
import { Mail } from 'lucide-react';
import { listCampaignSummaries } from '@/lib/email-campaigns';
import { DataTable } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { AdminLink } from '@/components/admin/AdminButton';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  sending: '发送中',
  sent: '已发送',
  failed: '失败',
  cancelled: '已取消',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function CampaignsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);

  // The summary query leaves `html_body` / `text_body` behind — the list
  // only shows the subject and the counters, and a full mail is several KB.
  const { rows, total } = await listCampaignSummaries(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (target: number) =>
    target > 1 ? `/admin/email/campaigns?page=${target}` : '/admin/email/campaigns';

  return (
    <div>
      <PageHeader
        title="营销邮件"
        description="群发营销通知给订阅用户。默认所有用户都收(底部退订链接一键取消)。发送走 scheduler 异步任务,单次 tick 处理 50 封,可放心发万级邮件。"
        actions={
          <AdminLink href="/admin/email/campaigns/new" variant="primary" size="sm">
            + 新建
          </AdminLink>
        }
      />

      <Panel title="邮件列表" description="按创建时间倒序排列的群发任务。" flush>
        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          caption="营销邮件列表"
          framed={false}
          empty={
            <EmptyState
              icon={Mail}
              title="还没有营销邮件"
              description="点右上「+ 新建」写一封群发通知。"
            />
          }
          columns={[
            { key: 'id', header: 'ID', mobileHide: true, numeric: true },
            { key: 'subject', header: '主题', mobileTitle: true },
            { key: 'audience', header: '受众' },
            { key: 'status', header: '状态' },
            { key: 'total', header: '收件人', numeric: true },
            { key: 'sent', header: '成功/失败', numeric: true },
            { key: 'createdAt', header: '创建时间', numeric: true, mobileHide: true },
          ]}
        >
          {(c) => (
            <>
              <span className="text-ink-faint tabular-nums">#{c.id}</span>
              <Link href={`/admin/email/campaigns/${c.id}`} className="text-ink hover:underline">
                {c.subject}
              </Link>
              <span className="text-ink-soft">{c.audience}</span>
              <StatusBadge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                {STATUS_LABEL[c.status] ?? c.status}
              </StatusBadge>
              <span>{c.total_recipients}</span>
              <span>{`${c.sent_count}/${c.failed_count}`}</span>
              <span className="text-ink-soft text-xs">{formatDateTime(c.created_at)}</span>
            </>
          )}
        </DataTable>
      </Panel>

      <div className="mt-4">
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          buildHref={buildHref}
        />
      </div>
    </div>
  );
}
