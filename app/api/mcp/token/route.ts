import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, unauthorized, forbidden, serviceUnavailable } from '@/lib/api-handler';
import { requireUser, type User } from '@/lib/auth';
import { logUserAction } from '@/lib/audit';
import { resolveMcpEndpoint } from '@/lib/mcp-endpoint';
import {
  getTokenStatus,
  issueToken,
  revokeToken,
  type IssuedToken,
  type McpTokenStatus,
} from '@/lib/mcp-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Every answer of this route is `no-store`: the body either carries a
 * bearer token or describes one, and a cached copy of a 401 would keep a
 * signed-out browser from ever seeing the fresh answer.
 */
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

/**
 * The placeholder the spec puts into the config template when no raw token
 * is available. It is a literal, not a real token — the raw token is only
 * ever handed out in the POST response.
 */
const TOKEN_PLACEHOLDER = 'mcp_<the raw token>';

interface McpServerConfig {
  mcpServers: {
    'ziyun-chinese': {
      type: 'http';
      url: string;
      headers: { Authorization: string };
    };
  };
}

/** The client configuration an AI client needs to talk to this site. */
function buildConfig(endpoint: string, rawToken: string | null): McpServerConfig {
  return {
    mcpServers: {
      'ziyun-chinese': {
        type: 'http',
        url: endpoint,
        headers: { Authorization: `Bearer ${rawToken ?? TOKEN_PLACEHOLDER}` },
      },
    },
  };
}

type AuthOutcome = { user: User } | { response: NextResponse };

/**
 * The signed-in user, or the answer to send back.
 *
 * The codes come from the spec (`unauthorized` / `forbidden`) and not from
 * requireUser()'s own responses (`unauthenticated` / `account_disabled`),
 * so the route builds them here instead of returning `auth.response`.
 */
async function authenticate(): Promise<AuthOutcome> {
  const auth = await requireUser();
  if (!auth.ok) {
    return {
      response:
        auth.reason === 'account_disabled'
          ? forbidden('forbidden', '账户已停用', NO_STORE)
          : unauthorized('unauthorized', '未登录', NO_STORE),
    };
  }
  return { user: auth.user };
}

/**
 * GET — the status of the caller's token, never the token itself.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return withErrorHandling<NextResponse>(async () => {
    const auth = await authenticate();
    if ('response' in auth) return auth.response;

    const endpoint = await resolveMcpEndpoint(req);

    let status: McpTokenStatus;
    try {
      status = await getTokenStatus(auth.user.id);
    } catch (err) {
      console.error('[api] mcp token status failed', err);
      return serviceUnavailable('service_unavailable', '服务暂时不可用', NO_STORE);
    }

    return NextResponse.json(
      { ok: true, data: { status, endpoint, config: buildConfig(endpoint, null) } },
      NO_STORE,
    );
  }, NO_STORE);
}

/**
 * POST — issue a token, rotating the previous one if there was one.
 *
 * The raw token appears in this response and nowhere else. It is not
 * recoverable afterwards: only its digest is stored.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withErrorHandling<NextResponse>(async () => {
    const auth = await authenticate();
    if ('response' in auth) return auth.response;

    const { id: userId, username } = auth.user;
    const endpoint = await resolveMcpEndpoint(req);

    let issued: IssuedToken;
    try {
      issued = await issueToken(userId);
    } catch (err) {
      console.error('[api] mcp token issue failed', err);
      return serviceUnavailable('service_unavailable', '服务暂时不可用', NO_STORE);
    }

    // Deliberately outside the try/catch above: the token is already issued
    // at this point. A failed audit row must not turn a successful issue
    // into a 503 — that would push the user into retrying and rotating the
    // token they just received. A 500 says "it went wrong", a 503 says
    // "come back later and do it again".
    await logUserAction(
      req,
      userId,
      issued.replaced ? 'mcp_token_regenerated' : 'mcp_token_created',
      { title: `${username} 的 MCP Token`, username },
    );

    return NextResponse.json(
      {
        ok: true,
        data: {
          token: issued.raw,
          createdAt: issued.createdAt,
          endpoint,
          config: buildConfig(endpoint, issued.raw),
        },
      },
      NO_STORE,
    );
  }, NO_STORE);
}

/**
 * DELETE — revoke the caller's token.
 *
 * Always answers 200: revoking a token that is already revoked keeps the
 * original timestamp, and revoking a user who never had one reports no
 * timestamp at all.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return withErrorHandling<NextResponse>(async () => {
    const auth = await authenticate();
    if ('response' in auth) return auth.response;

    const { id: userId, username } = auth.user;

    let revoked: { revokedAt: string | null };
    try {
      revoked = await revokeToken(userId);
    } catch (err) {
      console.error('[api] mcp token revoke failed', err);
      return serviceUnavailable('service_unavailable', '服务暂时不可用', NO_STORE);
    }

    // Outside the try/catch on purpose, for the same reason as in POST.
    await logUserAction(req, userId, 'mcp_token_revoked', {
      title: `${username} 的 MCP Token`,
      username,
    });

    return NextResponse.json(
      { ok: true, data: { revokedAt: revoked.revokedAt } },
      NO_STORE,
    );
  }, NO_STORE);
}
