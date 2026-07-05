import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { insertNote, listActiveNotes, checkRateLimit, bumpRateLimit } from '@/lib/notes';
import { sendEmail, notesNotificationEmail, EmailNotConfiguredError, EmailSendError } from '@/lib/email';
import { getConfig } from '@/lib/config';

const PostSchema = z.object({
  name: z.string().min(1).max(64),
  email: z.string().email().max(254).optional().or(z.literal('')).transform((v) => v || undefined),
  content: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = req.headers.get('user-agent') ?? null;
    const user = await getCurrentUser();

    // User interface lacks `email`; brief uses user?.email as a defensive
    // fallback for registered users who didn't supply one in the form.
    const userEmail = (user as unknown as { email?: string | null } | null)?.email ?? null;
    const verdict = await checkRateLimit({
      ip,
      email: parsed.data.email ?? userEmail ?? null,
    });
    if (!verdict.allow) {
      return NextResponse.json(
        { ok: false, error: { code: 'rate_limited', message: verdict.reason, retryAfterSec: verdict.retryAfterSec } },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } }
      );
    }

    let id: number;
    try {
      id = await insertNote({
        authorUserId: user?.id ?? null,
        authorName: parsed.data.name,
        authorEmail: parsed.data.email ?? null,
        content: parsed.data.content,
        ip, userAgent: ua,
      });
    } catch (err) {
      return badRequest('insert_failed', (err as Error).message);
    }

    await bumpRateLimit({ ip, email: parsed.data.email ?? null });

    // Audit + email are best-effort: never fail the user's POST.
    await writeAudit({
      userId: user?.id ?? null,
      event: 'notes_posted',
      metadata: { id, authorName: parsed.data.name },
      ip, userAgent: ua,
    }).catch(() => {});

    // Admin email (fire-and-forget; failures go to audit only)
    sendAdminNotification(id).catch(() => {});

    return NextResponse.json({ ok: true, data: { id } });
  });
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const limit = Math.min(
      Math.max(parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10) || 50, 1),
      100
    );
    const rows = await listActiveNotes({ limit });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    return NextResponse.json({ ok: true, data: rows }, { headers });
  });
}

async function sendAdminNotification(noteId: number): Promise<void> {
  // Lazy import to avoid pulling notes.ts into email-only call paths
  const { listAllNotesForAdmin } = await import('@/lib/notes');
  const all = await listAllNotesForAdmin({ limit: 200, includeDeleted: true });
  const note = all.find((n) => n.id === noteId);
  if (!note) return;
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  const tpl = notesNotificationEmail({
    id: note.id,
    authorName: note.authorName,
    authorEmail: note.authorEmail,
    content: note.content,
    createdAt: note.createdAt,
    ip: null, // we don't expose IP in email; only in admin /admin/notes
  });
  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        template: 'notes_notification',
      });
      await writeAudit({
        userId: null,
        event: 'notes_email_sent',
        metadata: { noteId: note.id, to },
      }).catch(() => {});
    } catch (err) {
      const code = err instanceof EmailNotConfiguredError ? 'email_not_configured'
        : err instanceof EmailSendError ? 'email_send_failed'
        : 'unknown';
      await writeAudit({
        userId: null,
        event: 'notes_email_failed',
        metadata: { noteId: note.id, to, error: code },
      }).catch(() => {});
    }
  }
}

async function resolveAdminRecipients(): Promise<string[]> {
  const cfg = await getConfig('notes.admin_emails').catch(() => null);
  const fallback = await getConfig('smtp.from').catch(() => null);
  const raw = (cfg && String(cfg).trim()) || (fallback && String(fallback).trim()) || '';
  return raw.split(',').map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}