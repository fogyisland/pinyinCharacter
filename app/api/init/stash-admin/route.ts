import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';
import { stashAdminCredentials, ADMIN_TOKEN_TTL_SEC } from '@/lib/init-credentials';

const stashAdminSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

/** Step 2 of /init wizard. Validates the admin schema and stashes the
 *  credentials server-side (in-memory, 10-minute TTL), returning a
 *  single-use token. Step 3 will POST this token to /api/init/create-admin
 *  which consumes it. The password NEVER leaves server memory.
 *
 *  The TTL is 10 minutes (`TTL_MS` in `lib/init-credentials.ts`), not 2:
 *  step 2 (fill the form) and step 3 (press "开始初始化") are two separate
 *  human steps, and the import phases in step 3 alone can take minutes on
 *  a fresh database. A 2-minute TTL expired mid-wizard and the
 *  create-admin phase died with 401 token_expired — a dead end, because
 *  the retry button replays the same stale token from sessionStorage.
 *
 *  All responses carry `Cache-Control: no-store` so a browser cannot replay
 *  a previously-issued token from its HTTP cache. */
export async function POST(req: NextRequest) {
  const result = await withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    const body = await req.json();
    const parsed = stashAdminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
    }
    const token = stashAdminCredentials(parsed.data);
    return NextResponse.json({ ok: true, data: { token, expiresInSec: ADMIN_TOKEN_TTL_SEC } });
  });
  if (result instanceof NextResponse) {
    result.headers.set('Cache-Control', 'no-store');
  }
  return result;
}
