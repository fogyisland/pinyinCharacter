import Link from 'next/link';
import { Crown, ArrowRight } from 'lucide-react';
import { getMyActiveMembership } from '@/lib/membership';

export async function MembershipStatusCard({ userId }: { userId: number }) {
  const m = await getMyActiveMembership(userId);
  return (
    <div className="card-paper p-5">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="h-5 w-5 text-seal" />
        <h2 className="font-kai text-lg text-ink">会员状态</h2>
      </div>
      {m.active ? (
        <div className="space-y-1 text-sm">
          <p>当前套餐: <span className="font-medium">{m.planKey}</span></p>
          <p>到期时间: <span className="font-medium">{new Date(m.expiresAt).toLocaleDateString('zh-CN')}</span> (还剩 {m.expiresInDays} 天)</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">您还不是会员</p>
          <Link href="/membership"
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-seal text-paper rounded hover:bg-seal/80">
            开通会员 <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
