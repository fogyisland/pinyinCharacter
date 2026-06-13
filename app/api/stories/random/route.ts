import { NextRequest, NextResponse } from 'next/server';
import { getRandomStoryChar } from '@/lib/rare-chars';
import { withErrorHandling, serviceUnavailable } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const result = await getRandomStoryChar();
    if (!result) {
      return serviceUnavailable('NO_STORIES', 'no stories available');
    }
    return NextResponse.json({ ok: true, data: result });
  });
}
