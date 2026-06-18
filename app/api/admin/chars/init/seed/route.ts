/**
 * Seed or clear the local-DB fixture (20 BMP rare chars + 1 admin user).
 * Used by /admin/chars/init panel. Only touches the test fixture, never prod data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { adminInitSeedSchema } from '@/lib/validators';
import { logUserAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const FIXTURE_USER = 'admin';
const FIXTURE_PASS = 'admin';

// BMP chars near the end of CJK Unified Ideographs — high codepoints, not in prod.
const L1 = ['龜','龠','龥','齉','靐','龘','齾','齼','龗','龍'];
const L2 = ['䶮','䶲','䶳','䶴','䶸'];
const L3 = ['䨻','䨷','䨈','䨁','䨂'];
const ALL = [...L1, ...L2, ...L3];

function cp(c: string): string {
  return 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const parsed = adminInitSeedSchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const pool = getPool();
    let action: 'seed' | 'clear' = parsed.data.action;

    if (action === 'clear') {
      await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (${ALL.map(() => '?').join(',')})`, ALL);
      await pool.query(`DELETE FROM chars WHERE \`char\` IN (${ALL.map(() => '?').join(',')})`, ALL);
      await pool.query(`DELETE FROM rare_chars WHERE \`char\` IN (${L3.map(() => '?').join(',')})`, L3);
      await pool.query(`DELETE FROM users WHERE username = ?`, [FIXTURE_USER]);
      await logUserAction(req, auth.user.id, 'admin_chars_init_seed', { action, removed: ALL.length });
      return NextResponse.json({ ok: true, data: { action, removed: ALL.length } });
    }

    // seed: clear first, then re-insert
    await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (${ALL.map(() => '?').join(',')})`, ALL);
    await pool.query(`DELETE FROM chars WHERE \`char\` IN (${ALL.map(() => '?').join(',')})`, ALL);
    await pool.query(`DELETE FROM rare_chars WHERE \`char\` IN (${L3.map(() => '?').join(',')})`, L3);
    await pool.query(`DELETE FROM users WHERE username = ?`, [FIXTURE_USER]);

    const hash = await hashPassword(FIXTURE_PASS);
    await pool.query(
      `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)`,
      [FIXTURE_USER, hash],
    );
    for (const [chars, level] of [[L1, 1], [L2, 2]] as const) {
      for (const c of chars) {
        await pool.query(
          `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, ?, ?, ?)`,
          [c, level, `mock-L${level}`, cp(c)],
        );
      }
    }
    for (const c of L3) {
      await pool.query(
        `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, 3, ?, ?)`,
        [c, `mock-L3-${c}`, cp(c)],
      );
      await pool.query(
        `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story) VALUES (?, ?, '', '')`,
        [c, `mock-L3-${c}`],
      );
    }
    await logUserAction(req, auth.user.id, 'admin_chars_init_seed', { action, inserted: ALL.length });
    return NextResponse.json({
      ok: true,
      data: { action, inserted: ALL.length, adminUser: FIXTURE_USER, adminPass: FIXTURE_PASS },
    });
  });
}
