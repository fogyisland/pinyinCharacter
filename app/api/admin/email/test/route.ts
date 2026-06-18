import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';

const TestSchema = z.object({ to: z.string().email() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = TestSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const { to } = parsed.data;

    let ok = false;
    let error: string | null = null;
    try {
      await sendEmail({
        to,
        subject: '字·韵 SMTP 测试',
        html: '<p>这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。</p>',
        text: '这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。',
      });
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'smtp_test_sent',
      metadata: { to, ok, error },
    });
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: { code: 'send_failed', message: error ?? 'send failed' } },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data: { to } });
  });
}
