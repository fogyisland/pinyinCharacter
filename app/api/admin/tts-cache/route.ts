import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getTtsCacheSize, clearTtsCache } from '@/lib/tts-cache';

export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.isAdmin) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const size = await getTtsCacheSize();
  return NextResponse.json({ ok: true, data: size });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  await clearTtsCache();
  return NextResponse.json({ ok: true });
}
