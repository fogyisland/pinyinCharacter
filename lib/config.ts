import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import { isMissingTableError } from './db-error';

interface AppConfigRow extends RowDataPacket {
  key: string;
  value: string;
}

/**
 * Hosts the AI base URL may not point at.
 *
 * `ai.base_url` is admin-configurable and the AI client sends it an
 * `Authorization: Bearer <api key>` header. With `http://` and no host
 * restriction, a compromised (or simply careless) admin could point the
 * app at `http://127.0.0.1:3306/` or `http://169.254.169.254/` and turn
 * the server into a request proxy for the internal network — carrying the
 * API key with it.
 *
 * The base URL is a trusted-input boundary, so it gets a boundary of its
 * own: HTTPS only, and no address that resolves inside the machine.
 */
const BLOCKED_AI_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  // The cloud metadata endpoint. Reading it from a server is how a
  // credential usually leaks.
  '169.254.169.254',
  'metadata.google.internal',
]);

/**
 * True when the base URL is an https URL pointing at a host that is not
 * on the internal-address blocklist.
 *
 * An empty value is allowed (it means "not configured" — the caller
 * falls back to its default endpoint).
 */
function isValidAiBaseUrl(v: string): boolean {
  if (v.length === 0) return true;
  if (v.length > 256) return false;
  // https only. `http://` would put the API key on the wire in clear.
  if (!/^https:\/\//i.test(v)) return false;
  let host: string;
  try {
    host = new URL(v).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.length === 0) return false;
  if (BLOCKED_AI_HOSTS.has(host)) return false;
  // Any address in 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12 or
  // 192.168.0.0/16 is private. Matching on the literal prefix covers the
  // common spellings; a hostname that resolves to a private address is
  // not covered here, because the validator is synchronous and cannot
  // resolve.
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

const KEY_VALIDATORS: Record<string, (v: string) => boolean> = {
  'ai.base_url': isValidAiBaseUrl,
  'ai.api_key': (v) => v.length <= 256,
  'ai.model': (v) => v.length > 0 && v.length <= 64,
  'ai.rate_limit_per_user_per_day': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && n <= 1000;
  },
  'ai.timeout_ms': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 1000 && n <= 300000;
  },
  'ai.temperature': (v) => {
    const n = parseFloat(v);
    return !isNaN(n) && n >= 0 && n <= 2;
  },
  'tts.voice_male': (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
  'tts.voice_female': (v) => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(v),
  'tts.audio_format': (v) =>
    [
      'audio-24khz-48kbitrate-mono-mp3',
      'audio-24khz-96kbitrate-mono-mp3',
      'audio-16khz-32kbitrate-mono-mp3',
      'audio-16khz-128kbitrate-mono-mp3',
    ].includes(v),
  'smtp.transport': (v) => v === 'console' || v === 'smtp',
  'smtp.host': (v) => v.length === 0 || v.length <= 256,
  'smtp.port': (v) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535;
  },
  'smtp.secure': (v) => v === 'true' || v === 'false',
  'smtp.user': (v) => v.length <= 256,
  'smtp.pass': (v) => v.length <= 256,
  'smtp.from': (v) => v.length === 0 || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  'smtp.from_name': (v) => v.length <= 128,
  'notes.admin_emails': (v) => v.length <= 1024,
  'site.url': (v) => /^https?:\/\//.test(v) && v.length <= 256,
  'era.jiaguwen.font': (v) => ['Oracular', 'OracularInverted', 'YinQiJiaGuWen'].includes(v),
  'era.jinwen.font': (v) => ['WangHanzongWeibei', 'HanDianJinWen'].includes(v),
  'era.xiaozhuan.font': (v) => ['QuanZiKuShuoWen', 'HanDianJinWen'].includes(v),
  'era.lishu.font': (v) => ['WangHanzongLishu', 'ZCOOLXiaoWei'].includes(v),
  'era.kaishu.font': (v) => ['ZCOOLXiaoWei', 'KaiTi', 'Iansui', 'MaShanZheng'].includes(v),
  'wechat.enabled': (v) => v === 'true' || v === 'false',
  // ⚠️ An empty app id is allowed ON PURPOSE: it is how the admin
  // clears a mistyped one. The shape check happens where the value is
  // set — the route's schema and the store — not here.
  'wechat.app_id': (v) => v === '' || /^wx[0-9a-f]{16}$/.test(v),
  'wechat.app_secret': (v) => v.length > 0 && v.length <= 256,
};

/**
 * Process-wide cache for `app_config`.
 *
 * The root layout resolves the site URL on every request
 * (`lib/seo/config.ts` → `getConfig('site.url')`), so this used to mean one
 * extra DB round-trip per page render, plus one query per key for code paths
 * that read several keys (SMTP, TTS, PayPal).
 *
 * `app_config` holds ~30 rows, so a single `SELECT key, value` loads
 * everything and serves every read from memory. Writes invalidate the cache
 * immediately; a 60s TTL bounds how long a change made by *another* process
 * (e.g. a second app instance) can stay invisible.
 */
