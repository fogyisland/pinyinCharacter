import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getPaymentOrderById } from '@/lib/payment-orders';
import { getPlanById } from '@/lib/membership';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('bad_id', 'invalid order id');
    const order = await getPaymentOrderById(id);
    if (!order) return notFound('order_not_found', 'order not found');
    if (order.userId !== user.id) return notFound('order_not_found', 'order not found');
    const plan = await getPlanById(order.planId);
    return NextResponse.json({
      ok: true,
      data: {
        status: order.status,
        planDisplayName: plan?.displayName ?? null,
        amount: order.amount,
        currency: order.currency,
        paidAt: order.paidAt,
      },
    });
  });
}
