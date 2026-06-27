import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withErrorHandling, badRequest, unauthorized, notFound, forbidden } from '@/lib/api-handler';
import { appendToWorksheetSchema } from '@/lib/validators';
import { appendCharToWorksheet, WorksheetAccessError } from '@/lib/worksheet-append';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = appendToWorksheetSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest('bad_input', issue?.message ?? 'bad input');
    }
    const { char, worksheetId, newTitle } = parsed.data;
    const mode = worksheetId ? 'append_existing' : newTitle ? 'create_or_append' : 'append_default';

    let result;
    try {
      result = await appendCharToWorksheet(user.id, { char, worksheetId, newTitle });
    } catch (e) {
      if (e instanceof WorksheetAccessError) {
        if (e.code === 'not_found') return notFound();
        if (e.code === 'not_owner') return forbidden();
      }
      throw e;
    }

    await logUserAction(req, user.id, 'worksheet_char_appended', {
      mode,
      worksheetId: result.worksheetId,
      title: result.title,
      char,
      added: result.added,
      charCount: result.charCount,
      created: result.created,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}