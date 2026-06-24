/**
 * Seed a minimal local-DB fixture for verifying the bulk-content-generation flow.
 *
 *  - 1 admin user (username "admin", password "admin")
 *  - 10 L1 chars, 5 L2 chars, 5 L3 chars (rare_chars subset) — all BMP, high
 *    codepoints, NOT in prod's piyin.chars table.
 *  - No content fields filled — admin/chars/init page will fill them.
 *
 * Idempotent: re-running wipes the previous fixture rows first.
 */

/**
 * PRESERVE — categories that this script MUST NOT touch.
 *
 * The seed script only DELETEs from these 4 places (see step 1 below):
 *   1. chars           (20 fixed seed BMP chars)
 *   2. char_etymology  (the same 20 seed chars)
 *   3. rare_chars      (the 5 L3 seed chars)
 *   4. users           (the 'admin' fixture user)
 *
 * Everything else is preserved by exclusion — DO NOT add DELETEs targeting:
 *   - data/content/*.json            (LLM-generated per-char content)
 *   - data/poems/*.json              (poem corpus — also has slug collections
 *                                    in .gitignore: yuefu/shijiu/cifu/caocao/nalan)
 *   - data/classics/*.json           (classic literature)
 *   - the chars / char_etymology /
 *     rare_chars tables for any char
 *     NOT in the 20 seed BMP chars
 *     listed below
 *   - the users table for any user
 *     other than 'admin'
 *   - app_config, audit_log, sessions,
 *     downloads, jobs, etc.
 */
import { getPool, closePool } from '../lib/db';
import { hashPassword } from '../lib/auth';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';

// 15 BMP chars near the end of the CJK Unified Ideographs block — high codepoints,
// not in the prod piyin.chars table, so safe to use for fixture.
const L1_CHARS = ['龜','龠','龥','齉','靐','龘','齾','齼','龗','龍'];
const L2_CHARS = ['䶮','䶲','䶳','䶴','䶸'];
const L3_CHARS = ['䨻','䨷','䨈','䨁','䨂'];

function cp(c: string): string {
  return 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

(async () => {
  const pool = getPool();
  const all = [...L1_CHARS, ...L2_CHARS, ...L3_CHARS];

  // 1) clean previous fixture
  await pool.query(
    `DELETE FROM char_etymology WHERE \`char\` IN (${all.map(() => '?').join(',')})`,
    all,
  );
  await pool.query(
    `DELETE FROM chars WHERE \`char\` IN (${all.map(() => '?').join(',')})`,
    all,
  );
  await pool.query(
    `DELETE FROM rare_chars WHERE \`char\` IN (${L3_CHARS.map(() => '?').join(',')})`,
    L3_CHARS,
  );
  await pool.query(`DELETE FROM users WHERE username = ?`, [ADMIN_USER]);

  // 2) seed admin
  const hash = await hashPassword(ADMIN_PASS);
  await pool.query(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)`,
    [ADMIN_USER, hash],
  );

  // 3) seed L1 + L2 chars
  const charRows = [
    ...L1_CHARS.map((c) => [c, 1, 'mock-L1', cp(c)]),
    ...L2_CHARS.map((c) => [c, 2, 'mock-L2', cp(c)]),
  ];
  for (const row of charRows) {
    await pool.query(
      `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, ?, ?, ?)`,
      row,
    );
  }

  // 4) seed L3 chars in BOTH chars (so the bulk route finds them) AND rare_chars
  for (const c of L3_CHARS) {
    await pool.query(
      `INSERT INTO chars (\`char\`, level, pinyin, unicode_codepoint) VALUES (?, 3, ?, ?)`,
      [c, 'mock-L3-' + c, cp(c)],
    );
    await pool.query(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story) VALUES (?, ?, '', '')`,
      [c, 'mock-L3-' + c],
    );
  }

  // 5) seed app_config defaults (idempotent — uses INSERT IGNORE)
  await pool.query(
    `INSERT IGNORE INTO app_config (\`key\`, value) VALUES
       ('ai.model', 'MiniMax-M3'),
       ('ai.mock_mode', 'false'),
       ('ai.temperature', '0.5')`,
  );

  const [[c]] = await pool.query<any[]>(`SELECT COUNT(*) AS c FROM chars WHERE level IN (1,2,3)`);
  const [[rc]] = await pool.query<any[]>(`SELECT COUNT(*) AS c FROM rare_chars`);
  const [[u]] = await pool.query<any[]>(`SELECT COUNT(*) AS c FROM users WHERE username = ?`, [ADMIN_USER]);
  console.log(`seeded: ${c.c} chars (L1+L2+L3), ${rc.c} rare_chars, ${u.c} admin user`);
  console.log(`login: ${ADMIN_USER} / ${ADMIN_PASS}`);
  await closePool();
})().catch((e) => { console.error(e); process.exit(1); });
