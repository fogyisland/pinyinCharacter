import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';

/**
 * /init phase 6: create the first admin user. Requires users table (PHASE 1).
 * Idempotent — refuses if username already taken.
 */
const createAdminSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const body = await req.json();
    const parsed = createAdminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map(i => i.message).join('; '));
    }
    const { createAdminUser } = await import('@/scripts/init-db');
    const stats = await createAdminUser(parsed.data);
    return NextResponse.json({ ok: true, data: stats });
  });
}