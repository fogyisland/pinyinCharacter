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
