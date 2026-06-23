import Link from 'next/link';
import { getAuditLog, type AuditLogOptions } from '@/lib/admin';
import { AUDIT_EVENTS, EVENT_LABEL, type AuditEvent } from '@/lib/audit-format';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage({ searchParams }: {
  searchParams: Promise<{ user_id?: string; event?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page ?? 0), 0);
  const limit = 50;
  const opts: AuditLogOptions = { limit, offset: page * limit };
  if (sp.user_id && /^\d+$/.test(sp.user_id)) opts.userId = Number(sp.user_id);
  if (sp.event) opts.event = sp.event as AuditEvent;
  if (sp.from) opts.from = sp.from;
  if (sp.to) opts.to = sp.to;
  const { rows, total } = await getAuditLog(opts);
  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">审计日志 (共 {total})</h1>
      <form className="card-paper rounded p-3 mb-4 flex flex-wrap gap-2 text-sm">
        <input type="text" name="user_id" placeholder="用户 ID" defaultValue={sp.user_id ?? ''}
          className="border border-ink/20 rounded px-2 py-1 w-24 bg-paper-soft" />
        <select name="event" defaultValue={sp.event ?? ''} className="border border-ink/20 rounded px-2 py-1 bg-paper-soft">
          <option value="">全部事件</option>
          {AUDIT_EVENTS.map((k) => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ''} className="border border-ink/20 rounded px-2 py-1 bg-paper-soft" />
        <input type="date" name="to" defaultValue={sp.to ?? ''} className="border border-ink/20 rounded px-2 py-1 bg-paper-soft" />
        <button type="submit" className="btn-seal text-sm">筛选</button>
        <Link href="/admin/audit" className="px-3 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep">清空</Link>
      </form>

      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">用户 ID</th>
              <th className="px-3 py-2">事件</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">元数据</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">无记录</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{r.user_id ?? '—'}</td>
                <td className="px-3 py-2">{(EVENT_LABEL as Record<string, string>)[r.event] ?? r.event}</td>
                <td className="px-3 py-2 text-ink-faint">{r.ip ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-ink-faint font-mono max-w-md truncate">{r.metadata ? JSON.stringify(r.metadata) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4 text-sm">
        {page > 0 && <Link href={{ query: { ...sp, page: String(page - 1) } }} className="px-3 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 上一页</Link>}
        <span className="px-3 py-1 text-ink-soft">第 {page + 1} / {totalPages} 页</span>
        {page + 1 < totalPages && <Link href={{ query: { ...sp, page: String(page + 1) } }} className="px-3 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep">下一页 →</Link>}
      </div>
    </div>
  );
}
