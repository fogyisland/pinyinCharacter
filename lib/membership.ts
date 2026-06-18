import { getPool } from './db';
import { cache } from 'react';

export const PLAN_KEYS = ['monthly_usd', 'yearly_usd', 'monthly_cny', 'yearly_cny'] as const;
export type PlanKey = typeof PLAN_KEYS[number];

export type MembershipCurrency = 'CNY' | 'USD';
export type MembershipFeature =
  | 'unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts'
  | 'multi_worksheet_print';

export interface MembershipPlanRow {
  id: number;
  planKey: PlanKey;
  displayName: string;
  durationDays: number;
  amount: string;       // DECIMAL(10,2) as string for precision
  currency: MembershipCurrency;
  enabled: boolean;
  displayOrder: number;
  features: MembershipFeature[];
}

interface PlanDbRow {
  id: number; plan_key: string; display_name: string;
  duration_days: number; amount: string; currency: MembershipCurrency;
  enabled: number; display_order: number;
}

async function loadFeatures(planId: number): Promise<MembershipFeature[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT feature_key FROM membership_plan_features WHERE plan_id = ?`,
    [planId],
  );
  return (rows as any[]).map(r => r.feature_key as MembershipFeature);
}

function mapPlanRow(r: PlanDbRow, features: MembershipFeature[]): MembershipPlanRow {
  return {
    id: r.id,
    planKey: r.plan_key as PlanKey,
    displayName: r.display_name,
    durationDays: r.duration_days,
    amount: String(r.amount),
    currency: r.currency,
    enabled: r.enabled === 1,
    displayOrder: r.display_order,
    features,
  };
}

export async function listPlans(opts: { enabledOnly?: boolean } = {}): Promise<MembershipPlanRow[]> {
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : '';
  const [rows] = await getPool().query<any[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans ${where} ORDER BY display_order ASC`,
  );
  return Promise.all((rows as PlanDbRow[]).map(async r => mapPlanRow(r, await loadFeatures(r.id))));
}

export async function getPlanByKey(key: PlanKey): Promise<MembershipPlanRow | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans WHERE plan_key = ? LIMIT 1`,
    [key],
  );
  const arr = rows as PlanDbRow[];
  if (arr.length === 0) return null;
  return mapPlanRow(arr[0], await loadFeatures(arr[0].id));
}

export async function getPlanById(id: number): Promise<MembershipPlanRow | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans WHERE id = ? LIMIT 1`,
    [id],
  );
  const arr = rows as PlanDbRow[];
  if (arr.length === 0) return null;
  return mapPlanRow(arr[0], await loadFeatures(arr[0].id));
}

const SEED_PLANS = [
  { plan_key: 'monthly_usd', display_name: '月度会员', duration_days: 30, amount: '3.00', currency: 'USD', enabled: 1, display_order: 1 },
  { plan_key: 'yearly_usd', display_name: '年度会员', duration_days: 365, amount: '15.00', currency: 'USD', enabled: 1, display_order: 2 },
  { plan_key: 'monthly_cny', display_name: '月度会员', duration_days: 30, amount: '15.00', currency: 'CNY', enabled: 0, display_order: 3 },
  { plan_key: 'yearly_cny', display_name: '年度会员', duration_days: 365, amount: '100.00', currency: 'CNY', enabled: 0, display_order: 4 },
];
const ALL_FEATURES: MembershipFeature[] = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts', 'multi_worksheet_print'];

