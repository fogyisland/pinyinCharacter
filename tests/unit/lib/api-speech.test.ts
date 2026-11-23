// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The client half of the assessment API.
 *
 * The route answers two things (`configured`, `loggedIn`) and this function
 * must pass BOTH through: collapsing them into one boolean is how the panel
 * ends up either offering a button that always 401s or hiding a feature the
 * operator already paid for.
 *
 * Every failure path must return a usable answer rather than throw: the
 * panel calls this during render, and a throw there blanks the whole page.
 */

import { assessWithAzure, fetchAssessStatus } from '@/lib/api-speech';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchAssessStatus', () => {
  it('reports both answers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { configured: true, loggedIn: true } }));
    expect(await fetchAssessStatus()).toEqual({ configured: true, loggedIn: true });
  });

  it('keeps "configured" true when the visitor is anonymous', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: { configured: true, loggedIn: false } }),
    );
    expect(await fetchAssessStatus()).toEqual({ configured: true, loggedIn: false });
  });

  it('returns both false on a non-2xx answer', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    expect(await fetchAssessStatus()).toEqual({ configured: false, loggedIn: false });
  });

  it('returns both false when the body is not the expected shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }));
    expect(await fetchAssessStatus()).toEqual({ configured: false, loggedIn: false });
  });

  it('returns both false instead of throwing when the network fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchAssessStatus()).resolves.toEqual({ configured: false, loggedIn: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('assessWithAzure', () => {
  const WAV = new ArrayBuffer(8);

  it('posts the audio with the reference in the query', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, data: { assessment: { reference: '学生', pronunciation: 90 } } }),
    );
    const result = await assessWithAzure(WAV, '学生');
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The word travels in the query, the audio in the body: an encoded word
    // in a JSON body would need the same encoding anyway, and a query keeps
    // the body a pure byte stream.
    expect(url).toBe(`/api/speech/assess?reference=${encodeURIComponent('学生')}`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
  });

  it('passes the server’s failure code through', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, error: { code: 'daily_limit', message: '今天的次数用完了' } }),
    );
    const result = await assessWithAzure(WAV, '学生');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    // The code is what lets the panel decide "retry" vs "tell the operator".
    expect(result.code).toBe('daily_limit');
    expect(result.message).toBe('今天的次数用完了');
  });

  it('reports a non-JSON answer as bad_response rather than crashing', async () => {
    // A proxy or a crashed route can answer HTML; `res.json()` would throw
    // and the panel would show nothing at all.
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const result = await assessWithAzure(WAV, '学生');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('bad_response');
    expect(result.message).toContain('502');
  });

  it('reports a network failure as a network code', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const result = await assessWithAzure(WAV, '学生');
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(result.message).toContain('offline');
  });
});
