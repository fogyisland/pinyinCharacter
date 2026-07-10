import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { getCurrentUser } from '@/lib/auth';
import { recordPageView } from '@/lib/page-views';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = await req.json().catch(() => ({}));
    const path = typeof body.path === 'string' ? body.path.slice(0, 255) : '';
    if (!path || !path.startsWith('/') || path.startsWith('//')) {
      return badRequest('invalid_path', 'path must start with /');
    }
    const user = await getCurrentUser().catch(() => null);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) ?? null;
    const ua = req.headers.get('user-agent')?.slice(0, 255) ?? null;
    await recordPageView({ userId: user?.id ?? null, path, ip, userAgent: ua });
    return NextResponse.json({ ok: true });
  });
}