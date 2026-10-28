'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { updateAdminPlanRequest, type AdminPlanRow as Plan } from '@/lib/api-admin';
import { AdminButton } from '@/components/admin/AdminButton';

const ALL_FEATURES = [
  'unlimited_history',
  'download_pdf',
  'ai_calls',
  'priority_tts',
  'multi_worksheet_print',
] as const;
const FEATURE_LABELS: Record<string, string> = {
  unlimited_history: '无限历史',
  download_pdf: 'PDF 下载',
  ai_calls: 'AI 调用',
  priority_tts: '优先 TTS',
  multi_worksheet_print: '批量 / 多页打印',
};

/**
 * The feature keys `updateAdminPlanRequest` accepts. The picker above also
 * offers `multi_worksheet_print`, which the request type does not list —
 * the API accepts it at runtime, the client-side type just does not.
 */
type UpdatableFeature =
  | 'unlimited_history'
  | 'download_pdf'
  | 'ai_calls'
  | 'priority_tts';

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
  const dirty =
    displayName !== plan.displayName ||
    amount !== plan.amount ||
    String(plan.durationDays) !== durationDays ||
    enabled !== plan.enabled ||
    String(plan.displayOrder) !== displayOrder ||
    features.length !== plan.features.length ||
    features.some((f) => !plan.features.includes(f));

  const onSave = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const r = await updateAdminPlanRequest(plan.id, {
      displayName,
      amount,
      durationDays: Number(durationDays),
      enabled,
      displayOrder: Number(displayOrder),
      features: features as UpdatableFeature[],
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    setMsg('已保存');
    router.refresh();
  }, [plan.id, displayName, amount, durationDays, enabled, displayOrder, features, router]);

  const onReset = () => {
    setDisplayName(plan.displayName);
    setAmount(plan.amount);
    setDurationDays(String(plan.durationDays));
    setEnabled(plan.enabled);
    setDisplayOrder(String(plan.displayOrder));
    setFeatures(plan.features);
    setErr(null);
    setMsg(null);
  };

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2" data-label="plan_key">
        <div className="text-xs font-mono">{plan.planKey}</div>
        <div className="text-xs text-ink-faint">{plan.currency}</div>
      </td>
      <td className="px-3 py-2" data-label="显示名">
        <div className="w-32">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label={`${plan.planKey} 显示名`}
            className="adm-input"
          />
        </div>
      </td>
      <td className="px-3 py-2" data-label="天数">
        <div className="w-20">
          <input
            type="number"
            min="1"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            aria-label={`${plan.planKey} 天数`}
            className="adm-input"
          />
        </div>
      </td>
      <td className="px-3 py-2" data-label="金额">
        <div className="w-20">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`${plan.planKey} 金额`}
            className="adm-input"
          />
        </div>
      </td>
      <td className="px-3 py-2 text-center" data-label="启用">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={`${plan.planKey} 启用`}
        />
      </td>
      <td className="px-3 py-2" data-label="排序">
        <div className="w-16">
          <input
            type="number"
            min="0"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            aria-label={`${plan.planKey} 排序`}
            className="adm-input"
          />
        </div>
      </td>
      <td className="px-3 py-2" data-label="权限">
        <div className="flex flex-wrap gap-1">
          {ALL_FEATURES.map((f) => {
            const on = features.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFeatures(on ? features.filter((x) => x !== f) : [...features, f])}
                aria-pressed={on}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  on
                    ? 'bg-ink text-paper border-ink'
                    : 'border-ink/20 text-ink-soft hover:bg-paper-deep'
                }`}
              >
                {FEATURE_LABELS[f]}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2" data-label="操作">
        {dirty && (
          <div className="flex flex-col gap-1">
            <AdminButton
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={busy}
              icon={<Save className="h-3 w-3" />}
            >
              保存
            </AdminButton>
            <AdminButton
              variant="secondary"
              size="sm"
              onClick={onReset}
              icon={<RotateCcw className="h-3 w-3" />}
            >
              还原
            </AdminButton>
          </div>
        )}
        {msg && (
          <span className="text-xs text-success inline-flex items-center gap-1">
            <Check className="h-3 w-3" />
            {msg}
          </span>
        )}
        {err && (
          <span className="text-xs text-danger inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}
