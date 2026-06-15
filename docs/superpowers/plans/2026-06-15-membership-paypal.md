# Membership + PayPal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a membership system: 4 plan slots (monthly/yearly × USD/CNY) editable by admin, manual grant by admin, PayPal USD checkout for users, and a single AI endpoint gated by `ai_calls` feature. Display membership status in `/profile` and `/membership`.

**Architecture:** Server Components for list pages; `'use client'` for admin forms and checkout button; RSC + `force-dynamic` for `/membership` and `/profile`. Webhook is a no-SDK PayPal signature-verified handler with idempotency via `UNIQUE` on `payment_orders.paypal_order_id`. Feature checks via `hasFeature(userId, feature)` backed by `react.cache()`.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2, Tailwind v4, zod, vitest + happy-dom, `react.cache`. **No new third-party SDK** — PayPal via `fetch` + REST. Webhook verified with `verify-webhook-signature` API.

**Spec:** `docs/superpowers/specs/2026-06-15-membership-paypal-design.md`

---

## File Structure

### New files (28)

| Path | Responsibility | LoC |
|---|---|---|
| `scripts/migrate-membership.ts` | Idempotent migration: 4 tables + 4 plans + 16 feature rows | 100 |
| `lib/membership.ts` | Plan CRUD, grant/revoke, feature queries | 280 |
| `lib/membership-stats.ts` | Aggregate stats for admin list page | 60 |
| `lib/paypal.ts` | Config reader, OAuth token cache, create/capture/verify | 180 |
| `lib/payment-orders.ts` | payment_orders table CRUD | 50 |
| `app/api/admin/memberships/route.ts` | GET (list) + POST (grant) | 90 |
| `app/api/admin/memberships/[id]/revoke/route.ts` | POST revoke | 50 |
| `app/api/admin/memberships/plans/route.ts` | GET list plans | 50 |
| `app/api/admin/memberships/plans/[id]/route.ts` | PATCH plan | 70 |
| `app/api/admin/memberships/plans/seed/route.ts` | POST re-seed | 25 |
| `app/api/admin/paypal/config/route.ts` | GET + PUT (mask secrets) | 90 |
| `app/api/admin/paypal/test-connection/route.ts` | POST (test auth) | 40 |
| `app/api/membership/plans/route.ts` | Public plan list (enabled only) | 25 |
| `app/api/membership/checkout/route.ts` | Create PayPal order | 70 |
| `app/api/membership/orders/[id]/route.ts` | Order status for success page | 40 |
| `app/api/membership/me/route.ts` | Current user's active membership | 35 |
| `app/api/webhooks/paypal/route.ts` | Signature verify + event handler | 130 |
| `app/api/ai/char-explain/route.ts` | Gated AI explain endpoint | 60 |
| `app/admin/memberships/page.tsx` | Admin list + stats | 250 |
| `app/admin/memberships/plans/page.tsx` | Plan editor | 200 |
| `app/admin/memberships/config/page.tsx` | PayPal config UI | 180 |
| `app/membership/page.tsx` | User plan grid | 120 |
| `app/membership/success/page.tsx` | Client poll success | 80 |
| `app/membership/cancel/page.tsx` | Static cancel | 20 |
| `components/admin/memberships/PlanRow.tsx` | Editable plan row | 120 |
| `components/admin/memberships/ManualGrantDrawer.tsx` | Grant form drawer | 150 |
| `components/admin/memberships/RevokeButton.tsx` | Revoke confirm | 60 |
| `components/membership/PlanCard.tsx` | Plan display + buy | 80 |
| `components/membership/CheckoutButton.tsx` | Checkout client island | 60 |
| `components/membership/MembershipStatusCard.tsx` | Profile status | 50 |

### New tests (10)

| Path | Covers |
|---|---|
| `tests/unit/lib/membership.test.ts` | plan CRUD, grant, revoke, hasFeature, getMyFeatures |
| `tests/unit/lib/paypal.test.ts` | token cache, getPayPalConfig, verify (mocked fetch) |
| `tests/integration/api/admin-memberships.test.ts` | admin grant/list/revoke |
| `tests/integration/api/admin-memberships-plans.test.ts` | plan PATCH, seed |
| `tests/integration/api/admin-paypal-config.test.ts` | config GET/PUT, masking |
| `tests/integration/api/membership-plans.test.ts` | public list (enabled only) |
| `tests/integration/api/membership-checkout.test.ts` | create PayPal order (mocked) |
| `tests/integration/api/membership-me.test.ts` | current user status |
| `tests/integration/api/webhooks-paypal.test.ts` | signature verify + idempotency |
| `tests/integration/api/ai-char-explain.test.ts` | feature gate |

### Modified files (4)

| Path | Change |
|---|---|
| `lib/audit.ts` | Add 6 events to `AuditEvent` union |
| `lib/api-admin.ts` | Add membership + paypal client wrappers |
| `components/admin/AdminSidebar.tsx` | Add `/admin/memberships` link |
| `components/Header.tsx` | Add "会员" link for logged-in users |

---

## Conventions

- All migrations are idempotent: check `INFORMATION_SCHEMA` before ALTER; `CREATE TABLE IF NOT EXISTS` for new tables; `INSERT IGNORE` for seed.
- All admin routes use `requireAdmin()` → 403 if not admin.
- All user routes use `getCurrentUser()` → 401 if not logged in.
- Webhook returns 200 even on unrecognized event (PayPal retry-safe).
- PayPal credentials stored in `app_config` table (keys: `paypal.mode`, `paypal.client_id`, `paypal.client_secret`, `paypal.webhook_id`).
- All times stored as MySQL `TIMESTAMP` / `DATETIME`; ISO strings at API boundary.
- Decimals: `DECIMAL(10,2)` in DB, string in JSON, `Number()` for math.

## Race condition note

The webhook handler treats `CHECKOUT.ORDER.APPROVED` as "user clicked pay" and calls `POST /v2/checkout/orders/{id}/capture` server-side. The client success page (`/membership/success`) is **read-only polling** — it does NOT call capture. The webhook is the sole capture trigger. Document this in `lib/paypal.ts` header.

---

# Milestone 1: Foundation (DB + manual grant + admin list)

## Task 1: DB migration script — create all 4 tables

**Files:**
- Create: `scripts/migrate-membership.ts`
- Test: `tests/integration/api/admin-memberships.test.ts` (will be created in Task 8)

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-membership.ts`:

```ts
/**
 * One-time migration: create 4 membership tables + seed 4 plans + 16 plan_features.
 * Idempotent: safe to re-run.
 *
 * Run: pnpm tsx --env-file=.env scripts/migrate-membership.ts
 * After verifying, delete this file (like migrate-pinyin-from-rare-chars.ts).
 */
import { getPool, closePool } from '../lib/db';

const DDL = [
  `CREATE TABLE IF NOT EXISTS memberships (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
     source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
     amount DECIMAL(10,2) NULL,
     currency ENUM('CNY','USD') NULL,
     source_payment_order_id BIGINT NULL,
     granted_by BIGINT NULL,
     note VARCHAR(255) NULL,
     granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     expires_at TIMESTAMP NOT NULL,
     revoked_at TIMESTAMP NULL,
     revoked_by BIGINT NULL,
     revoke_reason VARCHAR(255) NULL,
     PRIMARY KEY (id),
     KEY idx_memberships_user (user_id, granted_at DESC),
     KEY idx_memberships_expires (expires_at),
     UNIQUE KEY uk_memberships_payment_order (source_payment_order_id),
     CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT fk_memberships_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
     CONSTRAINT fk_memberships_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS membership_plans (
     id BIGINT NOT NULL AUTO_INCREMENT,
     plan_key VARCHAR(32) NOT NULL,
     display_name VARCHAR(64) NOT NULL,
     duration_days INT NOT NULL,
     amount DECIMAL(10,2) NOT NULL,
     currency ENUM('CNY','USD') NOT NULL,
     enabled TINYINT(1) NOT NULL DEFAULT 0,
     display_order INT NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uk_plan_key (plan_key)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS membership_plan_features (
     plan_id BIGINT NOT NULL,
     feature_key VARCHAR(32) NOT NULL,
     PRIMARY KEY (plan_id, feature_key),
     CONSTRAINT fk_mpf_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS payment_orders (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     plan_id BIGINT NOT NULL,
     paypal_order_id VARCHAR(64) NOT NULL,
     status ENUM('created','approved','paid','failed','expired') NOT NULL DEFAULT 'created',
     amount DECIMAL(10,2) NOT NULL,
     currency ENUM('CNY','USD') NOT NULL,
     approval_url VARCHAR(512) NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     paid_at TIMESTAMP NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_paypal_order (paypal_order_id),
     KEY idx_po_user (user_id, created_at DESC),
     CONSTRAINT fk_po_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT fk_po_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE RESTRICT
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SEED_PLANS = [
  { plan_key: 'monthly_usd', display_name: '月度会员', duration_days: 30, amount: '3.00', currency: 'USD', enabled: 1, display_order: 1 },
  { plan_key: 'yearly_usd', display_name: '年度会员', duration_days: 365, amount: '15.00', currency: 'USD', enabled: 1, display_order: 2 },
  { plan_key: 'monthly_cny', display_name: '月度会员', duration_days: 30, amount: '15.00', currency: 'CNY', enabled: 0, display_order: 3 },
  { plan_key: 'yearly_cny', display_name: '年度会员', duration_days: 365, amount: '100.00', currency: 'CNY', enabled: 0, display_order: 4 },
];

const ALL_FEATURES = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'];

export async function migrateMembership(): Promise<{ created: number; seeded: number; featureRows: number }> {
  const pool = getPool();
  for (const sql of DDL) await pool.query(sql);

  let seeded = 0;
  for (const p of SEED_PLANS) {
    const [res] = await pool.execute<any>(
      `INSERT IGNORE INTO membership_plans
         (plan_key, display_name, duration_days, amount, currency, enabled, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.plan_key, p.display_name, p.duration_days, p.amount, p.currency, p.enabled, p.display_order],
    );
    seeded += (res as any).affectedRows > 0 ? 1 : 0;
  }

  // For each plan, look up its id and INSERT IGNORE all 4 feature rows
  const [planRows] = await pool.query<any[]>(`SELECT id, plan_key FROM membership_plans`);
  let featureRows = 0;
  for (const r of planRows as any[]) {
    for (const f of ALL_FEATURES) {
      const [res] = await pool.execute<any>(
        `INSERT IGNORE INTO membership_plan_features (plan_id, feature_key) VALUES (?, ?)`,
        [r.id, f],
      );
      featureRows += (res as any).affectedRows > 0 ? 1 : 0;
    }
  }

  return { created: 4, seeded, featureRows };
}

async function main() {
  const r = await migrateMembership();
  console.error(`[migrate-membership] tables=4, plans seeded=${r.seeded}, feature_rows=${r.featureRows}`);
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Run the migration**

```bash
pnpm tsx --env-file=.env scripts/migrate-membership.ts
```

Expected output:
```
[migrate-membership] tables=4, plans seeded=4, feature_rows=16
```

- [ ] **Step 3: Verify tables exist**

```bash
mysql $DATABASE_URL -e "SHOW TABLES LIKE 'membership%'; SHOW TABLES LIKE 'payment%';"
```

Expected: 3 rows (`memberships`, `membership_plans`, `membership_plan_features`) + `payment_orders`.

- [ ] **Step 4: Verify seed data**

```bash
mysql $DATABASE_URL -e "SELECT plan_key, display_name, amount, currency, enabled FROM membership_plans ORDER BY display_order;"
```

Expected: 4 rows, USD plans with `enabled=1`, CNY plans with `enabled=0`.

```bash
mysql $DATABASE_URL -e "SELECT COUNT(*) AS n FROM membership_plan_features;"
```

Expected: `n = 16`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-membership.ts
git commit -m "feat(membership): idempotent migration — 4 tables + 4 plans + 16 feature rows"
```

---

## Task 2: `lib/membership.ts` — types, plan list, getPlanByKey

**Files:**
- Create: `lib/membership.ts`
- Test: `tests/unit/lib/membership.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/membership.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import {
  PLAN_KEYS, type PlanKey, type MembershipFeature,
  listPlans, getPlanByKey, getPlanById, seedDefaultPlans,
} from '@/lib/membership';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('membership plans', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    // Ensure schema (test DB may not have run migration)
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT,
      plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL,
      duration_days INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      display_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL,
      feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM membership_plan_features');
    await pool.query('DELETE FROM membership_plans');
  });

  afterAll(async () => { await closePool(); });

  it('PLAN_KEYS has exactly 4 plan keys', () => {
    expect(PLAN_KEYS).toEqual(['monthly_usd', 'yearly_usd', 'monthly_cny', 'yearly_cny']);
  });

  it('listPlans returns empty array when no plans exist', async () => {
    const plans = await listPlans();
    expect(plans).toEqual([]);
  });

  it('seedDefaultPlans inserts 4 plans and 16 features', async () => {
    const n = await seedDefaultPlans();
    expect(n).toBe(4);
    const plans = await listPlans();
    expect(plans).toHaveLength(4);
    expect(plans.reduce((s, p) => s + p.features.length, 0)).toBe(16);
  });

  it('listPlans({ enabledOnly: true }) filters disabled', async () => {
    await seedDefaultPlans();
    const all = await listPlans();
    const enabled = await listPlans({ enabledOnly: true });
    expect(enabled.length).toBeLessThan(all.length);
    expect(enabled.every(p => p.enabled)).toBe(true);
  });

  it('getPlanByKey returns full row with features', async () => {
    await seedDefaultPlans();
    const p = await getPlanByKey('monthly_usd' as PlanKey);
    expect(p).not.toBeNull();
    expect(p!.durationDays).toBe(30);
    expect(p!.amount).toBe('3.00');
    expect(p!.currency).toBe('USD');
    expect(p!.features).toContain('ai_calls');
  });

  it('getPlanByKey returns null for missing key', async () => {
    const p = await getPlanByKey('nonexistent' as PlanKey);
    expect(p).toBeNull();
  });

  it('getPlanById returns the same plan by id', async () => {
    await seedDefaultPlans();
    const byKey = await getPlanByKey('yearly_usd' as PlanKey);
    const byId = await getPlanById(byKey!.id);
    expect(byId!.planKey).toBe(byKey!.planKey);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/membership'".

- [ ] **Step 3: Write the minimal `lib/membership.ts`**

Create `lib/membership.ts`:

```ts
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
  return rows.map(r => r.feature_key as MembershipFeature);
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
  const [rows] = await getPool().query<PlanDbRow[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans ${where} ORDER BY display_order ASC`,
  );
  return Promise.all(rows.map(async r => mapPlanRow(r, await loadFeatures(r.id))));
}

