import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler so that thrown errors become a 500 JSON response.
 * Business errors (4xx) should be returned explicitly by the handler.
 */
export async function withErrorHandling<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    console.error('[api]', err);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export function notFound(message = 'not_found') {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export function forbidden(message = 'forbidden') {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export function unauthorized(message = 'unauthorized') {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}
