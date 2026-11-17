import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { isSetupRouteEnabled } from '@/lib/setup';

beforeEach(() => {
  queryMock.mockReset();
  process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test';
});

/**
 * The /init route gate.
 *
 * Every route behind this gate is unauthenticated, and one of them
 * (`POST /api/init/db-config`) rewrites `.env` — including `JWT_SECRET`.
 * So the gate has ONE rule: if it cannot prove the route should be open,
 * it must not open it.
 *
 * The version this replaces failed OPEN on three separate paths, and
 * each one was a remote takeover:
 *
 *   1. no `DATABASE_URL`        → true
 *   2. no `setup.route_enabled` row → true
 *   3. any database error       → true
 *
 * Path 2 and path 3 are the ones that bit: this project treats "schema
 * behind code" (`ER_NO_SUCH_TABLE`) as a recurring, normal state, so a
 * production site whose `app_config` table went missing silently
 * re-opened every `/api/init/*` endpoint to the internet.
 */
describe('isSetupRouteEnabled — the gate fails CLOSED', () => {
  it('is open before setup, when there is no DATABASE_URL at all', async () => {
    // The genuine first-run state: the wizard has to be reachable, and
    // its first step is the form that fills DATABASE_URL in.
    delete process.env.DATABASE_URL;
    expect(await isSetupRouteEnabled()).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('is open when the flag row says "true"', async () => {
    queryMock.mockResolvedValueOnce([[{ value: 'true' }]]);
    expect(await isSetupRouteEnabled()).toBe(true);
  });

  it('is CLOSED when the flag row says "false"', async () => {
    // This is the state `markSetupComplete()` leaves behind, so it is the
    // state of every healthy production install.
    queryMock.mockResolvedValueOnce([[{ value: 'false' }]]);
    expect(await isSetupRouteEnabled()).toBe(false);
  });

  it('is CLOSED when the flag row is missing entirely', async () => {
    // ⚠️ This is the regression that mattered.
    //
    // The row is written by `markSetupComplete()`, so its absence means
    // "nobody ever made a decision" — not "the route is open". The old
    // code read the missing row as `true`, which left every install that
    // completed setup through a path that did not write the row (the
    // `init-db` CLI, a partial wizard run) with the wizard open.
    queryMock.mockResolvedValueOnce([[]]);
    expect(await isSetupRouteEnabled()).toBe(false);
  });

  it('is CLOSED when the database cannot be reached', async () => {
    // An unreachable database cannot confirm that the route should be
    // open. Same discipline as `lib/auth.ts`: "we cannot check right now"
    // is never "permission granted".
    queryMock.mockRejectedValueOnce(new Error('pool gone'));
    expect(await isSetupRouteEnabled()).toBe(false);
  });

  it('is CLOSED when the app_config table does not exist', async () => {
    // ⚠️ The recurring failure mode of this project.
    //
    // A missing table is reported as ER_NO_SUCH_TABLE / errno 1146 /
    // SQLSTATE 42S02. The old code caught EVERY error and returned
    // `true`, so a production site whose schema lagged its code had the
    // whole /init surface open to the internet — including the route
    // that rewrites `.env`.
    const missing = Object.assign(new Error("Table 'app_config' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE',
      errno: 1146,
      sqlState: '42S02',
    });
    queryMock.mockRejectedValueOnce(missing);

    expect(await isSetupRouteEnabled()).toBe(false);
  });

  it('is CLOSED when the flag row holds a value it does not understand', async () => {
    // Anything that is not the literal "true" is closed. A typo in the
    // flag must not open the door.
    queryMock.mockResolvedValueOnce([[{ value: 'TRUE' }]]);
    expect(await isSetupRouteEnabled()).toBe(false);
  });
});
