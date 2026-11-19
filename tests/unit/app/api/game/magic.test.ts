/**
 * GET /api/game/magic — the one-stroke relation table.
 *
 * The table is a build product of `scripts/build-magic-chars.ts`. When it
 * has not been built the route must answer with a clear error, not a
 * stack trace: the fix is one command, and the person who sees the
 * message is the one who can run it.
 *
 * The handler is called directly — no server is started. The reader is
 * mocked, so the test needs no built table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/magic-char-data', () => ({
  getMagicTable: vi.fn(),
}));

import { getMagicTable } from '@/lib/magic-char-data';
import { GET } from '@/app/api/game/magic/route';

describe('GET /api/game/magic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('answers with the table', async () => {
    vi.mocked(getMagicTable).mockReturnValue({ 大: { 太: 'add' } });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.table['大']['太']).toBe('add');
  });

  it('does not let the browser cache it', async () => {
    vi.mocked(getMagicTable).mockReturnValue({});
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers with an error when the table cannot be read', async () => {
    vi.mocked(getMagicTable).mockImplementation(() => {
      throw new Error('the table is missing');
    });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('magic_table_unavailable');
  });

  it('logs the reason the table could not be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getMagicTable).mockImplementation(() => {
      throw new Error('the table is missing');
    });
    await GET();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
