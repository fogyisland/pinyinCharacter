import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSession,
  getSessionStore,
  MAX_SESSIONS,
  setSession,
  SESSION_IDLE_TTL_MS,
  sweepSessions,
  touchSession,
  type McpSession,
  type NewMcpSession,
} from '@/mcp/session-store';

/**
 * The session store.
 *
 * The store is the only place that knows when a session was last used, and
 * it is the only place that may write one — a caller that stamps the
 * timestamp itself would eventually forget to, and the session would then
 * be evicted as idle the moment it is created.
 */

/** A session whose transport and server can be watched. */
interface FakeSession extends NewMcpSession {
  closeTransport: ReturnType<typeof vi.fn>;
  closeServer: ReturnType<typeof vi.fn>;
}

/** A stand-in for a session — the store never calls anything but close. */
function fakeSession(userId = 1): FakeSession {
  const closeTransport = vi.fn().mockResolvedValue(undefined);
  const closeServer = vi.fn().mockResolvedValue(undefined);
  return {
    server: { close: closeServer } as unknown as McpSession['server'],
    transport: { close: closeTransport } as unknown as McpSession['transport'],
    userId,
    closeTransport,
    closeServer,
  };
}

/** Let the clock move on, so two timestamps cannot be the same millisecond. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  getSessionStore().clear();
});

describe('the session store', () => {
  it('stamps the last use itself', () => {
    const before = Date.now();
    setSession('a', fakeSession());
    const session = getSession('a');
    expect(session).toBeDefined();
    expect(session?.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  it('touching an unknown session does nothing', () => {
    touchSession('ghost');
    expect(getSessionStore().size).toBe(0);
    expect(getSession('ghost')).toBeUndefined();
  });
});

describe('sweeping the sessions', () => {
  it('drops a session that has been idle for too long, and closes it', () => {
    const session = fakeSession();
    setSession('a', session);

    const removed = sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: MAX_SESSIONS,
      now: Date.now() + SESSION_IDLE_TTL_MS + 1000,
    });

    expect(removed).toBe(1);
    expect(getSessionStore().size).toBe(0);
    expect(session.closeTransport).toHaveBeenCalled();
    expect(session.closeServer).toHaveBeenCalled();
  });

  it('keeps a session that is still fresh', () => {
    const session = fakeSession();
    setSession('a', session);

    const removed = sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: MAX_SESSIONS,
      now: Date.now() + 1000,
    });

    expect(removed).toBe(0);
    expect(getSessionStore().size).toBe(1);
    expect(session.closeTransport).not.toHaveBeenCalled();
    expect(session.closeServer).not.toHaveBeenCalled();
  });

  it('evicts the least recently used session when the cap is reached', async () => {
    const oldest = fakeSession();
    const middle = fakeSession();
    const newest = fakeSession();

    setSession('oldest', oldest);
    await sleep(5);
    setSession('middle', middle);
    await sleep(5);
    setSession('newest', newest);
    await sleep(5);
    // The middle session is used again, so it is no longer the oldest.
    touchSession('middle');

    const removed = sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: 2,
      now: Date.now(),
    });

    expect(removed).toBe(1);
    expect(getSessionStore().size).toBe(2);
    expect(getSession('oldest')).toBeUndefined();
    expect(oldest.closeTransport).toHaveBeenCalled();
    expect(oldest.closeServer).toHaveBeenCalled();
    expect(middle.closeTransport).not.toHaveBeenCalled();
    expect(newest.closeTransport).not.toHaveBeenCalled();
  });

  it('a touched session survives a sweep that would have dropped it', async () => {
    const untouched = fakeSession();
    const touched = fakeSession();

    setSession('untouched', untouched);
    await sleep(20);
    setSession('touched', touched);
    await sleep(20);

    const touchedAt = Date.now();
    touchSession('touched');

    // The clock is a hair short of the idle timeout, counted from the
    // touch: the untouched session is well past it, the touched one is not.
    const removed = sweepSessions({
      maxIdleMs: SESSION_IDLE_TTL_MS,
      maxSessions: MAX_SESSIONS,
      now: touchedAt + SESSION_IDLE_TTL_MS - 5,
    });

    expect(removed).toBe(1);
    expect(getSession('touched')).toBeDefined();
    expect(getSession('untouched')).toBeUndefined();
    expect(touched.closeTransport).not.toHaveBeenCalled();
    expect(untouched.closeTransport).toHaveBeenCalled();
  });
});
