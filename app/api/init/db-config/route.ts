import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import {
  testDbConnection,
  buildDatabaseUrl,
  writeEnvVars,
  generateJwtSecret,
  reloadProcessEnvFromFile,
  isSetupRouteEnabled,
} from '@/lib/setup';
import { closePool } from '@/lib/db';

const dbConfigSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  password: z.string().max(128), // Empty password allowed
  database: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, 'Schema name must be alphanumeric + underscore'),
});

/**
 * Step 1 of /init wizard. Test connection → write .env → close stale pool so
 * next request re-creates with the new DATABASE_URL. JWT_SECRET and
 * COOKIE_SECURE are auto-generated server-side (the user only ever sees
 * them in the success message — never the raw value — to limit exposure).
 *
 * Public: only callable when setup is incomplete OR setup.route_enabled=true.
 *
 * ⚠️ This route can rewrite `.env` — including `JWT_SECRET` — so it is one
 * of the most dangerous endpoints in the codebase. Two rules keep it from
 * being an unauthenticated takeover:
 *
 *   1. `isSetupRouteEnabled()` must return true. That gate fails CLOSED
 *      (see `lib/setup.ts`), so a production site whose `app_config` table
 *      went missing does NOT silently re-open this door.
 *   2. `JWT_SECRET` is only generated when there is none to keep. On a
 *      live install the existing secret is preserved, because rotating it
 *      invalidates every session AND hands the signing key to whoever
 *      triggered the rotation.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest(
        'setup_disabled',
        '/init is disabled. Ask an admin to enable it via /admin/settings/setup.',
      );
    }
    const body = await req.json();
    const parsed = dbConfigSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
    }
    const cfg = parsed.data;
    const conn = await testDbConnection(cfg);
    if (!conn.ok) {
      return badRequest('connection_failed', conn.error ?? 'Connection failed');
    }
    const databaseUrl = buildDatabaseUrl(cfg);
    // Keep the secret that is already in force. Regenerating it would
    // invalidate every issued session and hand the new signing key to
    // whoever called this route. A first run has no secret yet, so one is
    // generated then.
    const existingSecret = process.env.JWT_SECRET;
    const hasUsableSecret = typeof existingSecret === 'string' && existingSecret.length >= 32;
    const jwtSecret = hasUsableSecret ? existingSecret : generateJwtSecret();
    // /init is only reachable pre-setup, so production here means the user
    // is deploying prod for the first time. Lock down cookie transport.
    const cookieSecure = process.env.NODE_ENV === 'production' ? 'true' : 'false';
    writeEnvVars({
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      COOKIE_SECURE: cookieSecure,
    });
    // Next.js loads .env once at startup — writeEnvVars() above only writes
    // to disk. Reload process.env in the running process so step 2/3 of
    // /init can use the new DATABASE_URL/JWT_SECRET without a restart.
    reloadProcessEnvFromFile();
    // Close the (potentially stale) pool. Next getPool() call will pick up
    // the new DATABASE_URL from process.env on next request.
    await closePool().catch(() => undefined);
    return NextResponse.json({
      ok: true,
      data: {
        // The connection succeeded, but the URL carries the database
        // password — a credential that must not travel back to the client
        // (it would land in the browser's network log, in a proxy's log,
        // and in this project's own access logs). The UI only needs to
        // show which database was configured, so it gets the host and the
        // schema name — never the assembled URL.
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        // Never return the raw JWT_SECRET to the client — the user doesn't
        // need it and leaking it through JSON would defeat the purpose.
        // It is now in .env on disk.
      },
    });
  });
}
