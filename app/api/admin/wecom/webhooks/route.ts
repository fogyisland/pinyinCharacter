import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
  WecomDuplicateNameError,
} from '@/lib/wecom-webhooks';
import { isWecomCategory, type WecomCategory } from '@/lib/wecom-types';

export const dynamic = 'force-dynamic';

const CategoriesSchema = z
  .array(z.string())
  .refine((values) => values.every((v) => isWecomCategory(v)), {
    message: 'unknown notification category',
  });

const WebhookSchema = z.object({
  name: z.string().min(1).max(64),
  webhookUrl: z.string().min(1).max(512),
  enabled: z.boolean(),
  categories: CategoriesSchema,
});

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const webhooks = await listWebhooks();
    return NextResponse.json({ ok: true, data: { webhooks } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = WebhookSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      const id = await createWebhook({
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl,
        enabled: parsed.data.enabled,
        categories: parsed.data.categories as WecomCategory[],
      });
      await writeAudit({
        userId: auth.user.id,
        event: 'wecom_webhook_created',
        metadata: { id, name: parsed.data.name },
      });
      return NextResponse.json({ ok: true, data: { id } });
    } catch (error) {
      if (error instanceof WecomDuplicateNameError) {
        return badRequest('duplicate_name', error.message);
      }
      return badRequest('invalid_webhook', (error as Error).message);
    }
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return badRequest('validation', 'id must be a positive integer');
    }
    const parsed = WebhookSchema.safeParse(body);
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      await updateWebhook(id, {
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl,
        enabled: parsed.data.enabled,
        categories: parsed.data.categories as WecomCategory[],
      });
      await writeAudit({
        userId: auth.user.id,
        event: 'wecom_webhook_updated',
        metadata: { id, name: parsed.data.name },
      });
      return NextResponse.json({ ok: true, data: { id } });
    } catch (error) {
      if (error instanceof WecomDuplicateNameError) {
        return badRequest('duplicate_name', error.message);
      }
      return badRequest('invalid_webhook', (error as Error).message);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return badRequest('validation', 'id must be a positive integer');
    }
    await deleteWebhook(id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_webhook_deleted',
      metadata: { id },
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
