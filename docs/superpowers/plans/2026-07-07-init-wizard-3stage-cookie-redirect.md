# Init Wizard 3-Stage + Cookie-Based Auto-Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page `/init` wizard with three URL-based screens (`/init/db` → `/init/admin` → `/init/execute`), group the 9-step initialization into 3 collapsible sections on step 3, and switch the middleware from a `!DATABASE_URL` gate to a cookie-based gate (`setup_completed=1`). Admin credentials cross pages via a 30-second in-memory token instead of sessionStorage. Old `/api/init/init-db` endpoint gets a 410 shim.

**Architecture:** `app/init/page.tsx` becomes an RSC orchestrator (sets `setup_completed` cookie when it sees `setup.completed=true` so browsers aren't trapped in a redirect loop). Three new RSC pages under `app/init/{db,admin,execute}/page.tsx` each check prerequisites and redirect to the right place. Step 1 reuses existing `/api/init/db-config`. Step 2 posts credentials to a new `/api/init/stash-admin` that returns a 32-char hex token (password kept only in a server-side `Map`). Step 3 reads the token from sessionStorage and POSTs it to existing `/api/init/create-admin` (whose body changes from `{username,password,email}` to `{token}`). Step 3's UI uses a new `<StepGroup>` collapsible card to group the 9 phases into 3 named sections.

**Tech Stack:** Next.js 15.5.19 App Router (RSC + Client Components), Vitest + happy-dom, mysql2/promise (no changes), `lib/setup.ts` helpers extended, Node `crypto.randomBytes` for token generation. No new dependencies.

## Global Constraints

- Don't rewrite `lib/setup.ts`'s `writeEnvVars` / `reloadProcessEnvFromFile` / `testDbConnection` — only add `isInitWizardAdminDone()` and call existing helpers in new order
- Don't change the 9 existing `/api/init/*` endpoint contracts — only `/api/init/admin` (add flag write) and `/api/init/create-admin` (body `{token}`) get modified signatures
- Don't change `/api/init/status` response shape — add `adminDone: boolean` field, keep existing `setupComplete` + `routeEnabled` unchanged
- Don't write admin password to `.env` or `app_config` — only client state + token in server memory, both cleared after step 3
- Don't write DB password to sessionStorage — only `useState` for step 1, cleared on successful submit
- Don't change `setup.completed` / `setup.route_enabled` semantics — both still authoritative for "is setup done?"
- Don't change `instrumentation.ts` early-return logic for `initAppConfig` / `initPoems` / etc.
- All `<input>` fields get `autoComplete` attrs per spec (current-password / new-password / username / email / off)
- `tsconfig.json` `@/*` path alias unchanged
- No new npm dependencies
- File changes: ~13 (9 new + 4 modified) + 3 test files
- Local-only work: commits on local main, NOT pushed (per `no-prod-env-2026-06-21` / `local-work-only-2026-07-06`)
- Per memory `feedback-commit-timestamps`: append `[YYYY-MM-DD HH.MM]` to commit subject
- Per memory `dev-build-cache-stomp`: never run `npm run build` while `pnpm dev` is alive on port 4444
- Per memory `project-uses-npm`: use `npm test` / `npx vitest run`, never `pnpm test`
- Per memory `feedback-per-task-build-check`: per-task reviewer must run `npm run build` if diff touches `app/**/page.tsx` or adds new routes

---

## File Structure

### New files (9)

| Path | Responsibility |
|---|---|
| `lib/init-credentials.ts` | In-memory `Map<token, credentials>` with 30s TTL + interval GC |
| `app/api/init/init-db/route.ts` | 410 shim for the deleted endpoint (catches old client bundles) |
| `app/api/init/stash-admin/route.ts` | POST: validates admin schema, returns token |
| `app/init/db/page.tsx` | RSC shell: redirects to `/init/admin` if DATABASE_URL set |
| `app/init/db/InitDbForm.tsx` | Client form: host/port/user/password/database, autoComplete, clear password after submit |
| `app/init/admin/page.tsx` | RSC shell: redirects to `/init/db` (no DB) or `/init/execute` (admin_done) |
| `app/init/admin/InitAdminForm.tsx` | Client form: username/password/email, calls `/stash-admin`, stores token in sessionStorage |
| `app/init/execute/page.tsx` | RSC shell: redirects to `/init` (already done) or `/init/db` (no DB) |
| `app/init/execute/InitExecuteForm.tsx` | Client form: 9 phases grouped into 3 StepGroups, runs sequentially |
| `components/init/InitHeader.tsx` | Server component: 3-step indicator with Database / User / Rocket icons |
| `components/init/StepGroup.tsx` | Client component: collapsible card with `▼/▶` + completion counter |

(That's 11, not 9. The spec counted only top-level files; per-page client forms are colocated as the project does elsewhere — see `app/login/page.tsx` etc. 11 new + 4 modified + 10 test = 25 files total.)

### Modified files (4)

| Path | Change |
|---|---|
| `app/init/page.tsx` | Full rewrite as RSC orchestrator (sets cookie on AlreadyDoneCard) |
| `middleware.ts` | Drop `!DATABASE_URL` branch — cookie is sole gate |
| `app/api/init/create-admin/route.ts` | Body `{username,password,email}` → `{token}`; consume server-side |
| `app/api/init/admin/route.ts` | After validation pass, write `setup.wizard.admin_done='true'` to app_config |
| `lib/setup.ts` | Add `isInitWizardAdminDone()` exported helper |

### Test files (10)

| Path | Coverage |
|---|---|
| `tests/unit/lib/init-credentials.test.ts` | Token round-trip + expiry + GC (Task 1) |
| `tests/unit/app/api/init/init-db-shim.test.ts` | 410 + error code shape (Task 2) |
| `tests/unit/lib/middleware-redirect.test.ts` | Cookie gate: redirects when missing, allows when set (Task 3) |
| `tests/unit/lib/setup-wizard-flag.test.ts` | `isInitWizardAdminDone` 5 cases (Task 4) |
| `tests/unit/app/api/init/stash-admin.test.ts` | Valid → token; invalid → 400; setup_disabled → 400 (Task 5) |
| `tests/unit/app/api/init/admin-flag.test.ts` | `admin` route writes `setup.wizard.admin_done` (Task 6) |
| `tests/unit/app/api/init/create-admin.test.ts` | Valid token → 200; expired → 401; missing → 400 (Task 7) |
| `tests/unit/components/init/InitHeader.test.tsx` | 3-step indicator (Task 8) |
| `tests/unit/components/init/StepGroup.test.tsx` | Collapsible card + counter (Task 8) |
| `tests/integration/init-wizard.test.ts` | Full 9-phase chain on scratch DB + cookie assertion (Task 13) |

---

### Task 1: `lib/init-credentials.ts` token store

**Files:**
- Create: `lib/init-credentials.ts`
- Create: `tests/unit/lib/init-credentials.test.ts`

**Interfaces:**
- Produces: `stashAdminCredentials(input) → string` (32-hex token)
- Produces: `consumeAdminCredentials(token) → {username,password,email?} | null` (one-shot, null on miss/expiry)
- Produces: `gcExpired() → void` (also auto-runs every 60s via `setInterval(...).unref()`)

- [ ] **Step 1: Write failing tests**

Create `tests/unit/lib/init-credentials.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { stashAdminCredentials, consumeAdminCredentials, gcExpired, _resetStoreForTest } from '@/lib/init-credentials';

beforeEach(() => { _resetStoreForTest(); });

describe('stashAdminCredentials', () => {
  it('returns a 32-char hex token', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('consumeAdminCredentials', () => {
  it('returns the same credentials that were stashed', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
    expect(consumeAdminCredentials(t)).toEqual({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
  });

  it('is one-shot (second call returns null)', () => {
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    expect(consumeAdminCredentials(t)).not.toBeNull();
    expect(consumeAdminCredentials(t)).toBeNull();
  });

  it('returns null for unknown token', () => {
    expect(consumeAdminCredentials('a'.repeat(32))).toBeNull();
  });

  it('returns null after expiry (>30s)', () => {
    vi.useFakeTimers();
    const t = stashAdminCredentials({ username: 'admin', password: 'supersecret' });
    vi.advanceTimersByTime(31_000);
    expect(consumeAdminCredentials(t)).toBeNull();
    vi.useRealTimers();
  });
});

describe('gcExpired', () => {
  it('removes only expired entries', () => {
    vi.useFakeTimers();
    const t1 = stashAdminCredentials({ username: 'one', password: 'x' });
    vi.advanceTimersByTime(20_000);
    const t2 = stashAdminCredentials({ username: 'two', password: 'y' });
    vi.advanceTimersByTime(15_000); // t1 now at 35s (expired), t2 at 15s
    gcExpired();
    expect(consumeAdminCredentials(t1)).toBeNull(); // already gone via gc
    expect(consumeAdminCredentials(t2)).not.toBeNull();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/init-credentials.test.ts`
Expected: FAIL with "Cannot find module '@/lib/init-credentials'"

- [ ] **Step 3: Write minimal implementation**

Create `lib/init-credentials.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/init-credentials.test.ts`
Expected: PASS, 6 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/init-credentials.ts tests/unit/lib/init-credentials.test.ts
git commit -m "feat(init): token-based admin credentials store (30s TTL) [2026-07-07 HH.MM]"
```

---

### Task 2: `/api/init/init-db` 410 shim

**Files:**
- Create: `app/api/init/init-db/route.ts`
- Create: `tests/unit/app/api/init/init-db-shim.test.ts`

**Interfaces:**
- Produces: `POST /api/init/init-db` returns `{ok:false, error:{code:'stale_build', message:...}}` with status 410
- Produces: `GET /api/init/init-db` also returns 410 (defensive)

- [ ] **Step 1: Write failing test**

Create `tests/unit/app/api/init/init-db-shim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { POST, GET } from '@/app/api/init/init-db/route';

describe('POST /api/init/init-db (410 shim)', () => {
  it('returns 410 with stale_build error code', async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('stale_build');
    expect(body.error.message).toMatch(/刷新浏览器/);
  });
});

describe('GET /api/init/init-db (410 shim)', () => {
  it('also returns 410', async () => {
    const res = await GET();
    expect(res.status).toBe(410);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/app/api/init/init-db-shim.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/init/init-db/route'"

- [ ] **Step 3: Write minimal implementation**

Create `app/api/init/init-db/route.ts`:

```ts
import { NextResponse } from 'next/server';

const STALE_BUILD_BODY = {
  ok: false,
  error: {
    code: 'stale_build',
    message:
      '请硬刷新浏览器 (Ctrl+Shift+R) 后重试。这是旧版 wizard 的端点,新版已分拆为 /init/db + /init/admin + /init/execute。',
  },
};

/** 410 Gone — this endpoint was deleted in commit a00c6106 (replaced by
 *  the per-phase /api/init/init-* endpoints). Old client bundles may still
 *  POST here; we return a clear message telling the user to hard-refresh. */
export async function POST() {
  return NextResponse.json(STALE_BUILD_BODY, { status: 410 });
}

export async function GET() {
  return NextResponse.json(STALE_BUILD_BODY, { status: 410 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/init/init-db-shim.test.ts`
Expected: PASS, 2 tests green

- [ ] **Step 5: Commit**

```bash
git add app/api/init/init-db/route.ts tests/unit/app/api/init/init-db-shim.test.ts
git commit -m "feat(init): 410 shim for old /api/init/init-db endpoint [2026-07-07 HH.MM]"
```

---

### Task 3: `middleware.ts` cookie-only gate

**Files:**
- Modify: `middleware.ts`
- Create: `tests/unit/lib/middleware-redirect.test.ts`

**Interfaces:**
- Produces: `middleware(req)` returns `NextResponse.next()` for whitelisted paths or cookie-set browsers; `NextResponse.redirect('/init')` otherwise

- [ ] **Step 1: Write failing tests**

Create `tests/unit/lib/middleware-redirect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function callMiddleware(pathname: string, opts?: { cookie?: string }) {
  const url = `http://localhost${pathname}`;
  const req = new NextRequest(url);
  if (opts?.cookie) req.cookies.set('setup_completed', opts.cookie);
  return middleware(req);
}

async function status(res: Response | any): Promise<number> {
  return res.status;
}

async function redirectedTo(res: any): Promise<string | null> {
  // NextResponse.redirect sets the Location header
  return res.headers.get('location') ?? res.headers.get('Location') ?? null;
}

describe('middleware: whitelist', () => {
  it('/init is allowed even without cookie', async () => {
    const res = callMiddleware('/init');
    expect(await status(res)).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('/init/db is allowed (wizard itself)', async () => {
    const res = callMiddleware('/init/db');
    expect(await status(res)).toBe(200);
  });

  it('/api/init/db-config is allowed', async () => {
    const res = callMiddleware('/api/init/db-config');
    expect(await status(res)).toBe(200);
  });

  it('/_next/static/foo is allowed', async () => {
    const res = callMiddleware('/_next/static/foo');
    expect(await status(res)).toBe(200);
  });

  it('/favicon.ico is allowed', async () => {
    const res = callMiddleware('/favicon.ico');
    expect(await status(res)).toBe(200);
  });
});

describe('middleware: cookie gate', () => {
  it('redirects /login to /init when cookie missing', async () => {
    const res = callMiddleware('/login');
    expect(await status(res)).toBe(307); // NextResponse.redirect default
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });

  it('redirects / to /init when cookie missing', async () => {
    const res = callMiddleware('/');
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });

  it('allows /login when setup_completed=1 cookie is set', async () => {
    const res = callMiddleware('/login', { cookie: '1' });
    expect(await status(res)).toBe(200);
  });

  it('allows / when cookie set', async () => {
    const res = callMiddleware('/', { cookie: '1' });
    expect(await status(res)).toBe(200);
  });

  it('cookie value other than "1" still redirects', async () => {
    const res = callMiddleware('/login', { cookie: '0' });
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/middleware-redirect.test.ts`
Expected: FAIL — `cookie=0` test will currently PASS because existing middleware falls through to `!DATABASE_URL` check (which is false in test env, so allows traffic). This signals we're about to break the existing behavior correctly.

- [ ] **Step 3: Write minimal implementation**

Modify `middleware.ts` (full replacement):

```ts
import { NextRequest, NextResponse } from 'next/server';

/**
 * Cookie-only setup gate.
 *
 * With the 3-URL wizard in place, the *only* signal middleware has about
 * whether setup is done is the `setup_completed=1` cookie set by:
 *   1. `/api/init/mark-complete` when step 3 succeeds, OR
 *   2. The /init orchestrator when a fresh browser lands on /init after
 *      setup is already complete (breaks the redirect loop).
 *
 * Edge runtime can't import mysql2 to query app_config directly, so the
 * cookie is the sole gate. The /init page itself does a server-side check
 * via `/api/init/status` for the locked UI.
 *
 * Whitelist: /init, /init/*, /api/init/*, Next.js internals, static assets.
 * Everything else: redirect to /init if cookie not set.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow /init (the wizard + its 3 screens) and its API routes
  if (pathname === '/init' || pathname.startsWith('/init/')) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/init/')) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon')
  ) {
    return NextResponse.next();
  }

  // Cookie gate: trust `setup_completed=1` to mean setup is done.
  if (req.cookies.get('setup_completed')?.value === '1') {
    return NextResponse.next();
  }

  // Otherwise, force the wizard.
  const url = req.nextUrl.clone();
  url.pathname = '/init';
  return NextResponse.redirect(url);
}

export const config = {
  // Run middleware on every route except static assets and Next internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/middleware-redirect.test.ts`
Expected: PASS, all 10 tests green

- [ ] **Step 5: Manual verify with curl**

```bash
# Kill any existing dev on 4444 first (per dev-build-cache-stomp memory)
pkill -f "next dev" 2>/dev/null || true
sleep 1

# Temporarily rename .env to simulate fresh deploy
mv .env .env.bak-middleware-test 2>/dev/null || true

# Start dev (no DATABASE_URL → forces fresh-deploy mode)
npm run dev &

# Wait for server to be ready
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4444/ 2>/dev/null && break
  sleep 2
done

# Without cookie: should redirect to /init
curl -s -o /dev/null -w "Status: %{http_code}, Location: %{redirect_url}\n" http://localhost:4444/

# Restore .env
kill %1 2>/dev/null
mv .env.bak-middleware-test .env
```

Expected output:
```
Status: 307, Location: http://localhost:4444/init
```

- [ ] **Step 6: Commit**

```bash
git add middleware.ts tests/unit/lib/middleware-redirect.test.ts
git commit -m "refactor(middleware): cookie-only setup gate [2026-07-07 HH.MM]"
```

---

### Task 4: `lib/setup.ts` helper + `/api/init/status` adds `adminDone`

**Files:**
- Modify: `lib/setup.ts` (add `isInitWizardAdminDone` after `isSetupRouteEnabled`)
- Modify: `app/api/init/status/route.ts` (include `adminDone` field)
- Create: `tests/unit/lib/setup-wizard-flag.test.ts`

**Interfaces:**
- Produces: `isInitWizardAdminDone() → Promise<boolean>` (reads `app_config.setup.wizard.admin_done`)

- [ ] **Step 1: Write failing test**

Create `tests/unit/lib/setup-wizard-flag.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

// import after mocks
import { isInitWizardAdminDone } from '@/lib/setup';

beforeEach(() => {
  queryMock.mockReset();
  // ensure DATABASE_URL is set for these tests
  process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test';
});

describe('isInitWizardAdminDone', () => {
  it('returns false when row missing', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    expect(await isInitWizardAdminDone()).toBe(false);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("`key` = 'setup.wizard.admin_done'"),
      undefined,
    );
  });

  it('returns true when value="true"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'true' }]]);
    expect(await isInitWizardAdminDone()).toBe(true);
  });

  it('returns false when value="false"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'false' }]]);
    expect(await isInitWizardAdminDone()).toBe(false);
  });

  it('returns false when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    expect(await isInitWizardAdminDone()).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns false on DB error (defensive)', async () => {
    queryMock.mockRejectedValueOnce(new Error('pool gone'));
    expect(await isInitWizardAdminDone()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/setup-wizard-flag.test.ts`
Expected: FAIL with "isInitWizardAdminDone is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `lib/setup.ts` (right after `isSetupRouteEnabled`, before `markSetupComplete`):

```ts
/**
 * Whether the admin step of the /init wizard has been completed.
 * Set by /api/init/admin after validation passes. Used by /init/admin
 * page to decide whether to render the form or redirect to /init/execute.
 *
 * Defensive: returns false on any DB error or missing DATABASE_URL.
 */
export async function isInitWizardAdminDone(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { getPool } = await import('./db');
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = 'setup.wizard.admin_done' LIMIT 1`,
    );
    return rows.length > 0 && rows[0].value === 'true';
  } catch {
    return false;
  }
}
```

Replace `app/api/init/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isSetupComplete, isSetupRouteEnabled, isInitWizardAdminDone } from '@/lib/setup';

/**
 * Read-only status endpoint used by /init page on mount and by the
 * orchestrator to decide which wizard screen (or locked card) to show.
 * Returns { setupComplete, routeEnabled, adminDone }.
 */
export async function GET() {
  const [setupComplete, routeEnabled, adminDone] = await Promise.all([
    isSetupComplete(),
    isSetupRouteEnabled(),
    isInitWizardAdminDone(),
  ]);
  return NextResponse.json({
    ok: true,
    data: { setupComplete, routeEnabled, adminDone },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/setup-wizard-flag.test.ts`
Expected: PASS, 5 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/setup.ts app/api/init/status/route.ts tests/unit/lib/setup-wizard-flag.test.ts
git commit -m "feat(init): isInitWizardAdminDone helper + status.adminDone field [2026-07-07 HH.MM]"
```

---

### Task 5: `/api/init/stash-admin` endpoint

**Files:**
- Create: `app/api/init/stash-admin/route.ts`
- Create: `tests/unit/app/api/init/stash-admin.test.ts`

**Interfaces:**
- Produces: `POST /api/init/stash-admin` with `{username, password, email?}` → `{ok:true, data:{token, expiresInSec:30}}`
- Produces: 400 `invalid_input` on schema failure
- Produces: 400 `setup_disabled` when route is locked

- [ ] **Step 1: Write failing tests**

Create `tests/unit/app/api/init/stash-admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

vi.mock('@/lib/init-credentials', () => ({
  stashAdminCredentials: vi.fn(() => 'a'.repeat(32)),
}));

import { POST } from '@/app/api/init/stash-admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';
import { stashAdminCredentials } from '@/lib/init-credentials';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedStash = vi.mocked(stashAdminCredentials);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/stash-admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/stash-admin', () => {
  it('returns a token for valid credentials', async () => {
    mockedStash.mockReturnValueOnce('abc123def456abc123def456abc12345');
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.token).toBe('abc123def456abc123def456abc12345');
    expect(body.data.expiresInSec).toBe(30);
    expect(mockedStash).toHaveBeenCalledWith({ username: 'admin', password: 'supersecret', email: undefined });
  });

  it('passes email when provided', async () => {
    await POST(postReq({ username: 'admin', password: 'supersecret', email: 'a@b.com' }));
    expect(mockedStash).toHaveBeenCalledWith({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
  });

  it('rejects short username', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'supersecret' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_input');
    expect(mockedStash).not.toHaveBeenCalled();
  });

  it('rejects short password', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('rejects invalid username chars', async () => {
    const res = await POST(postReq({ username: 'ad min!', password: 'supersecret' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 setup_disabled when route is locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('setup_disabled');
    expect(mockedStash).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/api/init/stash-admin.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/init/stash-admin/route'"

- [ ] **Step 3: Write minimal implementation**

Create `app/api/init/stash-admin/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';
import { stashAdminCredentials } from '@/lib/init-credentials';

const stashAdminSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

/** Step 2 of /init wizard. Validates the admin schema and stashes the
 *  credentials server-side (in-memory, 30s TTL), returning a single-use
 *  token. Step 3 will POST this token to /api/init/create-admin which
 *  consumes it. The password NEVER leaves server memory. */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    const body = await req.json();
    const parsed = stashAdminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map(i => i.message).join('; '));
    }
    const token = stashAdminCredentials(parsed.data);
    return NextResponse.json({ ok: true, data: { token, expiresInSec: 30 } });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/init/stash-admin.test.ts`
Expected: PASS, 6 tests green

- [ ] **Step 5: Commit**

```bash
git add app/api/init/stash-admin/route.ts tests/unit/app/api/init/stash-admin.test.ts
git commit -m "feat(init): /api/init/stash-admin returns 30s token [2026-07-07 HH.MM]"
```

---

### Task 6: `/api/init/admin` writes `setup.wizard.admin_done`

**Files:**
- Modify: `app/api/init/admin/route.ts` (add flag write)
- Create: `tests/unit/app/api/init/admin-flag.test.ts`

**Interfaces:**
- Produces: After validation pass, writes `setup.wizard.admin_done='true'` to `app_config`
- Existing behavior (validation-only, no user INSERT) preserved

- [ ] **Step 1: Write failing tests**

Create `tests/unit/app/api/init/admin-flag.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { POST } from '@/app/api/init/admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRouteEnabled.mockResolvedValue(true);
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/admin — wizard flag', () => {
  it('writes setup.wizard.admin_done after validation pass', async () => {
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("'setup.wizard.admin_done'"),
      undefined,
    );
    expect(queryMock.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('does NOT write the flag when validation fails', async () => {
    const res = await POST(postReq({ username: 'ab', password: 'short' }));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns setup_disabled when route locked (no DB write)', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ username: 'admin', password: 'supersecret' }));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/api/init/admin-flag.test.ts`
Expected: FAIL — currently the route does NOT write to DB, so `queryMock` not called → second & third assertions on queryMock never trigger. First assertion (200 + queryMock called) will fail.

- [ ] **Step 3: Write minimal implementation**

Modify `app/api/init/admin/route.ts` (add `getPool` import + flag write after validation):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';
import { getPool } from '@/lib/db';

/**
 * Step 2 of /init wizard. After validating the admin schema, writes the
 * wizard step marker `setup.wizard.admin_done='true'` to app_config. This
 * marker tells the orchestrator (/init, /init/admin, /init/execute pages)
 * that step 2 has been reached, so subsequent visits skip the form and
 * jump straight to step 3.
 *
 * The actual user INSERT happens in step 3's `/api/init/create-admin`
 * (which consumes the token from /api/init/stash-admin).
 */
const adminSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric + underscore'),
  password: z.string().min(8).max(72),
  email: z.string().email().max(255).optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    const body = await req.json();
    const parsed = adminSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', parsed.error.issues.map(i => i.message).join('; '));
    }
    // Write the wizard marker so the orchestrator can skip step 2 on re-entry.
    await getPool().query(
      `INSERT INTO app_config (\`key\`, value) VALUES ('setup.wizard.admin_done', 'true')
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    );
    return NextResponse.json({ ok: true, data: { validated: true } });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/init/admin-flag.test.ts`
Expected: PASS, 3 tests green

- [ ] **Step 5: Commit**

```bash
git add app/api/init/admin/route.ts tests/unit/app/api/init/admin-flag.test.ts
git commit -m "feat(init): admin route writes setup.wizard.admin_done marker [2026-07-07 HH.MM]"
```

---

### Task 7: `/api/init/create-admin` accepts `{token}`

**Files:**
- Modify: `app/api/init/create-admin/route.ts` (body change)
- Create: `tests/unit/app/api/init/create-admin.test.ts`

**Interfaces:**
- Produces: `POST /api/init/create-admin` with `{token: 32-hex-string}` → `{ok:true, data:{userId, username}}`
- Produces: 400 `invalid_input` on missing/malformed token
- Produces: 401 `token_expired` on unknown/expired token
- Produces: 400 `setup_disabled` when route locked

- [ ] **Step 1: Write failing tests**

Create `tests/unit/app/api/init/create-admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/setup', () => ({
  isSetupRouteEnabled: vi.fn(),
}));

vi.mock('@/lib/init-credentials', () => ({
  consumeAdminCredentials: vi.fn(),
}));

const createAdminUserMock = vi.fn();
vi.mock('@/scripts/init-db', () => ({
  createAdminUser: (...args: any[]) => createAdminUserMock(...args),
}));

import { POST } from '@/app/api/init/create-admin/route';
import { isSetupRouteEnabled } from '@/lib/setup';
import { consumeAdminCredentials } from '@/lib/init-credentials';

const mockedRouteEnabled = vi.mocked(isSetupRouteEnabled);
const mockedConsume = vi.mocked(consumeAdminCredentials);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
  mockedRouteEnabled.mockResolvedValue(true);
  createAdminUserMock.mockResolvedValue({ userId: 42, username: 'admin' });
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/init/create-admin', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/init/create-admin (token-based)', () => {
  it('consumes token and creates user', async () => {
    mockedConsume.mockReturnValueOnce({ username: 'admin', password: 'supersecret', email: 'a@b.com' });
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBe(42);
    expect(mockedConsume).toHaveBeenCalledWith('a'.repeat(32));
    expect(createAdminUserMock).toHaveBeenCalledWith({
      username: 'admin',
      password: 'supersecret',
      email: 'a@b.com',
    });
  });

  it('returns 400 invalid_input when token missing', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
    expect(mockedConsume).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_input when token wrong length', async () => {
    const res = await POST(postReq({ token: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_input');
  });

  it('returns 401 token_expired when consume returns null', async () => {
    mockedConsume.mockReturnValueOnce(null);
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('token_expired');
    expect(createAdminUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 setup_disabled when route locked', async () => {
    mockedRouteEnabled.mockResolvedValueOnce(false);
    const res = await POST(postReq({ token: 'a'.repeat(32) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('setup_disabled');
    expect(mockedConsume).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/app/api/init/create-admin.test.ts`
Expected: FAIL — multiple ways:
- Current body is `{username, password, email}` so `tokenSchema.safeParse({token})` is fine but current route uses `createAdminSchema`
- The 5 tests reference `consumeAdminCredentials` which is mocked but the current route doesn't import it
- First test will pass mock-consume but the current route doesn't call it, so `createAdminUserMock` won't be called and assertion fails

- [ ] **Step 3: Write minimal implementation**

Replace `app/api/init/create-admin/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { isSetupRouteEnabled } from '@/lib/setup';
import { consumeAdminCredentials } from '@/lib/init-credentials';

/**
 * /init phase 6: create the first admin user. Requires users table (PHASE 1).
 *
 * Body changed from {username, password, email} to {token} — the token was
 * obtained from /api/init/stash-admin in step 2 and is consumed here. The
 * actual credentials never leave the server's in-memory map; the wizard
 * page only sees the token.
 *
 * Idempotent at the consume layer (one-shot) — refuses if token already
 * consumed or expired.
 */
const tokenSchema = z.object({
  token: z.string().length(32).regex(/^[0-9a-f]+$/i, 'token must be 32 hex chars'),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) {
      return badRequest('setup_disabled', '/init is disabled.');
    }
    if (!process.env.DATABASE_URL) {
      return badRequest('db_not_configured', 'Configure DATABASE_URL first (Step 1).');
    }
    const body = await req.json();
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest('invalid_input', 'token required (32 hex chars)');
    }
    const creds = consumeAdminCredentials(parsed.data.token);
    if (!creds) {
      return unauthorized('token_expired', 'admin credentials token expired or invalid; please re-enter on /init/admin');
    }
    const { createAdminUser } = await import('@/scripts/init-db');
    const stats = await createAdminUser({
      username: creds.username,
      password: creds.password,
      email: creds.email,
    });
    return NextResponse.json({ ok: true, data: stats });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/init/create-admin.test.ts`
Expected: PASS, 5 tests green

- [ ] **Step 5: Commit**

```bash
git add app/api/init/create-admin/route.ts tests/unit/app/api/init/create-admin.test.ts
git commit -m "feat(init): create-admin accepts token, consumes server-side creds [2026-07-07 HH.MM]"
```

---

### Task 8: `components/init/InitHeader` + `StepGroup`

**Files:**
- Create: `components/init/InitHeader.tsx`
- Create: `components/init/StepGroup.tsx`
- Create: `tests/unit/components/init/InitHeader.test.tsx`
- Create: `tests/unit/components/init/StepGroup.test.tsx`

**Interfaces:**
- Produces: `<InitHeader currentStep={0|1|2} />` — 3-step indicator (RSC)
- Produces: `<StepGroup title completedCount total defaultOpen children />` — collapsible card (client)

- [ ] **Step 1: Write failing tests**

Create `tests/unit/components/init/InitHeader.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InitHeader } from '@/components/init/InitHeader';

describe('InitHeader', () => {
  it('renders 3 steps with labels', () => {
    const { getByText } = render(<InitHeader currentStep={0} />);
    expect(getByText('数据库')).toBeTruthy();
    expect(getByText('管理员')).toBeTruthy();
    expect(getByText('初始化数据')).toBeTruthy();
  });

  it('marks current step as active', () => {
    const { container } = render(<InitHeader currentStep={1} />);
    // the second step's wrapper div should have border-seal class
    const activeDots = container.querySelectorAll('.border-seal');
    expect(activeDots.length).toBeGreaterThanOrEqual(1);
  });
});
```

Create `tests/unit/components/init/StepGroup.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StepGroup } from '@/components/init/StepGroup';

describe('StepGroup', () => {
  it('renders title with completion counter', () => {
    const { getByText } = render(
      <StepGroup title="数据库结构" completedCount={1} total={3}>
        <div data-testid="child">child content</div>
      </StepGroup>
    );
    expect(getByText('数据库结构')).toBeTruthy();
    expect(getByText('(1/3 完成)')).toBeTruthy();
  });

  it('renders children when defaultOpen=true', () => {
    const { getByTestId } = render(
      <StepGroup title="g" completedCount={0} total={2} defaultOpen>
        <div data-testid="child">c</div>
      </StepGroup>
    );
    expect(getByTestId('child')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/init/`
Expected: FAIL with "Cannot find module '@/components/init/InitHeader'"

- [ ] **Step 3: Write minimal implementations**

Create `components/init/InitHeader.tsx`:

```tsx
import { Check, Database, User, Rocket } from 'lucide-react';

const STEPS = [
  { id: 'db', label: '数据库', Icon: Database },
  { id: 'admin', label: '管理员', Icon: User },
  { id: 'execute', label: '初始化数据', Icon: Rocket },
] as const;

/** 3-step progress indicator for the /init wizard. Server component. */
export function InitHeader({ currentStep }: { currentStep: 0 | 1 | 2 }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {STEPS.map((s, i) => {
        const completed = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                completed
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : active
                  ? 'border-seal bg-seal text-white'
                  : 'border-ink/20 bg-paper-soft text-ink-faint'
              }`}
            >
              {completed ? <Check className="h-4 w-4" /> : <s.Icon className="h-4 w-4" />}
            </div>
            <span
              className={`text-sm ${active || completed ? 'text-ink font-medium' : 'text-ink-faint'}`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-2 text-ink-faint">→</span>}
          </div>
        );
      })}
    </div>
  );
}
```

Create `components/init/StepGroup.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Collapsible card group used on /init/execute to organize the 9 init
 *  phases into 3 named sections (数据库结构 / 数据导入 / 账号与激活). */
export function StepGroup({
  title,
  completedCount,
  total,
  children,
  defaultOpen = true,
}: {
  title: string;
  completedCount: number;
  total: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allDone = completedCount === total;
  return (
    <div
      className={`rounded-md border-2 ${
        allDone ? 'border-green-300' : 'border-ink/15'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-ink-soft" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-soft" />
          )}
          <span className="font-medium text-ink">{title}</span>
          <span className="text-sm text-ink-faint">
            ({completedCount}/{total} 完成)
          </span>
        </div>
      </button>
      {open && <div className="space-y-2 p-3 pt-0">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/init/`
Expected: PASS, 4 tests green (2 per file)

- [ ] **Step 5: Commit**

```bash
git add components/init/InitHeader.tsx components/init/StepGroup.tsx tests/unit/components/init/
git commit -m "feat(init): InitHeader + StepGroup reusable wizard components [2026-07-07 HH.MM]"
```

---

### Task 9: `/init` RSC orchestrator (sets cookie on AlreadyDoneCard)

**Files:**
- Modify: `app/init/page.tsx` (full rewrite — currently a 'use client' component)

**Interfaces:**
- Produces: RSC that reads `isSetupComplete()` and either sets the `setup_completed=1` cookie + renders `<AlreadyDoneCard>` or `redirect('/init/db')`

- [ ] **Step 1: Write minimal implementation**

Replace `app/init/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { isSetupComplete } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** RSC orchestrator for /init. Decides which of 3 wizard screens to show
 *  (or the locked card). Setting `setup_completed=1` here is critical:
 *  without it, a fresh browser that lands on /init after setup was already
 *  completed elsewhere would be trapped in a redirect loop (middleware
 *  redirects /login → /init → /login). */
export default async function InitOrchestrator() {
  if (await isSetupComplete()) {
    cookies().set('setup_completed', '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10, // 10 years, mirrors /api/init/mark-complete
      sameSite: 'lax',
      httpOnly: false,
    });
    return <AlreadyDoneCard />;
  }
  // Not yet complete: drop into step 1. The /init/db page itself does
  // prerequisite checks (DATABASE_URL → redirect to /init/admin, etc).
  redirect('/init/db');
}

function AlreadyDoneCard() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="rounded-md border border-green-300 bg-green-50 p-6 text-center">
        <Check className="mx-auto h-12 w-12 text-green-700" />
        <h2 className="mt-3 text-lg font-medium text-ink">系统已初始化完成</h2>
        <p className="mt-1 text-sm text-ink-soft">
          首次部署已完成,此页面已自动锁定。
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80"
        >
          前往登录 →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: clean (no errors)

- [ ] **Step 3: Verify redirect contract manually**

Per memory `dev-build-cache-stomp`: kill any dev on 4444 first.

```bash
pkill -f "next dev" 2>/dev/null || true
sleep 1
npm run dev &

# Wait for ready
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4444/ 2>/dev/null && break
  sleep 2
done

# With .env pointing to existing setup (piyin_dev has setup.completed=true):
# GET /init → 200 AlreadyDoneCard + Set-Cookie: setup_completed=1
curl -s -i http://localhost:4444/init 2>&1 | head -20
```

Expected: HTTP 200, body contains "系统已初始化完成", `Set-Cookie: setup_completed=1; ...`.

- [ ] **Step 4: Commit**

```bash
git add app/init/page.tsx
git commit -m "feat(init): RSC orchestrator sets setup_completed cookie on lock [2026-07-07 HH.MM]"
```

---

### Task 10: `/init/db` page (Step 1 — DB config)

**Files:**
- Create: `app/init/db/page.tsx`
- Create: `app/init/db/InitDbForm.tsx`

**Interfaces:**
- Produces: `/init/db` — RSC shell redirects to `/init/admin` if `DATABASE_URL` is set; otherwise renders `<InitDbForm />`
- Produces: `<InitDbForm />` — client form, host/port/user/password/database, calls `/api/init/db-config`, clears password from state on success, `router.push('/init/admin')`

- [ ] **Step 1: Write minimal implementation**

Create `app/init/db/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { InitDbForm } from './InitDbForm';

export const dynamic = 'force-dynamic';

export default function InitDbPage() {
  if (process.env.DATABASE_URL) {
    // DB already configured → skip straight to admin step
    redirect('/init/admin');
  }
  return (
    <div className="mx-auto max-w-2xl py-8">
      <InitDbForm />
    </div>
  );
}
```

Create `app/init/db/InitDbForm.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DEFAULT_DB: DbConfig = { host: '', port: 3306, user: '', password: '', database: 'pinyin' };

export function InitDbForm() {
  const router = useRouter();
  const [cfg, setCfg] = useState<DbConfig>(DEFAULT_DB);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '数据库连接失败');
        return;
      }
      // Clear password from state so a back-nav doesn't render the value.
      setCfg({ ...DEFAULT_DB, host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, password: '' });
      router.push('/init/admin');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 1 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        配置数据库连接。测试通过后会写入 .env 并自动跳到下一步。
      </p>
      {err && (
        <div className="mb-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-ink-soft">主机</label>
            <input
              type="text" required autoComplete="off" value={cfg.host}
              onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
              placeholder="例如 127.0.0.1 或 db.example.com"
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">端口</label>
            <input
              type="number" required min={1} max={65535} autoComplete="off" value={cfg.port}
              onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">Schema</label>
            <input
              type="text" required autoComplete="off" value={cfg.database}
              onChange={(e) => setCfg({ ...cfg, database: e.target.value })}
              placeholder="pinyin"
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">用户名</label>
            <input
              type="text" required autoComplete="off" value={cfg.user}
              onChange={(e) => setCfg({ ...cfg, user: e.target.value })}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft">密码</label>
            <input
              type="password" autoComplete="current-password" value={cfg.password}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
              className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
            />
          </div>
        </div>
        <p className="text-xs text-ink-faint">
          连接测试会自动创建 schema (如果不存在)。生产环境请使用专用账号,不要 root。
        </p>
        <button
          type="submit" disabled={busy}
          className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
        >
          {busy ? '测试连接…' : '测试连接并保存'}
        </button>
      </form>
    </>
  );
}
```

- [ ] **Step 2: Run tsc + dev smoke**

Run: `npx tsc --noEmit`
Expected: clean

Run: with dev already running from Task 9, `curl -i http://localhost:4444/init/db` → expect 200 (because piyin_dev has DATABASE_URL set, page redirects to /init/admin → expect 307 → /init/admin → 200).

- [ ] **Step 3: Commit**

```bash
git add app/init/db/
git commit -m "feat(init): /init/db page with autoComplete + clear-password fix [2026-07-07 HH.MM]"
```

---

### Task 11: `/init/admin` page (Step 2 — admin creds → token)

**Files:**
- Create: `app/init/admin/page.tsx`
- Create: `app/init/admin/InitAdminForm.tsx`

**Interfaces:**
- Produces: `/init/admin` — RSC shell:
  - no `DATABASE_URL` → `redirect('/init/db')`
  - `isInitWizardAdminDone()` → `redirect('/init/execute')`
  - else renders `<InitAdminForm />`
- Produces: `<InitAdminForm />` — client form, posts to `/api/init/stash-admin`, stores `{username, email, token}` in sessionStorage (NO password), `router.push('/init/execute')`

- [ ] **Step 1: Write minimal implementation**

Create `app/init/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { isInitWizardAdminDone } from '@/lib/setup';
import { InitAdminForm } from './InitAdminForm';

export const dynamic = 'force-dynamic';

export default async function InitAdminPage() {
  if (!process.env.DATABASE_URL) {
    redirect('/init/db');
  }
  if (await isInitWizardAdminDone()) {
    // Already submitted step 2 → skip to step 3
    redirect('/init/execute');
  }
  return (
    <div className="mx-auto max-w-2xl py-8">
      <InitAdminForm />
    </div>
  );
}
```

Create `app/init/admin/InitAdminForm.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'piyin.init.admin.creds';

export function InitAdminForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/init/stash-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error?.message ?? '提交失败');
        return;
      }
      // Store token + display info. NO password — server holds it for 30s.
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          username,
          email: email || undefined,
          token: data.data.token,
        }),
      );
      setPassword(''); // wipe from component state
      router.push('/init/execute');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 2 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        创建第一个管理员账号。密码仅在服务端内存中临时保存 (30 秒),不会写入客户端存储。
      </p>
      {err && (
        <div className="mb-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-ink/20 bg-paper-soft p-6">
        <div>
          <label className="block text-sm font-medium text-ink-soft">
            用户名 (3-32 字符,a-z A-Z 0-9 _)
          </label>
          <input
            type="text" required minLength={3} maxLength={32} autoComplete="username"
            value={username} onChange={(e) => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_]+"
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">密码 (≥8 字符)</label>
          <input
            type="password" required minLength={8} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-soft">邮箱 (可选)</label>
          <input
            type="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/20 px-3 py-2"
          />
        </div>
        <button
          type="submit" disabled={busy}
          className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
        >
          {busy ? '提交中…' : '下一步'}
        </button>
      </form>
    </>
  );
}
```

- [ ] **Step 2: Run tsc + dev smoke**

Run: `npx tsc --noEmit`
Expected: clean

Run: `curl -i http://localhost:4444/init/admin` (with piyin_dev having admin_done=true) → expect 307 → /init/execute.

- [ ] **Step 3: Commit**

```bash
git add app/init/admin/
git commit -m "feat(init): /init/admin page with token-based credential flow [2026-07-07 HH.MM]"
```

---

### Task 12: `/init/execute` page (Step 3 — 9 phases in 3 groups)

**Files:**
- Create: `app/init/execute/page.tsx`
- Create: `app/init/execute/InitExecuteForm.tsx`

**Interfaces:**
- Produces: `/init/execute` — RSC shell:
  - no `DATABASE_URL` → `redirect('/init/db')`
  - `isSetupComplete()` → `redirect('/init')` (orchestrator shows locked card + sets cookie)
  - else renders `<InitExecuteForm />`
- Produces: `<InitExecuteForm />` — reads `piyin.init.admin.creds` from sessionStorage on mount, redirects to `/init/admin` if missing; runs 8 endpoint phases sequentially (init-tables → init-app-config → init-poems → init-sutras → init-chars → create-admin(body={token}) → init-activate → migrate); then mark-complete which sets cookie; finally removes sessionStorage and bounces to `/init`

- [ ] **Step 1: Write minimal implementation**

Create `app/init/execute/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { isSetupComplete } from '@/lib/setup';
import { InitExecuteForm } from './InitExecuteForm';

export const dynamic = 'force-dynamic';

export default async function InitExecutePage() {
  if (!process.env.DATABASE_URL) redirect('/init/db');
  if (await isSetupComplete()) {
    // Bounce to orchestrator — it'll set cookie + show locked card
    redirect('/init');
  }
  return (
    <div className="mx-auto max-w-3xl py-8">
      <InitExecuteForm />
    </div>
  );
}
```

Create `app/init/execute/InitExecuteForm.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';
import { InitHeader } from '@/components/init/InitHeader';
import { StepGroup } from '@/components/init/StepGroup';

const STORAGE_KEY = 'piyin.init.admin.creds';

interface SubStep {
  id: 'tables' | 'app_config' | 'poems' | 'sutras' | 'chars' | 'create_admin' | 'activate' | 'migrations' | 'mark_complete';
  label: string;
  status: 'idle' | 'running' | 'done' | 'failed';
  detail?: string;
}

const INITIAL: SubStep[] = [
  { id: 'tables', label: '创建表结构', status: 'idle' },
  { id: 'app_config', label: '写入 app_config 默认值', status: 'idle' },
  { id: 'poems', label: '导入古诗 (data/poems/)', status: 'idle' },
  { id: 'sutras', label: '导入佛经 (data/sutras/)', status: 'idle' },
  { id: 'chars', label: '导入字典 (data/chars)', status: 'idle' },
  { id: 'create_admin', label: '创建管理员账号', status: 'idle' },
  { id: 'activate', label: '写入平台激活信息', status: 'idle' },
  { id: 'migrations', label: '应用迁移文件', status: 'idle' },
  { id: 'mark_complete', label: '标记 setup.completed', status: 'idle' },
];

export function InitExecuteForm() {
  const router = useRouter();
  const [creds, setCreds] = useState<{ username: string; email?: string; token: string } | null>(null);
  const [subSteps, setSubSteps] = useState<SubStep[]>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!raw) {
      // User skipped step 2 (or sessionStorage was cleared). Send back.
      router.replace('/init/admin');
      return;
    }
    try {
      setCreds(JSON.parse(raw));
    } catch {
      router.replace('/init/admin');
    }
  }, [router]);

  function update(id: SubStep['id'], patch: Partial<SubStep>) {
    setSubSteps((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function summarizeAutoPopulate(r: { inserted: number; skipped: boolean; failed?: string }) {
    if (r.failed) return `失败: ${r.failed}`;
    if (r.skipped) return '已跳过 (表内已有数据)';
    return `新增 ${r.inserted.toLocaleString('zh-CN')} 行`;
  }

  async function runPhases() {
    if (!creds) return;
    setBusy(true);
    setErr(null);
    setSubSteps(INITIAL.map((s) => ({ ...s, status: 'idle', detail: undefined })));

    const phases: Array<{ id: SubStep['id']; endpoint: string; body?: any; format: (d: any) => string }> = [
      { id: 'tables', endpoint: '/api/init/init-tables',
        format: (d) => `${d.statementsRun} 条 DDL 写入完成,当前 ${d.tablesNow} 张表` },
      { id: 'app_config', endpoint: '/api/init/init-app-config',
        format: (d) => `${d.totalRows} 条配置 (era 默认 + ai/tts)` },
      { id: 'poems', endpoint: '/api/init/init-poems',
        format: summarizeAutoPopulate },
      { id: 'sutras', endpoint: '/api/init/init-sutras',
        format: summarizeAutoPopulate },
      { id: 'chars', endpoint: '/api/init/init-chars',
        format: summarizeAutoPopulate },
      { id: 'create_admin', endpoint: '/api/init/create-admin',
        body: { token: creds.token },
        format: (d) => `已创建 (id=${d.userId})` },
      { id: 'activate', endpoint: '/api/init/init-activate',
        format: (d) => d.seeded ? `已写入 (short_name=${d.shortName})` : '已存在,跳过' },
      { id: 'migrations', endpoint: '/api/init/migrate',
        format: (d) => `${d.files} 个 SQL 文件 / ${d.statements} 条语句` },
    ];

    for (const phase of phases) {
      update(phase.id, { status: 'running' });
      try {
        const res = await fetch(phase.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: phase.body ? JSON.stringify(phase.body) : undefined,
        });
        const data = await res.json();
        if (!data.ok) {
          const detail = data.error?.message ?? '失败';
          update(phase.id, { status: 'failed', detail });
          setErr(`${phase.id} 失败: ${detail}`);
          setBusy(false);
          return;
        }
        update(phase.id, { status: 'done', detail: phase.format(data.data) });
      } catch (e) {
        const detail = (e as Error).message;
        update(phase.id, { status: 'failed', detail });
        setErr(`${phase.id} 失败: ${detail}`);
        setBusy(false);
        return;
      }
    }

    // mark-complete
    update('mark_complete', { status: 'running' });
    try {
      const r = await fetch('/api/init/mark-complete', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) {
        update('mark_complete', { status: 'failed', detail: d.error?.message ?? '失败' });
        setErr(d.error?.message ?? 'mark-complete 失败');
        setBusy(false);
        return;
      }
      update('mark_complete', { status: 'done' });
      // Clean up sessionStorage — token is consumed server-side.
      sessionStorage.removeItem(STORAGE_KEY);
      // Bounce to /init orchestrator — it sets cookie + shows locked card.
      router.push('/init');
    } catch (e) {
      update('mark_complete', { status: 'failed', detail: (e as Error).message });
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!creds) {
    return <div className="text-sm text-ink-soft">加载中…</div>;
  }

  const groups: { title: string; ids: SubStep['id'][] }[] = [
    { title: '数据库结构', ids: ['tables', 'app_config', 'migrations'] },
    { title: '数据导入', ids: ['poems', 'sutras', 'chars'] },
    { title: '账号与激活', ids: ['create_admin', 'activate', 'mark_complete'] },
  ];

  function statusClass(s: SubStep['status']) {
    return s === 'done'
      ? 'border-green-300 bg-green-50'
      : s === 'failed'
      ? 'border-red-300 bg-red-50'
      : s === 'running'
      ? 'border-blue-300 bg-blue-50'
      : 'border-ink/15 bg-paper-soft';
  }

  function renderCard(s: SubStep) {
    return (
      <div
        key={s.id}
        className={`flex items-center gap-3 rounded-md border-2 p-3 ${statusClass(s.status)}`}
      >
        <div className="flex h-6 w-6 items-center justify-center">
          {s.status === 'done' && <Check className="h-5 w-5 text-green-700" />}
          {s.status === 'failed' && <X className="h-5 w-5 text-red-700" />}
          {s.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
          {s.status === 'idle' && <span className="h-2 w-2 rounded-full bg-ink/20" />}
        </div>
        <div className="flex-1">
          <div
            className={`text-sm font-medium ${
              s.status === 'done'
                ? 'text-green-900'
                : s.status === 'failed'
                ? 'text-red-900'
                : s.status === 'running'
                ? 'text-blue-900'
                : 'text-ink-soft'
            }`}
          >
            {s.label}
          </div>
          {s.detail && (
            <div className={`mt-0.5 text-xs ${s.status === 'failed' ? 'text-red-700' : 'text-ink-faint'}`}>
              {s.detail}
            </div>
          )}
        </div>
        <span
          className={`text-xs ${
            s.status === 'done'
              ? 'text-green-700'
              : s.status === 'failed'
              ? 'text-red-700'
              : s.status === 'running'
              ? 'text-blue-600'
              : 'text-ink-faint'
          }`}
        >
          {s.status === 'done' && '完成'}
          {s.status === 'failed' && '失败'}
          {s.status === 'running' && '进行中'}
          {s.status === 'idle' && '等待'}
        </span>
      </div>
    );
  }

  const allIdle = subSteps.every((s) => s.status === 'idle');
  const someFailed = subSteps.some((s) => s.status === 'failed');
  const allDone = subSteps.every((s) => s.status === 'done');

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold text-ink">首次部署 — 第 3 步 / 共 3 步</h1>
      <p className="mb-6 text-sm text-ink-soft">
        点击下方按钮开始初始化。系统会依次执行以下步骤,每步状态实时显示。<br />
        创建管理员:<code className="rounded bg-ink/5 px-1">{creds.username}</code>
        {creds.email ? (
          <>
            {' '}
            (<code>{creds.email}</code>)
          </>
        ) : null}
      </p>
      <InitHeader currentStep={2} />
      {err && (
        <div className="my-4 rounded-md border border-seal/30 bg-seal/5 p-3 text-sm text-seal">
          {err}
        </div>
      )}
      <div className="space-y-4">
        {groups.map((g) => {
          const items = g.ids.map((id) => subSteps.find((s) => s.id === id)!).filter(Boolean);
          const completed = items.filter((s) => s.status === 'done').length;
          return (
            <StepGroup key={g.title} title={g.title} completedCount={completed} total={items.length}>
              {items.map(renderCard)}
            </StepGroup>
          );
        })}
      </div>
      <div className="mt-6 flex justify-center">
        {allIdle && (
          <button
            type="button" onClick={runPhases} disabled={busy}
            className="rounded-md bg-seal px-6 py-2 text-white hover:bg-seal/80 disabled:opacity-50"
          >
            开始初始化
          </button>
        )}
        {someFailed && (
          <button
            type="button" onClick={runPhases} disabled={busy}
            className="rounded-md bg-amber-600 px-6 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? '重试中…' : '重试失败步骤'}
          </button>
        )}
        {allDone && (
          <a
            href="/login"
            className="rounded-md bg-green-700 px-6 py-2 text-white hover:bg-green-800"
          >
            完成 — 前往登录 →
          </a>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run tsc + dev smoke**

Run: `npx tsc --noEmit`
Expected: clean

Run: `curl -i http://localhost:4444/init/execute` (with piyin_dev having setup.completed=true) → expect 307 → /init → 200 AlreadyDoneCard.

- [ ] **Step 3: Commit**

```bash
git add app/init/execute/
git commit -m "feat(init): /init/execute page with 3 grouped StepGroups [2026-07-07 HH.MM]"
```

---

### Task 13: Full-chain integration test on scratch DB

**Files:**
- Create: `tests/integration/init-wizard.test.ts`

**Interfaces:**
- Produces: Integration test that creates scratch DB `piyin_wizard_test`, runs full 9-phase chain, asserts cookie set + setup.completed=true in app_config

- [ ] **Step 1: Write integration test**

Create `tests/integration/init-wizard.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { writeEnvVars, reloadProcessEnvFromFile } from '@/lib/setup';

// Skip cleanly when no DATABASE_URL — mirrors other integration tests.
const integrationSkip = !process.env.DATABASE_URL;
const SCRATCH_DB = 'piyin_wizard_test';

describe.skipIf(integrationSkip)('Integration: /init wizard 3-stage flow', () => {
  beforeAll(async () => {
    // Drop + recreate scratch DB so test is hermetic.
    const adminUrl = process.env.DATABASE_URL!.replace(/\/[^/]+$/, '');
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(adminUrl);
    await admin.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
    await admin.query(`CREATE DATABASE \`${SCRATCH_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();

    // Point the running test process at the scratch DB.
    const newUrl = process.env.DATABASE_URL!.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);
    writeEnvVars({ DATABASE_URL: newUrl });
    reloadProcessEnvFromFile();
    await closePool();
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup. Drop DB and reset env to whatever the caller had.
    const adminUrl = process.env.DATABASE_URL!.replace(/\/[^/]+$/, '');
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(adminUrl);
    await admin.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
    await admin.end();
    await closePool();
  }, 60_000);

  it('runs the full 9-phase chain and sets setup_completed + cookie', async () => {
    // Phase 1: init-tables (creates 25 tables)
    const { POST: initTables } = await import('@/app/api/init/init-tables/route');
    let res = await initTables();
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.tablesNow).toBeGreaterThanOrEqual(20);

    // Phase 2: init-app-config
    const { POST: initAppConfig } = await import('@/app/api/init/init-app-config/route');
    res = await initAppConfig();
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.totalRows).toBeGreaterThan(0);

    // Phase 3-5: poems / sutras / chars
    for (const endpoint of ['init-poems', 'init-sutras', 'init-chars']) {
      const { POST } = await import(`@/app/api/init/${endpoint}/route`);
      const r = await POST();
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(b.ok).toBe(true);
    }

    // Phase 6: stash-admin (valid) → consume token → create-admin (token-based)
    const { POST: stashAdmin } = await import('@/app/api/init/stash-admin/route');
    const { NextRequest } = await import('next/server');
    const stashRes = await stashAdmin(
      new NextRequest('http://localhost/api/init/stash-admin', {
        method: 'POST',
        body: JSON.stringify({ username: 'wizardtest', password: 'supersecret', email: 'w@x.com' }),
      })
    );
    expect(stashRes.status).toBe(200);
    const stashBody = await stashRes.json();
    expect(stashBody.ok).toBe(true);
    expect(stashBody.data.token).toMatch(/^[0-9a-f]{32}$/);

    const { POST: createAdmin } = await import('@/app/api/init/create-admin/route');
    res = await createAdmin(
      new NextRequest('http://localhost/api/init/create-admin', {
        method: 'POST',
        body: JSON.stringify({ token: stashBody.data.token }),
      })
    );
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBeGreaterThan(0);
    expect(body.data.username).toBe('wizardtest');

    // Re-using the same token must fail (one-shot)
    const replayRes = await createAdmin(
      new NextRequest('http://localhost/api/init/create-admin', {
        method: 'POST',
        body: JSON.stringify({ token: stashBody.data.token }),
      })
    );
    expect(replayRes.status).toBe(401);

    // Phase 7: activate
    const { POST: initActivate } = await import('@/app/api/init/init-activate/route');
    res = await initActivate();
    expect(res.status).toBe(200);

    // Phase 8: migrate
    const { POST: migrate } = await import('@/app/api/init/migrate/route');
    res = await migrate();
    expect(res.status).toBe(200);

    // Phase 9: mark-complete — must set setup.completed=true
    const { POST: markComplete } = await import('@/app/api/init/mark-complete/route');
    res = await markComplete();
    expect(res.status).toBe(200);
    // Inspect Set-Cookie header
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/setup_completed=1/);

    // Verify the app_config flag
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = 'setup.completed' LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe('true');
  }, 120_000);
});
```

- [ ] **Step 2: Run integration test**

Run: `DATABASE_URL='mysql://root:Admin909217@127.0.0.1:3306/pinyin_dev' npx vitest run tests/integration/init-wizard.test.ts`
Expected: PASS, 1 test green (or skip with "DATABASE_URL not set" if no env).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/init-wizard.test.ts
git commit -m "test(init): full 9-phase /init wizard integration on scratch DB [2026-07-07 HH.MM]"
```

---

### Task 14: Build + dev verify (manual smoke)

**Files:** none (verification only)

- [ ] **Step 1: Run full unit test suite**

```bash
npm test
```

Expected: all tests pass (or pre-existing failures only — check vs `git stash` of pending changes if unsure).

- [ ] **Step 2: Run pnpm build** (per memory `feedback-per-task-build-check` — diff touched new routes)

Per memory `dev-build-cache-stomp` — first kill any dev on 4444:

```bash
pkill -f "next dev" 2>/dev/null || true
sleep 2
npm run build
```

Expected: build succeeds, /init, /init/db, /init/admin, /init/execute all listed in route table.

- [ ] **Step 3: Manual smoke on dev server**

```bash
npm run dev &

for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:4444/ 2>/dev/null && break
  sleep 2
done

# Scenario A: piyin_dev (already setup), fresh browser
curl -s -i -c /tmp/cookies.txt http://localhost:4444/ 2>&1 | head -10
# Expect: 307 → /init

curl -s -i -b /tmp/cookies.txt http://localhost:4444/init 2>&1 | head -10
# Expect: 200 AlreadyDoneCard + Set-Cookie: setup_completed=1

# Scenario B: with cookie, should now navigate freely
curl -s -i -b /tmp/cookies.txt http://localhost:4444/login 2>&1 | head -5
# Expect: 200 (or whatever /login returns, NOT a redirect to /init)

# Scenario C: old client bundle hitting /api/init/init-db
curl -s -i -X POST http://localhost:4444/api/init/init-db 2>&1 | head -10
# Expect: 410 + error.code='stale_build'
```

- [ ] **Step 4: Manual browser smoke** (require user, defer to next session if needed)

Per spec `Testing Approach` section, document the 6-step browser flow but don't execute here — user does human smoke after commit push.

- [ ] **Step 5: Final commit (no code changes)**

If any build-config / verify-only files changed:

```bash
git status
# If clean, no commit. If .env.bak-* or similar was created, ensure .gitignore covers it (it should — env files are gitignored).
```

---

## Testing Approach Summary

- **Unit tests** (Tasks 1, 2, 3, 4, 5, 6, 7, 8): 8 test files, ~30 tests total. Run: `npx vitest run tests/unit/`
- **Integration test** (Task 13): 1 test, full 9-phase chain on scratch DB. Run with `DATABASE_URL=...` env var set.
- **Manual smoke** (Task 14): curl scenarios + browser verify. Defer browser to user.

## Commit Strategy (4 commits per spec)

After Tasks 1-3 done: `refactor(middleware): cookie-only setup gate`
After Task 4-9 done: `feat(init): orchestrator + 3-URL wizard with token credentials`
After Tasks 10-12 done: `feat(init): /init/{db,admin,execute} pages with 9-card grouping`
After Task 13: `test(init): full wizard integration on scratch DB`
After Task 14: `chore(init): build + dev verify wizard 3-stage on 4444`

(Or fewer commits if reviewer prefers — the plan splits at natural boundaries. The implementer can squash if a single review pass makes sense.)

## Notes / Risks

- **Multi-process deployment**: token Map is per-process. With `pnpm start` it's a single Node process, so this is fine. If the user later moves to multi-instance behind a load balancer, switch to Redis. Spec already calls this out.
- **Cookie httpOnly=false**: the orchestrator's Set-Cookie uses `httpOnly: false` so the existing client-side cookie check pattern still works. The cookie value is just `1` so XSS exposure is minimal.
- **sessionStorage token**: token has 30s TTL — if the user pauses >30s between step 2 and 3, they must re-enter credentials. Acceptable; spec calls this out.
- **DB password in process.env**: even after step 1, the password sits in `process.env.DATABASE_URL` in the running process. This was already true in the old design. Not a regression.
- **Old client bundle cache**: if a user has a long-cached browser bundle calling `/api/init/init-db`, the 410 shim returns a clear "refresh browser" message.
- **Per-process memory Map GC**: `setInterval(gcExpired, 60_000).unref()` so it doesn't keep the process alive; safe in test environments.