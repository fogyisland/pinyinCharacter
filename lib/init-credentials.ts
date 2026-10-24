import { randomBytes } from 'node:crypto';

interface Credentials {
  username: string;
  password: string;
  email?: string;
  expiresAt: number;
}

/**
 * The stash lives on `globalThis`, not in a module-level `Map`.
 *
 * Why: in `next dev` the two halves of the wizard are separate route
 * entries, and the second one is compiled on demand — the dev log shows
 *
 *   ○ Compiling /api/init/create-admin ...
 *   ✓ Compiled /api/init/create-admin in 2.5s (1633 modules)
 *   POST /api/init/create-admin 401
 *
 * i.e. `create-admin` got a *different* module graph (1633 modules vs the
 * 1113 of the phase routes) and therefore its own module registry. A
 * module-level Map is instantiated once per registry, so the token that
 * `stash-admin` wrote was invisible to `create-admin` → 401 token_expired.
 * The same thing happens on every Fast Refresh / server recompile.
 *
 * `globalThis` is per-process, so the store is shared by every module
 * instance in the dev server and survives recompiles. In production
 * (single build) both routes already shared one instance, which is why
 * this only ever broke locally.
 */
interface InitCredentialGlobal {
  __pinyinInitCredentials?: {
    store: Map<string, Credentials>;
    gcStarted: boolean;
  };
}

const globalScope = globalThis as typeof globalThis & InitCredentialGlobal;

function getState(): NonNullable<InitCredentialGlobal['__pinyinInitCredentials']> {
  if (!globalScope.__pinyinInitCredentials) {
    globalScope.__pinyinInitCredentials = {
      store: new Map<string, Credentials>(),
      gcStarted: false,
    };
  }
  return globalScope.__pinyinInitCredentials;
}

const TTL_MS = 600_000;

/** Stash admin credentials and return a 32-char hex token. Token is single-use
 *  and expires after 10 minutes.
 *
 *  Why 10 minutes and not 2: step 2 (fill the form) and step 3 (press
 *  "开始初始化") are two separate human steps. The import phases in step 3
 *  alone can take minutes on a fresh database (196 classics + 7909 etymology
 *  rows), and a human needs time to read the page before clicking. A 2-minute
 *  TTL expired mid-wizard and the create-admin phase died with
 *  401 token_expired — a dead end, because the retry button replays the same
 *  stale token from sessionStorage.
 *
 *  The password NEVER leaves server memory, and the token is consumed on the
 *  first successful consume, so a long TTL does not widen the exposure. */
export function stashAdminCredentials(input: {
  username: string;
  password: string;
  email?: string;
}): string {
  ensureGcStarted();
  const token = randomBytes(16).toString('hex');
  getState().store.set(token, { ...input, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Consume a token (one-shot). Returns credentials or null on miss/expiry. */
export function consumeAdminCredentials(
  token: string,
): { username: string; password: string; email?: string } | null {
  const { store } = getState();
  const v = store.get(token);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  store.delete(token);
  return { username: v.username, password: v.password, email: v.email };
}

/** Drop entries past their TTL. Called manually by tests; auto-runs every 60s. */
export function gcExpired(): void {
  const { store } = getState();
  for (const [k, v] of store) {
    if (v.expiresAt < Date.now()) store.delete(k);
  }
}

/** Test-only: reset the in-memory store. No-op in production to prevent
 *  an RSC route handler from clearing all stashed admin credentials mid-wizard. */
export function _resetStoreForTest(): void {
  if (process.env.NODE_ENV === 'production') return;
  getState().store.clear();
}

/** Start the periodic GC interval exactly once per process. The flag lives on
 *  globalThis too, so a dev-mode module re-instantiation cannot leak orphan
 *  intervals that tick against a discarded STORE Map. */
function ensureGcStarted(): void {
  const state = getState();
  if (state.gcStarted) return;
  if (typeof setInterval === 'undefined') return;
  const handle = setInterval(gcExpired, 60_000);
  // Don't keep the process alive solely for GC
  handle.unref?.();
  state.gcStarted = true;
}
