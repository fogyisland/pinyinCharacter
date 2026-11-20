import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { createBroadcast, listBroadcasts, queueBroadcast } from '@/lib/wechat-broadcasts';
import { validateTemplateData } from '@/lib/wechat-types';

export const dynamic = 'force-dynamic';

const TemplateValueSchema = z.object({ value: z.string().min(1).max(200) });

const BroadcastSchema = z.object({
  title: z.string().min(1).max(128),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  data: z.record(z.string(), TemplateValueSchema),
});

/**
 * GET /api/admin/wechat/broadcasts
 *
 * The announcements, newest first.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const broadcasts = await listBroadcasts();
    return NextResponse.json({ ok: true, data: { broadcasts } });
  });
}

/**
 * POST /api/admin/wechat/broadcasts
 *
 * Creates an announcement and puts it in the queue.
 *
 * ⚠️ Creating it does NOT send it. The scheduler sends the queue, one
 * announcement per tick — an announcement that went out the moment it
 * was written would have no chance to be cancelled.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = BroadcastSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', error instanceof Error ? error.message : String(error));
    }
    const id = await createBroadcast({
      title: parsed.data.title,
      templateId: parsed.data.templateId,
      url: parsed.data.url || null,
      data,
      createdBy: auth.user.id,
    });
    await queueBroadcast(id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_created',
      metadata: { id, title: parsed.data.title },
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