export async function seedDefaultPlans(): Promise<number> {
  const pool = getPool();
  let inserted = 0;
  for (const p of SEED_PLANS) {
    const [res] = await pool.execute<any>(
      `INSERT IGNORE INTO membership_plans
         (plan_key, display_name, duration_days, amount, currency, enabled, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.plan_key, p.display_name, p.duration_days, p.amount, p.currency, p.enabled, p.display_order],
    );
    if ((res as any).affectedRows > 0) inserted++;
  }
  const [planRows] = await pool.query<any[]>(`SELECT id FROM membership_plans`);
  for (const r of planRows as any[]) {
    for (const f of ALL_FEATURES) {
      await pool.execute(
        `INSERT IGNORE INTO membership_plan_features (plan_id, feature_key) VALUES (?, ?)`,
        [r.id, f],
      );
    }
  }
  return inserted;
}

// --- Placeholders (filled in Task 3 + 4) -----------------------------

export type GrantSource = 'manual' | 'paypal';
export interface GrantMembershipArgs {
  targetUserId: number; planKey: PlanKey; note?: string | null;
  grantedBy: number | null; source: GrantSource; sourcePaymentOrderId?: number | null;
}
export interface GrantedMembership { id: number; expiresAt: Date; }
export async function grantMembership(args: GrantMembershipArgs): Promise<GrantedMembership> {
  const plan = await getPlanByKey(args.planKey);
  if (!plan) throw new Error(`plan_not_found: ${args.planKey}`);
  const pool = getPool();

  // Renewal: extend from current active expires_at, else from NOW()
  const [activeRows] = await pool.query<any[]>(
    `SELECT id, expires_at FROM memberships
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY expires_at DESC LIMIT 1`,
    [args.targetUserId],
  );
  const baseDate = activeRows.length > 0 ? new Date(activeRows[0].expires_at) : new Date();
  const expiresAt = new Date(baseDate.getTime() + plan.durationDays * 86400_000);

  const [res] = await pool.execute<any>(
    `INSERT INTO memberships
       (user_id, plan_key, source, amount, currency, source_payment_order_id, granted_by, note, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.targetUserId, args.planKey, args.source, plan.amount, plan.currency,
      args.sourcePaymentOrderId ?? null, args.grantedBy, args.note ?? null, expiresAt,
    ],
  );
  return { id: Number((res as any).insertId), expiresAt };
}

export interface MembershipRow {
  id: number; userId: number; username: string | null;
  planKey: string; source: GrantSource; amount: string | null; currency: string | null;
  grantedAt: string; expiresAt: string; revokedAt: string | null; note: string | null;
  grantedBy: number | null;
}
export interface ListMembershipsOpts { userId?: number; planKey?: string; page?: number; pageSize?: number; }
export interface ListMembershipsResult { items: MembershipRow[]; total: number; page: number; pageSize: number; }
export async function listMemberships(opts: ListMembershipsOpts): Promise<ListMembershipsResult> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId !== undefined) { where.push('m.user_id = ?'); params.push(opts.userId); }
  if (opts.planKey) { where.push('m.plan_key = ?'); params.push(opts.planKey); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT m.id, m.user_id, u.username, m.plan_key, m.source, m.amount, m.currency,
            m.granted_at, m.expires_at, m.revoked_at, m.note, m.granted_by
     FROM memberships m LEFT JOIN users u ON u.id = m.user_id
     ${whereSql}
     ORDER BY m.granted_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM memberships m ${whereSql}`,
    params,
  );

  return {
    items: (rows as any[]).map(r => ({
      id: Number(r.id), userId: Number(r.user_id), username: r.username,
      planKey: r.plan_key, source: r.source as GrantSource,
      amount: r.amount != null ? String(r.amount) : null,
      currency: r.currency, grantedAt: new Date(r.granted_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      note: r.note, grantedBy: r.granted_by != null ? Number(r.granted_by) : null,
    })),
    total: Number(total), page, pageSize,
  };
}

export async function revokeMembership(id: number, by: number, reason?: string): Promise<MembershipRow> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, revoked_at FROM memberships WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) throw new Error('membership_not_found');
  if (rows[0].revoked_at) throw new Error('already_revoked');

  await pool.execute(
    `UPDATE memberships SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?`,
    [by, reason ?? null, id],
  );
  const refreshed = await listMemberships({ userId: undefined });
  const found = refreshed.items.find(i => i.id === id);
  if (!found) throw new Error('membership_not_found');
  return found;
}

export type ActiveMembership =
  | { active: true; planKey: PlanKey; expiresAt: string; expiresInDays: number }
  | { active: false };
export const getMyActiveMembership = cache(async (userId: number): Promise<ActiveMembership> => {
  const [rows] = await getPool().query<any[]>(
    `SELECT plan_key, expires_at FROM memberships
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY expires_at DESC LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return { active: false };
  const r = rows[0];
  const expiresAt = new Date(r.expires_at);
  const expiresInDays = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400_000));
  return {
    active: true,
    planKey: r.plan_key as PlanKey,
    expiresAt: expiresAt.toISOString(),
    expiresInDays,
  };
});

export const getMyFeatures = cache(async (userId: number): Promise<Set<MembershipFeature>> => {
  const [rows] = await getPool().query<any[]>(
    `SELECT DISTINCT f.feature_key
     FROM memberships m
     JOIN membership_plans p ON p.plan_key = m.plan_key
     JOIN membership_plan_features f ON f.plan_id = p.id
     WHERE m.user_id = ? AND m.revoked_at IS NULL AND m.expires_at > NOW()`,
    [userId],
  );
  return new Set(rows.map(r => r.feature_key as MembershipFeature));
});

export async function hasFeature(userId: number, feature: MembershipFeature): Promise<boolean> {
  const [rows] = await getPool().query<any[]>(
    `SELECT 1 FROM memberships m
     JOIN membership_plans p ON p.plan_key = m.plan_key
     JOIN membership_plan_features f ON f.plan_id = p.id
     WHERE m.user_id = ? AND m.revoked_at IS NULL AND m.expires_at > NOW()
       AND f.feature_key = ? LIMIT 1`,
    [userId, feature],
  );
  return rows.length > 0;
}

export interface PlanPatch {
  displayName?: string; durationDays?: number; amount?: string;
  enabled?: boolean; displayOrder?: number;
  features?: MembershipFeature[];
}

export async function updatePlan(id: number, patch: PlanPatch): Promise<MembershipPlanRow> {
  const pool = getPool();
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.displayName !== undefined) { sets.push('display_name = ?'); params.push(patch.displayName); }
  if (patch.durationDays !== undefined) { sets.push('duration_days = ?'); params.push(patch.durationDays); }
  if (patch.amount !== undefined) { sets.push('amount = ?'); params.push(patch.amount); }
  if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }
  if (patch.displayOrder !== undefined) { sets.push('display_order = ?'); params.push(patch.displayOrder); }

  if (sets.length > 0) {
    await pool.execute(
      `UPDATE membership_plans SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id],
    );
  }

  if (patch.features !== undefined) {
    await pool.execute(`DELETE FROM membership_plan_features WHERE plan_id = ?`, [id]);
    for (const f of patch.features) {
      await pool.execute(`INSERT INTO membership_plan_features (plan_id, feature_key) VALUES (?, ?)`, [id, f]);
    }
  }

  const updated = await getPlanById(id);
  if (!updated) throw new Error(`plan_not_found: ${id}`);
  return updated;
}
