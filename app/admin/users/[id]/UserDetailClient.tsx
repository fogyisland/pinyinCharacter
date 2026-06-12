'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminPromoteUser, adminDemoteUser } from '@/lib/api-admin';
import { DeleteUserDialog } from '@/components/DeleteUserDialog';
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { AdminUserRow } from '@/lib/api-admin';
import type { HistoryRow } from '@/lib/api-history';

export function UserDetailClient({ user, recentHistory, isSelf }: {
  user: AdminUserRow; recentHistory: HistoryRow[]; isSelf: boolean;
}) {
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const [showDemote, setShowDemote] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doPromote() {
    setErr(null);
    const r = await adminPromoteUser(user.id);
    if (!r.ok) setErr(r.error.message); else router.refresh();
  }
  async function doDemote() {
    setErr(null);
    const r = await adminDemoteUser(user.id);
    if (!r.ok) setErr(r.error.message); else router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card-paper rounded-lg p-4">
        <h1 className="text-xl font-semibold">{user.username}</h1>
        <p className="text-sm text-ink-soft">注册时间: {new Date(user.createdAt).toLocaleString('zh-CN')}</p>
        <p className="text-sm text-ink-soft">历史: {user.historyCount} / 收藏: {user.favoriteCount}</p>
        <p className="text-sm mt-1">
          角色: {user.isAdmin
            ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">管理员</span>
            : <span className="text-xs text-ink-faint">用户</span>}
        </p>
        {err && <p className="text-sm text-seal mt-2">{err}</p>}
        <div className="flex gap-2 mt-4 flex-wrap">
          {!isSelf && (
            <>
              <button type="button" onClick={() => setShowReset(true)}
                className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">重置密码</button>
              {!user.isAdmin
                ? <button type="button" onClick={() => setShowPromote(true)}
                    className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">提升为管理员</button>
                : <button type="button" onClick={() => setShowDemote(true)}
                    className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">撤销管理员</button>}
              <button type="button" onClick={() => setShowDelete(true)}
                className="text-sm px-3 py-1.5 border border-seal/40 rounded text-seal hover:bg-seal/10">删除用户</button>
            </>
          )}
          {isSelf && <p className="text-xs text-ink-faint">不能对自己执行写操作,请用其他管理员账号操作。</p>}
        </div>
      </div>

      <div className="card-paper rounded-lg overflow-hidden">
        <h2 className="px-4 py-2 text-sm font-semibold bg-paper-deep">最近 10 条历史</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft">
            <th className="px-3 py-2">时间</th><th className="px-3 py-2">类型</th>
            <th className="px-3 py-2">输入</th><th className="px-3 py-2">输出</th>
            <th className="px-3 py-2">字数</th>
          </tr></thead>
          <tbody>
            {recentHistory.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-faint">暂无</td></tr>
            )}
            {recentHistory.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-ink-soft">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">{r.kind}</td>
                <td className="px-3 py-2 truncate max-w-xs">{r.input}</td>
                <td className="px-3 py-2 truncate max-w-xs">{r.output ?? '—'}</td>
                <td className="px-3 py-2">{r.char_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeleteUserDialog userId={user.id} username={user.username}
        open={showDelete} onClose={() => setShowDelete(false)} />
      <ResetPasswordDialog userId={user.id} username={user.username}
        open={showReset} onClose={() => setShowReset(false)} />
      <ConfirmDialog open={showPromote} title={`将 ${user.username} 提升为管理员`}
        description="该用户将获得管理后台的完全访问权限。"
        onConfirm={doPromote} onClose={() => setShowPromote(false)} />
      <ConfirmDialog open={showDemote} title={`撤销 ${user.username} 的管理员权限`}
        description="撤销后,该用户将无法访问管理后台。"
        onConfirm={doDemote} onClose={() => setShowDemote(false)} />
    </div>
  );
}
