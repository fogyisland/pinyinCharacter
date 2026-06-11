import { NextRequest, NextResponse } from 'next/server';
import { getChar } from '@/lib/rare-chars';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { charParamSchema } from '@/lib/validators';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ char: string }> }
) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const parsed = charParamSchema.safeParse({ char: decodeURIComponent(char) });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const found = await getChar(parsed.data.char);
    if (!found) return notFound();
    return NextResponse.json({ ok: true, data: found });
  });
}
