import { getPool } from './db';

export type PaymentOrderStatus = 'created' | 'approved' | 'paid' | 'failed' | 'expired';

export interface PaymentOrder {
  id: number; userId: number; planId: number; paypalOrderId: string;
  status: PaymentOrderStatus; amount: string; currency: 'CNY' | 'USD';
  approvalUrl: string | null; createdAt: string; updatedAt: string; paidAt: string | null;
}

interface DbRow {
  id: number; user_id: number; plan_id: number; paypal_order_id: string;
  status: PaymentOrderStatus; amount: string; currency: 'CNY' | 'USD';
  approval_url: string | null;
  created_at: Date; updated_at: Date; paid_at: Date | null;
}

function mapRow(r: DbRow): PaymentOrder {
  return {
    id: Number(r.id), userId: Number(r.user_id), planId: Number(r.plan_id),
    paypalOrderId: r.paypal_order_id, status: r.status, amount: String(r.amount), currency: r.currency,
    approvalUrl: r.approval_url,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  };
}

export async function createPaymentOrder(args: {
  userId: number; planId: number; paypalOrderId: string;
  amount: string; currency: 'CNY' | 'USD'; approvalUrl: string | null;
}): Promise<number> {
  const [res] = await getPool().execute<any>(
    `INSERT INTO payment_orders (user_id, plan_id, paypal_order_id, status, amount, currency, approval_url)
     VALUES (?, ?, ?, 'created', ?, ?, ?)`,
    [args.userId, args.planId, args.paypalOrderId, args.amount, args.currency, args.approvalUrl],
  );
  return Number((res as any).insertId);
}

export async function getPaymentOrder(paypalOrderId: string): Promise<PaymentOrder | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, user_id, plan_id, paypal_order_id, status, amount, currency, approval_url, created_at, updated_at, paid_at
     FROM payment_orders WHERE paypal_order_id = ? LIMIT 1`,
    [paypalOrderId],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0] as DbRow);
}

export async function getPaymentOrderById(id: number): Promise<PaymentOrder | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, user_id, plan_id, paypal_order_id, status, amount, currency, approval_url, created_at, updated_at, paid_at
     FROM payment_orders WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0] as DbRow);
}

export async function updatePaymentOrderStatus(
  paypalOrderId: string, status: PaymentOrderStatus, paidAt: Date | null = null,
): Promise<void> {
  await getPool().execute(
    `UPDATE payment_orders SET status = ?, paid_at = COALESCE(?, paid_at) WHERE paypal_order_id = ?`,
    [status, paidAt, paypalOrderId],
  );
}
