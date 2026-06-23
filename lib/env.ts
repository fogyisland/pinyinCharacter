/**
 * Production environment validation.
 *
 * The app uses custom JWT auth (lib/auth.ts), not next-auth. The cookie is
 * signed with JWT_SECRET, marked secure only when COOKIE_SECURE=true, and
 * DATABASE_URL points to the prod DB. If any of these regress in production,
 * we want to refuse to boot, not silently serve unsafe traffic.
 *
 * `validateEnv` is called once at startup from `instrumentation.ts`. In
 * production it throws on any error; in development it returns warnings so
 * local-dev quirks (HTTP, localhost DB, dev-default JWT secret) don't break
 * the day-to-day loop.
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

  // Rule 3: DATABASE_URL — must exist, and must not point at a dev/local DB
  // (127.0.0.1, localhost, or a schema literally named piyin_dev). Catching
  // this at boot is cheaper than discovering it from corrupted user state
  // six hours later.
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

  for (const i of issues) {
    if (i.level === 'warn') console.warn(`[env] WARN [${i.var}] ${i.message}`);
  }
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    const msgs = errors.map((i) => `  - [${i.var}] ${i.message}`).join('\n');
    throw new Error(`Production environment validation failed:\n${msgs}`);
  }

  return {
    ok: errors.length === 0,
    issues,
  };
}