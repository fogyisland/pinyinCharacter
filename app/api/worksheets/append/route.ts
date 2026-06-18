import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { appendToWorksheetSchema } from '@/lib/validators';
import { appendCharToMyWorksheet } from '@/lib/worksheet-append';
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
    const result = await appendCharToMyWorksheet(user.id, parsed.data.char);
    await logUserAction(req, user.id, 'worksheet_char_appended', {
      worksheetId: result.worksheetId,
      char: parsed.data.char,
      added: result.added,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
