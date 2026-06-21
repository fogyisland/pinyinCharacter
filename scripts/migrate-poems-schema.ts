/**
 * One-time migration: bring poems table to target schema.
 * - dynasty ENUM('tang','song') -> VARCHAR(16)
 * - ADD COLUMN category VARCHAR(32) + INDEX idx_category
 * - MODIFY COLUMN form VARCHAR(20) -> VARCHAR(32) + INDEX idx_form
 *
 * Idempotent: every ALTER checks INFORMATION_SCHEMA first, so re-running is a no-op.
 *
 * Run: DATABASE_URL=mysql://... pnpm tsx scripts/migrate-poems-schema.ts
 * After verifying on dev+prod, delete this script (per migrate-membership.ts pattern).
 */
import type { Pool } from 'mysql2/promise';
import { getPool, closePool } from '../lib/db';

const TARGET_DDL = {
  dynasty: 'ALTER TABLE poems MODIFY COLUMN dynasty VARCHAR(16) NOT NULL',
  category: 'ALTER TABLE poems ADD COLUMN category VARCHAR(32) DEFAULT NULL AFTER dynasty',
  categoryIndex: 'ALTER TABLE poems ADD INDEX idx_category (category)',
  form: 'ALTER TABLE poems MODIFY COLUMN form VARCHAR(32) DEFAULT NULL',
  formIndex: 'ALTER TABLE poems ADD INDEX idx_form (form)',
} as const;

async function columnExists(pool: Pool, column: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = ?`,
    [column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(pool: Pool, index: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT INDEX_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND INDEX_NAME = ?`,
    [index]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function migratePoemsSchema(): Promise<{ ran: string[]; skipped: string[] }> {
  const pool = getPool();
  const ran: string[] = [];
  const skipped: string[] = [];

  // 1. dynasty ENUM -> VARCHAR(16) — check by column type containing 'enum'
  const [dynastyRows] = await pool.query<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = 'dynasty'`
  );
  if (Array.isArray(dynastyRows) && dynastyRows[0] && dynastyRows[0].COLUMN_TYPE?.includes('enum')) {
    await pool.query(TARGET_DDL.dynasty);
    ran.push('dynasty');
  } else {
    skipped.push('dynasty');
  }

  // 2. category column
  if (await columnExists(pool, 'category')) {
    skipped.push('category');
  } else {
    await pool.query(TARGET_DDL.category);
    ran.push('category');
  }

  // 3. category index
  if (await indexExists(pool, 'idx_category')) {
    skipped.push('idx_category');
  } else {
    await pool.query(TARGET_DDL.categoryIndex);
    ran.push('idx_category');
  }

  // 4. form column widening
  const [formRows] = await pool.query<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = 'form'`
  );
  if (Array.isArray(formRows) && formRows[0] && formRows[0].COLUMN_TYPE?.includes('varchar(32)')) {
    skipped.push('form');
  } else {
    await pool.query(TARGET_DDL.form);
    ran.push('form');
  }

  // 5. form index
  if (await indexExists(pool, 'idx_form')) {
    skipped.push('idx_form');
  } else {
    await pool.query(TARGET_DDL.formIndex);
    ran.push('idx_form');
  }

  console.log(`[migrate-poems-schema] ran: ${ran.join(', ')}; skipped: ${skipped.join(', ')}`);
  return { ran, skipped };
}

if (require.main === module) {
  migratePoemsSchema()
    .then(() => closePool())
    .catch((err) => {
      console.error('[migrate-poems-schema] failed:', err);
      process.exit(1);
    });
}