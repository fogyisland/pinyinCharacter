import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from './db';

/** The value shapes mysql2 accepts as a bound SQL parameter. */
type SqlParam = string | number | bigint | boolean | Date | Buffer | null;

export type PaymentOrderStatus = 'created' | 'approved' | 'paid' | 'failed' | 'expired';

export interface PaymentOrder {
  id: number;
  userId: number;
  planId: number;
  paypalOrderId: string;
  status: PaymentOrderStatus;
  amount: string;
  currency: 'CNY' | 'USD';
  approvalUrl: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

interface DbRow extends RowDataPacket {
  id: number;
  user_id: number;
  plan_id: number;
  paypal_order_id: string;
  status: PaymentOrderStatus;
  amount: string;
  currency: 'CNY' | 'USD';
  approval_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  paid_at: Date | string | null;
}

/** The admin list view: a payment order joined with its buyer and plan. */
interface PaymentOrderListRow extends RowDataPacket {
  id: number;
  user_id: number;
  plan_id: number;
  paypal_order_id: string;
  status: PaymentOrderStatus;
  amount: string;
  currency: 'CNY' | 'USD';
  approval_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  paid_at: Date | string | null;
  username: string | null;
  plan_key: string | null;
  plan_display_name: string | null;
}

interface CountRow extends RowDataPacket {
  n: number;
}

/** Normalise a DATETIME/TIMESTAMP column to an ISO string. */
function toIsoString(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapRow(r: DbRow): PaymentOrder {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    planId: Number(r.plan_id),
    paypalOrderId: r.paypal_order_id,
    status: r.status,
    amount: String(r.amount),
    currency: r.currency,
    approvalUrl: r.approval_url,
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
    paidAt: r.paid_at ? toIsoString(r.paid_at) : null,
  };
}

export async function createPaymentOrder(args: {
  userId: number;
  planId: number;
  paypalOrderId: string;
  amount: string;
  currency: 'CNY' | 'USD';
  approvalUrl: string | null;
}): Promise<number> {
  const [res] = await getPool().query<ResultSetHeader>(
    `INSERT INTO payment_orders (user_id, plan_id, paypal_order_id, status, amount, currency, approval_url)
     VALUES (?, ?, ?, 'created', ?, ?, ?)`,
    [args.userId, args.planId, args.paypalOrderId, args.amount, args.currency, args.approvalUrl],
  );
  return Number(res.insertId);
}

export async function getPaymentOrder(paypalOrderId: string): Promise<PaymentOrder | null> {
  const [rows] = await getPool().query<DbRow[]>(
    `SELECT id, user_id, plan_id, paypal_order_id, status, amount, currency, approval_url, created_at, updated_at, paid_at
     FROM payment_orders WHERE paypal_order_id = ? LIMIT 1`,
    [paypalOrderId],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function getPaymentOrderById(id: number): Promise<PaymentOrder | null> {
  const [rows] = await getPool().query<DbRow[]>(
    `SELECT id, user_id, plan_id, paypal_order_id, status, amount, currency, approval_url, created_at, updated_at, paid_at
     FROM payment_orders WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

export async function updatePaymentOrderStatus(
  paypalOrderId: string,
  status: PaymentOrderStatus,
  paidAt: Date | null = null,
): Promise<void> {
  await getPool().query(
    `UPDATE payment_orders SET status = ?, paid_at = COALESCE(?, paid_at) WHERE paypal_order_id = ?`,
    [status, paidAt, paypalOrderId],
  );
}

export interface ListPaymentOrdersOpts {
  status?: PaymentOrderStatus;
  userId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentOrderWithUser extends PaymentOrder {
  username: string | null;
  planKey: string;
  planDisplayName: string;
}

export interface ListPaymentOrdersResult {
  items: PaymentOrderWithUser[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Admin-only read view over payment_orders. Filterable by status, userId,
 * and a substring of paypal_order_id (debugging webhook IDs). Default
 * ordering is newest first. Joins users + membership_plans so the UI can
 * show the buyer + plan in a single round-trip.
 */
export async function listPaymentOrders(
  opts: ListPaymentOrdersOpts = {},
): Promise<ListPaymentOrdersResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.max(opts.pageSize ?? 50, 1);
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: SqlParam[] = [];
  if (opts.status) {
    where.push('po.status = ?');
    params.push(opts.status);
  }
  if (opts.userId !== undefined) {
    where.push('po.user_id = ?');
    params.push(opts.userId);
  }
  if (opts.q) {
    where.push('po.paypal_order_id LIKE ?');
    params.push(`%${opts.q}%`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await getPool().query<PaymentOrderListRow[]>(
    `SELECT po.id, po.user_id, po.plan_id, po.paypal_order_id, po.status,
            po.amount, po.currency, po.approval_url,
            po.created_at, po.updated_at, po.paid_at,
            u.username, mp.plan_key, mp.display_name AS plan_display_name
     FROM payment_orders po
     LEFT JOIN users u ON u.id = po.user_id
     LEFT JOIN membership_plans mp ON mp.id = po.plan_id
     ${whereSql}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  const [countRows] = await getPool().query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM payment_orders po ${whereSql}`,
    params,
  );

  const items: PaymentOrderWithUser[] = rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    planId: Number(r.plan_id),
    paypalOrderId: r.paypal_order_id,
    status: r.status,
    amount: String(r.amount),
    currency: r.currency,
    approvalUrl: r.approval_url,
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
    paidAt: r.paid_at ? toIsoString(r.paid_at) : null,
    username: r.username ?? null,
    planKey: r.plan_key ?? '',
    planDisplayName: r.plan_display_name ?? '',
  }));

  return {
    items,
    total: Number(countRows[0].n) || 0,
    page,
    pageSize,
  };
}
