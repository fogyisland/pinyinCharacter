/**
 * `lib/config.ts` — the `app_config` cache, and what it does when the
 * database is not there.
 *
 * The cache is written only on success, so a failed load used to be
 * remembered for no time at all: the next read queried the database
 * again and threw again. The root layout reads `site.url` three times
 * per render (itself, `buildOrganization`, `buildWebSite`), so one
 * database hiccup produced three queries and three identical stack
 * traces — and the same again on every request until the database came
 * back.
 *
 * The failure is now remembered briefly, so the queries collapse. The
 * error is still thrown to every caller: the operator still finds out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: queryMock,
  }),
}));

import { getConfig, clearConfigCache } from '@/lib/config';

beforeEach(() => {
  // `mockReset` rather than `clearAllMocks`: the latter keeps the queued
  // `Once` implementations, so a leftover response from the previous
  // test would answer the next one's first query.
  queryMock.mockReset();
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
});

describe('lib/config — the app_config cache', () => {
  it('reads the table once and serves the rest from memory', async () => {
    queryMock.mockResolvedValue([
      [
        { key: 'site.url', value: 'https://example.com' },
        { key: 'ai.model', value: 'gpt-4o-mini' },
      ],
      [],
    ]);

    await expect(getConfig('site.url')).resolves.toBe('https://example.com');
    await expect(getConfig('ai.model')).resolves.toBe('gpt-4o-mini');
    await expect(getConfig('site.url')).resolves.toBe('https://example.com');

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('asks the database once when it fails, not once per read', async () => {
    queryMock.mockRejectedValue(new Error("Table 'app_config' doesn't exist"));

    // Every read still fails — the failure is not swallowed.
    await expect(getConfig('site.url')).rejects.toThrow("Table 'app_config' doesn't exist");
    await expect(getConfig('site.url')).rejects.toThrow("Table 'app_config' doesn't exist");
    await expect(getConfig('site.url')).rejects.toThrow("Table 'app_config' doesn't exist");

    // But the table was only asked once.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('throws the same error object, not a copy of it', async () => {
    const failure = new Error('connection refused');
    queryMock.mockRejectedValue(failure);

    await expect(getConfig('site.url')).rejects.toBe(failure);
    await expect(getConfig('site.url')).rejects.toBe(failure);

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent reads into one query even when it fails', async () => {
    queryMock.mockRejectedValue(new Error('boom'));

    const results = await Promise.allSettled([
      getConfig('site.url'),
      getConfig('ai.model'),
      getConfig('tts.voice_male'),
    ]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
    }
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('retries the database after the failure window passes', async () => {
    vi.useFakeTimers();
    try {
      queryMock.mockRejectedValueOnce(new Error('boom'));
      await expect(getConfig('site.url')).rejects.toThrow('boom');

      // Inside the window: the database is not asked again.
      vi.advanceTimersByTime(1_000);
      await expect(getConfig('site.url')).rejects.toThrow('boom');
      expect(queryMock).toHaveBeenCalledTimes(1);

      // Past the window: it is asked again, and this time it answers.
      queryMock.mockResolvedValueOnce([[{ key: 'site.url', value: 'https://back.example.com' }], []]);
      vi.advanceTimersByTime(6_000);
      await expect(getConfig('site.url')).resolves.toBe('https://back.example.com');
      expect(queryMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets a failure once the table answers again', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    await expect(getConfig('site.url')).rejects.toThrow('boom');

    // The database is not asked again while the failure is remembered —
    // that is the whole point of the window.
    await expect(getConfig('site.url')).rejects.toThrow('boom');
    expect(queryMock).toHaveBeenCalledTimes(1);

    // Past the window the database answers, and the answer sticks.
    vi.useFakeTimers();
    try {
      queryMock.mockResolvedValueOnce([[{ key: 'site.url', value: 'https://back.example.com' }], []]);
      vi.advanceTimersByTime(6_000);
      await expect(getConfig('site.url')).resolves.toBe('https://back.example.com');
      await expect(getConfig('site.url')).resolves.toBe('https://back.example.com');
      expect(queryMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache the failure across a cache clear', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    await expect(getConfig('site.url')).rejects.toThrow('boom');

    // A write (or a test) clears the cache — and with it the failure.
    clearConfigCache();

    queryMock.mockResolvedValueOnce([[{ key: 'site.url', value: 'https://back.example.com' }], []]);
    await expect(getConfig('site.url')).resolves.toBe('https://back.example.com');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
