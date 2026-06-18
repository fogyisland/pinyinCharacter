import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, serviceUnavailable } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAboutIntro } from '@/lib/about-config';
import { generateAboutIntro } from '@/lib/about-ai';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Manually regenerate the AI intro. Cached in app_config so all visitors
 * share the same version until the next regenerate.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    let result;
    try {
      result = await generateAboutIntro(auth.user.id);
    } catch (e) {
      const msg = (e as Error).message;
      return serviceUnavailable('llm_error', msg);
    }
    await writeAboutIntro(result.text, auth.user.id);
    await writeAudit({
      event: 'admin_about_intro_regenerated',
      userId: auth.user.id,
      metadata: { charCount: result.text.length, durationMs: result.durationMs, model: result.model },
    });
    return NextResponse.json({
      ok: true,
      data: {
        text: result.text,
        generatedAt: new Date().toISOString(),
        durationMs: result.durationMs,
      },
    });
  });
}