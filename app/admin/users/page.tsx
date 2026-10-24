import Link from 'next/link';
import { countUserBreakdown, listUsers } from '@/lib/admin';
import { UserActions } from './UsersActions';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import { Pagination } from '@/components/admin/Pagination';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ adminOnly?: string; disabled?: string; page?: string; q?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const adminOnly = sp.adminOnly === '1';
  const disabled = sp.disabled === '1';
  const q = sp.q?.trim() || undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  // The list and the chip counters are independent queries, so they run
  // together. The counters come from one conditional-aggregation query
  // instead of two `listUsers({ limit: 1 })` calls, which used to pay for a
  // full-table history aggregate each.
  const [{ users, total }, breakdown] = await Promise.all([
    listUsers({
      q,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      isAdmin: adminOnly ? true : undefined,
      disabled: disabled ? true : undefined,
    }),
    countUserBreakdown(q),
  ]);

  /**
   * The href of a target page. Changing a filter resets to page 1 — staying
   * on page 7 of a filter that now has two pages would show an empty list.
   */
  const buildHref = (
    target: number,
    overrides: { adminOnly?: string; disabled?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const admin = overrides.adminOnly ?? (adminOnly ? '1' : '');
    const dis = overrides.disabled ?? (disabled ? '1' : '');
    if (admin) params.set('adminOnly', admin);
    if (dis) params.set('disabled', dis);
    if (target > 1) params.set('page', String(target));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : '/admin/users';
  };

  const chipClass = (active: boolean) =>
    `text-xs px-3 py-1.5 rounded border transition-colors ${
      active ? 'bg-ink text-paper border-ink' : 'border-paper-warm text-ink hover:bg-paper-warm'
    }`;

  const showAll = !adminOnly && !disabled;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">用户管理 (共 {total})</h1>

      <form
        className="card-paper rounded p-3 mb-3 flex flex-wrap gap-2 items-end text-sm"
        method="get"
      >
        {adminOnly && <input type="hidden" name="adminOnly" value="1" />}
        {disabled && <input type="hidden" name="disabled" value="1" />}
        <input
          type="text"
          name="q"
          placeholder="搜索用户名或邮箱"
          defaultValue={q ?? ''}
          className="border border-ink/20 rounded px-2 py-1 w-64 bg-paper-soft"
        />
        <button type="submit" className="btn-seal text-sm">
          搜索
        </button>
        {q && (
          <Link
            href={buildHref(1, {})}
            className="px-3 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep"
          >
            清空
          </Link>
        )}
      </form>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Link href={buildHref(1, {})} className={chipClass(showAll)}>
          全部 ({breakdown.total})
        </Link>
        <Link href={buildHref(1, { adminOnly: '1' })} className={chipClass(adminOnly)}>
          管理员 ({breakdown.admins})
        </Link>
        <Link href={buildHref(1, { disabled: '1' })} className={chipClass(disabled)}>
          禁用 ({breakdown.disabled})
        </Link>
      </div>

      <ResponsiveTable
        rows={users}
        rowKey={(u) => u.id}
        emptyMessage="暂无用户"
        columns={[
          { key: 'username', header: '用户名', mobileTitle: true },
          { key: 'createdAt', header: '注册时间' },
          { key: 'historyCount', header: '历史' },
          { key: 'favoriteCount', header: '收藏' },
          { key: 'isAdmin', header: '角色' },
          { key: 'status', header: '状态' },
          { key: 'actions', header: '操作', mobileHide: true },
        ]}
      >
        {(u) => (
          <>
            <Link href={`/admin/users/${u.id}`} className="text-seal hover:underline">
              {u.username}
            </Link>
            <span className="text-ink-soft text-xs">
              {formatDateTime(u.createdAt)}
            </span>
            <span>{u.historyCount}</span>
            <span>{u.favoriteCount}</span>
            {u.isAdmin ? (
              <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">管理员</span>
            ) : (
              <span className="text-xs text-ink-faint">用户</span>
            )}
            {u.disabledAt != null ? (
              <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">禁用</span>
            ) : (
              <span className="text-xs text-ink-faint">正常</span>
            )}
            <UserActions
              userId={u.id}
              username={u.username}
              isAdmin={u.isAdmin}
              isSelf={false}
              isDisabled={u.disabledAt != null}
            />
          </>
        )}
      </ResponsiveTable>

      <div className="mt-4">
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          buildHref={(target) => buildHref(target)}
          unit="人"
        />
      </div>
    </div>
  );
}
