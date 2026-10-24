/**
 * URL state of the /admin/logs page.
 *
 * The filter state lives in the query string, so the page can be rendered on
 * the server (one HTML request instead of an HTML request plus a JSON round
 * trip) and a filtered view can be shared as a link.
 *
 * Client-safe: no server-only imports.
 */
import { AUDIT_EVENTS, EVENT_LABEL } from './audit-format';
import type { UnifiedLogSource } from './admin-logs-types';
import {
  buildQuery,
  defaultFromDate,
  readIntParam,
  readParam,
  todayDate,
  type SearchParams,
} from './admin-url';

export const LOGS_PAGE_SIZE = 50;

export interface LogsQuery {
  source: UnifiedLogSource | '';
  type: string;
  userId: string;
  ip: string;
  from: string;
  to: string;
  page: number;
}

export const LOG_SOURCE_OPTIONS: { value: UnifiedLogSource | ''; label: string }[] = [
  { value: '', label: '全部来源' },
  { value: 'audit', label: '审计日志' },
  { value: 'download', label: '下载' },
  { value: 'ai_call', label: 'AI 调用' },
];

/**
 * The `feature` values an `ai_calls` row can carry. The event filter matches
 * `audit_log.event` for the audit source, the constant `download_logged` for
 * downloads and `ai_calls.feature` for AI calls — so all three lists belong
 * in one dropdown.
 */
export const AI_CALL_FEATURES = [
  'about-intro',
  'char-explain',
  'char-meaning-en',
  'char-meaning-zh',
  'char-recognize',
  'etymology-story',
  'rare-char-content',
  'rare-char-story-batch',
] as const;

export interface LogEventGroup {
  label: string;
  options: { value: string; label: string }[];
}

export const LOG_EVENT_GROUPS: LogEventGroup[] = [
  {
    label: '审计事件',
    options: AUDIT_EVENTS.map((event) => ({ value: event, label: EVENT_LABEL[event] })),
  },
  {
    label: '合成事件',
    options: [{ value: 'download_logged', label: '下载记录' }],
  },
  {
    label: 'AI 功能',
    options: AI_CALL_FEATURES.map((feature) => ({ value: feature, label: feature })),
  },
];

const VALID_SOURCES = new Set<string>(['audit', 'download', 'ai_call']);

/** Validate a raw source value — an unknown source means "all sources". */
export function parseLogSource(raw: string): UnifiedLogSource | '' {
  return VALID_SOURCES.has(raw) ? (raw as UnifiedLogSource) : '';
}

/** The query a fresh visit to /admin/logs starts from: the last 7 days. */
export function defaultLogsQuery(): LogsQuery {
  return {
    source: '',
    type: '',
    userId: '',
    ip: '',
    from: defaultFromDate(7),
    to: todayDate(),
    page: 1,
  };
}

/** Read the logs filter state out of the page's `searchParams`. */
export function parseLogsQuery(params: SearchParams): LogsQuery {
  const sourceRaw = readParam(params, 'source');
  return {
    source: parseLogSource(sourceRaw),
    type: readParam(params, 'type'),
    userId: readParam(params, 'userId'),
    ip: readParam(params, 'ip'),
    from: readParam(params, 'from') || defaultFromDate(7),
    to: readParam(params, 'to') || todayDate(),
    page: readIntParam(params, 'page', 1),
  };
}

/** The href of the logs page for `query`, with `override` applied on top. */
export function buildLogsHref(query: LogsQuery, override: Partial<LogsQuery> = {}): string {
  const merged: LogsQuery = { ...query, ...override };
  const qs = buildQuery({
    source: merged.source,
    type: merged.type,
    userId: merged.userId,
    ip: merged.ip,
    from: merged.from,
    to: merged.to,
    page: merged.page > 1 ? merged.page : null,
  });
  return qs ? `/admin/logs?${qs}` : '/admin/logs';
}
