import Link from 'next/link';
import { SearchX, Users } from 'lucide-react';
import { countUserBreakdown, listUsers } from '@/lib/admin';
import { UserActions } from './UsersActions';
import { DataTable } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/PageHeader';
import { Toolbar } from '@/components/admin/Toolbar';
import { FilterChip } from '@/components/admin/FilterChip';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { AdminButton, AdminLink } from '@/components/admin/AdminButton';
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

  const showAll = !adminOnly && !disabled;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="用户管理"
        description={`共 ${total} 位注册用户。按用户名或邮箱搜索,或用下面的筛选查看管理员与已禁用的账号。`}
      />

      <Toolbar className="mb-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          {adminOnly && <input type="hidden" name="adminOnly" value="1" />}
          {disabled && <input type="hidden" name="disabled" value="1" />}
          <input
            type="text"
            name="q"
            placeholder="搜索用户名或邮箱"
            defaultValue={q ?? ''}
            aria-label="搜索用户名或邮箱"
            className="adm-input w-64 max-w-full"
          />
          <AdminButton type="submit" variant="primary" size="sm">
            搜索
          </AdminButton>
          {q ? (
            <AdminLink href={buildHref(1, {})} variant="ghost" size="sm">
              清空
            </AdminLink>
          ) : null}
        </form>
      </Toolbar>

      <div className="flex gap-2 mb-4 flex-wrap">
        <FilterChip href={buildHref(1, {})} active={showAll}>
          全部 ({breakdown.total})
        </FilterChip>
        <FilterChip href={buildHref(1, { adminOnly: '1' })} active={adminOnly}>
          管理员 ({breakdown.admins})
        </FilterChip>
        <FilterChip href={buildHref(1, { disabled: '1' })} active={disabled}>
          禁用 ({breakdown.disabled})
        </FilterChip>
      </div>

      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        caption="注册用户列表"
        empty={
          q ? (
            <EmptyState
              icon={SearchX}
              title="没有匹配的用户"
              description={`没有用户名或邮箱包含「${q}」的账号。换个关键词,或清空搜索看全部用户。`}
            />
          ) : (
            <EmptyState icon={Users} title="暂无用户" description="还没有人注册。 " />
          )
        }
        columns={[
          { key: 'username', header: '用户名', mobileTitle: true },
          { key: 'createdAt', header: '注册时间', numeric: true },
          { key: 'historyCount', header: '历史', numeric: true },
          { key: 'favoriteCount', header: '收藏', numeric: true },
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
            <span className="text-ink-soft text-xs">{formatDateTime(u.createdAt)}</span>
            <span>{u.historyCount}</span>
            <span>{u.favoriteCount}</span>
            {u.isAdmin ? (
              <StatusBadge tone="primary">管理员</StatusBadge>
            ) : (
              <StatusBadge>用户</StatusBadge>
            )}
            {u.disabledAt != null ? (
              <StatusBadge tone="danger">禁用</StatusBadge>
            ) : (
              <StatusBadge tone="success">正常</StatusBadge>
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
      </DataTable>

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
