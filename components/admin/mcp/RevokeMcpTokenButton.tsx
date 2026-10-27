'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, AlertTriangle } from 'lucide-react';
import { revokeAdminMcpTokenRequest } from '@/lib/api-admin';
import { AdminButton } from '@/components/admin/AdminButton';

/**
 * Revoke one user's MCP token from the admin page.
 *
 * The button asks first: a revocation takes the user's AI client off the
 * air, and the operator should mean it. The revocation itself is
 * idempotent — a token that is already revoked keeps its first timestamp —
 * so a second press is harmless.
 */
export function RevokeMcpTokenButton({ userId, username }: { userId: number; username: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onRevoke = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await revokeAdminMcpTokenRequest(userId);
      if (!r.ok) {
        setErr(r.error.message);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      // The request never reached the server, or its answer was not a
      // readable envelope. Either way the operator has to be told — a
      // silent failure would leave the button stuck and the revocation
      // in an unknown state.
      console.error('[admin] the mcp token revocation request failed', err);
      setErr('吊销请求失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [userId, router]);

  if (!confirming) {
    return (
      <AdminButton
        variant="danger"
        size="sm"
        onClick={() => setConfirming(true)}
        icon={<Ban className="h-3 w-3" />}
      >
        吊销
      </AdminButton>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-ink-soft whitespace-nowrap">吊销 {username} 的 Token？</span>
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
