import { Crown } from 'lucide-react';
import Link from 'next/link';

export function MembershipBadge({ active, planKey, expiresAt }: {
  active: boolean; planKey?: string; expiresAt?: string;
}) {
  if (!active) {
    return (
      <Link href="/membership"
        className="text-xs px-3 py-1 rounded bg-seal text-paper hover:bg-seal/80 inline-flex items-center gap-1">
        <Crown className="h-3 w-3" />开通会员
      </Link>
    );
  }
  return (
    <span className="text-xs px-3 py-1 rounded bg-success/15 text-success inline-flex items-center gap-1">
      <Crown className="h-3 w-3" />{planKey} · 到期 {expiresAt ? new Date(expiresAt).toLocaleDateString('zh-CN') : ''}
    </span>
  );
}
