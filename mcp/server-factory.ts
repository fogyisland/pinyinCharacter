import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './tools';

/**
 * The MCP server factory.
 *
 * The site mounts the MCP endpoint inside Next.js, so the server is built
 * per request rather than started once at boot. The identity (name and
 * version) comes from the environment so an operator can rename the server
 * in the client's UI without a code change.
 */

/** The name the server reports when the environment does not set one. */
const DEFAULT_SERVER_NAME = 'pinyin-character';

/** The version the server reports when the environment does not set one. */
const DEFAULT_SERVER_VERSION = '1.0.0';

/** Read an environment value, treating a blank one as unset. */
function readIdentity(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? value : fallback;
}

/**
 * Build a server with the site's tool registry.
 *
 * The tool set is the same one the standalone server served — the file-only
 * tools that need no database.
 */
export function createMcpServer(): McpServer {
  const name = readIdentity(process.env.MCP_SERVER_NAME, DEFAULT_SERVER_NAME);
  const version = readIdentity(process.env.MCP_SERVER_VERSION, DEFAULT_SERVER_VERSION);
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });
  registerAllTools(server);
  return server;
}
