/**
 * Create the 4 plan-b tables (idempotent via IF NOT EXISTS).
 * Run on first server start; safe to re-run.
 *
 * Schema is slim: only structural columns. LLM-generated content (meanings,
 * etymology stories, hanzi stories, rare_char meanings/stories) lives in
 * data/content/<char>.json — see scripts/schemas/content.ts and
 * lib/content.ts::getContent(). Read paths prefer JSON, fall back to legacy
 * content columns during the migration window.
 */
import { getPool, closePool } from '../lib/db';
import charsData from '../data/general-standard-chinese-characters.json';
import radicalsData from '../data/radicals.json';

const DDL = [
  `CREATE TABLE IF NOT EXISTS chars (
     \`char\` VARCHAR(4) NOT NULL,
     level TINYINT NOT NULL,
     pinyin VARCHAR(64) NOT NULL DEFAULT '',
     radical VARCHAR(8) NOT NULL DEFAULT '',
     stroke_count SMALLINT NOT NULL DEFAULT 0,
     unicode_codepoint VARCHAR(8) NOT NULL,
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
     PRIMARY KEY (\`char\`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  // char_story table dropped — story content now lives in data/content/<char>.json.

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
     needs_review  TINYINT(1)     NOT NULL DEFAULT 1,
     PRIMARY KEY (\`char\`),
     KEY idx_pinyin (pinyin)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS poems (
     id          INT             NOT NULL AUTO_INCREMENT,
     dynasty     ENUM('tang','song','汉','汉末','mixed','三国','清') NOT NULL,
     title       VARCHAR(80)     NOT NULL,
     author      VARCHAR(40)     NOT NULL,
     form        VARCHAR(20)     NULL,
     category    VARCHAR(32)     NULL,
     content     JSON            NOT NULL,
     pinyin      JSON            NOT NULL,
     appreciation TEXT           NULL,
     source      VARCHAR(120)    NULL,
     created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_poem (dynasty, title, author),
     KEY idx_author (author),
     KEY idx_dynasty_author (dynasty, author),
     KEY idx_category (category)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS worksheets (
     id          INT            NOT NULL AUTO_INCREMENT,
     user_id     BIGINT         NOT NULL,
     title       VARCHAR(80)    NOT NULL,
     content     JSON           NOT NULL,
     -- Latest ENUM (matches what migrations would converge to). init-db
     -- creates the final state; migrations exist only for upgrading
     -- older DBs and must NOT be run after a fresh initDb().
     cell_style  ENUM('brush','square','pen','cross','brush-square','brush-cross','pen-square','pen-cross','brush-trace-square','brush-trace-cross') NOT NULL,
     paper_size  ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL,
     font_family ENUM('song','kai','hei','wenkai-gb','yozai','iansui','zen-kaku-thin','ma-shan-zheng','long-cang') NOT NULL DEFAULT 'song',
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

  `CREATE TABLE IF NOT EXISTS classics (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     slug VARCHAR(64) NOT NULL,
     title VARCHAR(128) NOT NULL,
     category ENUM('four-books','five-classics','mengxue','philosophy','history','other','pianwen') NOT NULL DEFAULT 'other',
     author VARCHAR(64) NULL,
     era VARCHAR(16) NULL,
     source VARCHAR(64) NOT NULL DEFAULT 'chinese-poetry@master',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_slug (slug),
     KEY idx_category (category)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS membership_plans (
     id BIGINT NOT NULL AUTO_INCREMENT,
     plan_key VARCHAR(32) NOT NULL,
     display_name VARCHAR(64) NOT NULL,
     duration_days INT NOT NULL,
     amount DECIMAL(10,2) NOT NULL,
     currency ENUM('CNY','USD') NOT NULL,
     enabled TINYINT(1) NOT NULL DEFAULT 0,
     display_order INT NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uk_plan_key (plan_key)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS membership_plan_features (
     plan_id BIGINT NOT NULL,
     feature_key VARCHAR(32) NOT NULL,
     PRIMARY KEY (plan_id, feature_key),
     CONSTRAINT fk_mpf_plan FOREIGN KEY (plan_id)
       REFERENCES membership_plans(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS memberships (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     plan_key VARCHAR(32) NOT NULL DEFAULT 'manual',
     source ENUM('manual','paypal') NOT NULL DEFAULT 'manual',
     amount DECIMAL(10,2) NULL,
     currency ENUM('CNY','USD') NULL,
     source_payment_order_id BIGINT NULL,
     granted_by BIGINT NULL,
     note VARCHAR(255) NULL,
     granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     expires_at TIMESTAMP NOT NULL DEFAULT '2038-01-19 03:14:07',
     revoked_at TIMESTAMP NULL,
     revoked_by BIGINT NULL,
     revoke_reason VARCHAR(255) NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_memberships_payment_order (source_payment_order_id),
     KEY idx_memberships_user (user_id, granted_at),
     KEY idx_memberships_expires (expires_at),
     KEY fk_memberships_granted_by (granted_by),
     KEY fk_memberships_revoked_by (revoked_by),
     CONSTRAINT fk_memberships_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT fk_memberships_granted_by FOREIGN KEY (granted_by)
       REFERENCES users(id) ON DELETE SET NULL,
     CONSTRAINT fk_memberships_revoked_by FOREIGN KEY (revoked_by)
       REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS payment_orders (
     id BIGINT NOT NULL AUTO_INCREMENT,
     user_id BIGINT NOT NULL,
     plan_id BIGINT NOT NULL,
     paypal_order_id VARCHAR(64) NOT NULL,
     status ENUM('created','approved','paid','failed','expired') NOT NULL DEFAULT 'created',
     amount DECIMAL(10,2) NOT NULL,
     currency ENUM('CNY','USD') NOT NULL,
     approval_url VARCHAR(512) NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     paid_at TIMESTAMP NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_paypal_order (paypal_order_id),
     KEY idx_po_user (user_id, created_at),
     KEY fk_po_plan (plan_id),
     CONSTRAINT fk_po_user FOREIGN KEY (user_id)
       REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT fk_po_plan FOREIGN KEY (plan_id)
       REFERENCES membership_plans(id)
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
     user_agent  VARCHAR(512) NULL,
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

  `CREATE TABLE IF NOT EXISTS scheduler_run_history (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     run_id      VARCHAR(40)  NOT NULL,
     task_name   ENUM('content-refresh','daily-char','stats-refresh') NOT NULL,
     started_at  DATETIME(3)  NOT NULL,
     finished_at DATETIME(3)  NULL,
     ok          TINYINT(1)   NOT NULL,
     summary     VARCHAR(512) NULL,
     error       VARCHAR(1024) NULL,
     PRIMARY KEY (id),
     KEY idx_run (run_id),
     KEY idx_task_started (task_name, started_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS email_send_history (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     to_addr     VARCHAR(254) NOT NULL,
     subject     VARCHAR(512) NOT NULL,
     template    VARCHAR(64)  NULL,
     status      ENUM('sent','failed','console') NOT NULL,
     error       VARCHAR(1024) NULL,
     sent_at     DATETIME(3)  NOT NULL,
     PRIMARY KEY (id),
     KEY idx_sent_at (sent_at DESC),
     KEY idx_status (status, sent_at DESC),
     KEY idx_to (to_addr, sent_at DESC)
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

  `CREATE TABLE IF NOT EXISTS sutra_copy_progress (
     user_id INT UNSIGNED NOT NULL,
     sutra_id INT UNSIGNED NOT NULL,
     chunk_idx INT UNSIGNED NOT NULL,
     written_chars JSON NOT NULL,
     started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     completed_at DATETIME NULL,
     PRIMARY KEY (user_id, sutra_id, chunk_idx),
     INDEX idx_user_completed (user_id, completed_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS activate (
     id                 BIGINT       NOT NULL AUTO_INCREMENT,
     short_name         VARCHAR(64)  NOT NULL,
     installation_data  JSON         NULL,
     is_activated       TINYINT(1)   NOT NULL DEFAULT 0,
     activated_at       TIMESTAMP    NULL,
     is_expired         TINYINT(1)   NOT NULL DEFAULT 0,
     expire_date        TIMESTAMP    NULL,
     \`lock\`             TINYINT(1)   NOT NULL DEFAULT 0,
     last_heartbeat_at  TIMESTAMP    NULL,
     last_cloud_sync_at TIMESTAMP    NULL,
     cloud_endpoint     VARCHAR(255) NULL DEFAULT 'https://www.booming.one',
     created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `INSERT INTO app_config (\`key\`, value, updated_by) VALUES
     ('era.jiaguwen.font', 'Oracular',          NULL),
     ('era.jinwen.font',    'WangHanzongWeibei', NULL),
     ('era.xiaozhuan.font', 'QuanZiKuShuoWen',   NULL),
     ('era.lishu.font',     'WangHanzongLishu',  NULL),
     ('era.kaishu.font',    'ZCOOLXiaoWei',      NULL)
   ON DUPLICATE KEY UPDATE value = VALUES(value)`,
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
  // Auto-populate chars table if empty (fail-soft)
  // Seed 8105 chars with level + unicode_codepoint + radical from JSON files.
  // Pinyin/meaning/stroke_count are filled by admin tools or content-refresh scheduler.
  // Filter to BMP-only — mysql2 binary protocol mojibakes supp-plane chars (length > 1).
  // Bulk insert in batches of 500 to avoid per-row roundtrips (~3min → <10s).
  try {
    const [[{ count: cCount }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM chars`);
    if (Number(cCount) === 0) {
      const charsArr = (charsData as string[]).filter((c) => c.length === 1);
      const radicalsMap = radicalsData as Record<string, string>;
      const rows: Array<[string, number, string, string]> = [];
      let idx = 0;
      for (const ch of charsArr) {
        const level = idx < 3500 ? 1 : idx < 6500 ? 2 : 3;
        const cp = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
        const radical = radicalsMap[ch] ?? '';
        rows.push([ch, level, radical, cp]);
        idx++;
      }
      const BATCH = 500;
      let imported = 0;
      for (let off = 0; off < rows.length; off += BATCH) {
        const batch = rows.slice(off, off + BATCH);
        const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
        const params = batch.flat();
        await pool.execute(
          `INSERT IGNORE INTO chars (\`char\`, level, radical, unicode_codepoint) VALUES ${placeholders}`,
          params
        );
        imported += batch.length;
      }
      console.log(`[initDb] inserted ${imported} chars (bulk auto-populate)`);
    } else {
      console.log(`[initDb] chars table has ${cCount} rows, skip auto-populate`);
    }
  } catch (err) {
    console.warn('[initDb] chars auto-populate failed (continuing):', (err as Error).message);
  }
  // Seed activate singleton (id=1) — platform instance monitoring row.
  // short_name defaults to OS hostname; cloud_endpoint is the future
  // reporting target. installationData is left NULL until the cloud
  // daemon populates it on first heartbeat.
  try {
    const os = await import('node:os');
    const hostname = os.hostname().slice(0, 64);
    const installationData = JSON.stringify({
      hostname,
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMem: os.totalmem(),
      nodeVersion: process.version,
    });
    await pool.execute(
      `INSERT IGNORE INTO activate (id, short_name, installation_data) VALUES (1, ?, ?)`,
      [hostname, installationData]
    );
    console.log(`[initDb] activate singleton ready (short_name=${hostname})`);
  } catch (err) {
    console.warn('[initDb] activate singleton seed failed (continuing):', (err as Error).message);
  }
}

if (require.main === module) {
  initDb()
    .then(() => { console.log('DB initialized'); return closePool(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
