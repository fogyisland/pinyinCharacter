import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getActiveTrack } from '@/lib/audio-tracks';

// Public endpoint — no auth. Returns the active (default) audio track
// for the sutra player. Returns 200 with data: null if no tracks exist
// so the client can show an empty state.
export async function GET() {
  return withErrorHandling(async () => {
    const track = await getActiveTrack();
    return NextResponse.json({ ok: true, data: track });
  });
}
