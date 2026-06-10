const last = new Map<string, number>();

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
