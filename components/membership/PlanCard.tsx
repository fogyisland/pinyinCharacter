import { Crown } from 'lucide-react';
import { CheckoutButton } from './CheckoutButton';
import { MEMBERSHIP_FEATURES } from '@/lib/membership-features';

// ⚠️ A label here is a promise the buyer pays for.
//
// The map is keyed by the shared MEMBERSHIP_FEATURES list, so adding a
// feature without writing its label is a TYPE ERROR, and a feature that
// nothing enforces cannot be advertised here at all — the list only holds
// the features that are actually checked with `hasFeature()`.
const FEATURE_LABELS: Record<(typeof MEMBERSHIP_FEATURES)[number], string> = {
  ai_calls: 'AI 释义',
  multi_worksheet_print: '批量 / 多页打印',
};

export function PlanCard({
  plan,
  isLoggedIn,
}: {
  plan: {
    id: number;
    planKey: string;
    displayName: string;
    durationDays: number;
    amount: string;
    currency: 'CNY' | 'USD';
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
        {symbol}
        {plan.amount}
        <span className="text-xs text-ink-soft ml-1">/ {plan.durationDays} 天</span>
      </div>
      <ul className="text-sm space-y-1 text-ink-soft flex-1">
        {plan.features.map((f) => (
          <li key={f} className="inline-flex items-center gap-1">
            <span className="text-success">✓</span>{' '}
            {/* `plan.features` comes from the API as a plain string. A plan
                row that still carries one of the removed keys (a row the
                migration has not cleaned up yet) falls back to the raw key
                rather than printing "undefined". */}
            {FEATURE_LABELS[f as keyof typeof FEATURE_LABELS] ?? f}
          </li>
        ))}
      </ul>
      {isLoggedIn ? (
        <CheckoutButton planKey={plan.planKey} label="立即开通" />
      ) : (
        <a
          href={`/?auth=login&next=/membership`}
          className="block text-center text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep"
        >
          登录后开通
        </a>
      )}
    </div>
  );
}
