import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listUserWorksheets, saveWorksheet } from '@/lib/worksheet';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { saveWorksheetSchema } from '@/lib/validators';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const worksheets = await listUserWorksheets(user.id);
    return NextResponse.json({ ok: true, data: { worksheets } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const body = await req.json();
    const parsed = saveWorksheetSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join('.') ?? '';
      return badRequest('bad_input', `${path}: ${issue?.message ?? 'bad input'}`);
    }
    const id = await saveWorksheet({
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      cellStyle: parsed.data.cellStyle,
      paperSize: parsed.data.paperSize,
      fontFamily: parsed.data.fontFamily,
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
