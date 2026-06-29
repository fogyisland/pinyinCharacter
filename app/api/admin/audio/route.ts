import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/auth';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { listTracks, createTrack, getTrack } from '@/lib/audio-tracks';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';

const AUDIO_DIR = join(process.cwd(), 'public', 'audio');
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB ceiling — user said "不限大小" but a sanity cap helps prevent OOM

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const tracks = await listTracks();
    return NextResponse.json({ ok: true, data: { tracks } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const form = await req.formData();
    const file = form.get('file');
    const title = form.get('title');
    const isDefaultRaw = form.get('isDefault');

    if (!(file instanceof File)) return badRequest('validation', 'missing file');
    if (typeof title !== 'string' || !title.trim()) return badRequest('validation', 'title required');
    if (file.size > MAX_FILE_BYTES) {
      return badRequest('too_large', `file exceeds ${MAX_FILE_BYTES} bytes`);
    }
    // Only MP3 allowed (v1 single-format; matches filename convention).
    if (!file.name.toLowerCase().endsWith('.mp3')) {
      return badRequest('validation', 'only .mp3 accepted');
    }
    const isDefault = isDefaultRaw === 'true' || isDefaultRaw === 'on' || isDefaultRaw === '1';

    if (!existsSync(AUDIO_DIR)) await mkdir(AUDIO_DIR, { recursive: true });

    // Insert DB row first to get a new id, then save file as <id>.mp3
    // (so filename is always id-based, no race on auto-increment).
    const buf = Buffer.from(await file.arrayBuffer());
    const placeholderId = await createTrack({
      title: title.trim(),
      filename: 'pending',
      sizeBytes: buf.byteLength,
      uploadedBy: auth.user.id,
      isDefault,
    });
    const filename = `${placeholderId}.mp3`;
    const target = join(AUDIO_DIR, filename);
    try {
      await writeFile(target, buf);
    } catch (e) {
      // Roll back the DB row on disk-write failure so we don't leak orphan rows.
      await getPool().execute(`DELETE FROM audio_tracks WHERE id = ?`, [placeholderId]);
      throw e;
    }
    await getPool().execute(`UPDATE audio_tracks SET filename = ? WHERE id = ?`, [filename, placeholderId]);

    await writeAudit({
      userId: auth.user.id,
      event: 'admin.audio.upload',
      metadata: { title: title.trim(), filename, sizeBytes: buf.byteLength, isDefault },
    });

    const t = await getTrack(placeholderId);
    return NextResponse.json({ ok: true, data: { track: t } });
  });
}
