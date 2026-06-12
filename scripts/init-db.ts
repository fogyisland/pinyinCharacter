/**
 * Create the 4 plan-b tables (idempotent via IF NOT EXISTS).
 * Run on first server start; safe to re-run.
 */
import { getPool, closePool } from '../lib/db';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
     id BIGINT NOT NULL AUTO_INCREMENT,
     username VARCHAR(32) NOT NULL,
     password_hash VARCHAR(72) NOT NULL,
     is_admin TINYINT(1) NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_username (username)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS history (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     kind ENUM('text2pinyin','pinyin2text') NOT NULL,
     input TEXT NOT NULL,
     output TEXT NULL,
     is_favorite TINYINT(1) NOT NULL DEFAULT 0,
     char_count INT UNSIGNED NOT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_created (user_id, created_at DESC),
     KEY idx_user_fav (user_id, is_favorite, created_at DESC),
     CONSTRAINT fk_history_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS audit_log (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NULL,
     event VARCHAR(32) NOT NULL,
     metadata JSON NULL,
     ip VARCHAR(45) NULL,
     user_agent VARCHAR(255) NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_audit_user (user_id, created_at DESC),
     KEY idx_audit_event (event, created_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS password_resets (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     token_hash CHAR(64) NOT NULL,
     expires_at TIMESTAMP NOT NULL,
     used_at TIMESTAMP NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_pr_user (user_id),
     KEY idx_pr_token_hash (token_hash),
     KEY idx_pr_expires (expires_at),
     CONSTRAINT fk_pr_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS rare_chars (
     \`char\`        VARCHAR(1)     NOT NULL,
     pinyin        VARCHAR(64)    NOT NULL,
     meaning       TEXT           NOT NULL,
     story         TEXT           NOT NULL,
     needs_review  TINYINT(1)     NOT NULL DEFAULT 1,
     generated_by  VARCHAR(64)    NULL,
     generated_at  DATETIME       NULL,
     created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (\`char\`),
     KEY idx_pinyin (pinyin)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS poems (
     id          INT             NOT NULL AUTO_INCREMENT,
     dynasty     ENUM('tang','song') NOT NULL,
     title       VARCHAR(80)     NOT NULL,
     author      VARCHAR(40)     NOT NULL,
     form        VARCHAR(20)     NULL,
     content     JSON            NOT NULL,
     pinyin      JSON            NOT NULL,
     appreciation TEXT           NULL,
     source      VARCHAR(120)    NULL,
     created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_poem (dynasty, title, author),
     KEY idx_author (author),
     KEY idx_dynasty_author (dynasty, author)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS worksheets (
     id          INT            NOT NULL AUTO_INCREMENT,
     user_id     BIGINT         NOT NULL,
     title       VARCHAR(80)    NOT NULL,
     content     JSON           NOT NULL,
     cell_style  ENUM('brush','square') NOT NULL,
     created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_created (user_id, created_at DESC),
     CONSTRAINT fk_worksheets_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sutras (
     id          INT             NOT NULL AUTO_INCREMENT,
     title       VARCHAR(80)     NOT NULL,
     slug        VARCHAR(80)     NOT NULL,
     chunks      JSON            NOT NULL,
     source      VARCHAR(120)    NULL,
     created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_sutra (slug)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initDb(): Promise<void> {
  const pool = getPool();
  for (const sql of DDL) {
    await pool.query(sql);
  }
  // Auto-populate poems table if empty (fail-soft)
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM poems`);
    if (Number(count) === 0) {
      const { buildPoems } = await import('./build-poems');
      const n = await buildPoems();
      console.log(`[initDb] inserted ${n} poems (auto-populate)`);
    } else {
      console.log(`[initDb] poems table has ${count} rows, skip auto-populate`);
    }
  } catch (err) {
    console.warn('[initDb] poems auto-populate failed (continuing):', (err as Error).message);
  }
}

if (require.main === module) {
  initDb()
    .then(() => { console.log('DB initialized'); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
