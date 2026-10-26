import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * The MCP session store.
 *
 * A session owns an McpServer and a transport, plus the user it belongs to.
 * The map lives on `globalThis` behind a `Symbol.for` key: Next.js dev
 * re-evaluates route modules on every edit, and a module-level Map would
 * drop every open session on each hot reload. `Symbol.for` (not `Symbol`)
 * so that a hot reload — which re-evaluates the module and would otherwise
 * create a *new* symbol — still finds the same store.
 */

/** One client's session. */
export interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  /** The user the session was opened for. */
  userId: number;
}

/** The key the store lives under on globalThis. */
const SESSION_STORE_KEY = Symbol.for('pinyin-character.mcp.sessions');

/** The store's own type. */
type SessionStore = Map<string, McpSession>;

/** globalThis, typed so the store can hang off it. */
interface GlobalWithSessions {
  [SESSION_STORE_KEY]?: SessionStore;
}

/**
 * The store, created on first use.
 *
 * A server restart empties it — every open session id becomes unknown and
 * the client re-initialises. That is the correct behaviour.
 */
export function getSessionStore(): SessionStore {
  const holder = globalThis as GlobalWithSessions;
  const existing = holder[SESSION_STORE_KEY];
  if (existing) return existing;
  const created: SessionStore = new Map();
  holder[SESSION_STORE_KEY] = created;
  return created;
}

/** The session with that id, or undefined when it is not held. */
export function getSession(id: string): McpSession | undefined {
  return getSessionStore().get(id);
}

/** Remember a session under its id. */
export function setSession(id: string, session: McpSession): void {
  getSessionStore().set(id, session);
}

/** Forget one session — the client closed it, or the token was revoked. */
export function deleteSession(id: string): void {
  getSessionStore().delete(id);
}

/** Forget every session — the server is shutting down. */
export function clearSessions(): void {
  getSessionStore().clear();
}
