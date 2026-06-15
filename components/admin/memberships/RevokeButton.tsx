'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, AlertTriangle } from 'lucide-react';
import { revokeAdminMembershipRequest } from '@/lib/api-admin';

export function RevokeButton({ membershipId }: { membershipId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onRevoke = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await revokeAdminMembershipRequest(membershipId, reason || undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setConfirming(false);
    router.refresh();
  }, [membershipId, reason, router]);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="text-xs px-2 py-1 border border-seal/30 text-seal rounded hover:bg-seal/5 inline-flex items-center gap-1">
        <Ban className="h-3 w-3" />撤销
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="原因(可选)"
        className="text-xs border border-paper-warm rounded px-1 py-0.5 w-24" />
      <button type="button" onClick={onRevoke} disabled={busy}
        className="text-xs px-2 py-1 bg-seal text-paper rounded hover:bg-seal/80 disabled:opacity-50 inline-flex items-center gap-1">
        <Check className="h-3 w-3" />确认
      </button>
      <button type="button" onClick={() => { setConfirming(false); setErr(null); }}
        className="text-xs px-2 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep">取消</button>
      {err && <span className="text-xs text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</span>}
    </div>
  );
}
