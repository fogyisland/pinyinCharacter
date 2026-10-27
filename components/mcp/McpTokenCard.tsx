import { getTokenStatus } from '@/lib/mcp-token';
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';
import { McpTokenActions } from './McpTokenActions';

/**
 * The MCP token card on /profile.
 *
 * A server component: it reads the token status and the public MCP
 * endpoint on the server and hands both to the client island that runs the
 * issue / rotate / revoke actions. The raw token never reaches the server
 * render — it only ever exists in the client's memory, for the one
 * response that hands it out.
 */
export async function McpTokenCard({ userId }: { userId: number }) {
  const [status, endpoint] = await Promise.all([
    getTokenStatus(userId),
    resolveMcpEndpoint(),
  ]);
  return (
    <div className="mt-4 card-paper p-5">
      <McpTokenActions initialStatus={status} endpoint={endpoint} />
    </div>
  );
}
