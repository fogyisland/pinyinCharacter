'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  disableUserRequest,
  enableUserRequest,
  adminPromoteUser,
  adminDemoteUser,
} from '@/lib/api-admin';
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog';
import { AdminButton } from '@/components/admin/AdminButton';

export function UserActions({
  userId,
  username,
  isAdmin,
  isSelf,
  isDisabled,
}: {
  userId: number;
  username: string;
  isAdmin: boolean;
  isSelf: boolean;
  isDisabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function withConfirm(label: string, fn: () => Promise<void>) {
    if (!window.confirm(label)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    await withConfirm(`确定禁用 ${username}?`, async () => {
      const r = await disableUserRequest(userId);
      if (!r.ok) throw new Error(r.error.message);
      setMsg(`${username} 已被禁用`);
    });
  }
  async function onEnable() {
    await withConfirm(`确定启用 ${username}?`, async () => {
      const r = await enableUserRequest(userId);
      if (!r.ok) throw new Error(r.error.message);
      setMsg(`${username} 已被启用`);
    });
  }
  async function onPromote() {
    await withConfirm(`确定将 ${username} 提升为管理员?`, async () => {
      const r = await adminPromoteUser(userId);
      if (!r.ok) throw new Error(r.error.message);
    });
  }
  async function onDemote() {
    await withConfirm(`确定撤销 ${username} 的管理员权限?`, async () => {
      const r = await adminDemoteUser(userId);
      if (!r.ok) throw new Error(r.error.message);
    });
  }

  if (isSelf) return <span className="text-xs text-ink-faint">—</span>;

  return (
    <div className="flex flex-wrap gap-1.5 items-center" onClick={(e) => e.stopPropagation()}>
      {isDisabled ? (
        <AdminButton
          variant="secondary"
          size="sm"
          onClick={onEnable}
          disabled={busy}
          className="border-success/40 text-success hover:bg-success/10"
        >
          启用
        </AdminButton>
      ) : (
        <AdminButton variant="danger" size="sm" onClick={onDisable} disabled={busy}>
          禁用
        </AdminButton>
      )}
      <AdminButton
        variant="secondary"
        size="sm"
        onClick={() => setShowReset(true)}
        disabled={busy}
      >
        重置密码
      </AdminButton>
      {isAdmin ? (
        <AdminButton variant="secondary" size="sm" onClick={onDemote} disabled={busy}>
          降级
        </AdminButton>
      ) : (
        <AdminButton variant="secondary" size="sm" onClick={onPromote} disabled={busy}>
          提升
        </AdminButton>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
      {!err && msg && <span className="text-xs text-success">{msg}</span>}
      <ResetPasswordDialog
        userId={userId}
        username={username}
        open={showReset}
        onClose={() => setShowReset(false)}
      />
    </div>
  );
}
