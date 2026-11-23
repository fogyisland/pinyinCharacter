import { NextResponse } from 'next/server';

/**
 * How a route turns one thrown error into a different answer.
 *
 * `null` means "this error is not one I translate" — the handler then
 * falls back to its generic 500. A translator MUST only claim the errors
 * it actually understands; an error it misreads would be reported to the
 * caller as something it is not.
 */
export interface ErrorTranslation {
  /** The machine-readable code the caller sees. */
  code: string;
  /** The message the caller sees — actionable, not a stack trace. */
  message: string;
  /** The HTTP status. Defaults to 500 when the translation is applied. */
  status?: number;
}

/**
 * Wrap an API route handler so that thrown errors become a 500 JSON response.
 * Business errors (4xx) should be returned explicitly by the handler.
 *
 * `init` is optional and is applied to the 500 as well - a route whose
 * responses are all `no-store` needs its errors to be `no-store` too.
 *
 * `translate` is optional and is applied to the error BEFORE the generic
 * 500 is built: a route that can explain a particular failure (a schema
 * that is behind the code, say) turns it into an answer that says so,
 * instead of a generic "server error" that tells the caller nothing. A
 * translator that returns null leaves the generic 500 in place.
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  init?: ResponseInit,
  translate?: (error: unknown) => ErrorTranslation | null,
): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const e = err as Error & { ttsErrorName?: string };

    const translated = translate?.(err) ?? null;
    if (translated) {
      console.error('[api]', e.name, e.message, '-> translated to', translated.code);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: translated.code,
            message: translated.message,
            ...(e.ttsErrorName ? { ttsErrorName: e.ttsErrorName } : {}),
          },
        },
        { status: translated.status ?? 500, ...(init ?? {}) },
      );
    }

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

/**
 * The sentence a learner or teacher actually needs when a session expired.
 *
 * `unauthorized()` defaults to the English word "unauthorized", which is an
 * operator's vocabulary, not a student's — and several pages render
 * `error.message` straight into the UI. Every route that guards a USER-facing
 * feature should pass this instead, so the answer is always the same one
 * sentence rather than eleven slightly different ones.
 */
export const LOGIN_REQUIRED_MESSAGE = '请先登录，登录后回到本页即可。';

/** A 401 that says what to do, in the user's language. */
export function unauthorizedForLogin(init?: ResponseInit) {
  return unauthorized('unauthorized', LOGIN_REQUIRED_MESSAGE, init);
}

export function serviceUnavailable(code: string, message: string, init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 503, ...(init ?? {}) },
  );
}

export function conflict(code: string, message: string, init?: ResponseInit) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: 409, ...(init ?? {}) },
  );
}
