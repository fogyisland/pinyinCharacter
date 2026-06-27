import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken, setMarketingOptOut } from '@/lib/email-campaigns';
import { writeAudit } from '@/lib/audit';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-click unsubscribe (GET). Verifies the HMAC token, marks the user as
 * opted out, redirects home with a banner flag. Anonymous — no login
 * required, since the token IS the proof.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const siteUrl = await getRuntimeSiteUrl();
  if (!token) {
    return NextResponse.redirect(`${siteUrl}/?unsub=invalid`, { status: 303 });
  }
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return NextResponse.redirect(`${siteUrl}/?unsub=invalid`, { status: 303 });
  }
  await setMarketingOptOut(userId, true);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = req.headers.get('user-agent') ?? null;
  await writeAudit({ userId, event: 'marketing_unsubscribed', metadata: { via: 'link' }, ip, userAgent: ua });
  return NextResponse.redirect(`${siteUrl}/?unsub=ok`, { status: 303 });
}