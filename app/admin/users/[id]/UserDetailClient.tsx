'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import {
  adminPromoteUser,
  adminDemoteUser,
  disableUserRequest,
  enableUserRequest,
} from '@/lib/api-admin';
import { DeleteUserDialog } from '@/components/DeleteUserDialog';
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UserActivityTab } from './UserActivityTab';
import { Panel } from '@/components/admin/Panel';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { AdminButton } from '@/components/admin/AdminButton';
import type { AdminUserRow } from '@/lib/api-admin';
import type { HistoryRow } from '@/lib/api-history';
import { formatDateTime } from '@/lib/format';

type Tab = 'detail' | 'activity';

export function UserDetailClient({
  user,
  recentHistory,
  isSelf,
  disabledAt,
}: {
  user: AdminUserRow;
  recentHistory: HistoryRow[];
  isSelf: boolean;
  disabledAt: string | Date | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('detail');
  const [showDelete, setShowDelete] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showDemote, setShowDemote] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showEnable, setShowEnable] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDisabled = disabledAt != null;

  async function doPromote() {
    setErr(null);
    const r = await adminPromoteUser(user.id);
    if (!r.ok) setErr(r.error.message);
    else router.refresh();
  }
  async function doDemote() {
    setErr(null);
    const r = await adminDemoteUser(user.id);
    if (!r.ok) setErr(r.error.message);
    else router.refresh();
  }
  async function doDisable() {
    setErr(null);
    const r = await disableUserRequest(user.id);
    if (!r.ok) setErr(r.error.message);
    else router.refresh();
  }
  async function doEnable() {
    setErr(null);
    const r = await enableUserRequest(user.id);
    if (!r.ok) setErr(r.error.message);
    else router.refresh();
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
      active
        ? 'border-ink text-ink font-semibold'
        : 'border-transparent text-ink-soft hover:text-ink'
    }`;

  return (
    <div>
      {isDisabled && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger mb-3">
          此账号已被禁用 (since {formatDateTime(disabledAt!)})。
        </div>
      )}

      <Panel title="账号信息" description="角色、状态与可执行的账号操作。">
        <div className="flex flex-wrap items-center gap-2">
          {user.isAdmin ? (
            <StatusBadge tone="primary">管理员</StatusBadge>
          ) : (
            <StatusBadge>用户</StatusBadge>
          )}
          {isDisabled ? (
            <StatusBadge tone="danger">已禁用</StatusBadge>
          ) : (
            <StatusBadge tone="success">正常</StatusBadge>
          )}
        </div>
        {err && <p className="text-sm text-danger mt-3">{err}</p>}
        {!isSelf && (
          <div className="flex gap-2 mt-4 flex-wrap">
            {isDisabled ? (
              <AdminButton
                variant="success"
                size="md"
                onClick={() => setShowEnable(true)}
              >
                启用账号
              </AdminButton>
            ) : (
              <AdminButton
                variant="danger"
                size="md"
                onClick={() => setShowDisable(true)}
              >
                禁用账号
              </AdminButton>
            )}
            <AdminButton variant="secondary" size="md" onClick={() => setShowReset(true)}>
              重置密码
            </AdminButton>
            {!user.isAdmin ? (
              <AdminButton variant="secondary" size="md" onClick={() => setShowPromote(true)}>
                提升为管理员
              </AdminButton>
            ) : (
              <AdminButton variant="secondary" size="md" onClick={() => setShowDemote(true)}>
                撤销管理员
              </AdminButton>
            )}
            <AdminButton variant="danger" size="md" onClick={() => setShowDelete(true)}>
              删除用户
            </AdminButton>
          </div>
        )}
        {isSelf && (
          <p className="text-xs text-ink-faint mt-4">
            不能对自己执行写操作,请用其他管理员账号操作。
          </p>
        )}
      </Panel>

      <div className="flex border-b border-ink/10 mt-5">
        <button
          type="button"
          onClick={() => setTab('detail')}
          className={tabClass(tab === 'detail')}
        >
          详情
        </button>
        <button
          type="button"
          onClick={() => setTab('activity')}
          className={tabClass(tab === 'activity')}
        >
          活动
        </button>
      </div>

      {tab === 'detail' ? (
        <Panel title="最近 10 条历史" flush>
          <DataTable
            rows={recentHistory}
            rowKey={(r) => r.id}
            caption="最近的历史记录"
            framed={false}
            empty={
              <EmptyState
                icon={History}
                title="暂无历史"
                description="这位用户还没有留下任何历史记录。"
              />
            }
            columns={[
              { key: 'createdAt', header: '时间', numeric: true },
              { key: 'kind', header: '类型', mobileTitle: true },
              { key: 'input', header: '输入' },
              { key: 'output', header: '输出', mobileHide: true },
              { key: 'charCount', header: '字数', numeric: true, mobileHide: true },
            ]}
          >
            {(r) => (
              <>
                <span className="text-ink-soft text-xs">{formatDateTime(r.created_at)}</span>
                <span>{r.kind}</span>
                <span className="block max-w-xs truncate">{r.input}</span>
                <span className="block max-w-xs truncate">{r.output ?? '—'}</span>
                <span>{r.char_count}</span>
              </>
            )}
          </DataTable>
        </Panel>
      ) : (
        <UserActivityTab userId={user.id} />
      )}

      <DeleteUserDialog
        userId={user.id}
        username={user.username}
        open={showDelete}
        onClose={() => setShowDelete(false)}
      />
      <ResetPasswordDialog
        userId={user.id}
        username={user.username}
        open={showReset}
        onClose={() => setShowReset(false)}
      />
      <ConfirmDialog
        open={showPromote}
        title={`将 ${user.username} 提升为管理员`}
        description="该用户将获得管理后台的完全访问权限。"
        onConfirm={doPromote}
        onClose={() => setShowPromote(false)}
      />
      <ConfirmDialog
        open={showDemote}
        title={`撤销 ${user.username} 的管理员权限`}
        description="撤销后,该用户将无法访问管理后台。"
        onConfirm={doDemote}
        onClose={() => setShowDemote(false)}
      />
      <ConfirmDialog
        open={showDisable}
        title={`禁用 ${user.username}`}
        description="该账号将被禁用,无法登录。"
        destructive
        onConfirm={doDisable}
        onClose={() => setShowDisable(false)}
      />
      <ConfirmDialog
        open={showEnable}
        title={`启用 ${user.username}`}
        description="该账号将被恢复,可以登录。"
        onConfirm={doEnable}
        onClose={() => setShowEnable(false)}
      />
    </div>
  );
}
