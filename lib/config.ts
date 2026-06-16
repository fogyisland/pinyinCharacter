import { getPool } from './db';

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
  'tts.audio_format': (v) => [
    'audio-24khz-48kbitrate-mono-mp3',
    'audio-24khz-96kbitrate-mono-mp3',
    'audio-16khz-32kbitrate-mono-mp3',
    'audio-16khz-128kbitrate-mono-mp3',
  ].includes(v),
};

export async function getConfig(key: string): Promise<string | null> {
  const [rows] = await getPool().query<any[]>(
    `SELECT value FROM app_config WHERE \`key\` = ? LIMIT 1`,
    [key],
  );
  return rows.length ? rows[0].value : null;
}

export async function setConfig(key: string, value: string, byUserId: number | null): Promise<void> {
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
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const [rows] = await getPool().query<any[]>(`SELECT \`key\`, value FROM app_config`);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setConfigBatch(updates: Record<string, string>, byUserId: number): Promise<void> {
  for (const [k, v] of Object.entries(updates)) {
    await setConfig(k, v, byUserId);
  }
}
