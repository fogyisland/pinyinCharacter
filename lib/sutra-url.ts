// Shared query-string handling for the /sutra list page.
//
// The page used to be a client component that kept the search term and the
// page number in React state and fetched the list from /api/sutras after
// the page had loaded. The list is now rendered on the server, so the URL
// is the single source of truth for the filter state.

export const SUTRA_PAGE_SIZE = 12;

export interface SutraQuery {
  q: string;
  page: number;
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Read the filter state out of a URL query. Every value is validated and
 * falls back to a safe default, so a hand-crafted link can never put the
 * page into a broken state.
 */
export function parseSutraQuery(
  params: Record<string, string | string[] | undefined>,
): SutraQuery {
  const q = firstValue(params.q).trim();
  const rawPage = Number.parseInt(firstValue(params.page), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { q, page };
}

/**
 * Build the /sutra href for a query. `overrides` replaces single fields of
 * the query, which is how the search box and the pagination links derive a
 * new URL from the current one.
 */
export function buildSutraHref(query: SutraQuery, overrides: Partial<SutraQuery> = {}): string {
  const merged: SutraQuery = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.page > 1) params.set('page', String(merged.page));
  return `/sutra${params.toString() ? `?${params.toString()}` : ''}`;
}
