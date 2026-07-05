import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { setConfig } from '@/lib/config';
import { writeAudit } from '@/lib/audit';
import { parseNotesAdminEmails, isValidEmail } from '@/lib/notes-email-config';

const NotesEmailsSchema = z.object({
  adminEmails: z.string().max(1024),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = NotesEmailsSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const emails = parseNotesAdminEmails(parsed.data.adminEmails);
    for (const e of emails) {
      if (!isValidEmail(e)) {
        return badRequest('validation', `非法邮箱: ${e}`);
      }
    }
    try {
      await setConfig('notes.admin_emails', parsed.data.adminEmails, auth.user.id);
    } catch (err) {
      return badRequest('validation', (err as Error).message);
    }
    await writeAudit({
      event: 'notes_admin_emails_updated',
      userId: auth.user.id,
      metadata: { count: emails.length },
    });
    return NextResponse.json({ ok: true, data: { adminEmails: parsed.data.adminEmails, count: emails.length } });
  });
}
