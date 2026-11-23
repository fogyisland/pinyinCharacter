import { NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { resolveSpeechConfig, verifySpeechCredentials } from '@/lib/azure-speech';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/speech/verify — 「测试连接」.
 *
 * Tests the pair that is ALREADY SAVED, not values typed into the form.
 *
 * That looks like a limitation and is in fact the only correct option: the
 * key field is always blank (the stored value is never sent to the browser,
 * by design), so this route cannot tell "the operator typed something" from
 * "the operator left it alone". Testing the stored pair has a clear meaning,
 * and it keeps the secret from making one extra round trip.
 *
 * The response is 200 even when Azure refuses: the TEST worked and its
 * verdict was 「不通过」. A non-2xx would be read by the form as a broken
 * request and hide the verdict it just obtained.
 */
export async function POST() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const config = await resolveSpeechConfig();
    if (config === null) {
      return badRequest(
        'unconfigured',
        '还没有保存 region 和 key。请先保存，再测试连接。',
      );
    }

    const result = await verifySpeechCredentials(config);
    return NextResponse.json({ ok: true, data: result });
  });
}
