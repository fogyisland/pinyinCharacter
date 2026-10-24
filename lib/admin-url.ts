/**
 * Shared helpers for the admin pages' URL-based filter state.
 *
 * The admin pages read their filters from the query string, render their data
 * on the server and let a small client island push a new query string. Keeping
 * the parsing and the building in one place means a page and its filter bar
 * can never disagree about what a query means.
 *
 * Client-safe: no server-only imports (no mysql2, no next/server).
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** `2026-10-24` — the `yyyy-mm-dd` form an `<input type="date">` uses. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The default `from` date: `days` days before today. */
export function defaultFromDate(days = 7): string {
  return isoDate(new Date(Date.now() - days * 86_400_000));
}

/** Today's date. */
export function todayDate(): string {
  return isoDate(new Date());
}

/**
 * The first value of `key`. A repeated query param yields an array — the
 * first entry wins, which matches what `URLSearchParams.get()` returns.
 */
export function readParam(params: SearchParams, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** A positive integer param, or `fallback` when it is missing or invalid. */
export function readIntParam(params: SearchParams, key: string, fallback: number): number {
  const raw = readParam(params, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Turn the `from` / `to` date inputs into the ISO timestamps the queries
 * expect: `from` is the start of the day, `to` the end of it.
 */
export function dateRangeToIso(from: string, to: string): { from?: string; to?: string } {
  const range: { from?: string; to?: string } = {};
  if (from) {
    const start = new Date(from);
    if (!Number.isNaN(start.getTime())) range.from = start.toISOString();
  }
  if (to) {
    const end = new Date(`${to}T23:59:59`);
    if (!Number.isNaN(end.getTime())) range.to = end.toISOString();
  }
  return range;
}

/** Build a query string, dropping the empty values. */
export function buildQuery(entries: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** A user id filter: only a plain integer is a valid id. */
export function parseUserId(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
