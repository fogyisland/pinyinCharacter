import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound, unauthorized, serviceUnavailable } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getPlanByKey, PLAN_KEYS } from '@/lib/membership';
import { createPayPalOrder } from '@/lib/paypal';
import { createPaymentOrder } from '@/lib/payment-orders';

const Schema = z.object({ planKey: z.enum(PLAN_KEYS) });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    const plan = await getPlanByKey(parsed.data.planKey);
    if (!plan || !plan.enabled) return notFound('plan_not_found_or_disabled', `plan ${parsed.data.planKey}`);

    let order;
    try {
      order = await createPayPalOrder({
        amount: plan.amount, currency: plan.currency, description: plan.displayName,
        returnUrl: `${new URL(req.url).origin}/membership/success`,
        cancelUrl: `${new URL(req.url).origin}/membership/cancel`,
      });
    } catch (err) {
      return serviceUnavailable('paypal_unavailable', (err as Error).message);
    }

    const approveLink = order.links.find(l => l.rel === 'approve');
    const orderId = await createPaymentOrder({
      userId: user.id, planId: plan.id, paypalOrderId: order.id,
      amount: plan.amount, currency: plan.currency, approvalUrl: approveLink?.href ?? null,
    });

    return NextResponse.json({
      ok: true,
      data: { approvalUrl: approveLink?.href, orderId, paypalOrderId: order.id },
    });
  });
}
