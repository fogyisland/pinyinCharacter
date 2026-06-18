import { Crown } from 'lucide-react';
import { CheckoutButton } from './CheckoutButton';

const FEATURE_LABELS: Record<string, string> = {
  unlimited_history: '无限历史记录', download_pdf: 'PDF 下载', ai_calls: 'AI 释义', priority_tts: '优先 TTS',
  multi_worksheet_print: '批量 / 多页打印',
};

export function PlanCard({ plan, isLoggedIn }: {
  plan: {
    id: number; planKey: string; displayName: string;
    durationDays: number; amount: string; currency: 'CNY' | 'USD';
    features: string[];
  };
  isLoggedIn: boolean;
}) {
  const symbol = plan.currency === 'USD' ? '$' : '¥';
  return (
    <div className="card-paper rounded-lg p-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Crown className="h-5 w-5 text-seal" />
        <h3 className="font-kai text-lg text-ink">{plan.displayName}</h3>
      </div>
      <div className="text-3xl font-serif text-ink">
        {symbol}{plan.amount}
        <span className="text-xs text-ink-soft ml-1">/ {plan.durationDays} 天</span>
      </div>
      <ul className="text-sm space-y-1 text-ink-soft flex-1">
        {plan.features.map(f => (
          <li key={f} className="inline-flex items-center gap-1">
            <span className="text-success">✓</span> {FEATURE_LABELS[f] ?? f}
          </li>
        ))}
      </ul>
      {isLoggedIn
        ? <CheckoutButton planKey={plan.planKey} label="立即开通" />
        : <a href={`/?auth=login&next=/membership`}
            className="block text-center text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep">登录后开通</a>}
    </div>
  );
}
