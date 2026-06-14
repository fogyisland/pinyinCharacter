// Load .env from the repo root before any test imports lib/db.
// Without this, vitest doesn't pick up .env and unit tests that need
// DATABASE_URL (admin-extensions, ai-calls, auth-disabled, config,
// downloads) fail with "DATABASE_URL is not set".
//
// We intentionally skip DATABASE_URL_TEST so integration tests that
// need a separate test DB cleanly skip when that DB doesn't exist
// on the current MySQL host (see integration/setup.ts HAS_DB guard).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '..', '..', '.env');
const SKIP_KEYS = new Set(['DATABASE_URL_TEST']);

if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (SKIP_KEYS.has(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
