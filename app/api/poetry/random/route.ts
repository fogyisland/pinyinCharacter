import { NextResponse } from 'next/server';
import { getRandomPoem } from '@/lib/poetry';
import { withErrorHandling, notFound } from '@/lib/api-handler';

export async function GET() {
  return withErrorHandling(async () => {
    const poem = await getRandomPoem();
    if (!poem) return notFound('no_poems', 'no poems in database yet');
    return NextResponse.json({ ok: true, data: poem });
  });
}
