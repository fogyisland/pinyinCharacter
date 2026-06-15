/**
 * Create the 4 plan-b tables (idempotent via IF NOT EXISTS).
 * Run on first server start; safe to re-run.
 */
import { getPool, closePool } from '../lib/db';

const DDL = [
  `CREATE TABLE IF NOT EXISTS chars (
     \`char\` VARCHAR(4) NOT NULL,
     level TINYINT NOT NULL,
     pinyin VARCHAR(64) NOT NULL DEFAULT '',
     pinyin_alt TEXT NULL,
     radical VARCHAR(8) NOT NULL DEFAULT '',
     stroke_count SMALLINT NOT NULL DEFAULT 0,
     meaning_zh TEXT NULL,
     meaning_en TEXT NULL,
     unicode_codepoint VARCHAR(8) NOT NULL,
     variants TEXT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (\`char\`),
     KEY idx_level (level),
     KEY idx_radical (radical),
     KEY idx_pinyin (pinyin),
     KEY idx_stroke (stroke_count)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS char_etymology (
     \`char\` VARCHAR(4) NOT NULL,
     era_jiaguwen_font VARCHAR(32) NOT NULL DEFAULT 'YinQiJiaGuWen',
     era_jiaguwen_has TINYINT(1) NOT NULL DEFAULT 0,
     era_jinwen_font VARCHAR(32) NOT NULL DEFAULT 'HanDianJinWen',
     era_jinwen_has TINYINT(1) NOT NULL DEFAULT 0,
     era_xiaozhuan_font VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuShuoWen',
     era_xiaozhuan_has TINYINT(1) NOT NULL DEFAULT 0,
     era_lishu_font VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuLiDing',
     era_lishu_has TINYINT(1) NOT NULL DEFAULT 0,
     era_kaishu_font VARCHAR(32) NOT NULL DEFAULT 'KaiTi',
     era_kaishu_has TINYINT(1) NOT NULL DEFAULT 1,
     story TEXT NULL,
     generated_by VARCHAR(64) NULL,
     generated_at TIMESTAMP NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (\`char\`),
     KEY idx_generated (generated_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS char_story (
     \`char\` VARCHAR(4) NOT NULL,
     story TEXT NOT NULL,
     generated_by VARCHAR(64) NULL DEFAULT 'claude-handwritten',
     generated_at TIMESTAMP NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (\`char\`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS users (
     id BIGINT NOT NULL AUTO_INCREMENT,
     username VARCHAR(32) NOT NULL,
     email VARCHAR(255) NULL,
     password_hash VARCHAR(72) NOT NULL,
     is_admin TINYINT(1) NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_username (username),
     UNIQUE KEY uk_email (email)
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

  `CREATE TABLE IF NOT EXISTS downloads (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     user_id     BIGINT       NOT NULL,
     format      ENUM('pdf','print') NOT NULL,
     source_type ENUM('worksheet','poem','sutra','rare-char-card') NOT NULL,
     source_id   VARCHAR(64)  NULL,
     status      ENUM('ok','error') NOT NULL DEFAULT 'ok',
     duration_ms INT UNSIGNED NULL,
     ip          VARCHAR(45)  NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_user_created (user_id, created_at DESC),
     KEY idx_source (source_type, source_id),
     CONSTRAINT fk_downloads_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ai_calls (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     user_id     BIGINT       NULL,
     feature     VARCHAR(32)  NOT NULL,
     model       VARCHAR(64)  NOT NULL,
     status      ENUM('ok','error','rate-limited') NOT NULL,
     prompt_tokens     INT UNSIGNED NULL,
     completion_tokens INT UNSIGNED NULL,
     duration_ms INT UNSIGNED NULL,
     error       TEXT         NULL,
     metadata    JSON         NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_feature_created (feature, created_at DESC),
     KEY idx_user_created (user_id, created_at DESC),
     KEY idx_status (status, created_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS app_config (
     \`key\`       VARCHAR(64)  NOT NULL,
     value       TEXT         NOT NULL,
     updated_by  BIGINT       NULL,
     updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                   ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (\`key\`),
     CONSTRAINT fk_app_config_user FOREIGN KEY (updated_by)
       REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initDb(): Promise<void> {
  const pool = getPool();
  for (const sql of DDL) {
    await pool.query(sql);
  }
  // Idempotent ALTER: only add disabled_at if it doesn't already exist
  const [cols] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'disabled_at'`,
  );
  if (cols.length === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin`);
  }
  // Idempotent ALTER: only add email if it doesn't already exist
  const [emailCols] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'`,
  );
  if (emailCols.length === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username`);
    await pool.query(`ALTER TABLE users ADD UNIQUE KEY uk_email (email)`);
  }
  // Seed app_config defaults
  const [[{ count: cfgCount }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count FROM app_config`,
  );
  if (Number(cfgCount) === 0) {
    const defaults: Array<[string, string]> = [
      ['ai.model', 'gpt-4o-mini'],
      ['ai.rate_limit_per_user_per_day', '5'],
      ['ai.timeout_ms', '30000'],
      ['ai.temperature', '0.7'],
    ];
    for (const [k, v] of defaults) {
      await pool.query(`INSERT INTO app_config (\`key\`, value) VALUES (?, ?)`, [k, v]);
    }
    await pool.query(
      `INSERT IGNORE INTO app_config (\`key\`, value, updated_by) VALUES
         ('tts.voice_male', 'zh-CN-YunjianNeural', NULL),
         ('tts.voice_female', 'zh-CN-XiaoxiaoNeural', NULL),
         ('tts.audio_format', 'audio-24khz-48kbitrate-mono-mp3', NULL)`
    );
    console.log(`[initDb] seeded ${defaults.length} app_config defaults`);
  } else {
    console.log(`[initDb] app_config has ${cfgCount} rows, skip seed`);
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
  // Auto-populate sutras table if empty (fail-soft)
  try {
    const [[{ count: sCount }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM sutras`);
    if (Number(sCount) === 0) {
      const { buildSutras } = await import('./build-sutras');
      const n = await buildSutras();
      console.log(`[initDb] inserted ${n} sutras (auto-populate)`);
    } else {
      console.log(`[initDb] sutras table has ${sCount} rows, skip auto-populate`);
    }
  } catch (err) {
    console.warn('[initDb] sutras auto-populate failed (continuing):', (err as Error).message);
  }
}

if (require.main === module) {
  initDb()
    .then(() => { console.log('DB initialized'); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
