import { getPool } from './db';
import { cache } from 'react';

export const PLAN_KEYS = ['monthly_usd', 'yearly_usd', 'monthly_cny', 'yearly_cny'] as const;
export type PlanKey = typeof PLAN_KEYS[number];

export type MembershipCurrency = 'CNY' | 'USD';
export type MembershipFeature =
  | 'unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts';

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
const ALL_FEATURES: MembershipFeature[] = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'];

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
export async function grantMembership(_args: GrantMembershipArgs): Promise<GrantedMembership> {
  throw new Error('grantMembership not yet implemented');
}

export interface MembershipRow {
  id: number; userId: number; username: string | null;
  planKey: string; source: GrantSource; amount: string | null; currency: string | null;
  grantedAt: string; expiresAt: string; revokedAt: string | null; note: string | null;
  grantedBy: number | null;
}
export interface ListMembershipsOpts { userId?: number; planKey?: string; page?: number; pageSize?: number; }
export interface ListMembershipsResult { items: MembershipRow[]; total: number; page: number; pageSize: number; }
export async function listMemberships(_opts: ListMembershipsOpts): Promise<ListMembershipsResult> {
  throw new Error('listMemberships not yet implemented');
}

export async function revokeMembership(_id: number, _by: number, _reason?: string): Promise<MembershipRow> {
  throw new Error('revokeMembership not yet implemented');
}

export type ActiveMembership =
  | { active: true; planKey: PlanKey; expiresAt: string; expiresInDays: number }
  | { active: false };
export const getMyActiveMembership = cache(async (userId: number): Promise<ActiveMembership> => {
  throw new Error('getMyActiveMembership not yet implemented');
});

export const getMyFeatures = cache(async (_userId: number): Promise<Set<MembershipFeature>> => {
  return new Set();
});
export async function hasFeature(_userId: number, _feature: MembershipFeature): Promise<boolean> {
  return false;
}
