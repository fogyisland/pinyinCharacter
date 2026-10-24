// Shared query-string handling for the /poetry list page.
//
// The page used to be a client component that kept dynasty / q / form /
// page in React state and fetched the list from /api/poetry after the
// page had loaded. The list is now rendered on the server, so the URL is
// the single source of truth for the filter state: a filtered list can be
// reloaded, shared and linked to.

export const POETRY_DEFAULT_DYNASTY = 'tang';
export const POETRY_PAGE_SIZE = 24;

export interface PoetryQuery {
  dynasty: string;
  q: string;
  forms: string[];
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
export function parsePoetryQuery(
  params: Record<string, string | string[] | undefined>,
): PoetryQuery {
  const dynasty = firstValue(params.dynasty).trim() || POETRY_DEFAULT_DYNASTY;
  const q = firstValue(params.q).trim();
  const forms = firstValue(params.form)
    .split(',')
    .map((form) => form.trim())
    .filter(Boolean);
  const rawPage = Number.parseInt(firstValue(params.page), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { dynasty, q, forms, page };
}

/**
 * Build the /poetry href for a query. `overrides` replaces single fields
 * of the query, which is how the filter island and the pagination links
 * derive a new URL from the current one.
 */
export function buildPoetryHref(
  query: PoetryQuery,
  overrides: Partial<PoetryQuery> = {},
): string {
  const merged: PoetryQuery = { ...query, ...overrides };
  const params = new URLSearchParams();
  params.set('dynasty', merged.dynasty);
  if (merged.q) params.set('q', merged.q);
  if (merged.forms.length > 0) params.set('form', merged.forms.join(','));
  if (merged.page > 1) params.set('page', String(merged.page));
  return `/poetry?${params.toString()}`;
}
