import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { withErrorHandling } from '@/lib/api-handler';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface CountRow extends RowDataPacket {
  n: number;
}

interface LevelCoverageRow extends RowDataPacket {
  level: number;
  total: number | string;
  with_story: number | string | null;
}

interface EraCoverageRow extends RowDataPacket {
  jiaguwen: number | string | null;
  jinwen: number | string | null;
  xiaozhuan: number | string | null;
  lishu: number | string | null;
  kaishu: number | string | null;
}

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const pool = getPool();
    const [totals] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS n FROM chars`);
    const [withStory] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NOT NULL AND story <> ''`,
    );
    const [byLevel] = await pool.query<LevelCoverageRow[]>(
      `SELECT level, COUNT(*) AS total,
              SUM(CASE WHEN ce.story IS NOT NULL AND ce.story <> '' THEN 1 ELSE 0 END) AS with_story
       FROM chars c
       LEFT JOIN char_etymology ce ON c.\`char\` = ce.\`char\`
       GROUP BY level
       ORDER BY level`,
    );
    const [byEra] = await pool.query<EraCoverageRow[]>(
      `SELECT
         SUM(era_jiaguwen_has) AS jiaguwen,
         SUM(era_jinwen_has) AS jinwen,
         SUM(era_xiaozhuan_has) AS xiaozhuan,
         SUM(era_lishu_has) AS lishu,
         SUM(era_kaishu_has) AS kaishu
       FROM char_etymology`,
    );

    const total = Number(totals[0].n);
    const withEtymology = Number(withStory[0].n);
    return NextResponse.json({
      ok: true,
      data: {
        totalChars: total,
        charsWithEtymology: withEtymology,
        coveragePct: total > 0 ? Math.round((withEtymology / total) * 1000) / 10 : 0,
        byLevel: byLevel.map((r) => ({
          level: r.level,
          total: Number(r.total),
          withStory: Number(r.with_story ?? 0),
        })),
        eraCoverage: byEra[0] ?? {},
      },
    });
  });
}
