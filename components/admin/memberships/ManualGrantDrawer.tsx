'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, X, Check, AlertTriangle } from 'lucide-react';
import { grantAdminMembershipRequest, listAdminPlansRequest } from '@/lib/api-admin';

interface Plan { id: number; planKey: string; displayName: string; durationDays: number; amount: string; currency: string; enabled: boolean; features: string[]; }

export function ManualGrantDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [planKey, setPlanKey] = useState('');
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listAdminPlansRequest().then(r => {
      if (r.ok) {
        setPlans(r.data.items as any);
        const first = (r.data.items as Plan[]).find(p => p.enabled) ?? r.data.items[0];
        if (first) setPlanKey(first.planKey);
      }
    });
  }, [open]);

  const onGrant = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) { setBusy(false); setErr('userId 必须是正整数'); return; }
    if (!planKey) { setBusy(false); setErr('请选择套餐'); return; }
    const r = await grantAdminMembershipRequest({ userId: uid, planKey, note: note || undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(`已开通,到期 ${new Date(r.data.expiresAt).toLocaleDateString('zh-CN')}`);
    setUserId(''); setNote('');
    router.refresh();
  }, [userId, planKey, note, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 inline-flex items-center gap-1">
        <UserPlus className="h-4 w-4" />手动开通
      </button>
      {open && (
        <div className="fixed inset-0 z-30 bg-ink/40" onClick={() => setOpen(false)}>
          <form onSubmit={onGrant}
            className="absolute right-0 top-0 h-full w-80 bg-paper-soft p-5 shadow-paper-lg overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-kai text-lg text-ink">手动开通会员</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭"><X className="h-5 w-5" /></button>
            </div>
            {err && <p className="text-sm text-seal mb-3 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
            {msg && <p className="text-sm text-green-700 mb-3 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{msg}</p>}
            <label className="text-xs text-ink-soft">用户 ID</label>
            <input value={userId} onChange={e => setUserId(e.target.value)} type="number" min="1"
              className="w-full mt-1 mb-3 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
            <label className="text-xs text-ink-soft">套餐</label>
            <select value={planKey} onChange={e => setPlanKey(e.target.value)}
              className="w-full mt-1 mb-3 border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
              {plans.map(p => <option key={p.planKey} value={p.planKey}>
                {p.displayName} · {p.currency === 'USD' ? '$' : '¥'}{p.amount} · {p.durationDays} 天 {p.enabled ? '' : '(未启用)'}
              </option>)}
            </select>
            <label className="text-xs text-ink-soft">备注 (可选)</label>
            <input value={note} onChange={e => setNote(e.target.value)} type="text" maxLength={255}
              className="w-full mt-1 mb-4 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
            <button type="submit" disabled={busy}
              className="w-full text-sm px-3 py-2 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
              {busy ? '开通中…' : '确认开通'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
