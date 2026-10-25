/**
 * The MCP server's configuration.
 *
 * Everything is read from the environment once, at startup, and validated
 * there. A server that starts with a broken configuration answers every
 * later request with a confusing error; a server that refuses to start
 * says exactly what is wrong.
 *
 * The two rules that matter:
 *
 *   1. **a token is required unless anonymity is asked for explicitly** —
 *      `MCP_ALLOW_ANONYMOUS=true` is the only way to run without a token;
 *   2. **an anonymous server may only listen on the loopback interface** —
 *      an unauthenticated MCP server on a routable address would publish
 *      the whole site to anyone who can reach the port.
 */

/** The resolved configuration of the MCP server. */
export interface McpConfig {
  /** The interface to bind to. */
  host: string;
  /** The port to listen on. */
  port: number;
  /** The path the MCP endpoint is mounted on, e.g. `/mcp`. */
  endpoint: string;
  /** The Bearer token every request must carry; null in anonymous mode. */
  authToken: string | null;
  /** The allowed CORS origin, or `*` for any. */
  corsOrigin: string;
  /** The server name reported to MCP clients. */
  serverName: string;
  /** The server version reported to MCP clients. */
  serverVersion: string;
}

/** A configuration that cannot work — the server must not start. */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4455;
const DEFAULT_ENDPOINT = '/mcp';
const DEFAULT_SERVER_NAME = 'pinyin-character';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Read the port out of the environment, or fail with a message that says what to set. */
function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new McpConfigError(
      `MCP_PORT must be an integer between 1 and 65535 — got ${JSON.stringify(raw)}`,
    );
  }
  return port;
}

/** Read the endpoint path, normalizing the leading slash. */
function readEndpoint(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_ENDPOINT).trim();
  if (value === '') return DEFAULT_ENDPOINT;
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * Resolve the configuration from an environment.
 *
 * The environment is a parameter so the test can exercise the rules without
 * touching the real one.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const host = (env.MCP_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
  const port = readPort(env.MCP_PORT);
  const endpoint = readEndpoint(env.MCP_ENDPOINT);
  const corsOrigin = (env.MCP_CORS_ORIGIN ?? '*').trim() || '*';
  const serverName = (env.MCP_SERVER_NAME ?? DEFAULT_SERVER_NAME).trim() || DEFAULT_SERVER_NAME;
  const serverVersion = (env.MCP_SERVER_VERSION ?? '1.0.0').trim() || '1.0.0';

  const token = (env.MCP_AUTH_TOKEN ?? '').trim();
  const allowAnonymous = (env.MCP_ALLOW_ANONYMOUS ?? '').trim().toLowerCase() === 'true';

  if (token === '') {
    if (!allowAnonymous) {
      throw new McpConfigError(
        'MCP_AUTH_TOKEN is not set. Set it to a secret of your choice, or set ' +
          'MCP_ALLOW_ANONYMOUS=true to run without a token (that is only allowed ' +
          'on the loopback interface).',
      );
    }
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new McpConfigError(
        `MCP_ALLOW_ANONYMOUS=true is only allowed on the loopback interface — ` +
          `MCP_HOST is ${JSON.stringify(host)}. Set MCP_AUTH_TOKEN, or bind to 127.0.0.1.`,
      );
    }
  }

  return {
    host,
    port,
    endpoint,
    authToken: token === '' ? null : token,
    corsOrigin,
    serverName,
    serverVersion,
  };
}
