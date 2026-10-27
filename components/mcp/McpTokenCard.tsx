import { getTokenStatus } from '@/lib/mcp-token';
import type { McpTokenStatus } from '@/lib/mcp-token';
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';
import { McpTokenActions } from './McpTokenActions';

/**
 * The data the card needs: the token status and the public MCP endpoint.
 *
 * Either both are there or neither is. The `mcp_tokens` table only exists
 * after `scripts/migrations/2026-10-26-mcp-tokens.sql` has run, and the
 * deploy runbook restarts the app before it runs the migrations — so a
 * missing table is a real window, not a theory. A failure here is logged
 * and answered with `null`, and the card renders its degraded state; it
 * must never take the whole /profile page down with it.
 */
export async function loadMcpTokenCardData(
  userId: number,
): Promise<{ status: McpTokenStatus; endpoint: string } | null> {
  try {
    const [status, endpoint] = await Promise.all([
      getTokenStatus(userId),
      resolveMcpEndpoint(),
    ]);
    return { status, endpoint };
  } catch (err) {
    console.error('[mcp-token] the token card data is unavailable', err);
    return null;
  }
}

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
  const data = await loadMcpTokenCardData(userId);
  return (
    <div className="mt-4 card-paper p-5">
      {data === null ? (
        <div>
          <h2 className="font-kai text-lg text-ink">MCP Token</h2>
          <p className="text-sm text-ink-soft mt-1">Token 服务暂时不可用，请稍后再试。</p>
        </div>
      ) : (
        <McpTokenActions initialStatus={data.status} endpoint={data.endpoint} />
      )}
    </div>
  );
}
