import { NextResponse } from 'next/server';
import { getCurrentUserWithAdmin } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUserWithAdmin();
  // "no session" is a state, not an error — return 200 with user:null so the
  // browser console doesn't fill with 401s for every guest page load.
  if (!user) {
    return NextResponse.json({ ok: true, data: { user: null } });
  }
  return NextResponse.json({ ok: true, data: { user } });
}
