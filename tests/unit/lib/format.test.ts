import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateTimeMinute,
  formatDateTimeShort,
  formatLocalDateTime,
  formatNumber,
  formatTime,
} from '@/lib/format';

/**
 * The shared formatters replaced the scattered `toLocaleString('zh-CN')`
 * calls. These tests pin the output to what those calls produced, so the
 * refactor never changes a rendered timestamp.
 */
const SAMPLE = new Date('2026-07-05T08:05:09');

describe('format helpers', () => {
  it('formats a date & time exactly like toLocaleString("zh-CN")', () => {
    expect(formatDateTime(SAMPLE)).toBe(SAMPLE.toLocaleString('zh-CN'));
  });

  it('formats a date exactly like toLocaleDateString("zh-CN")', () => {
    expect(formatDate(SAMPLE)).toBe(SAMPLE.toLocaleDateString('zh-CN'));
  });

  it('formats a date & time down to the minute with zero-padded parts', () => {
    expect(formatDateTimeMinute(SAMPLE)).toBe(
      SAMPLE.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('formats a short date & time without the year', () => {
    expect(formatDateTimeShort(SAMPLE)).toBe(
      SAMPLE.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('formats a time exactly like toLocaleTimeString("zh-CN")', () => {
    expect(formatTime(SAMPLE)).toBe(SAMPLE.toLocaleTimeString('zh-CN'));
  });

  it('formats a date & time in the browser locale', () => {
    expect(formatLocalDateTime(SAMPLE)).toBe(SAMPLE.toLocaleString());
  });

  it('formats a number exactly like toLocaleString("zh-CN")', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString('zh-CN'));
    expect(formatNumber(0)).toBe('0');
  });

  it('accepts ISO strings and epoch milliseconds', () => {
    expect(formatDateTime('2026-07-05T08:05:09.000Z')).toBe(
      new Date('2026-07-05T08:05:09.000Z').toLocaleString('zh-CN'),
    );
    expect(formatDateTime(SAMPLE.getTime())).toBe(SAMPLE.toLocaleString('zh-CN'));
  });

  it('falls back to an em dash for missing or invalid input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDateTimeMinute('not-a-date')).toBe('—');
    expect(formatDateTimeShort('not-a-date')).toBe('—');
    expect(formatTime('not-a-date')).toBe('—');
    expect(formatLocalDateTime('not-a-date')).toBe('—');
  });

  it('falls back to zero for a non-finite number', () => {
    expect(formatNumber(Number.NaN)).toBe('0');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
