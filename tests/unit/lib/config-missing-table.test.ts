/**
 * `lib/config.ts` — 当 `app_config` 表还不存在时。
 *
 * 首次部署时，向导的第 1 屏写下 DATABASE_URL，第 3 屏才建表。在这两屏
 * 之间 `app_config` **必然**不存在 —— 而根布局每渲染一个页面就要读三次
 * `site.url`（布局自己一次，JSON-LD 的 buildOrganization 与 buildWebSite
 * 各一次），于是每次渲染都抛出
 *
 *     Table 'pinyin_test.app_config' doesn't exist
 *
 * `lib/seo/config.ts` 把它当成运行时故障，打了一条 console.error。新装的
 * 运维看到的是一屏红色堆栈，而系统其实完全正常 —— 表只是还没建。
 *
 * "表不存在"和"表在、但这个 key 没配"对调用方是同一件事：没有值。所以它
 * 不该是错误，而该是空结果。真正的故障（连接被拒、权限不足、超时）仍然
 * 必须抛出来 —— 那才是运维需要知道的事。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { getConfig, getAllConfig, clearConfigCache } from '@/lib/config';
import { getRuntimeSiteUrl } from '@/lib/seo/config';

/**
 * The error mysql2 raises when the table (or the schema holding it) is not
 * there. The three identifiers are all populated, the way the driver does it.
 */
function missingTableError(): Error {
  const error = new Error("Table 'pinyin_test.app_config' doesn't exist") as Error & {
    code: string;
    errno: number;
    sqlState: string;
  };
  error.code = 'ER_NO_SUCH_TABLE';
  error.errno = 1146;
  error.sqlState = '42S02';
  return error;
}

/** A different failure entirely: the database said no. */
function accessDeniedError(): Error {
  const error = new Error("Access denied for user 'root'@'localhost'") as Error & {
    code: string;
  };
  error.code = 'ER_ACCESS_DENIED_ERROR';
  return error;
}

const ENV_KEYS = ['DATABASE_URL', 'NEXT_PUBLIC_SITE_URL'] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

beforeEach(() => {
  queryMock.mockReset();
  clearConfigCache();
  // A configured database is what made the old behaviour noisy: the SEO
  // layer only logs when there IS a DATABASE_URL to complain about.
  process.env.DATABASE_URL = 'mysql://root@127.0.0.1:3306/pinyin_test';
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  clearConfigCache();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('lib/config — the table is not there yet', () => {
  it('answers null instead of raising', async () => {
    queryMock.mockRejectedValue(missingTableError());
    await expect(getConfig('site.url')).resolves.toBeNull();
  });

  it('answers an empty object instead of raising', async () => {
    queryMock.mockRejectedValue(missingTableError());
    await expect(getAllConfig()).resolves.toEqual({});
  });

  it('sees the rows the moment they exist — no stale window', async () => {
    // The table is not there yet.
    queryMock.mockRejectedValueOnce(missingTableError());
    await expect(getConfig('site.url')).resolves.toBeNull();

    // The wizard's third step creates it and seeds it. The seed writes with a
    // direct INSERT (scripts/init-db.ts), NOT through setConfig(), so the
    // cache is never invalidated from the inside — the read has to find out
    // by itself.
    queryMock.mockResolvedValueOnce([[{ key: 'site.url', value: 'https://example.com' }], []]);
    await expect(getConfig('site.url')).resolves.toBe('https://example.com');

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('sees the rows the moment they exist even when the table was merely empty', async () => {
    // The table exists but holds nothing — the state right after
    // CREATE TABLE, before the seed has run.
    queryMock.mockResolvedValueOnce([[], []]);
    await expect(getConfig('site.url')).resolves.toBeNull();

    queryMock.mockResolvedValueOnce([[{ key: 'site.url', value: 'https://example.com' }], []]);
    await expect(getConfig('site.url')).resolves.toBe('https://example.com');

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('downgrades only a missing table — a real failure still raises', async () => {
    queryMock.mockRejectedValue(accessDeniedError());
    await expect(getConfig('site.url')).rejects.toThrow('Access denied');
  });
});

describe('lib/seo/config — during the wizard, before the tables exist', () => {
  it('says nothing at all', async () => {
    queryMock.mockRejectedValue(missingTableError());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await getRuntimeSiteUrl();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('falls back to the default site URL — the page still renders', async () => {
    queryMock.mockRejectedValue(missingTableError());
    await expect(getRuntimeSiteUrl()).resolves.toBe('http://localhost:3000');
  });
});
