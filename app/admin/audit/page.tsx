import Link from 'next/link';
import { getAuditLog, type AuditLogOptions } from '@/lib/admin';
import type { AuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  register: '注册', login: '登录', logout: '登出',
  history_create: '历史创建', history_delete: '历史删除',
  password_reset_request: '密码重置申请', password_reset_complete: '密码重置完成',
  admin_user_delete: '管理员删除用户',
  admin_user_password_reset: '管理员重置密码',
  admin_user_promote: '管理员提升', admin_user_demote: '管理员撤销',
};

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
      <form className="bg-white border rounded p-3 mb-4 flex flex-wrap gap-2 text-sm">
        <input type="text" name="user_id" placeholder="用户 ID" defaultValue={sp.user_id ?? ''}
          className="border rounded px-2 py-1 w-24" />
        <select name="event" defaultValue={sp.event ?? ''} className="border rounded px-2 py-1">
          <option value="">全部事件</option>
          {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ''} className="border rounded px-2 py-1" />
        <input type="date" name="to" defaultValue={sp.to ?? ''} className="border rounded px-2 py-1" />
        <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded">筛选</button>
        <Link href="/admin/audit" className="px-3 py-1 border rounded text-gray-600">清空</Link>
      </form>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
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
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">无记录</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{r.user_id ?? '—'}</td>
                <td className="px-3 py-2">{EVENT_LABEL[r.event] ?? r.event}</td>
                <td className="px-3 py-2 text-gray-500">{r.ip ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono max-w-md truncate">{r.metadata ? JSON.stringify(r.metadata) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4 text-sm">
        {page > 0 && <Link href={{ query: { ...sp, page: String(page - 1) } }} className="px-3 py-1 border rounded">← 上一页</Link>}
        <span className="px-3 py-1 text-gray-600">第 {page + 1} / {totalPages} 页</span>
        {page + 1 < totalPages && <Link href={{ query: { ...sp, page: String(page + 1) } }} className="px-3 py-1 border rounded">下一页 →</Link>}
      </div>
    </div>
  );
}
