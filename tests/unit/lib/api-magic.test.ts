/**
 * lib/api-magic.ts — asking the server for the relation table.
 *
 * The table is several megabytes, so it is not bundled into the client.
 * The client asks for it once, when the game starts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMagicTable } from '@/lib/api-magic';

describe('fetchMagicTable', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('asks the server for the table', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { table: { 大: { 太: 'add' } } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const table = await fetchMagicTable();
    expect(table['大']['太']).toBe('add');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/game/magic');
  });

  it('says the server refused when it answers with an error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('', { status: 500 }));
    await expect(fetchMagicTable()).rejects.toThrow(/500/);
  });

  it('says the answer was malformed when the table is missing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(fetchMagicTable()).rejects.toThrow(/malformed/);
  });

  it('says the answer was malformed when the server reports a failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'x', message: 'y' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(fetchMagicTable()).rejects.toThrow(/malformed/);
  });
});