const CONFIG_TTL_MS = 60_000;

/**
 * How long a FAILED load is remembered, in milliseconds.
 *
 * A failed load used to be remembered for no time at all: the cache was
 * only written on success, so the next read queried the database again
 * and threw again. The root layout reads `site.url` three times per
 * render (itself, `buildOrganization`, `buildWebSite`), so one database
 * hiccup produced three queries and three identical stack traces — and
 * the same again on every request until the database came back.
 *
 * The failure is remembered so the queries collapse; the **error is still
 * thrown** to every caller, so the operator still learns about it. This
 * only bounds how often the database is asked, not who finds out.
 *
 * The window is short on purpose: a database that has just come back must
 * become visible again at once. Five seconds collapses the reads inside
 * one render without hiding a recovered database for a noticeable while.
 */
const CONFIG_FAILURE_TTL_MS = 5_000;

let configCache: { at: number; values: Map<string, string> } | null = null;
let inflightLoad: Promise<Map<string, string>> | null = null;

/**
 * The error from the last failed load, and when it happened.
 *
 * Held separately from `configCache` because it means the opposite thing:
 * `configCache` holds values, this holds the absence of them.
 */
let configFailure: { at: number; error: unknown } | null = null;

/**
 * Read every `app_config` row.
 *
 * A missing table is not a failure — it is "there is nothing here yet". The
 * /init wizard's first screen writes DATABASE_URL and its third screen
 * creates the tables, so between them the table is *guaranteed* to be
 * absent. The root layout reads `site.url` on every render (three times:
 * itself, `buildOrganization`, `buildWebSite`), so raising here turned a
 * perfectly normal first-run into a screenful of stack traces.
 *
 * To every caller "the table is not there" and "the table is there but has
 * no row for this key" mean the same thing: no value. So the missing table
 * becomes an empty result, and everything else keeps raising.
 */
async function loadConfigRows(): Promise<Map<string, string>> {
  try {
    const [rows] = await getPool().query<AppConfigRow[]>(`SELECT \`key\`, value FROM app_config`);
    const values = new Map<string, string>();
    for (const r of rows) values.set(r.key, r.value);
    return values;
  } catch (error) {
    if (isMissingTableError(error)) return new Map();
    throw error;
  }
}

async function getConfigMap(): Promise<Map<string, string>> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) {
    return configCache.values;
  }

  // A recent failure: do not ask the database again, just fail the same
  // way. The caller still gets the error — it is only the query that is
  // skipped.
  if (configFailure && Date.now() - configFailure.at < CONFIG_FAILURE_TTL_MS) {
    throw configFailure.error;
  }

  // Collapse concurrent misses into a single query.
  if (!inflightLoad) {
    const load = loadConfigRows()
      .then((values) => {
        // An empty result is never cached. "Empty" is what the table looks
        // like on a fresh install — before the wizard creates it, and for
        // the moment after CREATE TABLE but before the seed has run. The
        // seed writes with a direct INSERT (scripts/init-db.ts), NOT
        // through setConfig(), so nothing clears the cache from the
        // inside: a cached empty map would hide the seeded rows for a
        // whole TTL, and the site would keep serving placeholder canonical
        // URLs after the operator had already configured them.
        if (values.size > 0) {
          configCache = { at: Date.now(), values };
        } else {
          configCache = null;
        }
        // The load succeeded, so any remembered failure is stale.
        configFailure = null;
        return values;
      })
      .catch((error: unknown) => {
        // Remember the failure briefly so the next read does not query
        // the database again — but keep throwing it, so the failure is
        // still reported to every caller.
        configFailure = { at: Date.now(), error };
        throw error;
      })
      .finally(() => {
        if (inflightLoad === load) inflightLoad = null;
      });
    inflightLoad = load;
  }
  return inflightLoad;
}

/** Drop the cached config (used by writes and by tests). */
export function clearConfigCache(): void {
  configCache = null;
  configFailure = null;
}

export async function getConfig(key: string): Promise<string | null> {
  const values = await getConfigMap();
  return values.get(key) ?? null;
}

export async function setConfig(
  key: string,
  value: string,
  byUserId: number | null,
): Promise<void> {
  const validator = KEY_VALIDATORS[key];
  if (validator && !validator(value)) {
    throw new Error(`Invalid value for ${key}: ${value}`);
  }
  // Treat 0 (or any falsy) as "no user" — FK references users.id
  const effectiveUserId = byUserId || null;
  await getPool().query(
    `INSERT INTO app_config (\`key\`, value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    [key, value, effectiveUserId],
  );
  clearConfigCache();
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const values = await getConfigMap();
  return Object.fromEntries(values);
}

export async function setConfigBatch(
  updates: Record<string, string>,
  byUserId: number,
): Promise<void> {
  for (const [k, v] of Object.entries(updates)) {
    await setConfig(k, v, byUserId);
  }
}