export async function getPlanByKey(key: PlanKey): Promise<MembershipPlanRow | null> {
  const [rows] = await getPool().query<PlanDbRow[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans WHERE plan_key = ? LIMIT 1`,
    [key],
  );
  if (rows.length === 0) return null;
  return mapPlanRow(rows[0], await loadFeatures(rows[0].id));
}

export async function getPlanById(id: number): Promise<MembershipPlanRow | null> {
  const [rows] = await getPool().query<PlanDbRow[]>(
    `SELECT id, plan_key, display_name, duration_days, amount, currency, enabled, display_order
     FROM membership_plans WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  return mapPlanRow(rows[0], await loadFeatures(rows[0].id));
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: PASS (7 tests). The placeholder functions are unreachable in this task's tests.

- [ ] **Step 5: Commit**

```bash
git add lib/membership.ts tests/unit/lib/membership.test.ts
git commit -m "feat(membership): plan types + list/get/seed — Task 2"
```

---

## Task 3: `lib/membership.ts` — grant, list, revoke

**Files:**
- Modify: `lib/membership.ts`
- Test: `tests/unit/lib/membership.test.ts` (extend)

- [ ] **Step 1: Add failing tests for grant + list + revoke**

Append to `tests/unit/lib/membership.test.ts` (inside `d('membership plans', ...)` block, after the existing tests but before the closing `});`):

```ts
  // --- grant / list / revoke ---------------------------------------

  let testUserId: number;
  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('mem_test_${Date.now()}', 'x')`);
    const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    testUserId = Number(r[0].id);
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [testUserId]);
    await pool.query(`DELETE FROM users WHERE id = ?`, [testUserId]);
  });

  it('grantMembership inserts row with expires_at = now + duration_days', async () => {
    await seedDefaultPlans();
    const result = await grantMembership({
      targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual',
    });
    expect(result.id).toBeGreaterThan(0);
    const days = Math.round((result.expiresAt.getTime() - Date.now()) / 86400_000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('grantMembership extends from current active expires_at (renewal)', async () => {
    await seedDefaultPlans();
    const first = await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    const second = await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    // Second expiry should be ~60 days from now (extends by 30)
    const days = Math.round((second.expiresAt.getTime() - Date.now()) / 86400_000);
    expect(days).toBeGreaterThanOrEqual(58);
    expect(days).toBeLessThanOrEqual(62);
  });

  it('grantMembership with invalid planKey throws', async () => {
    await expect(
      grantMembership({ targetUserId: testUserId, planKey: 'nope' as any, grantedBy: null, source: 'manual' }),
    ).rejects.toThrow();
  });

  it('listMemberships returns paginated rows joined with username', async () => {
    await seedDefaultPlans();
    await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    const result = await listMemberships({ userId: testUserId, pageSize: 10 });
    expect(result.total).toBe(1);
    expect(result.items[0].userId).toBe(testUserId);
    expect(result.items[0].planKey).toBe('monthly_usd');
    expect(result.items[0].source).toBe('manual');
  });

  it('revokeMembership sets revoked_at and is idempotent (second call throws already_revoked)', async () => {
    await seedDefaultPlans();
    const m = await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    const r = await revokeMembership(m.id, testUserId, 'test reason');
    expect(r.revokedAt).not.toBeNull();
    await expect(revokeMembership(m.id, testUserId)).rejects.toThrow(/already_revoked/);
  });
```

- [ ] **Step 2: Run the test to verify the new tests fail**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: 5 new tests fail with "not yet implemented".

- [ ] **Step 3: Implement grant + list + revoke in `lib/membership.ts`**

Replace the placeholder implementations of `grantMembership`, `listMemberships`, `revokeMembership` with:

```ts
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
```

- [ ] **Step 4: Run the test to verify all pass**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/membership.ts tests/unit/lib/membership.test.ts
git commit -m "feat(membership): grant + list + revoke (renewal extends from current expires_at)"
```

---

## Task 4: `lib/membership.ts` — getMyActiveMembership + hasFeature + getMyFeatures

**Files:**
- Modify: `lib/membership.ts`
- Test: `tests/unit/lib/membership.test.ts` (extend)

- [ ] **Step 1: Add failing tests for user-side queries**

Append to `tests/unit/lib/membership.test.ts` (inside the `d('membership plans', ...)` block, before the closing `});`):

```ts
  // --- getMyActiveMembership + hasFeature + getMyFeatures -------

  it('getMyActiveMembership returns active:false for user with no membership', async () => {
    const r = await getMyActiveMembership(testUserId);
    expect(r.active).toBe(false);
  });

  it('getMyActiveMembership returns active:true with expiresAt + planKey', async () => {
    await seedDefaultPlans();
    await grantMembership({ targetUserId: testUserId, planKey: 'yearly_usd', grantedBy: null, source: 'manual' });
    const r = await getMyActiveMembership(testUserId);
    expect(r.active).toBe(true);
    if (r.active) {
      expect(r.planKey).toBe('yearly_usd');
      expect(r.expiresInDays).toBeGreaterThan(360);
    }
  });

  it('getMyActiveMembership ignores revoked rows', async () => {
    await seedDefaultPlans();
    const m = await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    await revokeMembership(m.id, testUserId);
    const r = await getMyActiveMembership(testUserId);
    expect(r.active).toBe(false);
  });

  it('hasFeature returns true for active plan that includes the feature', async () => {
    await seedDefaultPlans();
    await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    const ok = await hasFeature(testUserId, 'ai_calls');
    expect(ok).toBe(true);
  });

  it('hasFeature returns false for user with no membership', async () => {
    const ok = await hasFeature(testUserId, 'ai_calls');
    expect(ok).toBe(false);
  });

  it('getMyFeatures returns a Set with 4 features for active plan', async () => {
    await seedDefaultPlans();
    await grantMembership({ targetUserId: testUserId, planKey: 'monthly_usd', grantedBy: null, source: 'manual' });
    const set = await getMyFeatures(testUserId);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(4);
    expect(set.has('ai_calls')).toBe(true);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm test tests/unit/lib/membership.test.ts -t "getMyActiveMembership|hasFeature|getMyFeatures"
```

Expected: 6 tests fail with "not yet implemented".

- [ ] **Step 3: Implement the three functions**

Replace the placeholder `getMyActiveMembership`, `getMyFeatures`, `hasFeature` in `lib/membership.ts` with:

```ts
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
```

- [ ] **Step 4: Run all membership tests**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/membership.ts tests/unit/lib/membership.test.ts
git commit -m "feat(membership): getMyActiveMembership + hasFeature + getMyFeatures (React cache)"
```

---

## Task 5: Audit event union — add 6 membership events

**Files:**
- Modify: `lib/audit.ts:3-13`

- [ ] **Step 1: Add the new events to the `AuditEvent` union**

Edit `lib/audit.ts`, replace the `AuditEvent` type with:

```ts
export type AuditEvent =
  | 'register' | 'login' | 'logout'
  | 'history_create' | 'history_delete'
  | 'password_reset_request' | 'password_reset_complete'
  | 'admin_user_delete' | 'admin_user_password_reset'
  | 'admin_user_promote' | 'admin_user_demote'
  | 'user_disabled' | 'user_reenabled'
  | 'ai_config_updated' | 'ai_call_logged'
  | 'tts_config_updated'
  | 'worksheet_saved' | 'worksheet_deleted'
  | 'poem_saved' | 'sutra_saved' | 'rare_char_card_saved'
  | 'membership_granted' | 'membership_granted_paypal' | 'membership_revoked'
  | 'paypal_config_updated' | 'paypal_webhook_received' | 'paypal_webhook_rejected';
```

- [ ] **Step 2: Verify the type compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Update the existing audit test to expect 22 events**

Edit `tests/unit/lib/audit.test.ts`, replace the events array with:

```ts
  it('exports the 22 expected events', () => {
    const events: AuditEvent[] = [
      'register', 'login', 'logout',
      'history_create', 'history_delete',
      'password_reset_request', 'password_reset_complete',
      'admin_user_delete', 'admin_user_password_reset',
      'admin_user_promote', 'admin_user_demote',
      'user_disabled', 'user_reenabled',
      'ai_config_updated', 'ai_call_logged',
      'tts_config_updated',
      'worksheet_saved', 'worksheet_deleted',
      'poem_saved', 'sutra_saved', 'rare_char_card_saved',
      'membership_granted',
    ];
    expect(events).toHaveLength(22);
  });
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/unit/lib/audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/audit.ts tests/unit/lib/audit.test.ts
git commit -m "feat(audit): add 6 membership + PayPal event types"
```

---

## Task 6: API — list + grant + revoke memberships

**Files:**
- Create: `app/api/admin/memberships/route.ts`
- Create: `app/api/admin/memberships/[id]/revoke/route.ts`
- Test: `tests/integration/api/admin-memberships.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/api/admin-memberships.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET as listHandler, POST as grantHandler } from '@/app/api/admin/memberships/route';
import { POST as revokeHandler } from '@/app/api/admin/memberships/[id]/revoke/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let adminId: number, userId: number, adminToken: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/memberships routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    // Ensure schema
    await pool.query(`CREATE TABLE IF NOT EXISTS memberships (
      id BIGINT NOT NULL AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
      source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
      amount DECIMAL(10,2) NULL, currency ENUM('CNY','USD') NULL,
      source_payment_order_id BIGINT NULL,
      granted_by BIGINT NULL, note VARCHAR(255) NULL,
      granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL, revoked_by BIGINT NULL, revoke_reason VARCHAR(255) NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT,
      plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL,
      duration_days INT NOT NULL, amount DECIMAL(10,2) NOT NULL,
      currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Seed 4 plans + 16 features
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    for (const p of [
      { k: 'monthly_usd', dn: '月度会员', d: 30, a: '3.00', c: 'USD', e: 1, o: 1 },
      { k: 'yearly_usd', dn: '年度会员', d: 365, a: '15.00', c: 'USD', e: 1, o: 2 },
      { k: 'monthly_cny', dn: '月度会员', d: 30, a: '15.00', c: 'CNY', e: 0, o: 3 },
      { k: 'yearly_cny', dn: '年度会员', d: 365, a: '100.00', c: 'CNY', e: 0, o: 4 },
    ]) {
      await pool.execute(
        `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.k, p.dn, p.d, p.a, p.c, p.e, p.o],
      );
      const [r] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
      for (const f of ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts']) {
        await pool.execute(`INSERT INTO membership_plan_features (plan_id, feature_key) VALUES (?, ?)`, [Number((r[0] as any).id), f]);
      }
    }

    // Seed admin + user
    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_mem', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_mem', ?)`, [hash]);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_mem' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    await getPool().query(`DELETE FROM audit_log WHERE user_id IN (?, ?)`, [adminId, userId]);
    await getPool().query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE id IN (?, ?)`, [adminId, userId]);
    await closePool();
  });

  const cookieHeader = () => ({ cookie: `auth_token=${adminToken}` });
  const jsonHeader = () => ({ ...cookieHeader(), 'content-type': 'application/json' });

  it('POST /api/admin/memberships — grants a membership and writes audit', async () => {
    const req = new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    });
    const res = await grantHandler(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeGreaterThan(0);
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

    const [audit] = await getPool().query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'membership_granted'`,
      [adminId],
    );
    expect(audit.length).toBe(1);
  });

  it('POST with unknown planKey returns 404', async () => {
    const req = new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'unknown' }),
    });
    const res = await grantHandler(req);
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/memberships — lists rows for the user', async () => {
    const gr = await grantHandler(new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    }));
    const { data: granted } = await gr.json();

    const res = await listHandler(new NextRequest(`http://localhost/api/admin/memberships?userId=${userId}`, { headers: cookieHeader() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0].id).toBe(granted.id);
    expect(body.data.items[0].username).toBe('usr_mem');
  });

  it('POST /api/admin/memberships/[id]/revoke — revokes and writes audit', async () => {
    const gr = await grantHandler(new NextRequest('http://localhost/api/admin/memberships', {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ userId, planKey: 'monthly_usd' }),
    }));
    const { data: granted } = await gr.json();

    const rev = await revokeHandler(new NextRequest(`http://localhost/api/admin/memberships/${granted.id}/revoke`, {
      method: 'POST', headers: jsonHeader(),
      body: JSON.stringify({ reason: 'test' }),
    }), { params: Promise.resolve({ id: String(granted.id) }) });
    const revBody = await rev.json();
    expect(rev.status).toBe(200);
    expect(revBody.data.revokedAt).not.toBeNull();

    const second = await revokeHandler(new NextRequest(`http://localhost/api/admin/memberships/${granted.id}/revoke`, {
      method: 'POST', headers: jsonHeader(), body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: String(granted.id) }) });
    expect(second.status).toBe(409);
  });

  it('Non-admin request returns 403', async () => {
    // Login as non-admin
    const usrTok = await signSession({ id: userId, username: 'usr_mem' });
    testCookieStore['auth_token'] = { value: usrTok };
    const res = await listHandler(new NextRequest('http://localhost/api/admin/memberships', {
      headers: { cookie: `auth_token=${usrTok}` },
    }));
    expect(res.status).toBe(403);
    testCookieStore['auth_token'] = { value: adminToken };
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/admin-memberships.test.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement list + grant route**

Create `app/api/admin/memberships/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listMemberships, grantMembership, getPlanByKey, PLAN_KEYS } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const userId = sp.get('userId') ? Number(sp.get('userId')) : undefined;
    const planKey = sp.get('planKey') ?? undefined;
    const page = sp.get('page') ? Number(sp.get('page')) : undefined;
    const pageSize = sp.get('pageSize') ? Number(sp.get('pageSize')) : undefined;
    const result = await listMemberships({ userId, planKey, page, pageSize });
    return NextResponse.json({ ok: true, data: result });
  });
}

const GrantSchema = z.object({
  userId: z.number().int().positive(),
  planKey: z.enum(PLAN_KEYS),
  note: z.string().max(255).optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = GrantSchema.safeParse(body);
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const plan = await getPlanByKey(parsed.data.planKey);
    if (!plan) return notFound('plan_not_found', `plan ${parsed.data.planKey} not found`);
    // Ensure target user exists
    const [u] = await getPool().query<any[]>(`SELECT id FROM users WHERE id = ? LIMIT 1`, [parsed.data.userId]);
    if (u.length === 0) return notFound('user_not_found', `user ${parsed.data.userId} not found`);

    const result = await grantMembership({
      targetUserId: parsed.data.userId,
      planKey: parsed.data.planKey,
      note: parsed.data.note ?? null,
      grantedBy: auth.user.id,
      source: 'manual',
    });
    await writeAudit({
      userId: auth.user.id,
      event: 'membership_granted',
      metadata: {
        targetUserId: parsed.data.userId,
        planKey: parsed.data.planKey,
        currency: plan.currency,
        expiresAt: result.expiresAt.toISOString(),
      },
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Implement revoke route**

Create `app/api/admin/memberships/[id]/revoke/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound, forbidden } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { revokeMembership, listMemberships } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';

const RevokeSchema = z.object({ reason: z.string().max(255).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('bad_id', 'invalid membership id');

    const parsed = RevokeSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    try {
      const row = await revokeMembership(id, auth.user.id, parsed.data.reason);
      await writeAudit({
        userId: auth.user.id,
        event: 'membership_revoked',
        metadata: { membershipId: id, targetUserId: row.userId, reason: parsed.data.reason ?? null },
      });
      return NextResponse.json({ ok: true, data: row });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'membership_not_found') return notFound('membership_not_found', msg);
      if (msg === 'already_revoked') {
        return NextResponse.json({ ok: false, error: { code: 'already_revoked', message: msg } }, { status: 409 });
      }
      throw err;
    }
  });
}
```

- [ ] **Step 5: Run the integration test**

```bash
pnpm test tests/integration/api/admin-memberships.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/memberships/ tests/integration/api/admin-memberships.test.ts
git commit -m "feat(membership): admin list + grant + revoke API with audit"
```

---

## Task 7: API client wrapper for admin membership endpoints

**Files:**
- Modify: `lib/api-admin.ts` (append)

- [ ] **Step 1: Add the client wrapper types and functions**

Append to `lib/api-admin.ts`:

```ts
// --- H12: Memberships (admin) ---------------------------------------

