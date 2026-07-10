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
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

  `CREATE TABLE IF NOT EXISTS audio_tracks (
     id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
     title       VARCHAR(128) NOT NULL,
     filename    VARCHAR(255) NOT NULL,
     size_bytes  INT UNSIGNED NOT NULL DEFAULT 0,
     is_default  TINYINT(1)   NOT NULL DEFAULT 0,
     uploaded_by BIGINT       NULL,
     created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_audio_default (is_default),
     CONSTRAINT fk_audio_uploaded_by FOREIGN KEY (uploaded_by)
       REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS playlists (
     id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
     title       VARCHAR(128) NOT NULL,
     is_default  TINYINT(1)   NOT NULL DEFAULT 0,
     created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_playlists_default (is_default)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS playlist_tracks (
     playlist_id INT UNSIGNED NOT NULL,
     track_id    INT UNSIGNED NOT NULL,
     position    INT UNSIGNED NOT NULL,
     PRIMARY KEY (playlist_id, position),
     UNIQUE KEY uq_playlist_track (playlist_id, track_id),
     KEY idx_pt_track (track_id),
     CONSTRAINT fk_pt_playlist FOREIGN KEY (playlist_id)
       REFERENCES playlists(id) ON DELETE CASCADE,
     CONSTRAINT fk_pt_track FOREIGN KEY (track_id)
       REFERENCES audio_tracks(id) ON DELETE CASCADE
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
];

// Era font defaults — always upserted by initAppConfig (idempotent).
// Kept separate from DDL so phase 1 (tables) and phase 2 (app_config) have
// clean boundaries; no double-execution.
const APPCONFIG_DEFAULTS = [
  `INSERT INTO app_config (\`key\`, value, updated_by) VALUES
     ('era.jiaguwen.font', 'Oracular',          NULL),
     ('era.jinwen.font',    'WangHanzongWeibei', NULL),
     ('era.xiaozhuan.font', 'QuanZiKuShuoWen',   NULL),
     ('era.lishu.font',     'WangHanzongLishu',  NULL),
     ('era.kaishu.font',    'ZCOOLXiaoWei',      NULL)
   ON DUPLICATE KEY UPDATE value = VALUES(value)`,
];

export interface AutoPopulateResult {
  /** 0 = skipped because table already had rows; >0 = inserted count. */
  inserted: number;
  /** True when the table had rows already and we skipped auto-populate. */
  skipped: boolean;
  /** Error message when auto-populate failed (table remains empty). */
  failed?: string;
}

/**
 * PHASE 1: create the 25-table base schema (DDL is idempotent — re-runs are no-ops).
 * Also handles 2 idempotent ALTERs on `users` (disabled_at, email) that were added
 * post-launch. Returns total statements executed + current table count for the
 * wizard summary.
 */
export interface InitTablesStats {
  statementsRun: number;
  tablesNow: number;
}

export async function initTables(): Promise<InitTablesStats> {
  const pool = getPool();
  let altersRun = 0;
  for (const sql of DDL) {
    await pool.query(sql);
  }
  const [cols] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'disabled_at'`,
  );
  if (cols.length === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL AFTER is_admin`);
    altersRun++;
  }
  const [emailCols] = await pool.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'`,
  );
  if (emailCols.length === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username`);
    await pool.query(`ALTER TABLE users ADD UNIQUE KEY uk_email (email)`);
    altersRun += 2;
  }
  const [[{ count }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()`,
  );
  return { statementsRun: DDL.length + altersRun, tablesNow: Number(count) };
}

/**
 * PHASE 2: seed app_config defaults (ai.* + tts.* + era fonts).
 * Idempotent — re-runs are no-ops (era fonts use ON DUPLICATE KEY UPDATE,
 * ai/tts keys check existing rows first).
 */
export interface InitAppConfigStats {
  inserted: number;
  totalRows: number;
}

