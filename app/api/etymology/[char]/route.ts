import { NextRequest, NextResponse } from 'next/server';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { etymologyCharParamSchema } from '@/lib/validators';
import type { EtymologyClient } from '@/lib/etymology-types';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ char: string }> }) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const decoded = decodeURIComponent(char);
    const parsed = etymologyCharParamSchema.safeParse({ char: decoded });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const [etymology, adjacent] = await Promise.all([getEtymology(decoded), getAdjacentChars(decoded)]);
    if (!etymology) return notFound('not_found', 'etymology not found');
    const data: EtymologyClient = {
      ...etymology,
      prev: adjacent.prev,
      next: adjacent.next,
    };
    return NextResponse.json({ ok: true, data });
  });
}