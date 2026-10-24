/**
 * Shared date & number formatters.
 *
 * `toLocaleString('zh-CN')` builds a brand new `Intl.DateTimeFormat` on every
 * call, which is expensive: the admin tables format one timestamp per cell
 * and the charts format every axis tick. The formatters below are created
 * once per process and reused — identical output, a fraction of the cost.
 *
 * The options were chosen to match `toLocaleString('zh-CN')` exactly:
 * `hourCycle: 'h23'` keeps midnight at `00:xx` instead of the `24:xx` that
 * some ICU versions produce for the zh-CN locale.
 */

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const dateTimeMinuteFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateTimeShortFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Mirrors `Date.prototype.toLocaleString()` without a pinned locale: the
// browser's own locale decides how the timestamp reads.
const localDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const numberFormatter = new Intl.NumberFormat('zh-CN');

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026/10/24 13:12:00` — the zh-CN default date & time format. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : '—';
}

/** `2026/10/24` — the zh-CN default date format. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '—';
}

/** `2026/10/24 13:12` — date & time down to the minute, zero-padded. */
export function formatDateTimeMinute(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeMinuteFormatter.format(date) : '—';
}

/** `10/24 13:12` — date & time down to the minute, without the year. */
export function formatDateTimeShort(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeShortFormatter.format(date) : '—';
}

/** `1,234,567` — the zh-CN default number format. */
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormatter.format(value) : '0';
}

/** `13:12:00` — the zh-CN default time format. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : '—';
}

/** Date & time in the browser's own locale — mirrors `toLocaleString()`. */
export function formatLocalDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? localDateTimeFormatter.format(date) : '—';
}
