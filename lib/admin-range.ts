/**
 * Time-range filter shared across /admin/* analytics surfaces.
 *
 * `?range=1d|7d|30d|90d` is parsed server-side from the page's `searchParams`
 * prop and translated to a SQL WHERE clause. Wave 2 (analytics detail page)
 * and Wave 3 (overview redesign) compose on these helpers.
 */

export type Range = '1d' | '7d' | '30d' | '90d';

export const DEFAULT_RANGE: Range = '7d';

export const ALL_RANGES: readonly Range[] = ['1d', '7d', '30d', '90d'] as const;

const RANGE_DAYS: Record<Range, 1 | 7 | 30 | 90> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Parse `?range=` value into a Range. Never throws — unknown / missing /
 * array values fall back to DEFAULT_RANGE so a broken URL never 500s.
 */
export function parseRange(raw: string | string[] | undefined): Range {
  if (typeof raw === 'string' && (ALL_RANGES as readonly string[]).includes(raw)) {
    return raw as Range;
  }
  return DEFAULT_RANGE;
}

export function rangeToDays(range: Range): 1 | 7 | 30 | 90 {
  return RANGE_DAYS[range];
}

/**
 * SQL WHERE fragment equivalent to `created_at >= (today - N days)`.
 * Combine with AND into a larger WHERE; params must be bound in the same
 * order they appear in the surrounding SQL.
 */
export function rangeToSinceClause(range: Range): { sql: string; params: number[] } {
  const days = rangeToDays(range);
  return {
    sql: 'created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    params: [days],
  };
}
