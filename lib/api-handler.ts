import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler so that thrown errors become a 500 JSON response.
 * Business errors (4xx) should be returned explicitly by the handler.
 *
 * `init` is optional and is applied to the 500 as well - a route whose
 * responses are all `no-store` needs its errors to be `no-store` too.
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  init?: ResponseInit,
): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const e = err as Error & { ttsErrorName?: string };
    console.error('[api]', e.name, e.message);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'server',
          message: 'server error',
          ...(e.ttsErrorName ? { ttsErrorName: e.ttsErrorName } : {}),
        },
      },
      { status: 500, ...(init ?? {}) },
    );
  }
}

export function badRequest(code: string, message: string, init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 400, ...(init ?? {}) },
  );
}

export function notFound(code = 'not_found', message = 'not_found', init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 404, ...(init ?? {}) },
  );
}

export function forbidden(code = 'forbidden', message = 'forbidden', init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 403, ...(init ?? {}) },
  );
}

export function unauthorized(code = 'unauthorized', message = 'unauthorized', init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 401, ...(init ?? {}) },
  );
}

export function serviceUnavailable(code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 503 });
}

export function conflict(code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 409 });
}
