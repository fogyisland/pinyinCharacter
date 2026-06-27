import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCampaign } from '@/lib/email-campaigns';
import { getPool } from '@/lib/db';
import { CampaignActions } from '@/components/admin/CampaignActions';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', sending: '发送中', sent: '已发送', failed: '失败', cancelled: '已取消',
};

export default async function CampaignDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();
  const c = await getCampaign(id);
  if (!c) notFound();

  // Pull recipient stats for status display.
  const pool = getPool();
  const [recipients] = await pool.query<any[]>(
    `SELECT status, COUNT(*) AS n FROM email_campaign_recipients WHERE campaign_id = ? GROUP BY status`,
    [id]
  );
  const counts: Record<string, number> = {};
  for (const r of recipients) counts[r.status] = Number(r.n);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/email/campaigns" className="text-sm text-ink-soft hover:text-ink">← 返回列表</Link>
          <h1 className="text-xl font-semibold mt-1">{c.subject}</h1>
        </div>
        <div className="text-sm text-ink-soft">
          <span className="mr-2">受众: <span className="text-ink">{c.audience}</span></span>
          <span className="px-2 py-0.5 rounded bg-paper-warm">{STATUS_LABEL[c.status] ?? c.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="收件人" value={c.total_recipients} />
        <Stat label="待发送" value={counts.pending ?? 0} color="text-blue-700" />
        <Stat label="已发送" value={counts.sent ?? 0} color="text-emerald-700" />
        <Stat label="失败" value={counts.failed ?? 0} color="text-red-700" />
        <Stat label="退订跳过" value={counts.skipped ?? 0} color="text-ink-faint" />
      </div>

      <div className="border border-paper-warm rounded-md p-4 space-y-3">
        <h2 className="text-sm font-medium text-ink-soft">正文 (HTML 预览)</h2>
        <div
          className="prose prose-sm max-w-none border border-paper-warm rounded p-3 bg-white"
          dangerouslySetInnerHTML={{ __html: c.html_body }}
        />
      </div>

      <div className="border border-paper-warm rounded-md p-4 space-y-3">
        <h2 className="text-sm font-medium text-ink-soft">正文 (纯文本版本)</h2>
        <pre className="whitespace-pre-wrap text-xs bg-paper-warm/30 p-3 rounded">{c.text_body}</pre>
      </div>

      <CampaignActions id={c.id} status={c.status} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="border border-paper-warm rounded p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={'text-2xl font-semibold tabular-nums ' + (color ?? 'text-ink')}>{value}</div>
    </div>
  );
}