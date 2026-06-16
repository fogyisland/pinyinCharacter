import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getPayPalConfig, verifyWebhookSignature, capturePayPalOrder } from '@/lib/paypal';
import { getPaymentOrder, updatePaymentOrderStatus } from '@/lib/payment-orders';
import { grantMembership } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const cfg = await getPayPalConfig();
    if (!cfg) return NextResponse.json({ ok: false, error: 'paypal_not_configured' }, { status: 503 });

    const rawBody = await req.text();
    const headerObj: Record<string, string> = {};
    for (const [k, v] of req.headers.entries()) headerObj[k.toLowerCase()] = v;
    const ok = await verifyWebhookSignature({ cfg, rawBody, headers: headerObj });
    if (!ok) {
      await writeAudit({ userId: null, event: 'paypal_webhook_rejected', metadata: { reason: 'signature_invalid' } });
      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }
    await writeAudit({ userId: null, event: 'paypal_webhook_received', metadata: { event_type: event.event_type, paypal_order_id: event.resource?.id } });

    const orderId: string | undefined = event.resource?.id
      ?? event.resource?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return NextResponse.json({ ok: true });

    const order = await getPaymentOrder(orderId);
    if (!order) return NextResponse.json({ ok: true });

    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        if (order.status === 'created') {
          await updatePaymentOrderStatus(orderId, 'approved');
          try { await capturePayPalOrder(orderId); } catch (err) {
            await updatePaymentOrderStatus(orderId, 'failed');
            return NextResponse.json({ ok: true, data: { captured: false, error: (err as Error).message } });
          }
        }
        return NextResponse.json({ ok: true });
      }
      case 'PAYMENT.CAPTURE.COMPLETED': {
        if (order.status === 'paid') return NextResponse.json({ ok: true });
        await updatePaymentOrderStatus(orderId, 'paid', new Date());
        const [planRows] = await getPool().query<any[]>(`SELECT plan_key FROM membership_plans WHERE id = ?`, [order.planId]);
        if (planRows.length === 0) return NextResponse.json({ ok: true });
        const planKey = planRows[0].plan_key;
        try {
          await grantMembership({
            targetUserId: order.userId,
            planKey: planKey as any,
            grantedBy: null,
            source: 'paypal',
            sourcePaymentOrderId: order.id,
          });
          await writeAudit({
            userId: null,
            event: 'membership_granted_paypal',
            metadata: {
              targetUserId: order.userId,
              planKey,
              amount: order.amount,
              paymentOrderId: order.id,
            },
          });
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes('Duplicate') && !msg.includes('ER_DUP_ENTRY')) throw err;
        }
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: true });
    }
  });
}
