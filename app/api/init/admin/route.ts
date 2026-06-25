import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { getPool } from '@/lib/db';
import { isSetupRouteEnabled } from '@/lib/setup';

const adminSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

/**
 * Step 2 of /init wizard. Create the first admin user. Requires DATABASE_URL
 * to be configured (Step 1) so the users table is reachable.
 *
 * Public: only callable when setup is incomplete OR setup.route_enabled=true.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const body = await req.json();
    const parsed = adminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map(i => i.message).join('; '));
    }
    const { username, password, email } = parsed.data;
    const pool = getPool();
    // Step 2 runs BEFORE step 3 (init-db), so the users table may not exist
    // yet on a fresh DB. Run initDb() first — it's idempotent (CREATE IF
    // NOT EXISTS, skip-if-non-empty for seeds) and guarantees the schema is
    // in place before we INSERT. The visible "创建表结构" sub-step in step 3
    // will then re-run initDb (still idempotent) and report tables present.
    await pool.query(`SELECT 1`);
    const [tbls] = await pool.query<any[]>(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'users' LIMIT 1`,
    );
    if (tbls.length === 0) {
      const { initDb } = await import('@/scripts/init-db');
      await initDb();
    }
    // Defensive: refuse if a user with this username already exists (so
    // /init step 2 can be safely re-run during a multi-attempt session).
    const [existing] = await pool.query<any[]>(
      `SELECT id FROM users WHERE username = ? LIMIT 1`,
      [username],
    );
    if (existing.length > 0) {
      return badRequest('username_taken', 'A user with this username already exists.');
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.execute(
      `INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, 1)`,
      [username, email ?? null, hash],
    );
    return NextResponse.json({ ok: true, data: { username } });
  });
}