/**
 * First-time setup wizard helpers (used by /init and /api/init/*).
 *
 * The /init wizard runs once on a fresh deployment:
 *   1. User enters DB host/user/password/schema → server validates the
 *      connection, then writes DATABASE_URL to project-root .env.
 *   2. User enters admin username/password → server creates the first
 *      admin user with bcrypt hash.
 *   3. User clicks "开始初始化" → server runs initDb() which builds the
 *      15 tables, seeds app_config defaults, and auto-populates
 *      poems/sutras/chars from JSON sources.
 *
 * After step 3, the wizard sets `setup.completed = "true"` in app_config
 * and the middleware stops redirecting to /init. The route also becomes
 * inaccessible by default — admins must re-enable it via /admin/settings
 * for re-runs (debugging, schema reset, etc.).
 *
 * Why this is a separate module rather than inline:
 *   - Pure helpers (env var parsing, connection probe) are easy to unit test
 *   - Both /init UI and /api/init routes need the same primitives
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';

const ENV_PATH = join(process.cwd(), '.env');

/**
 * Generate a cryptographically random JWT secret. 32 bytes → 44 base64 chars,
 * comfortably above the validateEnv 32-char floor and resistant to brute force.
 */
export function generateJwtSecret(): string {
  return randomBytes(32).toString('base64');
}

export interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DbConnectionResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify a candidate DB URL by opening a connection and pinging. Uses mysql2
 * directly (not the shared pool) so we don't pollute getPool() with a config
 * that may turn out to be wrong. Also tries CREATE DATABASE IF NOT EXISTS so
 * the user only has to enter a name that may or may not exist yet.
 */
export async function testDbConnection(cfg: DbConnectionConfig): Promise<DbConnectionResult> {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 10000,
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
}

/**
 * Build a DATABASE_URL string from structured input. mysql2 accepts both
 * `mysql://user:pass@host:port/db?params` and `mysql://...` with query params.
 */
export function buildDatabaseUrl(cfg: DbConnectionConfig): string {
  const u = encodeURIComponent(cfg.user);
  const p = encodeURIComponent(cfg.password);
  return `mysql://${u}:${p}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

/**
 * Append-or-replace a single KEY=value in project-root .env. Preserves
 * existing comments and other keys. Operates line-by-line so we don't need a
 * dotenv parser. Returns the new file contents.
 *
 * WARNING: caller is responsible for ensuring the value does not contain
 * a newline. The form input is validated server-side.
 */
export function writeEnvVar(key: string, value: string): void {
  const escaped = value.replace(/\n/g, '');
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${key}=${escaped}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    lines.push(`${key}=${escaped}`);
  }
  // Ensure trailing newline
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('');
  }
  writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

/**
 * Set multiple env vars in one pass. Used by /api/init/db-config which writes
 * DATABASE_URL + JWT_SECRET + COOKIE_SECURE together.
 */
export function writeEnvVars(updates: Record<string, string>): void {
  for (const [k, v] of Object.entries(updates)) {
    writeEnvVar(k, v);
  }
}

/**
 * Parse project-root .env into a record. Skips blank lines and comments
 * (`#`). Splits on the first `=` per line, trims whitespace, and preserves
 * the value verbatim (no quote-stripping — writeEnvVar writes unquoted).
 *
 * Used by /api/init/db-config after writeEnvVars() to refresh process.env
 * in the running Next.js process (Node doesn't auto-reload .env after
 * startup, so subsequent requests in the same process would otherwise
 * still see the pre-init DATABASE_URL=undefined).
 */
export function loadEnvFromFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf8');
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Re-read .env from disk and merge into process.env. Called by /init
 * step 1 after writing DATABASE_URL/JWT_SECRET/COOKIE_SECURE so the
 * running process picks up the new values without a restart.
 */
export function reloadProcessEnvFromFile(): void {
  const fromFile = loadEnvFromFile();
  for (const [k, v] of Object.entries(fromFile)) {
    process.env[k] = v;
  }
}

/**
 * Check whether the system has been initialized. We use the app_config flag
 * `setup.completed` set at the end of /init step 3. This is the source of
 * truth — middleware redirects to /init when false.
 *
 * Defensive: returns false on any DB error (so a broken pool doesn't lock
 * the user out of /init). Caller should not treat a false negative as fatal.
 */
export async function isSetupComplete(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { getPool } = await import('./db');
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = 'setup.completed' LIMIT 1`,
    );
    return rows.length > 0 && rows[0].value === 'true';
  } catch {
    return false;
  }
}

/**
 * Whether the /init route is currently enabled. Default false after setup
 * completes — admins must toggle this back on via /admin/settings/setup
 * to re-run setup (e.g. schema reset).
 */
export async function isSetupRouteEnabled(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true; // Pre-setup: route is always available
  try {
    const { getPool } = await import('./db');
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = 'setup.route_enabled' LIMIT 1`,
    );
    return rows.length === 0 || rows[0].value === 'true';
  } catch {
    return true;
  }
}

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

/**
 * Mark setup as complete in app_config. Called by /api/init/run-seed after
 * initDb() succeeds. Sets both the completed flag and route_enabled=false
 * so the wizard locks itself out by default.
 */
export async function markSetupComplete(): Promise<void> {
  const { getPool } = await import('./db');
  const pool = getPool();
  await pool.query(
    `INSERT INTO app_config (\`key\`, value) VALUES
       ('setup.completed', 'true'),
       ('setup.route_enabled', 'false'),
       ('setup.completed_at', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [new Date().toISOString()],
  );
}

/**
 * Toggle /init route availability. Admin-only — used by /admin/settings/setup.
 */
export async function setSetupRouteEnabled(enabled: boolean): Promise<void> {
  const { getPool } = await import('./db');
  await getPool().query(
    `INSERT INTO app_config (\`key\`, value) VALUES ('setup.route_enabled', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [enabled ? 'true' : 'false'],
  );
}