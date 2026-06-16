'use client';

import { useState, useCallback } from 'react';
import { CreditCard, AlertTriangle } from 'lucide-react';

export function CheckoutButton({ planKey, label }: { planKey: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onClick = useCallback(async () => {
    setBusy(true); setErr(null);
    const res = await fetch('/api/membership/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey }),
      credentials: 'same-origin',
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) { setErr(j.error.message); return; }
    if (j.data.approvalUrl) {
      const url = new URL(j.data.approvalUrl);
      url.searchParams.set('orderId', String(j.data.orderId));
      window.location.href = url.toString();
    } else {
      setErr('PayPal 未返回 approvalUrl');
    }
  }, [planKey]);
  return (
    <div>
      <button type="button" onClick={onClick} disabled={busy}
        className="w-full text-sm px-4 py-2 bg-seal text-paper rounded hover:bg-seal/80 disabled:opacity-50 inline-flex items-center justify-center gap-1">
        <CreditCard className="h-4 w-4" />{busy ? '跳转中…' : label}
      </button>
      {err && <p className="text-xs text-seal mt-1 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</p>}
    </div>
  );
}
