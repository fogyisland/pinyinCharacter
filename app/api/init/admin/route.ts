import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled, markInitWizardAdminDone } from '@/lib/setup';

/**
 * Step 2 of /init wizard. After validating the admin schema, writes the
 * wizard step marker `setup.wizard.admin_done='true'` to app_config. This
 * marker tells the orchestrator (/init, /init/admin, /init/execute pages)
 * that step 2 has been reached, so subsequent visits skip the form and
 * jump straight to step 3.
 *
 * The actual user INSERT happens in step 3's `/api/init/create-admin`
 * (which consumes the token from /api/init/stash-admin).
 *
 * ## The marker cannot be written during a fresh install — and that is fine
 *
 * `app_config` is created by step 3 (`initDb()`), so on a brand-new
 * database step 2 runs against a schema that has **no tables at all**. The
 * marker therefore cannot land here; the route used to turn that into a
 * 500, which surfaced in the browser console as
 *
 *     [init] the wizard step-2 marker could not be written ...
 *
 * A missing table is a *state*, not a fault — the same rule the read side
 * already follows (`isInitWizardAdminDone()` answers "not done" without
 * erroring). So the route answers 200 and tells the client, in
 * `data.markerWritten`, whether the marker actually landed.
 *
 * Step 3 re-writes the marker once `initDb()` has created the table, so
 * the "skip step 2 on re-entry" protection still works once the wizard
 * has run.
 *
 * All responses carry `Cache-Control: no-store` so a browser cannot replay
 * a previously-seen step-2-completed state from its HTTP cache and skip
 * form re-validation.
 */
const adminSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

export async function POST(req: NextRequest) {
  const result = await withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    const body = await req.json();
    const parsed = adminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
    }
    // Write the wizard marker so the orchestrator can skip step 2 on
    // re-entry. `false` means the table does not exist yet — the normal
    // state on a fresh install, and not an error.
    const markerWritten = await markInitWizardAdminDone();
    return NextResponse.json({ ok: true, data: { validated: true, markerWritten } });
  });
  if (result instanceof NextResponse) {
    result.headers.set('Cache-Control', 'no-store');
  }
  return result;
}
