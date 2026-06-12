'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminDeleteUser } from '@/lib/api-admin';
import { ConfirmDialog } from './ConfirmDialog';

export function DeleteUserDialog({ userId, username, open, onClose }: {
  userId: number; username: string; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const match = confirm === username;

  return (
    <ConfirmDialog
      open={open}
      title={`删除用户 ${username}`}
      description="此操作不可撤销。该用户的所有历史和审计记录会一并删除。请输入用户名以确认。"
      confirmLabel="删除"
      destructive
      onClose={() => { setConfirm(''); setError(null); onClose(); }}
      onConfirm={async () => {
        setError(null);
        const r = await adminDeleteUser(userId, confirm);
        if (!r.ok) { setError(r.error.message); throw new Error(r.error.message); }
        router.push('/admin/users');
        router.refresh();
      }}
    >
      <input
        type="text" value={confirm} onChange={e => setConfirm(e.target.value)}
        placeholder={`输入 ${username} 以确认`}
        className="w-full border rounded px-3 py-2 text-sm mb-1"
      />
      {error && <p className="text-xs text-seal mb-2">{error}</p>}
      {!match && confirm && <p className="text-xs text-ink-faint">用户名不匹配</p>}
    </ConfirmDialog>
  );
}
