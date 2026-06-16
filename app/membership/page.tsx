import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { listPlans, getMyActiveMembership } from '@/lib/membership';
import { getCurrentUser } from '@/lib/auth';
import { PlanCard } from '@/components/membership/PlanCard';
import { MembershipBadge } from '@/components/membership/MembershipBadge';

export const dynamic = 'force-dynamic';

export default async function MembershipPage() {
  const user = await getCurrentUser();
  const [plans, active] = await Promise.all([
    listPlans({ enabledOnly: true }),
    user ? getMyActiveMembership(user.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <Header />
      <PageContainer>
        <SectionTitle subtitle="支持站点持续运营,解锁全部功能">会员</SectionTitle>
        {user && (
          <div className="mt-4 mb-6">
            <MembershipBadge
              active={!!active?.active}
              planKey={active?.active ? active.planKey : undefined}
              expiresAt={active?.active ? active.expiresAt : undefined}
            />
          </div>
        )}
        {plans.length === 0
          ? <p className="text-sm text-ink-faint">暂无可用套餐,请稍后再来。</p>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              {plans.map(p => <PlanCard key={p.id} plan={p} isLoggedIn={!!user} />)}
            </div>}
        <p className="text-xs text-ink-faint mt-8">
          支付由 PayPal 处理。开通后会员时长自动累加到当前到期日。
          如需发票请联系 <Link href="/?contact=1" className="text-seal hover:underline">客服</Link>。
        </p>
      </PageContainer>
      <Footer />
    </>
  );
}
