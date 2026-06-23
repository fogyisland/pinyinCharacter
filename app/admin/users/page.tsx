import Link from 'next/link';
import { listUsers } from '@/lib/admin';
import { UserActions } from './UsersActions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

interface PageProps {
  searchParams: Promise<{ adminOnly?: string; disabled?: string; page?: string; q?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const adminOnly = sp.adminOnly === '1';
  const disabled = sp.disabled === '1';
  const q = sp.q?.trim() || undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  // Run all 3 counts in parallel so the chip labels show accurate numbers.
  // Counts are filtered by q so the chip total reflects "users matching
  // this search", not the global user table size.
  const listOpts = { q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const [{ users, total }, { total: totalAdmins }, { total: totalDisabled }] = await Promise.all([
    listUsers({ ...listOpts, isAdmin: adminOnly ? true : undefined, disabled: disabled ? true : undefined }),
    listUsers({ q, limit: 1, isAdmin: true }),
    listUsers({ q, limit: 1, disabled: true }),
  ]);

  const chipHref = (overrides: { adminOnly?: string; disabled?: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (overrides.adminOnly) params.set('adminOnly', overrides.adminOnly);
    if (overrides.disabled) params.set('disabled', overrides.disabled);
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : '/admin/users';
  };

  const chipClass = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded border transition-colors ${
      active
        ? 'bg-ink text-paper border-ink'
        : 'border-paper-warm text-ink hover:bg-paper-warm'
    }`;

  const showAll = !adminOnly && !disabled;
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">用户管理 (共 {total})</h1>

      <form className="card-paper rounded p-3 mb-3 flex flex-wrap gap-2 items-end text-sm" method="get">
        {adminOnly && <input type="hidden" name="adminOnly" value="1" />}
        {disabled && <input type="hidden" name="disabled" value="1" />}
        <input type="text" name="q" placeholder="搜索用户名或邮箱" defaultValue={q ?? ''}
          className="border border-ink/20 rounded px-2 py-1 w-64 bg-paper-soft" />
        <button type="submit" className="btn-seal text-sm">搜索</button>
        {q && <Link href={chipHref({})} className="px-3 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep">清空</Link>}
      </form>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Link href={chipHref({})} className={chipClass(showAll)}>全部 ({total})</Link>
        <Link href={chipHref({ adminOnly: '1' })} className={chipClass(adminOnly)}>管理员 ({totalAdmins})</Link>
        <Link href={chipHref({ disabled: '1' })} className={chipClass(disabled)}>禁用 ({totalDisabled})</Link>
      </div>

      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">用户名</th>
              <th className="px-3 py-2">注册时间</th>
              <th className="px-3 py-2">历史</th>
              <th className="px-3 py-2">收藏</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isDisabled = u.disabledAt != null;
              return (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${u.id}`} className="text-seal hover:underline">{u.username}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{new Date(u.createdAt).toLocaleString('zh-CN')}</td>
                  <td className="px-3 py-2">{u.historyCount}</td>
                  <td className="px-3 py-2">{u.favoriteCount}</td>
                  <td className="px-3 py-2">
                    {u.isAdmin
                      ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">管理员</span>
                      : <span className="text-xs text-ink-faint">用户</span>}
                  </td>
                  <td className="px-3 py-2">
                    {isDisabled
                      ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">禁用</span>
                      : <span className="text-xs text-ink-faint">正常</span>}
                  </td>
                  <td className="px-3 py-2">
                    <UserActions
                      userId={u.id}
                      username={u.username}
                      isAdmin={u.isAdmin}
                      isSelf={false}
                      isDisabled={isDisabled}
                    />
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-faint">暂无用户</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}