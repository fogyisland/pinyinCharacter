/**
 * URL state of the /admin/ai page.
 *
 * The tab and the call filters live in the query string, so the page can be
 * rendered on the server (one HTML request instead of an HTML request plus a
 * JSON round trip) and a filtered view can be shared as a link.
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

export type AiTab = 'calls' | 'config' | 'mock';

export const AI_TABS: { value: AiTab; label: string }[] = [
  { value: 'calls', label: '调用记录' },
  { value: 'config', label: '配置' },
  { value: 'mock', label: 'Mock 模式' },
];

/** The `status` values an `ai_calls` row can carry. */
export type AiCallStatusFilter = 'ok' | 'error' | 'rate-limited';

export const AI_STATUS_OPTIONS: { value: AiCallStatusFilter | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'ok', label: '成功' },
  { value: 'error', label: '失败' },
  { value: 'rate-limited', label: '限流' },
];

export interface AiCallsQuery {
  feature: string;
  status: AiCallStatusFilter | '';
  userId: string;
  from: string;
  to: string;
  page: number;
}

const VALID_TABS = new Set<string>(['calls', 'config', 'mock']);
const VALID_STATUS = new Set<string>(['ok', 'error', 'rate-limited']);

/** Validate a raw tab value — an unknown tab means the call list. */
export function parseAiTab(raw: string): AiTab {
  return VALID_TABS.has(raw) ? (raw as AiTab) : 'calls';
}

/** Validate a raw status value — an unknown status means "all statuses". */
export function parseAiStatus(raw: string): AiCallStatusFilter | '' {
  return VALID_STATUS.has(raw) ? (raw as AiCallStatusFilter) : '';
}

/** The query a fresh visit to the call list starts from: the last 7 days. */
export function defaultAiCallsQuery(): AiCallsQuery {
  return {
    feature: '',
    status: '',
    userId: '',
    from: defaultFromDate(7),
    to: todayDate(),
    page: 1,
  };
}

/** Read the call filter state out of the page's `searchParams`. */
export function parseAiCallsQuery(params: SearchParams): AiCallsQuery {
  return {
    feature: readParam(params, 'feature'),
    status: parseAiStatus(readParam(params, 'status')),
    userId: readParam(params, 'userId'),
    from: readParam(params, 'from') || defaultFromDate(7),
    to: readParam(params, 'to') || todayDate(),
    page: readIntParam(params, 'page', 1),
  };
}

/**
 * The href of the AI page. The call filters only apply to the call list, so
 * the other tabs drop them and keep the URL readable.
 */
export function buildAiHref(
  tab: AiTab,
  query: AiCallsQuery = defaultAiCallsQuery(),
  override: Partial<AiCallsQuery> = {},
): string {
  if (tab !== 'calls') return `/admin/ai?tab=${tab}`;
  const merged: AiCallsQuery = { ...query, ...override };
  const qs = buildQuery({
    feature: merged.feature,
    status: merged.status,
    userId: merged.userId,
    from: merged.from,
    to: merged.to,
    page: merged.page > 1 ? merged.page : null,
  });
  return qs ? `/admin/ai?${qs}` : '/admin/ai';
}
