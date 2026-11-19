/**
 * GET /api/game/magic — the one-stroke relation table.
 *
 * The table is `data/magic-chars.json`, a build product of
 * `scripts/build-magic-chars.ts`. It is several megabytes, so it is read
 * on the server and served from here rather than bundled into the client.
 *
 * When the table has not been built the route answers 500 with a code
 * the client can show: the fix is `npm run magic:build`, and the person
 * who reads the message is the one who can run it.
 */
import { NextResponse } from 'next/server';
import { getMagicTable } from '@/lib/magic-char-data';

export const dynamic = 'force-dynamic';

/** GET /api/game/magic — the one-stroke relation table. */
export async function GET(): Promise<NextResponse> {
  try {
    const table = getMagicTable();
    return NextResponse.json(
      { ok: true, data: { table } },
      {
        headers: {
          // Per feedback-cache-control-route-iterations.md, new routes
          // default to no-store so iteration doesn't get masked by the
          // browser's HTTP cache.
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('[api/game/magic] failed to read the relation table', error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'magic_table_unavailable',
          message: '变字关系表暂时读不到，请先运行 npm run magic:build 生成它。',
        },
      },
      { status: 500 },
    );
  }
}
