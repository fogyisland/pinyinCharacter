import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler so that thrown errors become a 500 JSON response.
 * Business errors (4xx) should be returned explicitly by the handler.
 */
export async function withErrorHandling<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
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
      { status: 500 }
    );
  }
}

export function badRequest(code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 400 });
}

export function notFound(code = 'not_found', message = 'not_found') {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 404 });
}

export function forbidden(code = 'forbidden', message = 'forbidden') {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 403 });
}

export function unauthorized(code = 'unauthorized', message = 'unauthorized') {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 401 });
}

export function serviceUnavailable(code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 503 });
}

export function conflict(code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 409 });
}
