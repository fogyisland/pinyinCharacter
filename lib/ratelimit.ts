const last = new Map<string, number>();
const attempts = new Map<string, { count: number; firstAt: number }>();

/**
 * True if this key has not hit the endpoint within `windowMs` of its last call.
 * False otherwise. In-memory only — restart wipes the window (acceptable for v1).
 */
export function checkRateLimit(key: string, windowMs: number): boolean {
  const now = Date.now();
  const prev = last.get(key);
  if (prev !== undefined && now - prev < windowMs) return false;
  last.set(key, now);
  return true;
}

/**
 * Count an attempt against `key` inside a fixed window and report whether
 * the budget is exhausted.
 *
 * Unlike `checkRateLimit`, this is a BUDGET rather than a minimum
 * interval: N attempts are allowed per window, and the counter resets
 * once the window has passed. That is the shape a brute-force defence
 * needs — "at most 10 tries per 15 minutes" — where `checkRateLimit`'s
 * "one call per window" cannot express a limit above one.
 *
 * The counter is keyed per (scope, key) pair, so a limit on one
 * endpoint never consumes another's budget.
 *
 * ⚠️ In-memory only. A restart wipes every counter. That is a real
 * limitation on a multi-instance deployment, but it is the same
 * limitation `checkRateLimit` already has, and it fails towards
 * "more attempts allowed", not towards "lockout".
 */
export function checkAttemptLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt >= windowMs) {
    attempts.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: Math.max(0, maxAttempts - 1) };
  }
  entry.count += 1;
  const allowed = entry.count <= maxAttempts;
  return { allowed, remaining: Math.max(0, maxAttempts - entry.count) };
}

/**
 * Forget the attempts recorded against `key`.
 *
 * Called after a SUCCESSFUL authentication so that a legitimate user who
 * mistyped their password a few times is not left near the limit.
 */
export function resetAttemptLimit(key: string): void {
  attempts.delete(key);
}