export async function initAppConfig(): Promise<InitAppConfigStats> {
  const pool = getPool();
  const [[{ count: beforeCount }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count FROM app_config`,
  );
  let inserted = 0;
  if (Number(beforeCount) === 0) {
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
    inserted = defaults.length + 3;
    console.log(`[initAppConfig] seeded ${inserted} app_config defaults`);
  } else {
    console.log(`[initAppConfig] app_config has ${beforeCount} rows, skip seed`);
  }
  // Era font defaults — always upsert (ON DUPLICATE KEY keeps them in sync with code).
  for (const sql of APPCONFIG_DEFAULTS) {
    await pool.query(sql);
  }
  const [[{ count: afterCount }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count FROM app_config`,
  );
  return { inserted, totalRows: Number(afterCount) };
}

/**
 * PHASE 3: auto-populate poems table from data/poems/*.json. Idempotent (skip if
 * poems table already has rows). Fail-soft — errors don't propagate.
 */
export async function initPoems(): Promise<AutoPopulateResult> {
  const pool = getPool();
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM poems`);
    if (Number(count) > 0) {
      console.log(`[initPoems] poems table has ${count} rows, skip auto-populate`);
      return { inserted: 0, skipped: true };
    }
    const { buildPoems } = await import('./build-poems');
    const n = await buildPoems();
    console.log(`[initPoems] inserted ${n} poems (auto-populate)`);
    return { inserted: n, skipped: false };
  } catch (err) {
    console.warn('[initPoems] auto-populate failed (continuing):', (err as Error).message);
    return { inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 4b: auto-populate classics from data/classics-manifest.json +
 * data/classics/<slug>.json (file-only since 2026-07-10; build-classics was
 * previously GitHub-fetch which 503'd on prod). Idempotent (skip if classics
 * already has rows). Mirrors initPoems.
 */
export async function initClassics(): Promise<AutoPopulateResult> {
  const pool = getPool();
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM classics`);
    if (Number(count) > 0) {
      console.log(`[initClassics] classics table has ${count} rows, skip auto-populate`);
      return { inserted: 0, skipped: true };
    }
    const { buildClassicsFromFiles } = await import('./build-classics');
    const n = await buildClassicsFromFiles();
    console.log(`[initClassics] inserted ${n} classics (auto-populate)`);
    return { inserted: n, skipped: false };
  } catch (err) {
    console.warn('[initClassics] auto-populate failed (continuing):', (err as Error).message);
    return { inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 4: auto-populate sutras table from data/sutras/*.json.
 */
export async function initSutras(): Promise<AutoPopulateResult> {
  const pool = getPool();
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM sutras`);
    if (Number(count) > 0) {
      console.log(`[initSutras] sutras table has ${count} rows, skip auto-populate`);
      return { inserted: 0, skipped: true };
    }
    const { buildSutras } = await import('./build-sutras');
    const n = await buildSutras();
    console.log(`[initSutras] inserted ${n} sutras (auto-populate)`);
    return { inserted: n, skipped: false };
  } catch (err) {
    console.warn('[initSutras] auto-populate failed (continuing):', (err as Error).message);
    return { inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 5: auto-populate chars table from data/general-standard-chinese-characters.json.
 * 8105 chars with level + unicode_codepoint + radical. Pinyin/meaning/stroke_count
 * are filled later by admin tools or content-refresh scheduler.
 * Filter to BMP-only — mysql2 binary protocol mojibakes supp-plane chars.
 */
export async function initChars(): Promise<AutoPopulateResult> {
  const pool = getPool();
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM chars`);
    if (Number(count) > 0) {
      console.log(`[initChars] chars table has ${count} rows, skip auto-populate`);
      return { inserted: 0, skipped: true };
    }
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
    console.log(`[initChars] inserted ${imported} chars (bulk auto-populate)`);
    return { inserted: imported, skipped: false };
  } catch (err) {
    console.warn('[initChars] auto-populate failed (continuing):', (err as Error).message);
    return { inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 5b: auto-populate rare_chars table from data/content/<char>.json.
 * /rare-chars page reads FROM this table; without seed, the page shows
 * "字库为空" even though chars table has 1412 level-3 rows (added 2026-07-09
 * to fix "罕见字库为空" user feedback).
 *
 * Source: scan data/content/<char>.json, keep those with `level === 3` AND
 * non-empty `rare.meaning`. The "needs_review" flag stays at the default (1)
 * — admin tools flag individual chars after human review.
 *
 * Idempotent: skips if table already has rows (matches initChars pattern).
 */
export interface InitRareCharsStats {
  scanned: number;
  inserted: number;
  skipped: boolean;
  failed?: string;
}
export async function initRareChars(): Promise<InitRareCharsStats> {
  const pool = getPool();
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM rare_chars`);
    if (Number(count) > 0) {
      console.log(`[initRareChars] rare_chars table has ${count} rows, skip auto-populate`);
      return { scanned: 0, inserted: 0, skipped: true };
    }
    const contentDir = join(process.cwd(), 'data', 'content');
    if (!existsSync(contentDir)) {
      console.warn(`[initRareChars] ${contentDir} not found, nothing to seed`);
      return { scanned: 0, inserted: 0, skipped: false };
    }
    const files = readdirSync(contentDir).filter((f) => f.endsWith('.json'));
    const rows: Array<[string]> = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(readFileSync(join(contentDir, f), 'utf8'));
        if (raw?.level === 3 && raw?.rare?.meaning) {
          rows.push([raw.char]);
        }
      } catch {
        // Skip malformed JSON — log but don't abort the whole seed.
        continue;
      }
    }
    const BATCH = 500;
    let imported = 0;
    for (let off = 0; off < rows.length; off += BATCH) {
      const batch = rows.slice(off, off + BATCH);
      const placeholders = batch.map(() => '(?)').join(', ');
      await pool.execute(
        `INSERT IGNORE INTO rare_chars (\`char\`) VALUES ${placeholders}`,
        batch.flat(),
      );
      imported += batch.length;
    }
    console.log(`[initRareChars] scanned ${files.length}, inserted ${imported} rare chars`);
    return { scanned: files.length, inserted: imported, skipped: false };
  } catch (err) {
    console.warn('[initRareChars] auto-populate failed (continuing):', (err as Error).message);
    return { scanned: 0, inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 5c: backfill char_etymology rows for chars without one.
 *
 * 2026-06-17 slim-DB refactor only writes a char_etymology row when the
 * content JSON has a non-empty `etymology_story` field. ~10 chars have no
 * content JSON, so /etymology/<char> would fall through to the empty state
 * path forever. Insert a placeholder row (kaishu only) so the page renders.
 *
 * ERA_FONT defaults mirror lib/etymology.ts:19-25 — kept local so this
 * module doesn't pull client-side code. Idempotent (INSERT IGNORE).
 */
function isBmpChar(c: string): boolean {
  const cp = c.codePointAt(0);
  return cp != null && cp <= 0xFFFF;
}

const CHAR_ETYMOLOGY_ERA_FONT = {
  jiaguwen: 'YinQiJiaGuWen',
  jinwen: 'HanDianJinWen',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'QuanZiKuLiDing',
  kaishu: 'KaiTi',
};

export async function initCharEtymology(): Promise<AutoPopulateResult> {
  const pool = getPool();
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT c.char FROM chars c LEFT JOIN char_etymology e ON c.char = e.char WHERE e.char IS NULL`,
    );
    const missing: string[] = (rows as any[]).map((r) => r.char);
    if (missing.length === 0) {
      console.log('[initCharEtymology] no chars missing etymology row, skip');
      return { inserted: 0, skipped: true };
    }
    let inserted = 0;
    for (const ch of missing) {
      await pool.execute(
        `INSERT IGNORE INTO char_etymology (\`char\`, era_jiaguwen_font, era_jiaguwen_has, era_jinwen_font, era_jinwen_has, era_xiaozhuan_font, era_xiaozhuan_has, era_lishu_font, era_lishu_has, era_kaishu_font, era_kaishu_has) VALUES (?, ?, 0, ?, 0, ?, 0, ?, 0, ?, 1)`,
        [
          ch,
          CHAR_ETYMOLOGY_ERA_FONT.jiaguwen,
          CHAR_ETYMOLOGY_ERA_FONT.jinwen,
          CHAR_ETYMOLOGY_ERA_FONT.xiaozhuan,
          CHAR_ETYMOLOGY_ERA_FONT.lishu,
          CHAR_ETYMOLOGY_ERA_FONT.kaishu,
        ],
      );
      inserted++;
    }
    console.log(`[initCharEtymology] backfilled ${inserted} char_etymology rows`);
    return { inserted, skipped: false };
  } catch (err) {
    console.warn('[initCharEtymology] backfill failed (continuing):', (err as Error).message);
    return { inserted: 0, skipped: false, failed: (err as Error).message };
  }
}

/**
 * PHASE 6: create the first admin user. Requires users table (PHASE 1).
 * Idempotent — refuses if username already taken. Returns the new user's id.
 */
export interface CreateAdminInput {
  username: string;
  password: string;
  email?: string;
}
export interface CreateAdminStats {
  userId: number;
  username: string;
}

export async function createAdminUser(input: CreateAdminInput): Promise<CreateAdminStats> {
  const pool = getPool();
  // Refuse if username already exists (idempotent re-runs).
  const [existing] = await pool.query<any[]>(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [input.username],
  );
  if (existing.length > 0) {
    throw new Error(`username_taken: A user with username '${input.username}' already exists.`);
  }
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(input.password, 10);
  const [r] = await pool.execute<any>(
    `INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, 1)`,
    [input.username, input.email ?? null, hash],
  );
  return { userId: Number((r as any).insertId), username: input.username };
}

/**
 * PHASE 7: seed activate singleton (id=1) — platform instance monitoring row.
 * short_name defaults to OS hostname; cloud_endpoint is the future reporting
 * target. installationData is left NULL until the cloud daemon populates it.
 */
export interface InitActivateStats {
  seeded: boolean;
  shortName: string;
}

export async function initActivate(): Promise<InitActivateStats> {
  const pool = getPool();
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
  const [r] = await pool.execute(
    `INSERT IGNORE INTO activate (id, short_name, installation_data) VALUES (1, ?, ?)`,
    [hostname, installationData],
  );
  const seeded = (r as any).affectedRows > 0;
  console.log(`[initActivate] singleton ready (short_name=${hostname}, seeded=${seeded})`);
  return { seeded, shortName: hostname };
}

/**
 * Orchestrator: runs all 7 init phases in order. Kept for CLI use
 * (`npx tsx scripts/init-db.ts`) and for one-shot callers that don't need
 * per-phase progress. The /init wizard calls each phase individually for
 * real-time progress UI.
 */
export interface InitDbStats {
  statementsRun: number;
  tablesNow: number;
  appConfigRows: number;
  poems: AutoPopulateResult;
  sutras: AutoPopulateResult;
  chars: AutoPopulateResult;
  rareChars: InitRareCharsStats;
  activateSeeded: boolean;
}

export async function initDb(): Promise<InitDbStats> {
  const tables = await initTables();
  const appConfig = await initAppConfig();
  const poems = await initPoems();
  const sutras = await initSutras();
  const chars = await initChars();
  const rareChars = await initRareChars();
  const { seeded: activateSeeded } = await initActivate();
  return {
    statementsRun: tables.statementsRun,
    tablesNow: tables.tablesNow,
    appConfigRows: appConfig.totalRows,
    poems,
    sutras,
    chars,
    rareChars,
    activateSeeded,
  };
}

if (require.main === module) {
  initDb()
    .then((stats) => {
      console.log('DB initialized:', JSON.stringify(stats, null, 2));
      return closePool();
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
