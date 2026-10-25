import { timingSafeEqual } from 'node:crypto';

/**
 * The MCP server's authorization.
 *
 * The site itself authenticates with a cookie session; an MCP client is a
 * program, not a browser, so it carries a Bearer token instead. The check
 * is constant-time: a token comparison that returns early on the first
 * differing byte leaks the token one byte at a time.
 */

/** The `Authorization` header's scheme this server accepts. */
const BEARER = 'bearer';

/**
 * Pull the token out of an `Authorization` header.
 *
 * Returns null when the header is missing or carries another scheme.
 */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== BEARER) return null;
  const token = parts[1].trim();
  return token === '' ? null : token;
}

/** Compare two strings without leaking their contents through the timing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // timingSafeEqual refuses buffers of different lengths. Compare the
    // buffer with itself so the work done does not depend on the secret.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Is the request authorized?
 *
 * A null token means the server runs in anonymous mode (mcp/config.ts only
 * allows that on the loopback interface) — then every request passes.
 */
export function isAuthorized(header: string | undefined, token: string | null): boolean {
  if (token === null) return true;
  const presented = extractBearer(header);
  if (presented === null) return false;
  return safeEqual(presented, token);
}
