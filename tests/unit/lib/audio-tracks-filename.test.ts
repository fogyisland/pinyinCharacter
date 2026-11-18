/**
 * `isTrackFilename` — the whitelist for a stored audio filename.
 *
 * The admin delete route hands the stored name to
 * `unlink(join(AUDIO_DIR, name))`. A name like `../../.env` would resolve
 * OUTSIDE `public/audio/` — so the check is "does it look exactly like
 * what the upload route writes" (`<id>.mp3`), not "does it look safe
 * enough".
 *
 * This test exists because the ROUTE test cannot reach the whitelist:
 * the route only sees `deleteTrack`'s `null` return, which says nothing
 * about WHICH names are refused.
 */
import { describe, it, expect, vi } from 'vitest';

// The module under test imports the db module; the pool is lazy, but
// mocking it keeps this test from ever touching a database.
vi.mock('@/lib/db', () => ({ getPool: vi.fn() }));

import { isTrackFilename } from '@/lib/audio-tracks';

describe('isTrackFilename', () => {
  it('accepts the one shape the upload route writes', () => {
    expect(isTrackFilename('7.mp3')).toBe(true);
    expect(isTrackFilename('0.mp3')).toBe(true);
    expect(isTrackFilename('123.mp3')).toBe(true);
  });

  it('rejects a name that would resolve outside the audio directory', () => {
    expect(isTrackFilename('../../.env')).toBe(false);
    expect(isTrackFilename('../secrets.txt')).toBe(false);
    expect(isTrackFilename('/etc/passwd')).toBe(false);
    expect(isTrackFilename('sub/dir/7.mp3')).toBe(false);
  });

  it('rejects a name that is not an mp3 this module wrote', () => {
    expect(isTrackFilename('7.wav')).toBe(false);
    expect(isTrackFilename('7')).toBe(false);
    expect(isTrackFilename('seven.mp3')).toBe(false);
    expect(isTrackFilename('7.mp3.gz')).toBe(false);
    expect(isTrackFilename('')).toBe(false);
  });
});
