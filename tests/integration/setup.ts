/// <reference types="vitest/globals" />
import { afterAll, afterEach, beforeAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';
import { createHash, randomBytes } from 'node:crypto';

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const TEST_JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';

export function integrationTest(name: string, fn: () => Promise<void>) {
  return HAS_DB ? test(name, fn) : test.skip(name, fn);
}

export function integrationDescribe(name: string, factory: () => void) {
  if (HAS_DB) {
    describe(name, factory);
  } else {
    describe.skip(name, factory);
  }
}

export async function truncateAll(): Promise<void> {
  if (!HAS_DB) return;
  const pool = getPool();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE TABLE worksheets');
  await pool.query('TRUNCATE TABLE poems');
  await pool.query('TRUNCATE TABLE rare_chars');
  await pool.query('TRUNCATE TABLE char_etymology');
  await pool.query('TRUNCATE TABLE chars');
  await pool.query('TRUNCATE TABLE history');
  await pool.query('TRUNCATE TABLE password_resets');
  await pool.query('TRUNCATE TABLE audit_log');
  await pool.query('TRUNCATE TABLE users');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

export function installTestEnv(): void {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = TEST_JWT_SECRET;
}

export function uniqueUsername(prefix = 'u'): string {
  const h = createHash('sha256').update(randomBytes(8)).digest('hex').slice(0, 12);
  return `${prefix}_${h}`;
}

if (HAS_DB) {
  beforeAll(async () => {
    installTestEnv();
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    await initDb();
  });
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });
}
