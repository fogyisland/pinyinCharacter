import { NextRequest, NextResponse } from 'next/server';
import { findValidVerifyRow, markVerified } from '@/lib/email-verification';
import { writeAudit } from '@/lib/audit';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length < 32) {
    return NextResponse.redirect(`${await getRuntimeSiteUrl()}/login?verify=invalid`, { status: 303 });
  }
  const row = await findValidVerifyRow(token);
  if (!row) {
    return NextResponse.redirect(`${await getRuntimeSiteUrl()}/login?verify=expired`, { status: 303 });
  }
  await markVerified(row.user_id);
  await writeAudit({ userId: row.user_id, event: 'email_verified', metadata: { verify_id: row.id } });
  return NextResponse.redirect(`${await getRuntimeSiteUrl()}/login?verify=ok`, { status: 303 });
}