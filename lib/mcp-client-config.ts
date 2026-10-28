/**
 * The client configuration an AI client needs to reach this site's MCP
 * service.
 *
 * Three places show it: the /profile token card, the answer of
 * /api/mcp/token, and the admin's MCP page. They must show the *same*
 * JSON — a user who pastes what the admin page shows and what the profile
 * page shows has to end up with the same client. So the shape lives here,
 * once, and the three places import it.
 *
 * This module has no imports at all: it is data, safe on the server and in
 * the browser, and it never touches the database.
 */

/** The name the server is registered under in the client configuration. */
export const MCP_SERVER_NAME = 'ziyun-chinese';

/**
 * The literal the configuration carries when no raw token is available.
 *
 * The raw token is handed out exactly once, in the POST answer of
 * /api/mcp/token. Everywhere else the configuration carries this
 * placeholder, so the user pastes their own token into it — and no copy
 * of the block ever carries a live credential.
 */
export const MCP_TOKEN_PLACEHOLDER = 'mcp_<the raw token>';

/** The configuration object an MCP client reads. */
export interface McpServerConfig {
  mcpServers: {
    [serverName: string]: {
      type: 'http';
      url: string;
      headers: { Authorization: string };
    };
  };
}

/**
 * The client configuration for one endpoint.
 *
 * `rawToken` is the token to embed; `null` puts the placeholder in its
 * place.
 */
export function buildMcpClientConfig(
  endpoint: string,
  rawToken: string | null,
): McpServerConfig {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: endpoint,
        headers: { Authorization: `Bearer ${rawToken ?? MCP_TOKEN_PLACEHOLDER}` },
      },
    },
  };
}

/**
 * The same configuration, as the JSON text a user pastes into a client.
 *
 * The indentation matters: this block is read by people as well as by
 * clients, and it lands in a README more often than not.
 */
export function formatMcpClientConfig(endpoint: string, rawToken: string | null): string {
  return JSON.stringify(buildMcpClientConfig(endpoint, rawToken), null, 2);
}
