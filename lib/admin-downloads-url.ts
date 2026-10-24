/**
 * URL state of the /admin/downloads page.
 *
 * The filter state lives in the query string, so the page can be rendered on
 * the server (one HTML request instead of an HTML request plus a JSON round
 * trip) and a filtered view can be shared as a link.
 *
 * Client-safe: no server-only imports.
 */
import {
  buildQuery,
  defaultFromDate,
  readIntParam,
  readParam,
  todayDate,
  type SearchParams,
} from './admin-url';

export const DOWNLOADS_PAGE_SIZE = 50;

/** Mirrors `DownloadSourceType` in lib/downloads.ts — kept local so this file stays client-safe. */
export type DownloadSourceTypeFilter = 'worksheet' | 'poem' | 'sutra' | 'rare-char-card';

export interface DownloadsQuery {
  sourceType: DownloadSourceTypeFilter | '';
  userId: string;
  from: string;
  to: string;
  page: number;
}

export const DOWNLOAD_SOURCE_OPTIONS: { value: DownloadSourceTypeFilter | ''; label: string }[] = [
  { value: '', label: '全部类型' },
  { value: 'worksheet', label: '字帖' },
  { value: 'poem', label: '古诗' },
  { value: 'sutra', label: '佛经' },
  { value: 'rare-char-card', label: '生字卡' },
];

const VALID_SOURCE_TYPES = new Set<string>(['worksheet', 'poem', 'sutra', 'rare-char-card']);

/** Validate a raw source type — an unknown type means "all types". */
export function parseDownloadSourceType(raw: string): DownloadSourceTypeFilter | '' {
  return VALID_SOURCE_TYPES.has(raw) ? (raw as DownloadSourceTypeFilter) : '';
}

/** The query a fresh visit to /admin/downloads starts from: the last 7 days. */
export function defaultDownloadsQuery(): DownloadsQuery {
  return {
    sourceType: '',
    userId: '',
    from: defaultFromDate(7),
    to: todayDate(),
    page: 1,
  };
}

/** Read the downloads filter state out of the page's `searchParams`. */
export function parseDownloadsQuery(params: SearchParams): DownloadsQuery {
  const sourceTypeRaw = readParam(params, 'sourceType');
  return {
    sourceType: parseDownloadSourceType(sourceTypeRaw),
    userId: readParam(params, 'userId'),
    from: readParam(params, 'from') || defaultFromDate(7),
    to: readParam(params, 'to') || todayDate(),
    page: readIntParam(params, 'page', 1),
  };
}

/** The href of the downloads page for `query`, with `override` applied on top. */
export function buildDownloadsHref(
  query: DownloadsQuery,
  override: Partial<DownloadsQuery> = {},
): string {
  const merged: DownloadsQuery = { ...query, ...override };
  const qs = buildQuery({
    sourceType: merged.sourceType,
    userId: merged.userId,
    from: merged.from,
    to: merged.to,
    page: merged.page > 1 ? merged.page : null,
  });
  return qs ? `/admin/downloads?${qs}` : '/admin/downloads';
}