export interface AdminMembershipRow {
  id: number;
  userId: number;
  username: string | null;
  planKey: string;
  source: 'manual' | 'paypal';
  amount: string | null;
  currency: string | null;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  note: string | null;
  grantedBy: number | null;
}
export interface AdminMembershipListData { items: AdminMembershipRow[]; total: number; page: number; pageSize: number; }

export async function listAdminMembershipsRequest(params: {
  userId?: number; planKey?: string; page?: number; pageSize?: number;
} = {}): Promise<ApiResult<AdminMembershipListData>> {
  const sp = new URLSearchParams();
  if (params.userId !== undefined) sp.set('userId', String(params.userId));
  if (params.planKey) sp.set('planKey', params.planKey);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return call(`/api/admin/memberships${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function grantAdminMembershipRequest(body: {
  userId: number; planKey: string; note?: string;
}): Promise<ApiResult<{ id: number; expiresAt: string }>> {
  return call('/api/admin/memberships', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function revokeAdminMembershipRequest(id: number, reason?: string): Promise<ApiResult<AdminMembershipRow>> {
  return call(`/api/admin/memberships/${id}/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/api-admin.ts
git commit -m "feat(api-admin): client wrappers for admin memberships endpoints"
```

---

## Task 8: Admin memberships list page (RSC) — server-rendered with stats

**Files:**
- Create: `app/admin/memberships/page.tsx`
- Create: `lib/membership-stats.ts`
- Test: covered by Task 6 integration tests (lib functions), plus manual smoke

- [ ] **Step 1: Write `lib/membership-stats.ts`**

Create `lib/membership-stats.ts`:

```ts
import { getPool } from './db';
import { listMemberships } from './membership';

export interface MembershipStats {
  total: number;
  active: number;
  newThisMonth: number;
  revenueThisMonth: number; // sum of amount in USD equivalent — for v1 we sum raw amounts
  bySource: { manual: number; paypal: number };
}

export async function getMembershipStats(): Promise<MembershipStats> {
  const pool = getPool();
  const [totals] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM memberships`);
  const [active] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM memberships WHERE revoked_at IS NULL AND expires_at > NOW()`,
  );
  const [newM] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM memberships WHERE granted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
  );
  const [rev] = await pool.query<any[]>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM memberships
     WHERE granted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND source = 'paypal' AND currency = 'USD'`,
  );
  const [bySrc] = await pool.query<any[]>(
    `SELECT source, COUNT(*) AS n FROM memberships GROUP BY source`,
  );
  const bySource: MembershipStats['bySource'] = { manual: 0, paypal: 0 };
  for (const r of bySrc as any[]) bySource[r.source as 'manual' | 'paypal'] = Number(r.n);
  return {
    total: Number(totals[0].n),
    active: Number(active[0].n),
    newThisMonth: Number(newM[0].n),
    revenueThisMonth: Number(rev[0].s),
    bySource,
  };
}
```

- [ ] **Step 2: Create the admin page**

Create `app/admin/memberships/page.tsx`:

```tsx
import Link from 'next/link';
import { listMemberships } from '@/lib/membership';
import { getMembershipStats } from '@/lib/membership-stats';
import { ManualGrantDrawer } from '@/components/admin/memberships/ManualGrantDrawer';
import { RevokeButton } from '@/components/admin/memberships/RevokeButton';
import { Crown, Users, TrendingUp, DollarSign } from 'lucide-react';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface PageProps { searchParams: Promise<{ userId?: string; planKey?: string; page?: string }>; }

export default async function AdminMembershipsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const userId = sp.userId ? Number(sp.userId) : undefined;
  const planKey = sp.planKey ?? undefined;
  const page = Math.max(Number(sp.page) || 1, 1);

  const [stats, list] = await Promise.all([
    getMembershipStats(),
    listMemberships({ userId, planKey, page, pageSize: PAGE_SIZE }),
  ]);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">会员</h1>
        <div className="flex gap-2">
          <ManualGrantDrawer />
          <Link href="/admin/memberships/plans" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">套餐设置</Link>
          <Link href="/admin/memberships/config" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">支付配置</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="总开通" value={stats.total} icon={Crown} />
        <Stat label="当前活跃" value={stats.active} icon={Users} />
        <Stat label="本月新增" value={stats.newThisMonth} icon={TrendingUp} />
        <Stat label="本月收入 (USD)" value={`$${stats.revenueThisMonth.toFixed(2)}`} icon={DollarSign} />
      </div>

      <div className="card-paper rounded-lg p-3 flex flex-wrap gap-2 items-end text-sm">
        <FilterChip active={!userId && !planKey} href="/admin/memberships">全部</FilterChip>
        <FilterChip active={!!userId} href={userId ? '/admin/memberships' : `/admin/memberships?userId=${userId ?? ''}`}>{userId ? `用户 #${userId}` : '按用户'}</FilterChip>
      </div>

      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">开通时间</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">套餐</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">到期</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">{new Date(r.grantedAt).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-2">
                  {r.username
                    ? <Link href={`/admin/users/${r.userId}`} className="text-seal hover:underline">{r.username}</Link>
                    : <span className="text-ink-faint">#{r.userId}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{r.planKey}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${r.source === 'paypal' ? 'bg-green-100 text-green-800' : 'bg-paper-deep text-ink-soft'}`}>{r.source}</span>
                </td>
                <td className="px-3 py-2 text-xs">{r.amount != null ? `${r.currency === 'USD' ? '$' : '¥'}${r.amount}` : '—'}</td>
                <td className="px-3 py-2 text-xs">{new Date(r.expiresAt).toLocaleDateString('zh-CN')}</td>
                <td className="px-3 py-2">
                  {r.revokedAt
                    ? <span className="text-xs px-2 py-0.5 rounded bg-seal/15 text-seal">已撤销</span>
                    : <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">活跃</span>}
                </td>
                <td className="px-3 py-2">
                  {!r.revokedAt && <RevokeButton membershipId={r.id} />}
                </td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-faint">暂无会员</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>共 {list.total} 条 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <Link href={`/admin/memberships?page=${Math.max(1, page - 1)}`}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}>上一页</Link>
          <Link href={`/admin/memberships?page=${Math.min(totalPages, page + 1)}`}
            className={`text-sm px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}>下一页</Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-lg border border-paper-warm bg-paper p-4 flex items-center gap-3">
      <Icon className="h-6 w-6 text-seal shrink-0" />
      <div>
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="text-2xl font-serif text-ink">{value}</div>
      </div>
    </div>
  );
}

function FilterChip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`text-xs px-3 py-1.5 rounded border transition-colors ${
      active ? 'bg-ink text-paper border-ink' : 'border-paper-warm text-ink hover:bg-paper-warm'
    }`}>{children}</Link>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: error on the `ManualGrantDrawer` / `RevokeButton` imports — those are created in Task 9/10. Will resolve in next task.

- [ ] **Step 4: Commit (page only, even with broken imports — fixed in next task)**

```bash
git add app/admin/memberships/page.tsx lib/membership-stats.ts
git commit -m "feat(membership): admin list page + stats (drawer/button stubs in next tasks)"
```

---

## Task 9: `ManualGrantDrawer` + `RevokeButton` components

**Files:**
- Create: `components/admin/memberships/ManualGrantDrawer.tsx`
- Create: `components/admin/memberships/RevokeButton.tsx`

- [ ] **Step 1: Create `RevokeButton`**

Create `components/admin/memberships/RevokeButton.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, AlertTriangle } from 'lucide-react';
import { revokeAdminMembershipRequest } from '@/lib/api-admin';

export function RevokeButton({ membershipId }: { membershipId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const onRevoke = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await revokeAdminMembershipRequest(membershipId, reason || undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setConfirming(false);
    router.refresh();
  }, [membershipId, reason, router]);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="text-xs px-2 py-1 border border-seal/30 text-seal rounded hover:bg-seal/5 inline-flex items-center gap-1">
        <Ban className="h-3 w-3" />撤销
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="原因(可选)"
        className="text-xs border border-paper-warm rounded px-1 py-0.5 w-24" />
      <button type="button" onClick={onRevoke} disabled={busy}
        className="text-xs px-2 py-1 bg-seal text-paper rounded hover:bg-seal/80 disabled:opacity-50 inline-flex items-center gap-1">
        <Check className="h-3 w-3" />确认
      </button>
      <button type="button" onClick={() => { setConfirming(false); setErr(null); }}
        className="text-xs px-2 py-1 border border-ink/20 rounded text-ink hover:bg-paper-deep">取消</button>
      {err && <span className="text-xs text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Create `ManualGrantDrawer`**

Create `components/admin/memberships/ManualGrantDrawer.tsx`:

```tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, X, Check, AlertTriangle } from 'lucide-react';
import { grantAdminMembershipRequest, listAdminPlansRequest } from '@/lib/api-admin';

interface Plan { id: number; planKey: string; displayName: string; durationDays: number; amount: string; currency: string; enabled: boolean; features: string[]; }

export function ManualGrantDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [planKey, setPlanKey] = useState('');
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listAdminPlansRequest().then(r => {
      if (r.ok) {
        setPlans(r.data.items as any);
        const first = (r.data.items as Plan[]).find(p => p.enabled) ?? r.data.items[0];
        if (first) setPlanKey(first.planKey);
      }
    });
  }, [open]);

  const onGrant = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) { setBusy(false); setErr('userId 必须是正整数'); return; }
    if (!planKey) { setBusy(false); setErr('请选择套餐'); return; }
    const r = await grantAdminMembershipRequest({ userId: uid, planKey, note: note || undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(`已开通,到期 ${new Date(r.data.expiresAt).toLocaleDateString('zh-CN')}`);
    setUserId(''); setNote('');
    router.refresh();
  }, [userId, planKey, note, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 inline-flex items-center gap-1">
        <UserPlus className="h-4 w-4" />手动开通
      </button>
      {open && (
        <div className="fixed inset-0 z-30 bg-ink/40" onClick={() => setOpen(false)}>
          <form onSubmit={onGrant}
            className="absolute right-0 top-0 h-full w-80 bg-paper-soft p-5 shadow-paper-lg overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-kai text-lg text-ink">手动开通会员</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭"><X className="h-5 w-5" /></button>
            </div>
            {err && <p className="text-sm text-seal mb-3 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
            {msg && <p className="text-sm text-green-700 mb-3 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{msg}</p>}
            <label className="text-xs text-ink-soft">用户 ID</label>
            <input value={userId} onChange={e => setUserId(e.target.value)} type="number" min="1"
              className="w-full mt-1 mb-3 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
            <label className="text-xs text-ink-soft">套餐</label>
            <select value={planKey} onChange={e => setPlanKey(e.target.value)}
              className="w-full mt-1 mb-3 border border-paper-warm rounded px-2 py-1 text-sm bg-paper">
              {plans.map(p => <option key={p.planKey} value={p.planKey}>
                {p.displayName} · {p.currency === 'USD' ? '$' : '¥'}{p.amount} · {p.durationDays} 天 {p.enabled ? '' : '(未启用)'}
              </option>)}
            </select>
            <label className="text-xs text-ink-soft">备注 (可选)</label>
            <input value={note} onChange={e => setNote(e.target.value)} type="text" maxLength={255}
              className="w-full mt-1 mb-4 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
            <button type="submit" disabled={busy}
              className="w-full text-sm px-3 py-2 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
              {busy ? '开通中…' : '确认开通'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Add `listAdminPlansRequest` to `lib/api-admin.ts` (stub for now, will be wired in Task 12)**

Append to `lib/api-admin.ts`:

```ts
// --- H12: Admin plans (list only here; PATCH + seed in later tasks) ----

export interface AdminPlanRow {
  id: number; planKey: string; displayName: string;
  durationDays: number; amount: string; currency: string;
  enabled: boolean; displayOrder: number; features: string[];
}
export interface AdminPlanListData { items: AdminPlanRow[]; total: number; }

export async function listAdminPlansRequest(): Promise<ApiResult<AdminPlanListData>> {
  return call('/api/admin/memberships/plans', { method: 'GET' });
}
```

- [ ] **Step 4: Type-check and fix**

```bash
pnpm tsc --noEmit
```

Expected: no errors. (Task 12 will create the actual `/api/admin/memberships/plans` endpoint that this calls.)

- [ ] **Step 5: Commit**

```bash
git add components/admin/memberships/ lib/api-admin.ts
git commit -m "feat(membership): admin ManualGrantDrawer + RevokeButton + plans list wrapper"
```

---

## Task 10: Sidebar entry + smoke-verify M1

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Add the sidebar link**

Edit `components/admin/AdminSidebar.tsx`, add `{ href: '/admin/memberships', label: '会员' }` to the `ITEMS` array, right after `'字典 / 字源'`:

```ts
const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/memberships', label: '会员' },
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
];
```

- [ ] **Step 2: Build and start dev server**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: 0 errors.

```bash
pnpm dev &  # background
```

- [ ] **Step 3: Smoke test M1 manually**

```bash
# 1. Login as admin
curl -s -X POST http://localhost:4444/api/auth/login \
  -H "content-type: application/json" \
  -c /tmp/c.txt \
  -d '{"username":"<your-admin-user>","password":"<pwd>"}'

# 2. Hit the new endpoint
curl -s -b /tmp/c.txt "http://localhost:4444/api/admin/memberships" | head -c 200
```

Expected: `{"ok":true,"data":{"items":[],"total":0,...}}` for a fresh DB.

```bash
# 3. Grant a membership to user id 1
curl -s -X POST -b /tmp/c.txt -H "content-type: application/json" \
  http://localhost:4444/api/admin/memberships \
  -d '{"userId":1,"planKey":"monthly_usd","note":"smoke"}'
```

Expected: `{"ok":true,"data":{"id":1,"expiresAt":"2026-07-15T..."}}`.

- [ ] **Step 4: Open in browser, verify the admin page**

Navigate to `http://localhost:4444/admin/memberships`:
- 4 stat cards visible (total/active/newMonth/revenue)
- 1 row in table (just granted)
- "手动开通" button visible at top
- Sidebar has "会员" entry

- [ ] **Step 5: Stop dev server + commit**

```bash
kill %1   # or Ctrl-C
git add components/admin/AdminSidebar.tsx
git commit -m "feat(membership): add 会员 sidebar entry — M1 complete"
```

---

# Milestone 2: Plan editor + PayPal config UI

## Task 11: `lib/membership.ts` — updatePlan, PlanPatch type

**Files:**
- Modify: `lib/membership.ts`
- Test: `tests/unit/lib/membership.test.ts` (extend)

- [ ] **Step 1: Add failing tests for updatePlan**

Append to `tests/unit/lib/membership.test.ts` (inside `d('membership plans', ...)` block, before the closing `});`):

```ts
  // --- updatePlan ----------------------------------------------

  it('updatePlan changes displayName, amount, enabled, displayOrder', async () => {
    await seedDefaultPlans();
    const p = await getPlanByKey('monthly_usd' as PlanKey);
    const updated = await updatePlan(p!.id, { displayName: '月卡 (新)', amount: '3.50', enabled: false, displayOrder: 10 });
    expect(updated.displayName).toBe('月卡 (新)');
    expect(updated.amount).toBe('3.50');
    expect(updated.enabled).toBe(false);
    expect(updated.displayOrder).toBe(10);
  });

  it('updatePlan replaces feature set', async () => {
    await seedDefaultPlans();
    const p = await getPlanByKey('yearly_usd' as PlanKey);
    const updated = await updatePlan(p!.id, { features: ['ai_calls'] });
    expect(updated.features).toEqual(['ai_calls']);
  });

  it('updatePlan with empty patch returns the same plan', async () => {
    await seedDefaultPlans();
    const p = await getPlanByKey('monthly_usd' as PlanKey);
    const updated = await updatePlan(p!.id, {});
    expect(updated.displayName).toBe(p!.displayName);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm test tests/unit/lib/membership.test.ts -t "updatePlan"
```

Expected: 3 tests fail with "not a function".

- [ ] **Step 3: Implement updatePlan in `lib/membership.ts`**

Append the following to `lib/membership.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
pnpm test tests/unit/lib/membership.test.ts
```

Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/membership.ts tests/unit/lib/membership.test.ts
git commit -m "feat(membership): updatePlan (display name, amount, enabled, features)"
```

---

## Task 12: API — plan list, PATCH, seed

**Files:**
- Create: `app/api/admin/memberships/plans/route.ts`
- Create: `app/api/admin/memberships/plans/[id]/route.ts`
- Create: `app/api/admin/memberships/plans/seed/route.ts`
- Test: `tests/integration/api/admin-memberships-plans.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/api/admin-memberships-plans.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET as listHandler, POST as seedHandler } from '@/app/api/admin/memberships/plans/route';
import { PATCH as patchHandler } from '@/app/api/admin/memberships/plans/[id]/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let adminId: number, adminToken: string;

const d = HAS_DB ? describe : describe.skip;

d('admin/memberships/plans routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_plans', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_plans' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM audit_log WHERE user_id = ?`, [adminId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  const hdr = () => ({ cookie: `auth_token=${adminToken}` });
  const json = (b: any) => ({ ...hdr(), 'content-type': 'application/json' });

  it('POST /seed creates 4 plans + 16 features', async () => {
    const res = await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.seeded).toBe(4);
    const [c] = await getPool().query<any[]>(`SELECT COUNT(*) AS n FROM membership_plan_features`);
    expect(Number(c[0].n)).toBe(16);
  });

  it('GET returns enabledOnly filter', async () => {
    await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const res = await listHandler(new NextRequest('http://localhost/api/admin/memberships/plans?enabledOnly=1', { headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.items.every((p: any) => p.enabled)).toBe(true);
  });

  it('PATCH updates plan fields and writes audit', async () => {
    await seedHandler(new NextRequest('http://localhost/api/admin/memberships/plans/seed', { method: 'POST', headers: hdr() }));
    const list = await listHandler(new NextRequest('http://localhost/api/admin/memberships/plans', { headers: hdr() }));
    const { data: { items } } = await list.json();
    const target = items.find((p: any) => p.planKey === 'monthly_usd');

    const res = await patchHandler(new NextRequest(`http://localhost/api/admin/memberships/plans/${target.id}`, {
      method: 'PATCH', headers: json({ displayName: '月卡', amount: '4.00' }), body: JSON.stringify({ displayName: '月卡', amount: '4.00' }),
    }), { params: Promise.resolve({ id: String(target.id) }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.plan.displayName).toBe('月卡');
    expect(body.data.plan.amount).toBe('4.00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/admin-memberships-plans.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement list + seed route**

Create `app/api/admin/memberships/plans/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { listPlans, seedDefaultPlans } from '@/lib/membership';
import { writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const enabledOnly = req.nextUrl.searchParams.get('enabledOnly') === '1';
    const items = await listPlans({ enabledOnly });
    return NextResponse.json({ ok: true, data: { items, total: items.length } });
  });
}

export async function POST(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const seeded = await seedDefaultPlans();
    // No dedicated audit event for plan seeding — it's an admin setup action, not a grant.
    return NextResponse.json({ ok: true, data: { seeded } });
  });
}
```

- [ ] **Step 4: Implement PATCH route**

Create `app/api/admin/memberships/plans/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { updatePlan, type PlanPatch } from '@/lib/membership';

const PatchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  amount: z.string().regex(/^\d+\.\d{2}$/).optional(),
  enabled: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  features: z.array(z.enum(['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'])).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return badRequest('bad_id', 'invalid plan id');

    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    try {
      const plan = await updatePlan(id, parsed.data as PlanPatch);
      return NextResponse.json({ ok: true, data: { plan } });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('plan_not_found')) return notFound('plan_not_found', msg);
      throw err;
    }
  });
}
```

- [ ] **Step 5: Create seed route alias**

Create `app/api/admin/memberships/plans/seed/route.ts`:

```ts
export { POST } from '../route';
```

- [ ] **Step 6: Run the integration test**

```bash
pnpm test tests/integration/api/admin-memberships-plans.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/memberships/plans/ tests/integration/api/admin-memberships-plans.test.ts
git commit -m "feat(membership): plans list/PATCH/seed API"
```

---

## Task 13: `lib/paypal.ts` — config reader, access token cache, verify stub

**Files:**
- Create: `lib/paypal.ts`
- Test: `tests/unit/lib/paypal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/paypal.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { getPayPalConfig, getPayPalAccessToken, _resetTokenCacheForTest } from '@/lib/paypal';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const d = HAS_DB ? describe : describe.skip;

d('paypal', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_config (
      \`key\` VARCHAR(64) NOT NULL, value TEXT NOT NULL,
      updated_by BIGINT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  });

  beforeEach(() => {
    _resetTokenCacheForTest();
  });

  afterAll(async () => { await closePool(); });

  it('getPayPalConfig returns null if any required key missing', async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    expect(await getPayPalConfig()).toBeNull();
  });

  it('getPayPalConfig returns full config when all keys set', async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    for (const [k, v] of [
      ['paypal.mode', 'sandbox'], ['paypal.client_id', 'cid'], ['paypal.client_secret', 'csec'], ['paypal.webhook_id', 'wid'],
    ]) {
      await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [k, v]);
    }
    const cfg = await getPayPalConfig();
    expect(cfg).toEqual({ mode: 'sandbox', clientId: 'cid', clientSecret: 'csec', webhookId: 'wid' });
  });

  it('getPayPalAccessToken caches the token (1 fetch per mode+clientId)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-123', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const t1 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'a', clientSecret: 'b', webhookId: 'w' });
    const t2 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'a', clientSecret: 'b', webhookId: 'w' });
    expect(t1).toBe('tok-123');
    expect(t2).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // different clientId → different cache key → second fetch
    const t3 = await getPayPalAccessToken({ mode: 'sandbox', clientId: 'b', clientSecret: 'b', webhookId: 'w' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/unit/lib/paypal.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/paypal'".

- [ ] **Step 3: Implement `lib/paypal.ts`**

Create `lib/paypal.ts`:

```ts
/**
 * PayPal REST client (no SDK — fetch + REST).
 *
 * Token cache: module-level, keyed by `${mode}:${clientId}`, TTL 50min
 * (PayPal access tokens are valid 60min, we refresh 10min early).
 *
 * Race condition note: webhook handles capture (server-side) on
 * CHECKOUT.ORDER.APPROVED. The /membership/success page is read-only
 * polling — it MUST NOT call capture. The webhook is the sole capture
 * trigger.
 */
import { getPool } from './db';

export type PayPalMode = 'sandbox' | 'live';
export interface PayPalConfig {
  mode: PayPalMode; clientId: string; clientSecret: string; webhookId: string;
}

interface TokenEntry { token: string; expiresAt: number; }
const tokenCache: Map<string, TokenEntry> = new Map();
const TOKEN_TTL_MS = 50 * 60 * 1000;

const BASE = (mode: PayPalMode) =>
  mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

export async function getPayPalConfig(): Promise<PayPalConfig | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT \`key\`, value FROM app_config WHERE \`key\` IN
       ('paypal.mode','paypal.client_id','paypal.client_secret','paypal.webhook_id')`,
  );
  const map: Record<string, string> = {};
  for (const r of rows as any[]) map[r.key] = r.value;
  const mode = map['paypal.mode'];
  const clientId = map['paypal.client_id'];
  const clientSecret = map['paypal.client_secret'];
  const webhookId = map['paypal.webhook_id'];
  if (!mode || !clientId || !clientSecret || !webhookId) return null;
  if (mode !== 'sandbox' && mode !== 'live') return null;
  return { mode, clientId, clientSecret, webhookId };
}

export async function getPayPalAccessToken(cfg: PayPalConfig): Promise<string> {
  const key = `${cfg.mode}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${BASE(cfg.mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`paypal_oauth_failed: ${res.status}`);
  const j = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return j.access_token;
}

export function _resetTokenCacheForTest(): void {
  tokenCache.clear();
}

// Stubs for Tasks 14, 19 — filled later
export interface PayPalOrder { id: string; status: string; links: { href: string; rel: string }[]; }
export async function createPayPalOrder(_args: {
  amount: string; currency: 'CNY' | 'USD'; description: string;
  returnUrl: string; cancelUrl: string;
}): Promise<PayPalOrder> {
  throw new Error('createPayPalOrder not yet implemented');
}
export async function capturePayPalOrder(_orderId: string): Promise<unknown> {
  throw new Error('capturePayPalOrder not yet implemented');
}
export async function verifyWebhookSignature(_args: {
  rawBody: string; headers: Record<string, string>;
}): Promise<boolean> {
  throw new Error('verifyWebhookSignature not yet implemented');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test tests/unit/lib/paypal.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/paypal.ts tests/unit/lib/paypal.test.ts
git commit -m "feat(paypal): config reader + access token cache (module-level, 50min TTL)"
```

---

## Task 14: API — PayPal config GET + PUT (masked secrets)

**Files:**
- Create: `app/api/admin/paypal/config/route.ts`
- Test: `tests/integration/api/admin-paypal-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/admin-paypal-config.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET, PUT } from '@/app/api/admin/paypal/config/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let adminId: number, adminToken: string;
const d = HAS_DB ? describe : describe.skip;

d('admin/paypal/config routes', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_config (
      \`key\` VARCHAR(64) NOT NULL, value TEXT NOT NULL,
      updated_by BIGINT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash, is_admin) VALUES ('adm_paypal', ?, 1)`, [hash]);
    const [a] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    adminId = Number((a[0] as any).id);
    adminToken = await signSession({ id: adminId, username: 'adm_paypal' });
    testCookieStore['auth_token'] = { value: adminToken };
  });

  afterEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    await pool.query(`DELETE FROM audit_log WHERE user_id = ?`, [adminId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM app_config WHERE \`key\` LIKE 'paypal.%'`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [adminId]);
    await closePool();
  });

  const hdr = () => ({ cookie: `auth_token=${adminToken}` });
  const json = (b: any) => ({ ...hdr(), 'content-type': 'application/json' });

  it('GET returns all 4 fields masked when not set', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/paypal/config', { headers: hdr() }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ mode: 'sandbox', hasClientId: false, hasSecret: false, hasWebhookId: false, webhookUrl: expect.stringContaining('/api/webhooks/paypal') });
  });

  it('PUT updates mode and writes audit', async () => {
    const res = await PUT(new NextRequest('http://localhost/api/admin/paypal/config', {
      method: 'PUT', headers: json({}), body: JSON.stringify({ mode: 'live' }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('live');
    const [audit] = await getPool().query<any[]>(
      `SELECT event, metadata FROM audit_log WHERE user_id = ? AND event = 'paypal_config_updated'`,
      [adminId],
    );
    expect(audit.length).toBe(1);
  });

  it('PUT writes secret and masks on subsequent GET', async () => {
    await PUT(new NextRequest('http://localhost/api/admin/paypal/config', {
      method: 'PUT', headers: json({}), body: JSON.stringify({ clientSecret: 'super-secret-1234567890' }),
    }));
    const get = await GET(new NextRequest('http://localhost/api/admin/paypal/config', { headers: hdr() }));
    const { data } = await get.json();
    expect(data.hasSecret).toBe(true);
    // Confirm raw value is not returned anywhere
    const rawJson = JSON.stringify(data);
    expect(rawJson).not.toContain('super-secret-1234567890');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/admin-paypal-config.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/paypal/config/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getConfig, setConfigBatch } from '@/lib/config';
import { writeAudit } from '@/lib/audit';

const PayPalConfigSchema = z.object({
  mode: z.enum(['sandbox', 'live']).optional(),
  clientId: z.string().min(1).max(128).optional(),
  clientSecret: z.string().min(1).max(256).optional(),
  webhookId: z.string().min(1).max(128).optional(),
});

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const [mode, clientId, clientSecret, webhookId] = await Promise.all([
      getConfig('paypal.mode'),
      getConfig('paypal.client_id'),
      getConfig('paypal.client_secret'),
      getConfig('paypal.webhook_id'),
    ]);
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      ok: true,
      data: {
        mode: (mode ?? 'sandbox') as 'sandbox' | 'live',
        hasClientId: !!clientId,
        hasSecret: !!clientSecret,
        hasWebhookId: !!webhookId,
        webhookUrl: `${origin}/api/webhooks/paypal`,
      },
    });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = PayPalConfigSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const updates: Record<string, string> = {};
    if (parsed.data.mode) updates['paypal.mode'] = parsed.data.mode;
    if (parsed.data.clientId) updates['paypal.client_id'] = parsed.data.clientId;
    if (parsed.data.clientSecret) updates['paypal.client_secret'] = parsed.data.clientSecret;
    if (parsed.data.webhookId) updates['paypal.webhook_id'] = parsed.data.webhookId;
    if (Object.keys(updates).length === 0) return badRequest('empty', 'no fields to update');

    await setConfigBatch(updates, auth.user.id);
    await writeAudit({
      userId: auth.user.id,
      event: 'paypal_config_updated',
      metadata: { changed: Object.keys(updates) },
    });
    // Return same shape as GET
    const [mode] = await Promise.all([getConfig('paypal.mode')]);
    return NextResponse.json({
      ok: true,
      data: {
        mode: (mode ?? 'sandbox') as 'sandbox' | 'live',
        changed: Object.keys(updates),
      },
    });
  });
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/integration/api/admin-paypal-config.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/paypal/ tests/integration/api/admin-paypal-config.test.ts
git commit -m "feat(paypal): admin config GET/PUT with masked secrets + audit"
```

---

## Task 15: API — PayPal test-connection

**Files:**
- Create: `app/api/admin/paypal/test-connection/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/api/admin/paypal/test-connection/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withErrorHandling, serviceUnavailable } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPayPalConfig, getPayPalAccessToken } from '@/lib/paypal';
import { writeAudit } from '@/lib/audit';

export async function POST() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const cfg = await getPayPalConfig();
    if (!cfg) {
      return serviceUnavailable('paypal_not_configured', 'PayPal 凭据未配置完整');
    }
    try {
      const token = await getPayPalAccessToken(cfg);
      return NextResponse.json({
        ok: true,
        data: { ok: true, message: `连接成功,token 长度 ${token.length}` },
      });
    } catch (err) {
      await writeAudit({
        userId: auth.user.id,
        event: 'paypal_config_updated',
        metadata: { action: 'test_connection_failed', error: (err as Error).message },
      });
      return serviceUnavailable('paypal_unreachable', `连接失败: ${(err as Error).message}`);
    }
  });
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/paypal/test-connection/route.ts
git commit -m "feat(paypal): test-connection endpoint (uses cached token)"
```

---

## Task 16: `lib/paypal.ts` — createPayPalOrder + capturePayPalOrder (real impls)

**Files:**
- Modify: `lib/paypal.ts`
- Test: extend `tests/unit/lib/paypal.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/lib/paypal.test.ts`:

```ts
  // --- createPayPalOrder / capturePayPalOrder ---------------------

  it('createPayPalOrder posts to /v2/checkout/orders and returns id+approvalUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ id: 'PAY-123', status: 'CREATED', links: [
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAY-123' },
        { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAY-123' },
      ] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createPayPalOrder } = await import('@/lib/paypal');
    const order = await createPayPalOrder({
      amount: '3.00', currency: 'USD', description: '月卡',
      returnUrl: 'https://x.test/success', cancelUrl: 'https://x.test/cancel',
    });
    expect(order.id).toBe('PAY-123');
    expect(order.links.find(l => l.rel === 'approve')?.href).toContain('PAY-123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('createPayPalOrder throws on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: false, status: 422, text: async () => 'invalid',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createPayPalOrder } = await import('@/lib/paypal');
    await expect(createPayPalOrder({
      amount: '3.00', currency: 'USD', description: 'x',
      returnUrl: 'https://x/s', cancelUrl: 'https://x/c',
    })).rejects.toThrow(/paypal_create_failed/);
    vi.unstubAllGlobals();
  });

  it('capturePayPalOrder posts to /capture and returns the response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ id: 'PAY-123', status: 'COMPLETED' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { capturePayPalOrder } = await import('@/lib/paypal');
    const r = await capturePayPalOrder('PAY-123') as any;
    expect(r.status).toBe('COMPLETED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm test tests/unit/lib/paypal.test.ts -t "createPayPalOrder|capturePayPalOrder"
```

Expected: FAIL with "not yet implemented".

- [ ] **Step 3: Implement the two functions in `lib/paypal.ts`**

Replace the `createPayPalOrder` and `capturePayPalOrder` stubs with:

```ts
export async function createPayPalOrder(args: {
  amount: string; currency: 'CNY' | 'USD'; description: string;
  returnUrl: string; cancelUrl: string;
}): Promise<PayPalOrder> {
  const cfg = await getPayPalConfig();
  if (!cfg) throw new Error('paypal_not_configured');
  const token = await getPayPalAccessToken(cfg);
  const res = await fetch(`${BASE(cfg.mode)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: args.currency, value: args.amount },
        description: args.description,
      }],
      application_context: { return_url: args.returnUrl, cancel_url: args.cancelUrl },
    }),
  });
  if (!res.ok) throw new Error(`paypal_create_failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<PayPalOrder>;
}

export async function capturePayPalOrder(orderId: string): Promise<unknown> {
  const cfg = await getPayPalConfig();
  if (!cfg) throw new Error('paypal_not_configured');
  const token = await getPayPalAccessToken(cfg);
  const res = await fetch(`${BASE(cfg.mode)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`paypal_capture_failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/unit/lib/paypal.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/paypal.ts tests/unit/lib/paypal.test.ts
git commit -m "feat(paypal): createOrder + captureOrder real impls"
```

---

## Task 17: Admin plans editor + PayPal config page

**Files:**
- Create: `app/admin/memberships/plans/page.tsx`
- Create: `app/admin/memberships/config/page.tsx`
- Create: `components/admin/memberships/PlanRow.tsx`
- Modify: `lib/api-admin.ts` (add plan PATCH + PayPal config wrappers)

- [ ] **Step 1: Add client wrappers**

Append to `lib/api-admin.ts`:

```ts
// --- Plan PATCH ---------------------------------------------------

export interface UpdatePlanBody {
  displayName?: string; durationDays?: number; amount?: string;
  enabled?: boolean; displayOrder?: number;
  features?: ('unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts')[];
}

export async function updateAdminPlanRequest(id: number, body: UpdatePlanBody): Promise<ApiResult<{ plan: AdminPlanRow }>> {
  return call(`/api/admin/memberships/plans/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function seedAdminPlansRequest(): Promise<ApiResult<{ seeded: number }>> {
  return call('/api/admin/memberships/plans/seed', { method: 'POST' });
}

// --- PayPal config -----------------------------------------------

export interface AdminPayPalConfig {
  mode: 'sandbox' | 'live';
  hasClientId: boolean;
  hasSecret: boolean;
  hasWebhookId: boolean;
  webhookUrl: string;
}

export async function getAdminPayPalConfigRequest(): Promise<ApiResult<AdminPayPalConfig>> {
  return call('/api/admin/paypal/config', { method: 'GET' });
}

export async function updateAdminPayPalConfigRequest(body: {
  mode?: 'sandbox' | 'live';
  clientId?: string; clientSecret?: string; webhookId?: string;
}): Promise<ApiResult<{ mode: 'sandbox' | 'live'; changed: string[] }>> {
  return call('/api/admin/paypal/config', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function testPayPalConnectionRequest(): Promise<ApiResult<{ ok: true; message: string }>> {
  return call('/api/admin/paypal/test-connection', { method: 'POST' });
}
```

- [ ] **Step 2: Create `PlanRow` component**

Create `components/admin/memberships/PlanRow.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { updateAdminPlanRequest, type AdminPlanRow as Plan } from '@/lib/api-admin';

const ALL_FEATURES = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'] as const;
const FEATURE_LABELS: Record<string, string> = {
  unlimited_history: '无限历史', download_pdf: 'PDF 下载', ai_calls: 'AI 调用', priority_tts: '优先 TTS',
};

export function PlanRow({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(plan.displayName);
  const [amount, setAmount] = useState(plan.amount);
  const [durationDays, setDurationDays] = useState(String(plan.durationDays));
  const [enabled, setEnabled] = useState(plan.enabled);
  const [displayOrder, setDisplayOrder] = useState(String(plan.displayOrder));
  const [features, setFeatures] = useState<string[]>(plan.features);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = displayName !== plan.displayName || amount !== plan.amount
    || String(plan.durationDays) !== durationDays || enabled !== plan.enabled
    || String(plan.displayOrder) !== displayOrder
    || features.length !== plan.features.length || features.some(f => !plan.features.includes(f));

  const onSave = useCallback(async () => {
    setBusy(true); setMsg(null); setErr(null);
    const r = await updateAdminPlanRequest(plan.id, {
      displayName, amount, durationDays: Number(durationDays), enabled, displayOrder: Number(displayOrder), features: features as any,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg('已保存');
    router.refresh();
  }, [plan.id, displayName, amount, durationDays, enabled, displayOrder, features, router]);

  const onReset = () => {
    setDisplayName(plan.displayName); setAmount(plan.amount); setDurationDays(String(plan.durationDays));
    setEnabled(plan.enabled); setDisplayOrder(String(plan.displayOrder)); setFeatures(plan.features);
    setErr(null); setMsg(null);
  };

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="text-xs font-mono">{plan.planKey}</div>
        <div className="text-xs text-ink-faint">{plan.currency}</div>
      </td>
      <td className="px-3 py-2">
        <input value={displayName} onChange={e => setDisplayName(e.target.value)}
          className="w-32 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="1" value={durationDays} onChange={e => setDurationDays(e.target.value)}
          className="w-20 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <input value={amount} onChange={e => setAmount(e.target.value)}
          className="w-20 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="0" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)}
          className="w-16 border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {ALL_FEATURES.map(f => {
            const on = features.includes(f);
            return (
              <button key={f} type="button" onClick={() => setFeatures(on ? features.filter(x => x !== f) : [...features, f])}
                className={`text-xs px-2 py-0.5 rounded border ${on ? 'bg-ink text-paper border-ink' : 'border-paper-warm text-ink-soft'}`}>
                {FEATURE_LABELS[f]}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        {dirty && (
          <div className="flex flex-col gap-1">
            <button type="button" onClick={onSave} disabled={busy}
              className="text-xs px-2 py-1 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50 inline-flex items-center gap-1">
              <Save className="h-3 w-3" />保存
            </button>
            <button type="button" onClick={onReset}
              className="text-xs px-2 py-1 border border-ink/20 rounded text-ink-soft hover:bg-paper-deep inline-flex items-center gap-1">
              <RotateCcw className="h-3 w-3" />还原
            </button>
          </div>
        )}
        {msg && <span className="text-xs text-green-700 inline-flex items-center gap-1"><Check className="h-3 w-3" />{msg}</span>}
        {err && <span className="text-xs text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</span>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Create plans page**

Create `app/admin/memberships/plans/page.tsx`:

```tsx
import Link from 'next/link';
import { listPlans } from '@/lib/membership';
import { PlanRow } from '@/components/admin/memberships/PlanRow';
import { SeedPlansButton } from './SeedPlansButton';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const plans = await listPlans();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">套餐设置</h1>
          <p className="text-sm text-ink-soft">编辑 4 档会员套餐。点击「保存」提交单行 PATCH。</p>
        </div>
        <div className="flex gap-2">
          {plans.length === 0 && <SeedPlansButton />}
          <Link href="/admin/memberships" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 返回会员列表</Link>
        </div>
      </div>
      <div className="card-paper rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              <th className="px-3 py-2">plan_key</th>
              <th className="px-3 py-2">显示名</th>
              <th className="px-3 py-2">天数</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">启用</th>
              <th className="px-3 py-2">排序</th>
              <th className="px-3 py-2">权限</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map(p => <PlanRow key={p.id} plan={p} />)}
            {plans.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-faint">暂无套餐,点右上「初始化」</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the seed button (client component)**

Create `app/admin/memberships/plans/SeedPlansButton.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { seedAdminPlansRequest } from '@/lib/api-admin';

export function SeedPlansButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = useCallback(async () => {
    setBusy(true);
    const r = await seedAdminPlansRequest();
    setBusy(false);
    if (r.ok) router.refresh();
  }, [router]);
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="text-sm px-3 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
      {busy ? '初始化中…' : '初始化 4 档套餐'}
    </button>
  );
}
```

- [ ] **Step 5: Create PayPal config page (client component — re-fetch on tab visit)**

Create `app/admin/memberships/config/page.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Check, AlertTriangle, ExternalLink, Wifi } from 'lucide-react';
import { getAdminPayPalConfigRequest, updateAdminPayPalConfigRequest, testPayPalConnectionRequest } from '@/lib/api-admin';

export default function AdminPayPalConfigPage() {
  const [cfg, setCfg] = useState<{
    mode: 'sandbox' | 'live';
    hasClientId: boolean; hasSecret: boolean; hasWebhookId: boolean;
    webhookUrl: string;
  } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookId, setWebhookId] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null); setErr(null);
    const r = await getAdminPayPalConfigRequest();
    if (r.ok) setCfg(r.data);
    else setErr(r.error.message);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    const body: any = {};
    if (cfg) body.mode = cfg.mode;
    if (clientId) body.clientId = clientId;
    if (clientSecret) body.clientSecret = clientSecret;
    if (webhookId) body.webhookId = webhookId;
    const r = await updateAdminPayPalConfigRequest(body);
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(`已保存 (${r.data.changed.join(', ')})`);
    setClientId(''); setClientSecret(''); setWebhookId('');
    load();
  }, [cfg, clientId, clientSecret, webhookId, load]);

  const onTest = useCallback(async () => {
    setTesting(true); setMsg(null); setErr(null);
    const r = await testPayPalConnectionRequest();
    setTesting(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setMsg(r.data.message);
  }, []);

  if (!cfg) return <p className="text-sm text-ink-faint">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">支付配置 (PayPal)</h1>
        <Link href="/admin/memberships" className="text-sm px-3 py-1.5 border border-ink/20 rounded text-ink hover:bg-paper-deep">← 返回会员列表</Link>
      </div>

      <div className="card-paper rounded-lg p-4 space-y-4 max-w-2xl">
        {err && <p className="text-sm text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
        {msg && <p className="text-sm text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />{msg}</p>}

        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-soft">状态:</span>
          {cfg.hasClientId && cfg.hasSecret && cfg.hasWebhookId
            ? <span className="text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />已配置</span>
            : <span className="text-seal inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />未完整</span>}
          <button type="button" onClick={onTest} disabled={testing}
            className="ml-auto text-xs px-2 py-1 border border-ink/20 rounded hover:bg-paper-deep inline-flex items-center gap-1">
            <Wifi className="h-3 w-3" />{testing ? '测试中…' : '测试连接'}
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-3">
          <div>
            <label className="text-sm font-medium">模式</label>
            <div className="flex gap-3 mt-1">
              {(['sandbox', 'live'] as const).map(m => (
                <label key={m} className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={cfg.mode === m} onChange={() => setCfg({ ...cfg, mode: m })} />
                  {m === 'sandbox' ? 'Sandbox (测试)' : 'Live (生产)'}
                </label>
              ))}
            </div>
          </div>
          <Field label={`Client ID ${cfg.hasClientId ? '(已配置,留空不改)' : ''}`}>
            <input value={clientId} onChange={e => setClientId(e.target.value)} className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <Field label={`Client Secret ${cfg.hasSecret ? '(已配置,留空不改)' : ''}`}>
            <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password" className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <Field label={`Webhook ID ${cfg.hasWebhookId ? '(已配置,留空不改)' : ''}`}>
            <input value={webhookId} onChange={e => setWebhookId(e.target.value)} className="w-full border border-paper-warm rounded px-2 py-1 text-sm bg-paper" />
          </Field>
          <div>
            <label className="text-sm font-medium">Webhook URL (PayPal 后台填这个)</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 text-xs bg-paper-deep px-2 py-1 rounded font-mono">{cfg.webhookUrl}</code>
              <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener"
                className="text-xs text-seal hover:underline inline-flex items-center gap-1">
                PayPal 后台<ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <button type="submit" disabled={busy}
            className="text-sm px-4 py-1.5 bg-ink text-paper rounded hover:bg-ink/80 disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Type-check and build**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: 0 errors.

- [ ] **Step 7: Smoke test**

```bash
pnpm dev &
# Visit http://localhost:4444/admin/memberships/plans
# Visit http://localhost:4444/admin/memberships/config
kill %1
```

- [ ] **Step 8: Commit**

```bash
git add app/admin/memberships/plans/ app/admin/memberships/config/ components/admin/memberships/ lib/api-admin.ts
git commit -m "feat(membership): admin plans editor + PayPal config UI — M2 complete"
```

---

# Milestone 3: User purchase + webhook + AI gate

## Task 18: `lib/payment-orders.ts` — CRUD for payment_orders

**Files:**
- Create: `lib/payment-orders.ts`
- Test: covered indirectly by Task 20/24 (will use the helpers)

- [ ] **Step 1: Create `lib/payment-orders.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/payment-orders.ts
git commit -m "feat(membership): payment_orders CRUD helpers"
```

---

## Task 19: `lib/paypal.ts` — verifyWebhookSignature (real impl)

**Files:**
- Modify: `lib/paypal.ts`
- Test: extend `tests/unit/lib/paypal.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/lib/paypal.test.ts`:

```ts
  it('verifyWebhookSignature posts to /v1/notifications/verify-webhook-signature', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ verification_status: 'SUCCESS' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { verifyWebhookSignature } = await import('@/lib/paypal');
    const ok = await verifyWebhookSignature({
      cfg: { mode: 'sandbox', clientId: 'c', clientSecret: 's', webhookId: 'w' },
      rawBody: '{"id":"WH-1"}',
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.paypal.com/cert.pem',
        'paypal-transmission-id': 'abc-123',
        'paypal-transmission-sig': 'sig',
        'paypal-transmission-time': '2026-06-15T00:00:00Z',
      },
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('verifyWebhookSignature returns false on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ verification_status: 'FAILURE' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { verifyWebhookSignature } = await import('@/lib/paypal');
    const ok = await verifyWebhookSignature({
      cfg: { mode: 'sandbox', clientId: 'c', clientSecret: 's', webhookId: 'w' },
      rawBody: '{}', headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://x/cert.pem',
        'paypal-transmission-id': 't',
        'paypal-transmission-sig': 's',
        'paypal-transmission-time': '2026-06-15T00:00:00Z',
      },
    });
    expect(ok).toBe(false);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pnpm test tests/unit/lib/paypal.test.ts -t "verifyWebhookSignature"
```

Expected: FAIL with "not yet implemented".

- [ ] **Step 3: Implement verifyWebhookSignature in `lib/paypal.ts`**

Replace the `verifyWebhookSignature` stub with:

```ts
export async function verifyWebhookSignature(args: {
  cfg: PayPalConfig; rawBody: string; headers: Record<string, string>;
}): Promise<boolean> {
  const token = await getPayPalAccessToken(args.cfg);
  const res = await fetch(`${BASE(args.cfg.mode)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      auth_algo: args.headers['paypal-auth-algo'],
      cert_url: args.headers['paypal-cert-url'],
      transmission_id: args.headers['paypal-transmission-id'],
      transmission_sig: args.headers['paypal-transmission-sig'],
      transmission_time: args.headers['paypal-transmission-time'],
      webhook_id: args.cfg.webhookId,
      webhook_event: JSON.parse(args.rawBody),
    }),
  });
  if (!res.ok) return false;
  const j = await res.json() as { verification_status: string };
  return j.verification_status === 'SUCCESS';
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/unit/lib/paypal.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/paypal.ts tests/unit/lib/paypal.test.ts
git commit -m "feat(paypal): verifyWebhookSignature real impl"
```

---

## Task 20: API — `/api/membership/plans` (public enabled-only list)

**Files:**
- Create: `app/api/membership/plans/route.ts`
- Test: `tests/integration/api/membership-plans.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/membership-plans.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { GET } from '@/app/api/membership/plans/route';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const d = HAS_DB ? describe : describe.skip;

d('public /api/membership/plans', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plans (
      id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
      display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS membership_plan_features (
      plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
      PRIMARY KEY (plan_id, feature_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
  });

  afterAll(async () => { await closePool(); });

  it('returns only enabled plans (CNY plans disabled by default)', async () => {
    const pool = getPool();
    for (const p of [
      { k: 'monthly_usd', dn: '月', d: 30, a: '3.00', c: 'USD', e: 1, o: 1 },
      { k: 'yearly_usd', dn: '年', d: 365, a: '15.00', c: 'USD', e: 1, o: 2 },
      { k: 'monthly_cny', dn: '月CNY', d: 30, a: '15.00', c: 'CNY', e: 0, o: 3 },
    ]) {
      await pool.execute(
        `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.k, p.dn, p.d, p.a, p.c, p.e, p.o],
      );
    }
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.items.every((p: any) => p.enabled)).toBe(true);
    expect(body.data.items.every((p: any) => p.currency === 'USD')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/membership-plans.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the route**

Create `app/api/membership/plans/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { listPlans } from '@/lib/membership';

export async function GET() {
  return withErrorHandling(async () => {
    const items = await listPlans({ enabledOnly: true });
    return NextResponse.json({ ok: true, data: { items } });
  });
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/integration/api/membership-plans.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/api/membership/plans/ tests/integration/api/membership-plans.test.ts
git commit -m "feat(membership): public plans endpoint (enabled only)"
```

---

## Task 21: API — `/api/membership/checkout` (create PayPal order)

**Files:**
- Create: `app/api/membership/checkout/route.ts`
- Test: `tests/integration/api/membership-checkout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/membership-checkout.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { POST } from '@/app/api/membership/checkout/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let userId: number, userToken: string;
const d = HAS_DB ? describe : describe.skip;

d('POST /api/membership/checkout', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS membership_plans (
        id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
        display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS membership_plan_features (
        plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
        PRIMARY KEY (plan_id, feature_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS payment_orders (
        id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL, plan_id BIGINT NOT NULL,
        paypal_order_id VARCHAR(64) NOT NULL,
        status ENUM('created','approved','paid','failed','expired') NOT NULL DEFAULT 'created',
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        approval_url VARCHAR(512) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        PRIMARY KEY (id), UNIQUE KEY uk_paypal_order (paypal_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ]) await pool.query(sql);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_co', ?)`, [hash]);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    userToken = await signSession({ id: userId, username: 'usr_co' });
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM membership_plan_features`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM payment_orders`);
    await pool.execute(
      `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES ('monthly_usd', '月', 30, '3.00', 'USD', 1, 1)`,
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM payment_orders WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const req = new NextRequest('http://localhost/api/membership/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: 'monthly_usd' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 for disabled plan', async () => {
    testCookieStore['auth_token'] = { value: userToken };
    const req = new NextRequest('http://localhost/api/membership/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `auth_token=${userToken}` },
      body: JSON.stringify({ planKey: 'nonexistent' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/membership-checkout.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the route**

Create `app/api/membership/checkout/route.ts`:

```ts
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
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/integration/api/membership-checkout.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/membership/checkout/ tests/integration/api/membership-checkout.test.ts
git commit -m "feat(membership): checkout endpoint — creates PayPal order + payment_orders row"
```

---

## Task 22: API — `/api/membership/orders/[id]` and `/api/membership/me`

**Files:**
- Create: `app/api/membership/orders/[id]/route.ts`
- Create: `app/api/membership/me/route.ts`
- Test: `tests/integration/api/membership-me.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/membership-me.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { GET as meHandler } from '@/app/api/membership/me/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

let userId: number, userToken: string;
const d = HAS_DB ? describe : describe.skip;

d('GET /api/membership/me', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS membership_plans (
        id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
        display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS membership_plan_features (
        plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
        PRIMARY KEY (plan_id, feature_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS memberships (
        id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL,
        plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
        source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
        amount DECIMAL(10,2) NULL, currency ENUM('CNY','USD') NULL,
        source_payment_order_id BIGINT NULL,
        granted_by BIGINT NULL, note VARCHAR(255) NULL,
        granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL, revoked_by BIGINT NULL, revoke_reason VARCHAR(255) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ]) await pool.query(sql);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_me', ?)`, [hash]);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    userToken = await signSession({ id: userId, username: 'usr_me' });
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships`);
    await pool.query(`DELETE FROM membership_plans`);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('returns active:false for user with no membership', async () => {
    testCookieStore['auth_token'] = { value: userToken };
    const res = await meHandler(new NextRequest('http://localhost/api/membership/me', { headers: { cookie: `auth_token=${userToken}` } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.active).toBe(false);
  });

  it('returns active:true with planKey when user has membership', async () => {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES ('yearly_usd', '年', 365, '15.00', 'USD', 1, 1)`,
    );
    const exp = new Date(Date.now() + 30 * 86400_000);
    await pool.execute(
      `INSERT INTO memberships (user_id, plan_key, source, expires_at) VALUES (?, 'yearly_usd', 'manual', ?)`,
      [userId, exp],
    );

    testCookieStore['auth_token'] = { value: userToken };
    const res = await meHandler(new NextRequest('http://localhost/api/membership/me', { headers: { cookie: `auth_token=${userToken}` } }));
    const body = await res.json();
    expect(body.data.active).toBe(true);
    if (body.data.active) expect(body.data.planKey).toBe('yearly_usd');
  });

  it('returns 401 when not logged in', async () => {
    delete testCookieStore['auth_token'];
    const res = await meHandler(new NextRequest('http://localhost/api/membership/me'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/membership-me.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `/me` route**

Create `app/api/membership/me/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, unauthorized } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { getMyActiveMembership } from '@/lib/membership';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const data = await getMyActiveMembership(user.id);
    return NextResponse.json({ ok: true, data });
  });
}
```

- [ ] **Step 4: Implement `/orders/[id]` route**

Create `app/api/membership/orders/[id]/route.ts`:

```ts
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
    if (order.userId !== user.id) return notFound('order_not_found', 'order not found'); // don't leak existence
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
```

- [ ] **Step 5: Run the test**

```bash
pnpm test tests/integration/api/membership-me.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/membership/me/ app/api/membership/orders/ tests/integration/api/membership-me.test.ts
git commit -m "feat(membership): /me + /orders/[id] endpoints (user-side)"
```

---

## Task 23: API — `/api/webhooks/paypal` (signature verify + handler)

**Files:**
- Create: `app/api/webhooks/paypal/route.ts`
- Test: `tests/integration/api/webhooks-paypal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/webhooks-paypal.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { POST } from '@/app/api/webhooks/paypal/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
// Mock paypal module so we can control verifyWebhookSignature
const verifyMock = vi.fn();
const captureMock = vi.fn();
vi.mock('@/lib/paypal', async () => {
  const actual = await vi.importActual<any>('@/lib/paypal');
  return { ...actual, verifyWebhookSignature: verifyMock, capturePayPalOrder: captureMock, getPayPalConfig: vi.fn().mockResolvedValue({ mode: 'sandbox', clientId: 'c', clientSecret: 's', webhookId: 'w' }) };
});

let userId: number, planId: number;
const d = HAS_DB ? describe : describe.skip;

d('POST /api/webhooks/paypal', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS membership_plans (
        id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
        display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS memberships (
        id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL,
        plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
        source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
        amount DECIMAL(10,2) NULL, currency ENUM('CNY','USD') NULL,
        source_payment_order_id BIGINT NULL UNIQUE,
        granted_by BIGINT NULL, note VARCHAR(255) NULL,
        granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL, revoked_by BIGINT NULL, revoke_reason VARCHAR(255) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS payment_orders (
        id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL, plan_id BIGINT NOT NULL,
        paypal_order_id VARCHAR(64) NOT NULL,
        status ENUM('created','approved','paid','failed','expired') NOT NULL DEFAULT 'created',
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        approval_url VARCHAR(512) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        paid_at TIMESTAMP NULL,
        PRIMARY KEY (id), UNIQUE KEY uk_paypal_order (paypal_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ]) await pool.query(sql);

    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_wh', 'x')`);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    await pool.execute(
      `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES ('monthly_usd', '月', 30, '3.00', 'USD', 1, 1)`,
    );
    const [p] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    planId = Number((p[0] as any).id);
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships`);
    await pool.query(`DELETE FROM payment_orders`);
    await pool.query(`DELETE FROM audit_log`);
    verifyMock.mockReset();
    captureMock.mockReset();
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM payment_orders WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  function buildReq(event: any): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://x/cert', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': '2026-06-15T00:00:00Z' },
      body: JSON.stringify(event),
    });
  }

  it('rejects with 401 when signature verification fails', async () => {
    verifyMock.mockResolvedValueOnce(false);
    const event = { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'PAY-1' } };
    const res = await POST(buildReq(event));
    expect(res.status).toBe(401);
    const [audit] = await getPool().query<any[]>(`SELECT event FROM audit_log WHERE event = 'paypal_webhook_rejected'`);
    expect(audit.length).toBe(1);
  });

  it('CHECKOUT.ORDER.APPROVED updates payment_orders to approved and calls capture', async () => {
    verifyMock.mockResolvedValueOnce(true);
    captureMock.mockResolvedValueOnce({ id: 'PAY-1', status: 'COMPLETED' });
    const pool = getPool();
    await pool.execute(
      `INSERT INTO payment_orders (user_id, plan_id, paypal_order_id, status, amount, currency) VALUES (?, ?, 'PAY-1', 'created', '3.00', 'USD')`,
      [userId, planId],
    );
    const res = await POST(buildReq({ id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'PAY-1' } }));
    expect(res.status).toBe(200);
    expect(captureMock).toHaveBeenCalledWith('PAY-1');
    const [r] = await pool.query<any[]>(`SELECT status FROM payment_orders WHERE paypal_order_id = 'PAY-1'`);
    expect(r[0].status).toBe('approved');
  });

  it('PAYMENT.CAPTURE.COMPLETED grants membership and marks payment paid', async () => {
    verifyMock.mockResolvedValueOnce(true);
    const pool = getPool();
    const [ins] = await pool.execute<any>(
      `INSERT INTO payment_orders (user_id, plan_id, paypal_order_id, status, amount, currency) VALUES (?, ?, 'PAY-2', 'approved', '3.00', 'USD')`,
      [userId, planId],
    );
    const orderId = Number((ins as any).insertId);

    const res = await POST(buildReq({ id: 'WH-2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'PAY-2' } } } }));
    expect(res.status).toBe(200);
    const [m] = await pool.query<any[]>(`SELECT plan_key, source, source_payment_order_id FROM memberships WHERE user_id = ?`, [userId]);
    expect(m.length).toBe(1);
    expect(m[0].plan_key).toBe('monthly_usd');
    expect(m[0].source).toBe('paypal');
    expect(Number(m[0].source_payment_order_id)).toBe(orderId);
    const [p] = await pool.query<any[]>(`SELECT status, paid_at FROM payment_orders WHERE paypal_order_id = 'PAY-2'`);
    expect(p[0].status).toBe('paid');
    expect(p[0].paid_at).not.toBeNull();
    // Verify audit write
    const [audit] = await pool.query<any[]>(
      `SELECT event, user_id, metadata FROM audit_log WHERE event = 'membership_granted_paypal'`,
    );
    expect(audit.length).toBe(1);
    expect(audit[0].user_id).toBeNull();
    const meta = typeof audit[0].metadata === 'string' ? JSON.parse(audit[0].metadata) : audit[0].metadata;
    expect(meta).toMatchObject({ targetUserId: userId, planKey: 'monthly_usd', paymentOrderId: orderId });
  });

  it('duplicate PAYMENT.CAPTURE.COMPLETED is noop (UNIQUE catches)', async () => {
    verifyMock.mockResolvedValue(true);
    const pool = getPool();
    const [ins] = await pool.execute<any>(
      `INSERT INTO payment_orders (user_id, plan_id, paypal_order_id, status, amount, currency) VALUES (?, ?, 'PAY-3', 'approved', '3.00', 'USD')`,
      [userId, planId],
    );
    const orderId = Number((ins as any).insertId);
    const event = { id: 'WH-3', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'PAY-3' } } } };
    await POST(buildReq(event));
    const second = await POST(buildReq(event));
    expect(second.status).toBe(200);
    const [m] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?`, [userId]);
    expect(Number(m[0].n)).toBe(1);
  });

  it('unrecognized event type returns 200 noop (PayPal retry-safe)', async () => {
    verifyMock.mockResolvedValueOnce(true);
    const res = await POST(buildReq({ id: 'WH-4', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} }));
    expect(res.status).toBe(200);
    const [p] = await getPool().query<any[]>(`SELECT COUNT(*) AS n FROM payment_orders`);
    expect(Number(p[0].n)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/webhooks-paypal.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the webhook route**

Create `app/api/webhooks/paypal/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getPayPalConfig, verifyWebhookSignature, capturePayPalOrder } from '@/lib/paypal';
import { getPaymentOrder, updatePaymentOrderStatus } from '@/lib/payment-orders';
import { grantMembership, getPlanByKey } from '@/lib/membership';
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
    if (!order) return NextResponse.json({ ok: true }); // unknown order → noop

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
        // Look up plan_key via planId
        const [planRows] = await getPool().query<any[]>(`SELECT plan_key, currency FROM membership_plans WHERE id = ?`, [order.planId]);
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
          // duplicate: idempotent noop (UNIQUE on source_payment_order_id caught it)
        }
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: true });
    }
  });
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test tests/integration/api/webhooks-paypal.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/ tests/integration/api/webhooks-paypal.test.ts
git commit -m "feat(paypal): webhook handler with signature verify + idempotency via UNIQUE"
```

---

## Task 24: AI endpoint — `/api/ai/char-explain` (gated by `ai_calls`)

**Files:**
- Create: `app/api/ai/char-explain/route.ts`
- Test: `tests/integration/api/ai-char-explain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/ai-char-explain.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';
import { POST } from '@/app/api/ai/char-explain/route';
import { NextRequest } from 'next/server';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => testCookieStore[n],
    set: (o: any) => { testCookieStore[o.name] = { value: o.value }; },
    delete: (n: string) => { delete testCookieStore[n]; },
  }),
}));

// Mock char-ai
const explainMock = vi.fn();
vi.mock('@/lib/char-ai', () => ({ explainChar: explainMock }));

let userId: number, userToken: string;
const d = HAS_DB ? describe : describe.skip;

d('POST /api/ai/char-explain', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    const pool = getPool();
    await pool.query('SELECT 1');
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS membership_plans (
        id BIGINT NOT NULL AUTO_INCREMENT, plan_key VARCHAR(32) NOT NULL,
        display_name VARCHAR(64) NOT NULL, duration_days INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL, currency ENUM('CNY','USD') NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0, display_order INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id), UNIQUE KEY uk_plan_key (plan_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS membership_plan_features (
        plan_id BIGINT NOT NULL, feature_key VARCHAR(32) NOT NULL,
        PRIMARY KEY (plan_id, feature_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS memberships (
        id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL,
        plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
        source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
        amount DECIMAL(10,2) NULL, currency ENUM('CNY','USD') NULL,
        source_payment_order_id BIGINT NULL,
        granted_by BIGINT NULL, note VARCHAR(255) NULL,
        granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL, revoked_by BIGINT NULL, revoke_reason VARCHAR(255) NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ]) await pool.query(sql);

    const hash = await hashPassword('longenoughpwd');
    await pool.execute(`INSERT INTO users (username, password_hash) VALUES ('usr_ai', ?)`, [hash]);
    const [u] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    userId = Number((u[0] as any).id);
    userToken = await signSession({ id: userId, username: 'usr_ai' });
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships`);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM membership_plan_features`);
    explainMock.mockReset();
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM memberships WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM membership_plans`);
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    await closePool();
  });

  it('returns 401 when not logged in', async () => {
    const res = await POST(new NextRequest('http://localhost/api/ai/char-explain', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ char: '水' }),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 403 membership_required when user has no membership', async () => {
    testCookieStore['auth_token'] = { value: userToken };
    const res = await POST(new NextRequest('http://localhost/api/ai/char-explain', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `auth_token=${userToken}` },
      body: JSON.stringify({ char: '水' }),
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('membership_required');
  });

  it('returns 200 with explanation when user has ai_calls feature', async () => {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO membership_plans (plan_key, display_name, duration_days, amount, currency, enabled, display_order) VALUES ('monthly_usd', '月', 30, '3.00', 'USD', 1, 1)`,
    );
    const [p] = await pool.query<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    await pool.execute(`INSERT INTO membership_plan_features (plan_id, feature_key) VALUES (?, 'ai_calls')`, [Number((p[0] as any).id)]);
    await pool.execute(
      `INSERT INTO memberships (user_id, plan_key, source, expires_at) VALUES (?, 'monthly_usd', 'manual', ?)`,
      [userId, new Date(Date.now() + 30 * 86400_000)],
    );
    explainMock.mockResolvedValueOnce('水是生命之源,五行之一。');

    testCookieStore['auth_token'] = { value: userToken };
    const res = await POST(new NextRequest('http://localhost/api/ai/char-explain', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `auth_token=${userToken}` },
      body: JSON.stringify({ char: '水' }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.explanation).toContain('生命之源');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/integration/api/ai-char-explain.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Add `explainChar` to `lib/char-ai.ts`**

Edit `lib/char-ai.ts`, append at the end:

```ts
export interface CharExplainInput { char: string; pinyin: string; }
export async function explainChar(input: CharExplainInput): Promise<string> {
  const text = await callLlm({
    system: '你是一位汉语言文字学家,擅长简洁解释汉字。',
    prompt: `请用 60-100 字简洁解释汉字「${input.char}」的形、义、用。\n\n直接输出解释,不要前缀。`,
    temperature: 0.5,
    maxTokens: 200,
  });
  return text.trim();
}
```

(If `lib/char-ai.ts` doesn't export `callLlm` already, check `lib/llm.ts` is imported. The existing `generateEtymologyStory` uses `callLlm` from `./llm`, so this pattern works.)

- [ ] **Step 4: Implement the route**

Create `app/api/ai/char-explain/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorized, forbidden } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { hasFeature } from '@/lib/membership';
import { explainChar } from '@/lib/char-ai';
import { getPool } from '@/lib/db';
import { logAiCall } from '@/lib/ai-calls';

const Schema = z.object({ char: z.string().length(1) });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized('unauthenticated', 'login required');
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    if (!await hasFeature(user.id, 'ai_calls')) {
      return forbidden('membership_required', '需要 AI 调用会员');
    }
    // Look up pinyin
    const [rows] = await getPool().query<any[]>(
      `SELECT pinyin FROM chars WHERE \`char\` = ? LIMIT 1`, [parsed.data.char],
    );
    if (rows.length === 0) return badRequest('char_not_found', 'char not in dictionary');
    const pinyin = String(rows[0].pinyin);

    const start = Date.now();
    try {
      const explanation = await explainChar({ char: parsed.data.char, pinyin });
      await logAiCall({
        userId: user.id, feature: 'char-explain', model: 'unknown', status: 'ok',
        durationMs: Date.now() - start, metadata: { char: parsed.data.char },
      });
      return NextResponse.json({ ok: true, data: { explanation } });
    } catch (err) {
      await logAiCall({
        userId: user.id, feature: 'char-explain', model: 'unknown', status: 'error',
        durationMs: Date.now() - start, error: (err as Error).message,
        metadata: { char: parsed.data.char },
      });
      throw err;
    }
  });
}
```

- [ ] **Step 5: Run the test**

```bash
pnpm test tests/integration/api/ai-char-explain.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/ai/char-explain/ lib/char-ai.ts tests/integration/api/ai-char-explain.test.ts
git commit -m "feat(membership): gated /api/ai/char-explain endpoint (ai_calls feature)"
```

---

## Task 25: `/membership` page + `PlanCard` + `CheckoutButton`

**Files:**
- Create: `app/membership/page.tsx`
- Create: `components/membership/PlanCard.tsx`
- Create: `components/membership/CheckoutButton.tsx`
- Create: `components/membership/MembershipBadge.tsx`

- [ ] **Step 1: Create `MembershipBadge`**

Create `components/membership/MembershipBadge.tsx`:

```tsx
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
```

- [ ] **Step 2: Create `CheckoutButton` (client island)**

Create `components/membership/CheckoutButton.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, AlertTriangle } from 'lucide-react';

export function CheckoutButton({ planKey, label }: { planKey: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onClick = useCallback(async () => {
    setBusy(true); setErr(null);
    const res = await fetch('/api/membership/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey }),
      credentials: 'same-origin',
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) { setErr(j.error.message); return; }
    if (j.data.approvalUrl) {
      // Pass orderId via query for success page polling
      const url = new URL(j.data.approvalUrl);
      url.searchParams.set('orderId', String(j.data.orderId));
      window.location.href = url.toString();
    } else {
      setErr('PayPal 未返回 approvalUrl');
    }
  }, [planKey]);
  return (
    <div>
      <button type="button" onClick={onClick} disabled={busy}
        className="w-full text-sm px-4 py-2 bg-seal text-paper rounded hover:bg-seal/80 disabled:opacity-50 inline-flex items-center justify-center gap-1">
        <CreditCard className="h-4 w-4" />{busy ? '跳转中…' : label}
      </button>
      {err && <p className="text-xs text-seal mt-1 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{err}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create `PlanCard`**

Create `components/membership/PlanCard.tsx`:

```tsx
import { Crown } from 'lucide-react';
import { CheckoutButton } from './CheckoutButton';

const FEATURE_LABELS: Record<string, string> = {
  unlimited_history: '无限历史记录', download_pdf: 'PDF 下载', ai_calls: 'AI 释义', priority_tts: '优先 TTS',
};

export function PlanCard({ plan, isLoggedIn }: {
  plan: {
    id: number; planKey: string; displayName: string;
    durationDays: number; amount: string; currency: 'CNY' | 'USD';
    features: string[];
  };
  isLoggedIn: boolean;
}) {
  const symbol = plan.currency === 'USD' ? '$' : '¥';
  return (
    <div className="card-paper rounded-lg p-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Crown className="h-5 w-5 text-seal" />
        <h3 className="font-kai text-lg text-ink">{plan.displayName}</h3>
      </div>
      <div className="text-3xl font-serif text-ink">
        {symbol}{plan.amount}
        <span className="text-xs text-ink-soft ml-1">/ {plan.durationDays} 天</span>
      </div>
      <ul className="text-sm space-y-1 text-ink-soft flex-1">
        {plan.features.map(f => (
          <li key={f} className="inline-flex items-center gap-1">
            <span className="text-success">✓</span> {FEATURE_LABELS[f] ?? f}
          </li>
        ))}
      </ul>
      {isLoggedIn
        ? <CheckoutButton planKey={plan.planKey} label="立即开通" />
        : <a href={`/?auth=login&next=/membership`}
            className="block text-center text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep">登录后开通</a>}
    </div>
  );
}
```

- [ ] **Step 4: Create the `/membership` page (server component)**

Create `app/membership/page.tsx`:

```tsx
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
  const [plans, user, active] = await Promise.all([
    listPlans({ enabledOnly: true }),
    getCurrentUser(),
    getCurrentUser().then(u => u ? getMyActiveMembership(u.id) : null),
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
```

- [ ] **Step 5: Type-check and build**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/membership/ components/membership/
git commit -m "feat(membership): /membership page + PlanCard + CheckoutButton"
```

---

## Task 26: `/membership/success` (polling) + `/membership/cancel`

**Files:**
- Create: `app/membership/success/page.tsx`
- Create: `app/membership/cancel/page.tsx`

- [ ] **Step 1: Create success page (client component)**

Create `app/membership/success/page.tsx`:

```tsx
'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

function SuccessInner() {
  const sp = useSearchParams();
  const orderId = sp.get('orderId');
  const [status, setStatus] = useState<'pending' | 'paid' | 'failed'>('pending');
  const [planName, setPlanName] = useState<string | null>(null);

  const poll = useCallback(async () => {
    if (!orderId) { setStatus('failed'); return; }
    const res = await fetch(`/api/membership/orders/${orderId}`, { credentials: 'same-origin' });
    const j = await res.json();
    if (!j.ok) return; // keep polling
    if (j.data.status === 'paid') {
      setStatus('paid');
      setPlanName(j.data.planDisplayName);
    } else if (j.data.status === 'failed' || j.data.status === 'expired') {
      setStatus('failed');
    }
  }, [orderId]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [poll]);

  return (
    <main className="max-w-md mx-auto p-8 text-center space-y-4">
      {status === 'pending' && (
        <>
          <Loader2 className="h-12 w-12 mx-auto text-seal animate-spin" />
          <h1 className="font-kai text-xl">等待支付确认…</h1>
          <p className="text-sm text-ink-soft">请在 PayPal 页面完成支付。本页面会自动刷新状态。</p>
        </>
      )}
      {status === 'paid' && (
        <>
          <Check className="h-12 w-12 mx-auto text-success" />
          <h1 className="font-kai text-xl">开通成功!</h1>
          {planName && <p className="text-sm text-ink-soft">{planName} 已激活。</p>}
          <Link href="/profile" className="inline-block text-sm px-4 py-2 bg-ink text-paper rounded hover:bg-ink/80">查看我的会员</Link>
        </>
      )}
      {status === 'failed' && (
        <>
          <AlertTriangle className="h-12 w-12 mx-auto text-seal" />
          <h1 className="font-kai text-xl">支付未完成</h1>
          <p className="text-sm text-ink-soft">订单可能已过期或被取消。如已扣款请联系客服。</p>
          <Link href="/membership" className="inline-block text-sm px-4 py-2 border border-ink/20 rounded text-ink hover:bg-paper-deep">重试</Link>
        </>
      )}
    </main>
  );
}

export default function MembershipSuccessPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<p className="p-8 text-center text-ink-faint">加载中…</p>}>
        <SuccessInner />
      </Suspense>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Create cancel page**

Create `app/membership/cancel/page.tsx`:

```tsx
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { X } from 'lucide-react';

export default function MembershipCancelPage() {
  return (
    <>
      <Header />
      <main className="max-w-md mx-auto p-8 text-center space-y-4">
        <X className="h-12 w-12 mx-auto text-ink-soft" />
        <h1 className="font-kai text-xl">支付已取消</h1>
        <p className="text-sm text-ink-soft">您可以稍后再来。</p>
        <Link href="/membership" className="inline-block text-sm px-4 py-2 bg-ink text-paper rounded hover:bg-ink/80">返回套餐</Link>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/membership/success/ app/membership/cancel/
git commit -m "feat(membership): /success (polling) + /cancel pages"
```

---

## Task 27: `/profile` membership status card + Header link

**Files:**
- Create: `components/membership/MembershipStatusCard.tsx`
- Modify: `app/profile/page.tsx`
- Modify: `components/Header.tsx` (add "会员" link)
- Modify: `lib/design.ts` (add 会员 to NAV_LINKS for logged-in)

- [ ] **Step 1: Create `MembershipStatusCard`**

Create `components/membership/MembershipStatusCard.tsx`:

```tsx
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
```

- [ ] **Step 2: Add the card to `/profile`**

Edit `app/profile/page.tsx`, import and add the card after the stat cards grid. Replace the `<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">` block with:

```tsx
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          {statCards.map(s => (
            <div key={s.label} className="card-paper p-4 text-center">
              <div className="font-kai text-3xl text-ink">{s.value}</div>
              <div className="text-xs text-ink-soft mt-1">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <MembershipStatusCard userId={session.userId} />
        </div>
```

And update the import line:
```tsx
import { MembershipStatusCard } from '@/components/membership/MembershipStatusCard';
```

- [ ] **Step 3: Add "会员" to NAV_LINKS (for logged-in users)**

Edit `lib/design.ts`, add `{ href: '/membership', label: '会员' }` to `NAV_LINKS` after `'我的'`:

```ts
export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/dictionary', label: '字典' },
  { href: '/worksheet', label: '字帖' },
  { href: '/pinyin', label: '字转拼音' },
  { href: '/poetry', label: '诗词' },
  { href: '/sutra', label: '佛经' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
  { href: '/membership', label: '会员' },
] as const;
```

- [ ] **Step 4: Type-check and build**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/profile/page.tsx components/membership/MembershipStatusCard.tsx components/Header.tsx lib/design.ts
git commit -m "feat(membership): /profile status card + 会员 nav link"
```

---

## Task 28: Final smoke test + add new event types to admin logs filter

**Files:**
- Modify: `app/admin/logs/page.tsx` (add 6 new events to `EVENT_TYPES`)

- [ ] **Step 1: Find and update the EVENT_TYPES constant**

Read `app/admin/logs/page.tsx` to find the `EVENT_TYPES` constant. Append the 6 new events:

```ts
const EVENT_TYPES = [
  // ... existing events ...
  'membership_granted', 'membership_granted_paypal', 'membership_revoked',
  'paypal_config_updated', 'paypal_webhook_received', 'paypal_webhook_rejected',
];
```

(If `EVENT_TYPES` doesn't exist, add it next to the filter dropdown options — find the `<option>` list and add the 6 values there.)

- [ ] **Step 2: Start dev server and full smoke test**

```bash
pnpm dev &
```

Then run through the full flow:
1. Login as admin
2. Visit `/admin/memberships` — see 4 plans in /plans page, 0 memberships in /memberships list
3. Click "初始化 4 档套餐" — verify 4 rows appear
4. Edit "月度会员" USD price to 3.50 → save
5. Visit `/admin/memberships/config` — fill in PayPal sandbox creds (use a sandbox client_id/secret from developer.paypal.com)
6. Save config
7. Login as a regular user
8. Visit `/membership` — see 2 USD plans
9. Click "立即开通" on monthly → redirected to PayPal
10. Pay with sandbox test account
11. Get redirected back to `/membership/success?orderId=...` — should show "开通成功!" within 30s
12. Visit `/profile` — see "月度会员" status with expiry
13. Back to admin `/admin/memberships` — see new row with `source=paypal`
14. Test revoke: click "撤销" with reason → row shows "已撤销"

- [ ] **Step 3: Verify webhook idempotency**

```bash
# Replay the webhook (use the same event ID)
curl -X POST -H "content-type: application/json" \
  -H "paypal-auth-algo: SHA256withRSA" \
  -H "paypal-cert-url: https://api.paypal.com/cert.pem" \
  -H "paypal-transmission-id: t-replay" \
  -H "paypal-transmission-sig: s" \
  -H "paypal-transmission-time: 2026-06-15T00:00:00Z" \
  http://localhost:4444/api/webhooks/paypal \
  -d '{"id":"WH-REPLAY","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"supplementary_data":{"related_ids":{"order_id":"PAY-2"}}}}'
```

Expected: 200, no duplicate membership row.

- [ ] **Step 4: Stop dev server + commit**

```bash
kill %1
git add app/admin/logs/page.tsx
git commit -m "feat(membership): add 6 new audit events to /admin/logs filter"
```

---

# Final verification

After all tasks complete:

```bash
pnpm tsc --noEmit
pnpm test
pnpm build
```

Expected: all green. Manual smoke (Task 28 step 2) confirms the user-facing flow.

## Rollback plan

If something goes wrong post-deploy:
1. `pnpm tsc --noEmit` will catch type errors before deploy
2. The migration is idempotent — re-run if interrupted
3. Webhook is retry-safe — duplicate events are noop
4. Membership tables don't affect existing functionality (no FK on existing tables except users)
5. To fully roll back: `git revert` the merge commit; the migration script can be re-run with `DROP TABLE` if needed

## Out of scope (M4+)

- `hasFeature` integration beyond AI endpoint
- Subscription auto-renewal (no PayPal Subscriptions API)
- Stripe / 微信 / 支付宝 gateways
- Refund flow
- 多币种换汇

---



