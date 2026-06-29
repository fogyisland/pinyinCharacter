import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import {
  getPlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
} from '@/lib/playlists';
import { getTrack } from '@/lib/audio-tracks';
import { writeAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const playlistId = Number(idStr);
    if (!Number.isInteger(playlistId) || playlistId <= 0) return badRequest('validation', 'invalid id');

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest('validation', 'invalid JSON');
    }
    const trackId = Number(body.trackId);
    if (!Number.isInteger(trackId) || trackId <= 0) return badRequest('validation', 'trackId required');

    const playlist = await getPlaylist(playlistId);
    if (!playlist) return notFound('not_found', 'playlist not found');
    const track = await getTrack(trackId);
    if (!track) return notFound('not_found', 'audio track not found');

    try {
      await addTrackToPlaylist(playlistId, trackId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed to add track';
      return badRequest('conflict', msg);
    }

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.add_track',
      metadata: { playlistId, playlistTitle: playlist.title, trackId, trackTitle: track.title },
    });

    const updated = await getPlaylist(playlistId);
    return NextResponse.json({ ok: true, data: { playlist: updated } });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const playlistId = Number(idStr);
    if (!Number.isInteger(playlistId) || playlistId <= 0) return badRequest('validation', 'invalid id');

    const trackIdRaw = req.nextUrl.searchParams.get('trackId');
    const trackId = Number(trackIdRaw);
    if (!Number.isInteger(trackId) || trackId <= 0) return badRequest('validation', 'trackId required');

    const playlist = await getPlaylist(playlistId);
    if (!playlist) return notFound('not_found', 'playlist not found');
    const track = await getTrack(trackId);
    if (!track) return notFound('not_found', 'audio track not found');

    await removeTrackFromPlaylist(playlistId, trackId);

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.remove_track',
      metadata: { playlistId, playlistTitle: playlist.title, trackId, trackTitle: track.title },
    });

    const updated = await getPlaylist(playlistId);
    return NextResponse.json({ ok: true, data: { playlist: updated } });
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id: idStr } = await params;
    const playlistId = Number(idStr);
    if (!Number.isInteger(playlistId) || playlistId <= 0) return badRequest('validation', 'invalid id');

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest('validation', 'invalid JSON');
    }
    const trackIds = Array.isArray(body.trackIds) ? body.trackIds.map(Number) : null;
    if (!trackIds || !trackIds.every((n) => Number.isInteger(n) && n > 0)) {
      return badRequest('validation', 'trackIds[] of positive integers required');
    }

    const playlist = await getPlaylist(playlistId);
    if (!playlist) return notFound('not_found', 'playlist not found');

    try {
      await reorderPlaylistTracks(playlistId, trackIds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed to reorder';
      return badRequest('conflict', msg);
    }

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.playlist.reorder',
      metadata: { playlistId, playlistTitle: playlist.title, trackCount: trackIds.length },
    });

    const updated = await getPlaylist(playlistId);
    return NextResponse.json({ ok: true, data: { playlist: updated } });
  });
}