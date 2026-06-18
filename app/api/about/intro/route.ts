import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { readAboutIntro, DEFAULT_INTRO } from '@/lib/about-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const cached = await readAboutIntro();
    // Public endpoint: always return some text. If no AI version cached,
    // return the hand-written default so first-time visitors see content.
    return NextResponse.json({
      ok: true,
      data: {
        text: cached.text || DEFAULT_INTRO,
        generatedAt: cached.generatedAt,
        isAi: cached.isAi,
      },
    });
  });
}