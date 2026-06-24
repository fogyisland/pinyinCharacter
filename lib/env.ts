/**
 * Production environment validation.
 *
 * The app uses custom JWT auth (lib/auth.ts), not next-auth. The cookie is
 * signed with JWT_SECRET, marked secure only when COOKIE_SECURE=true, and
 * DATABASE_URL points to the prod DB. If any of these regress in production,
 * we want to surface the issue clearly, not silently serve unsafe traffic.
 *
 * `validateEnv` is called once at startup from `instrumentation.ts`. It
 * NEVER throws — production deployments that haven't completed `/init` yet
 * (no DB, no JWT_SECRET) need the server to boot far enough to serve the
 * setup wizard. Instead it logs warnings/errors and returns the issue list,
 * which `isReady()` reduces to a single boolean for /admin/init's checklist.
 *
 * Why this is a separate module rather than inline checks:
 *   - Pure function with `env` parameter → trivial to unit test without
 *     mutating process.env or fighting vitest module cache
 *   - Centralizes the rule set so the deploy checklist and the runtime
 *     check can't drift apart
 */

const DEV_DEFAULT_JWT_SECRET = 'local-dev-secret-must-be-32-chars-long-1234';

export function isProd(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export interface EnvIssue {
  level: 'warn' | 'error';
  var: string;
  message: string;
}

export interface EnvValidationResult {
  ok: boolean;
  issues: EnvIssue[];
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const issues: EnvIssue[] = [];
  const prod = isProd(env);

  // Dev: every "rule" we enforce below is the expected local-dev state
  // (dev-default JWT secret, HTTP, localhost DB). Skipping all checks here
  // keeps validateEnv a no-op for the day-to-day loop and avoids spamming
  // the console with warnings developers already know about.
  if (!prod) {
    return { ok: true, issues: [] };
  }

  // Rule 1: JWT_SECRET — sign + verify use this. If it's missing, too short,
  // or still the known dev default, an attacker who cloned the repo can forge
  // any user's auth_token cookie.
  const secret = env.JWT_SECRET;
  if (!secret) {
    issues.push({ level: 'error', var: 'JWT_SECRET', message: 'JWT_SECRET is not set' });
  } else if (secret.length < 32) {
    issues.push({
      level: 'error',
      var: 'JWT_SECRET',
      message: `JWT_SECRET must be at least 32 chars (got ${secret.length})`,
    });
  } else if (secret === DEV_DEFAULT_JWT_SECRET) {
    issues.push({
      level: 'error',
      var: 'JWT_SECRET',
      message:
        'JWT_SECRET is set to the known dev default value — anyone with repo access can forge tokens. Generate a new random ≥32-char value for prod.',
    });
  }

  // Rule 2: COOKIE_SECURE — must be exactly "true" for the auth cookie to
  // only travel over HTTPS. Any other value (missing, "false", "1", "yes")
  // leaves the JWT sniffable on the wire.
  if (env.COOKIE_SECURE !== 'true') {
    issues.push({
      level: 'error',
      var: 'COOKIE_SECURE',
      message:
        'COOKIE_SECURE must be set to the literal string "true" in production so the auth cookie is only sent over HTTPS',
    });
  }

  // Rule 3: DATABASE_URL — must exist for any data-driven feature (auth,
  // worksheets, history, audit log, AI config). Without it the server can
  // still serve static pages + /init wizard, so we surface as an error
  // for /admin/init's checklist but do NOT block startup.
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    issues.push({ level: 'error', var: 'DATABASE_URL', message: 'DATABASE_URL is not set' });
  } else {
    const lower = dbUrl.toLowerCase();
    const isLocalHost = /@(127\.0\.0\.1|localhost)(:|\/|$)/.test(lower);
    const isDevSchema = lower.includes('piyin_dev');
    if (isLocalHost || isDevSchema) {
      issues.push({
        level: 'error',
        var: 'DATABASE_URL',
        message:
          'DATABASE_URL points to a dev/local DB (127.0.0.1, localhost, or piyin_dev schema) — production would corrupt dev state',
      });
    }
  }

  // Rule 4: NEXT_PUBLIC_SITE_URL — admin backend sets this from the UI, not
  // from .env. We don't fail boot if it's missing; we just warn, because the
  // real fallback (localhost:3000) only affects canonical/sitemap URLs which
  // are cosmetic. The admin flow is the source of truth for the prod domain.
  if (!env.NEXT_PUBLIC_SITE_URL) {
    issues.push({
      level: 'warn',
      var: 'NEXT_PUBLIC_SITE_URL',
      message:
        'NEXT_PUBLIC_SITE_URL not set — canonical URLs and sitemap will use localhost:3000 fallback. Set it via admin backend UI (not manual .env edit).',
    });
  }

  // Always log warnings (best-effort signal for operators tailing logs).
  // Errors are NOT thrown — the server must boot far enough to serve /init.
  // Callers that need a hard gate (e.g. /admin/init checklist) should call
  // isReady() to collapse the issue list into a single ok boolean.
  for (const i of issues) {
    const tag = i.level === 'error' ? 'ERROR' : 'WARN';
    console.warn(`[env] ${tag} [${i.var}] ${i.message}`);
  }

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0,
    issues,
  };
}

/**
 * Convenience: only true when validateEnv returned zero error-level issues.
 * Used by /admin/init checklist to gate "prod-ready" status.
 */
export function isReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return validateEnv(env).ok;
}