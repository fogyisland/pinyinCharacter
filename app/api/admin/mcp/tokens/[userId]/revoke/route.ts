import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { revokeToken } from '@/lib/mcp-token';
import { getMcpTokenOwner } from '@/lib/mcp-token-admin';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * An administrator revokes a user's MCP token.
 *
 * The user can revoke their own token on their own profile page; this is
 * the other direction — the operator takes a token away. The row is kept
 * (it is only marked revoked), so the audit trail of "this user held a
 * token" survives, and the user's own page still shows the token as
 * revoked rather than as never issued.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { userId: userIdRaw } = await params;
    const userId = Number(userIdRaw);
    if (!Number.isInteger(userId) || userId <= 0) {
      return badRequest('bad_id', 'invalid user id');
    }

    const owner = await getMcpTokenOwner(userId);
    if (!owner) {
      return notFound('user_not_found', '没有这个用户');
    }

    const revoked = await revokeToken(userId);

    // Outside the try/catch of the route on purpose: the token is already
    // revoked at this point, so a failed audit row must not tell the
    // operator that the revocation did not happen.
    await writeAudit({
      userId: auth.user.id,
      event: 'admin_mcp_token_revoked',
      metadata: {
        title: `${owner.username} 的 MCP Token`,
        targetUserId: userId,
        username: owner.username,
        revokedAt: revoked.revokedAt,
      },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({
      ok: true,
      data: { userId, username: owner.username, revokedAt: revoked.revokedAt },
    });
  });
}
