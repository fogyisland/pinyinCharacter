import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import {
  getAdminMcpTokenStats,
  listAdminMcpTokens,
  type AdminMcpTokenFilter,
} from '@/lib/mcp-token-admin';

export const dynamic = 'force-dynamic';

/**
 * The list of the MCP tokens every user holds.
 *
 * The page itself is server-rendered, so this route is the machine-facing
 * twin of it: the same list, the same counters, and the same filters. It
 * exists for the tooling that has to read the token table without a
 * browser — and for the tests, which assert the contract of the list
 * rather than of the markup.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const sp = req.nextUrl.searchParams;
    const stateRaw = sp.get('state');
    const state: AdminMcpTokenFilter =
      stateRaw === 'active' || stateRaw === 'disabled' || stateRaw === 'revoked'
        ? stateRaw
        : 'all';
    const q = sp.get('q')?.trim() || undefined;
    // The page size and the offset reach MySQL's LIMIT, which takes whole
    // numbers — a fractional one is a syntax error there and would come
    // back as a 500. Anything that is not a whole number falls back to
    // the default rather than failing the request; the data layer keeps
    // the same rule, so both layers answer the same way.
    const limitRaw = Number(sp.get('limit'));
    const offsetRaw = Number(sp.get('offset'));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const [stats, list] = await Promise.all([
      // The counters describe the same set the list shows — the search
      // term included.
      getAdminMcpTokenStats(q),
      listAdminMcpTokens({ state, q, limit, offset }),
    ]);

    return NextResponse.json({
      ok: true,
      data: { stats, items: list.items, total: list.total },
    });
  });
}
