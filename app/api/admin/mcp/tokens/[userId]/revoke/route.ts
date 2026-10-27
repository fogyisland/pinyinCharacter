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
    // Only a plain decimal number is a user id. `Number()` would also
    // accept `0x10`, `1e3` and ` 7 ` — all of which name a different
    // user than the digits suggest.
    //
    // The length is capped at ten digits, so the id can never be longer
    // than a BIGINT column but still far wider than any real user table
    // (nine billion nine hundred and ninety-nine million ids). The cap
    // is here to keep the pattern from accepting an absurdly long path
    // segment, not because the database needs it.
    const userId = /^\d{1,10}$/.test(userIdRaw) ? Number(userIdRaw) : Number.NaN;
    if (!Number.isInteger(userId) || userId <= 0) {
      return badRequest('bad_id', 'invalid user id');
    }

    const owner = await getMcpTokenOwner(userId);
    if (!owner) {
      return notFound('user_not_found', '没有这个用户');
    }

    const revoked = await revokeToken(userId);

    // The token is already revoked at this point, so a failed audit row
    // must not tell the operator that the revocation did not happen. The
    // failure is written to the log instead, and the request still
    // succeeds — the effect of the revocation is the fact, and the audit
    // row is a record of it.
    try {
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
    } catch (auditErr) {
      console.error(
        '[admin] the mcp token was revoked but its audit row could not be written',
        auditErr,
      );
    }

    return NextResponse.json({
      ok: true,
      data: { userId, username: owner.username, revokedAt: revoked.revokedAt },
    });
  });
}
