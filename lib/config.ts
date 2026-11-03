import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

interface AppConfigRow extends RowDataPacket {
  key: string;
  value: string;
}

const KEY_VALIDATORS: Record<string, (v: string) => boolean> = {
  'ai.base_url': (v) => v.length === 0 || (/^https?:\/\//.test(v) && v.length <= 256),
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

async function loadConfigRows(): Promise<Map<string, string>> {
  const [rows] = await getPool().query<AppConfigRow[]>(`SELECT \`key\`, value FROM app_config`);
  const values = new Map<string, string>();
  for (const r of rows) values.set(r.key, r.value);
  return values;
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
        configCache = { at: Date.now(), values };
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
