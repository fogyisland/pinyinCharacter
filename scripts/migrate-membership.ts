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
