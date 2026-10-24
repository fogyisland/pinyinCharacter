/**
 * The AI configuration keys the admin UI manages.
 *
 * The list lives here instead of inside the API route so the route and the
 * server page agree on which keys exist and which of them are secrets.
 *
 * Client-safe: no server-only imports.
 */

export const AI_CONFIG_KEYS = [
  'ai.base_url',
  'ai.model',
  'ai.api_key',
  'ai.rate_limit_per_user_per_day',
  'ai.timeout_ms',
  'ai.temperature',
  'ai.thinking',
  'ai.max_completion_tokens',
] as const;

export type AiConfigKey = (typeof AI_CONFIG_KEYS)[number];

export const AI_SECRET_KEYS: ReadonlySet<AiConfigKey> = new Set(['ai.api_key']);

/** The config as the admin UI sees it — the secrets are blanked out. */
export function maskAiConfig(all: Record<string, string>): Record<string, string> {
  const config: Record<string, string> = {};
  for (const key of AI_CONFIG_KEYS) {
    config[key] = AI_SECRET_KEYS.has(key) ? '' : (all[key] ?? '');
  }
  return config;
}

/** Whether an API key is configured — its value is never exposed. */
export function hasAiApiKey(all: Record<string, string>): boolean {
  return !!all['ai.api_key'];
}
