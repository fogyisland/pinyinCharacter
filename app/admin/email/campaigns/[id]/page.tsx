import { notFound } from 'next/navigation';
import type { RowDataPacket } from 'mysql2';
import { getCampaign } from '@/lib/email-campaigns';
import { getPool } from '@/lib/db';
import { CampaignActions } from '@/components/admin/CampaignActions';
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { StatusBadge, type BadgeTone } from '@/components/admin/StatusBadge';
import { AdminLink } from '@/components/admin/AdminButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

interface RecipientCountRow extends RowDataPacket {
  status: string;
  n: number;
}

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
  cancelled: 'warning',
};

export default async function CampaignDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();
  const c = await getCampaign(id);
  if (!c) notFound();

  // Pull recipient stats for status display.
  const pool = getPool();
  const [recipients] = await pool.query<RecipientCountRow[]>(
    `SELECT status, COUNT(*) AS n FROM email_campaign_recipients WHERE campaign_id = ? GROUP BY status`,
    [id],
  );
  const counts: Record<string, number> = {};
  for (const r of recipients) counts[r.status] = Number(r.n);

  return (
    <div>
      <PageHeader
        eyebrow="营销邮件"
        title={c.subject}
        description={
          <>
            受众: <span className="text-ink">{c.audience}</span> · 查看正文与发送进度。
          </>
        }
        actions={
          <>
            <AdminLink href="/admin/email/campaigns" variant="secondary" size="sm">
              ← 返回列表
            </AdminLink>
            <StatusBadge tone={STATUS_TONE[c.status] ?? 'neutral'}>
              {STATUS_LABEL[c.status] ?? c.status}
            </StatusBadge>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat label="收件人" value={c.total_recipients} />
        <Stat label="待发送" value={counts.pending ?? 0} color="text-info" />
        <Stat label="已发送" value={counts.sent ?? 0} color="text-success" />
        <Stat label="失败" value={counts.failed ?? 0} color="text-danger" />
        <Stat label="退订跳过" value={counts.skipped ?? 0} color="text-ink-faint" />
      </div>

      <Panel title="正文 (HTML 预览)" className="mb-4">
        <div
          className="prose prose-sm max-w-none border border-ink/10 rounded bg-paper-soft p-3"
          dangerouslySetInnerHTML={{ __html: c.html_body }}
        />
      </Panel>

      <Panel title="正文 (纯文本版本)" className="mb-4">
        <pre className="whitespace-pre-wrap text-xs bg-paper-deep/40 border border-ink/10 rounded p-3 text-ink">
          {c.text_body}
        </pre>
      </Panel>

      <CampaignActions id={c.id} status={c.status} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-paper-soft p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`text-2xl font-serif tabular-nums ${color ?? 'text-ink'}`}>{value}</div>
    </div>
  );
}
