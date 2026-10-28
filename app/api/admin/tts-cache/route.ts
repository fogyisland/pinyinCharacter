import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getTtsCacheSize, clearTtsCache } from '@/lib/tts-cache';

export const runtime = 'nodejs';

/**
 * The size of the TTS cache, and the button that empties it.
 *
 * The administrator check is the one the whole admin uses: `requireAdmin`
 * reads the session token, then reads `is_admin` and `disabled_at` from
 * the users table, so a demotion or a ban takes effect at once instead of
 * at token expiry.
 *
 * It used to be hand-rolled here, reading `isAdmin` off the token's
 * payload — but the token carries the user id and the name and nothing
 * else, so the payload never had that field, the check never passed, and
 * this route refused everybody, administrator included. The guard's own
 * answer is handed back untouched: 401 for a signed-out caller, 403 for
 * one who is signed in but not an administrator.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const size = await getTtsCacheSize();
    return NextResponse.json({ ok: true, data: size });
  });
}

export async function DELETE() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    await clearTtsCache();
    return NextResponse.json({ ok: true });
  });
}
