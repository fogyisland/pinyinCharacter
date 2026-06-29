import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getActivePlaylist } from '@/lib/playlists';

// Public endpoint — no auth. Returns the active (default) audio playlist
// for the sutra player. Returns 200 with data: null if no default playlist
// exists so the client can show an empty state.
export async function GET() {
  return withErrorHandling(async () => {
    const playlist = await getActivePlaylist();
    return NextResponse.json({ ok: true, data: playlist });
  });
}