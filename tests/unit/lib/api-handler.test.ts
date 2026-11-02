import { describe, it, expect, vi, afterEach } from 'vitest';
import { conflict, withErrorHandling } from '@/lib/api-handler';

/**
 * The shared API response helpers (`lib/api-handler.ts`).
 *
 * ⚠️ This file exists because the shared helper was changed — `conflict()`
 * gained an optional `init?: ResponseInit` so that a route whose responses
 * are all `no-store` can say so on its 409 as well — and that change had NO
 * test net at all. `grep -rn "conflict" tests/unit/` used to return zero
 * hits.
 *
 * What is pinned here:
 *
 *  - the STATUS and the BODY shape of a 409 (the admin pages branch on
 *    `error.code`, so a change there would silently break them);
 *  - that the optional `init` is BACKWARD COMPATIBLE: a caller that does
 *    not pass one gets exactly the old response, with no `cache-control`
 *    header at all;
 *  - that `withErrorHandling` turns a thrown error into a 500 whose body
 *    carries no internal detail.
 *
 * ⚠️ The responses are `NextResponse` objects ⇒ the headers are read with
 * `response.headers.get('cache-control')`, NOT `response.headers['cache-control']`
 * (the latter is a plain object access and always answers `undefined`).
 */

/** The error shape the admin pages read. */
type ErrorBody = {
  ok: boolean;
  error: { code: string; message: string };
};

afterEach(() => {
  // `withErrorHandling` logs the error it caught; keep the test output
  // readable instead of filling it with stack traces.
  vi.restoreAllMocks();
});

describe('conflict', () => {
  it('answers 409 with the code and the message, and no cache header', async () => {
    const res = conflict('some_code', 'some message');
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: { code: 'some_code', message: 'some message' },
    });
    // ⚠️ Backward compatibility: a caller that does not ask for caching
    // headers must not get one — the old behaviour is unchanged.
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('answers 409 with the given response init', async () => {
    const res = conflict('some_code', 'some message', {
      headers: { 'Cache-Control': 'no-store' },
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: { code: 'some_code', message: 'some message' },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('withErrorHandling', () => {
  it('turns a thrown error into a 500 that leaks nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await withErrorHandling(async () => {
      throw new Error('boom');
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: { code: 'server', message: 'server error' },
    });
    // ⚠️ The internal message must NOT reach the client — it can carry
    // paths and query fragments.
    expect(JSON.stringify(body)).not.toContain('boom');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
