import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';
import { consumeAdminCredentials } from '@/lib/init-credentials';

/**
 * /init phase 6: create the first admin user. Requires users table (PHASE 1).
 *
 * Body changed from {username, password, email} to {token} — the token was
 * obtained from /api/init/stash-admin in step 2 and is consumed here. The
 * actual credentials never leave the server's in-memory map; the wizard
 * page only sees the token.
 *
 * Idempotent at the consume layer (one-shot) — refuses if token already
 * consumed or expired.
 */
const tokenSchema = z.object({
  token: z.string().length(32).regex(/^[0-9a-f]+$/i, 'token must be 32 hex chars'),
});

// Secret-bearing endpoint — must never be HTTP-cached (lesson from Task 5 review)
const NO_STORE = { headers: { 'cache-control': 'no-store' } } as const;

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.', NO_STORE);
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).', NO_STORE);
    }
    const body = await req.json();
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', 'token required (32 hex chars)', NO_STORE);
    }
    const creds = consumeAdminCredentials(parsed.data.token);
    if (!creds) {
      return unauthorized('token_expired', 'admin credentials token expired or invalid; please re-enter on /init/admin', NO_STORE);
    }
    const { createAdminUser } = await import('@/scripts/init-db');
    const stats = await createAdminUser({
      username: creds.username,
      password: creds.password,
      email: creds.email,
    });
    return NextResponse.json({ ok: true, data: stats }, NO_STORE);
  });
}
