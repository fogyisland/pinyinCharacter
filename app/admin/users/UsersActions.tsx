'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { disableUserRequest, enableUserRequest, adminResetUserPassword, adminPromoteUser, adminDemoteUser } from '@/lib/api-admin';
import { ResetPasswordDialog } from '@/components/ResetPasswordDialog';

export function UserActions({ userId, username, isAdmin, isSelf, isDisabled }: {
  userId: number; username: string; isAdmin: boolean; isSelf: boolean; isDisabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function withConfirm(label: string, fn: () => Promise<void>) {
    if (!window.confirm(label)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
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
    <div className="flex flex-wrap gap-1.5 items-center" onClick={e => e.stopPropagation()}>
      {isDisabled
        ? <button type="button" onClick={onEnable} disabled={busy}
            className="text-xs px-2 py-1 border border-green-600/40 rounded text-green-700 hover:bg-green-50 disabled:opacity-50">启用</button>
        : <button type="button" onClick={onDisable} disabled={busy}
            className="text-xs px-2 py-1 border border-seal/40 rounded text-seal hover:bg-seal/10 disabled:opacity-50">禁用</button>}
      <button type="button" onClick={() => setShowReset(true)} disabled={busy}
        className="text-xs px-2 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep disabled:opacity-50">重置密码</button>
      {isAdmin
        ? <button type="button" onClick={onDemote} disabled={busy}
            className="text-xs px-2 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep disabled:opacity-50">降级</button>
        : <button type="button" onClick={onPromote} disabled={busy}
            className="text-xs px-2 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep disabled:opacity-50">提升</button>}
      {err && <span className="text-xs text-seal">{err}</span>}
      {!err && msg && <span className="text-xs text-green-700">{msg}</span>}
      <ResetPasswordDialog userId={userId} username={username}
        open={showReset} onClose={() => setShowReset(false)} />
    </div>
  );
}