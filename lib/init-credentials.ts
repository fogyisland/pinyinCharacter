import { randomBytes } from 'node:crypto';

interface Credentials {
  username: string;
  password: string;
  email?: string;
  expiresAt: number;
}

const STORE = new Map<string, Credentials>();
const TTL_MS = 30_000;

/** Stash admin credentials and return a 32-char hex token. Token is single-use
 *  and expires after 30 seconds. The password NEVER leaves server memory. */
export function stashAdminCredentials(input: { username: string; password: string; email?: string }): string {
  const token = randomBytes(16).toString('hex');
  STORE.set(token, { ...input, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Consume a token (one-shot). Returns credentials or null on miss/expiry. */
export function consumeAdminCredentials(token: string): { username: string; password: string; email?: string } | null {
  const v = STORE.get(token);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    STORE.delete(token);
    return null;
  }
  STORE.delete(token);
  return { username: v.username, password: v.password, email: v.email };
}

/** Drop entries past their TTL. Called manually by tests; auto-runs every 60s. */
export function gcExpired(): void {
  for (const [k, v] of STORE) {
    if (v.expiresAt < Date.now()) STORE.delete(k);
  }
}

/** Test-only: reset the in-memory store. Not exported in production builds. */
export function _resetStoreForTest(): void {
  STORE.clear();
}

if (typeof setInterval !== 'undefined') {
  const handle = setInterval(gcExpired, 60_000);
  // Don't keep the process alive solely for GC
  handle.unref?.();
}