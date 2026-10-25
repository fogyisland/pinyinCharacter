import { loadConfig, McpConfigError } from './config';
import { startServer } from './server';

/**
 * The MCP server's entry point.
 *
 * It is a separate file from mcp/server.ts so the module can be imported by
 * the tests without binding a port.
 *
 * The server reads its configuration from the environment:
 *
 *   MCP_HOST             the interface to bind to (default 127.0.0.1)
 *   MCP_PORT             the port to listen on (default 4455)
 *   MCP_ENDPOINT         the path of the MCP endpoint (default /mcp)
 *   MCP_AUTH_TOKEN       the Bearer token the clients must present
 *   MCP_ALLOW_ANONYMOUS  set to true to run without a token (loopback only)
 *   MCP_CORS_ORIGIN      the allowed CORS origin (default *)
 *   MCP_SERVER_NAME      the name reported to the clients
 *   MCP_SERVER_VERSION   the version reported to the clients
 *
 * The token is required unless anonymity is asked for explicitly — see
 * mcp/config.ts for the rules.
 */

/** Start the server and wire the shutdown signals. */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof McpConfigError) {
      console.error(`[mcp] the configuration is not usable: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const server = startServer(config);

  const shutdown = (signal: string): void => {
    console.info(`[mcp] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    // The server must not wait for a long-lived SSE stream to end.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
