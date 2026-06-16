// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import {
  PLAN_KEYS, type PlanKey, type MembershipFeature,
  listPlans, getPlanByKey, getPlanById, seedDefaultPlans, updatePlan,
  grantMembership, listMemberships, revokeMembership,
  getMyActiveMembership, hasFeature, getMyFeatures,
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

  // --- grant / list / revoke ---------------------------------------

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
});
