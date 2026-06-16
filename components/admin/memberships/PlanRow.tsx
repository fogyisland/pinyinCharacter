'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { updateAdminPlanRequest, type AdminPlanRow as Plan } from '@/lib/api-admin';

const ALL_FEATURES = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'] as const;
const FEATURE_LABELS: Record<string, string> = {
  unlimited_history: '无限历史', download_pdf: 'PDF 下载', ai_calls: 'AI 调用', priority_tts: '优先 TTS',
};

export function PlanRow({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(plan.displayName);
  const [amount, setAmount] = useState(plan.amount);
  const [durationDays, setDurationDays] = useState(String(plan.durationDays));
  const [enabled, setEnabled] = useState(plan.enabled);
  const [displayOrder, setDisplayOrder] = useState(String(plan.displayOrder));
  const [features, setFeatures] = useState<string[]>(plan.features);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = displayName !== plan.displayName || amount !== plan.amount
    || String(plan.durationDays) !== durationDays || enabled !== plan.enabled
    || String(plan.displayOrder) !== displayOrder
    || features.length !== plan.features.length || features.some(f => !plan.features.includes(f));

  const onSave = useCallback(async () => {
    setBusy(true); setMsg(null); setErr(null);
    const r = await updateAdminPlanRequest(plan.id, {
      displayName, amount, durationDays: Number(durationDays), enabled, displayOrder: Number(displayOrder), features: features as any,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg('已保存');
    router.refresh();
  }, [plan.id, displayName, amount, durationDays, enabled, displayOrder, features, router]);

  const onReset = () => {
    setDisplayName(plan.displayName); setAmount(plan.amount); setDurationDays(String(plan.durationDays));
    setEnabled(plan.enabled); setDisplayOrder(String(plan.displayOrder)); setFeatures(plan.features);
    setErr(null); setMsg(null);
  };

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="text-xs font-mono">{plan.planKey}</div>
        <div className="text-xs text-ink-faint">{plan.currency}</div>
      </td>
      <td className="px-3 py-2">
        <input value={displayName} onChange={e => setDisplayName(e.target.value)}
          className="w-32 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="1" value={durationDays} onChange={e => setDurationDays(e.target.value)}
          className="w-20 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <input value={amount} onChange={e => setAmount(e.target.value)}
          className="w-20 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="0" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)}
          className="w-16 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {ALL_FEATURES.map(f => {
            const on = features.includes(f);
            return (
              <button key={f} type="button" onClick={() => setFeatures(on ? features.filter(x => x !== f) : [...features, f])}
                className={`text-xs px-2 py-0.5 rounded border ${on ? 'bg-ink text-paper border-ink' : 'border-paper-warm text-ink-soft'}`}>
                {FEATURE_LABELS[f]}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        {dirty && (
          <div className="flex flex-col gap-1">
            <button type="button" onClick={onSave} disabled={busy}
              className="text-xs px-2 py-1 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50 inline-flex items-center gap-1">
              <Save className="h-3 w-3" />保存
            </button>
            <button type="button" onClick={onReset}
              className="text-xs px-2 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep inline-flex items-center gap-1">
              <RotateCcw className="h-3 w-3" />还原
            </button>
          </div>
        )}
        {msg && <span className="text-xs text-green-700 inline-flex items-center gap-1"><Check className="h-3 w-3" />{msg}</span>}
        {err && <span className="text-xs text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</span>}
      </td>
    </tr>
  );
}
