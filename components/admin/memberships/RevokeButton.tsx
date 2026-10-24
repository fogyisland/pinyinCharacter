'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, AlertTriangle } from 'lucide-react';
import { revokeAdminMembershipRequest } from '@/lib/api-admin';
import { AdminButton } from '@/components/admin/AdminButton';

export function RevokeButton({ membershipId }: { membershipId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onRevoke = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const r = await revokeAdminMembershipRequest(membershipId, reason || undefined);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }, [membershipId, reason, router]);

  if (!confirming) {
    return (
      <AdminButton
        variant="danger"
        size="sm"
        onClick={() => setConfirming(true)}
        icon={<Ban className="h-3 w-3" />}
      >
        撤销
      </AdminButton>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <div className="w-28">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="原因(可选)"
          aria-label="撤销原因"
          className="adm-input"
        />
      </div>
      <AdminButton
        variant="primary"
        size="sm"
        onClick={onRevoke}
        disabled={busy}
        icon={<Check className="h-3 w-3" />}
      >
        确认
      </AdminButton>
      <AdminButton
        variant="secondary"
        size="sm"
        onClick={() => {
          setConfirming(false);
          setErr(null);
        }}
      >
        取消
      </AdminButton>
      {err && (
        <span className="text-xs text-danger inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {err}
        </span>
      )}
    </div>
  );
}
