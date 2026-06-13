import { NextRequest, NextResponse } from 'next/server';
import { getCharDetail } from '@/lib/chars';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { charParamSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ char: string }> }) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const decoded = decodeURIComponent(char);
    const parsed = charParamSchema.safeParse({ char: decoded });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await getCharDetail(decoded);
    if (!result) return notFound('not_found', 'char not found');
    return NextResponse.json({ ok: true, data: result });
  });
}