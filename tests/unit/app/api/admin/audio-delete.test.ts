/**
 * DELETE /api/admin/audio/[id] — the file removal.
 *
 * The route deletes the DB row and then removes the file from
 * `public/audio/`. The file removal is a BEST-EFFORT step: the row is
 * gone either way, and a failure there must not fail the request.
 *
 * ⚠️ But "best effort" used to mean "silent". The old code swallowed
 * EVERY fs error:
 *
 *     try {
 *       await unlink(filePath);
 *     } catch {
 *       // swallow ENOENT and other fs errors
 *     }
 *
 * ENOENT (the file was already gone) is normal. `EACCES` / `EPERM` /
 * `EISDIR` are not: they mean the file is STILL ON DISK while its row is
 * gone — an orphan that will never be cleaned up, and nobody would ever
 * know. That has to leave a trace in the log.
 *
 * These tests pin the three cases: ENOENT is quiet, anything else is
 * logged, and a row whose filename is not one this module wrote is never
 * handed to `unlink` at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const unlinkMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/audio-tracks', () => ({
  getTrack: vi.fn(),
  updateTrack: vi.fn(),
  deleteTrack: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(),
}));

import { DELETE } from '@/app/api/admin/audio/[id]/route';
import { requireAdmin } from '@/lib/auth';
import { deleteTrack } from '@/lib/audio-tracks';
import { writeAudit } from '@/lib/audit';

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedDeleteTrack = vi.mocked(deleteTrack);
const mockedWriteAudit = vi.mocked(writeAudit);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
  mockedWriteAudit.mockResolvedValue(undefined);
});

function del(id: number): NextRequest {
  return new NextRequest(`http://localhost/api/admin/audio/${id}`, { method: 'DELETE' });
}

describe('DELETE /api/admin/audio/[id]', () => {
  it('removes the file of a deleted track', async () => {
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    unlinkMock.mockResolvedValue(undefined);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(String(unlinkMock.mock.calls[0][0])).toContain('7.mp3');
  });

  it('does not fail the request when the file is already gone', async () => {
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    unlinkMock.mockRejectedValue(enoent);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(200);
  });

  it('logs a failure that is not ENOENT', async () => {
    // The row is gone but the file is still on disk: an orphan that will
    // never be cleaned up. That has to leave a trace.
    mockedDeleteTrack.mockResolvedValue({ filename: '7.mp3' });
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    unlinkMock.mockRejectedValue(eacces);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

      // The request still succeeds — the row IS gone.
      expect(res.status).toBe(200);
      // But the failure was reported.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('EACCES');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not touch the disk when the row was not deleted', async () => {
    // `deleteTrack` returns null for a row it refused to delete — a row
    // whose filename is not the `<id>.mp3` this module writes. Nothing may
    // be unlinked in that case: the name might point outside public/audio.
    mockedDeleteTrack.mockResolvedValue(null);

    const res = await DELETE(del(7), { params: Promise.resolve({ id: '7' }) });

    expect(res.status).toBe(404);
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
