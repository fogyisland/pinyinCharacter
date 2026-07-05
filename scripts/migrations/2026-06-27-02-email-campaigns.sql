-- Email campaigns (Task C — marketing broadcast, scheduler-driven)
-- Idempotent: re-runs are no-ops once the schema is current.

-- 1. Users: marketing opt-out flag (0 = subscribed, 1 = unsubscribed)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'marketing_opted_out'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN marketing_opted_out TINYINT(1) NOT NULL DEFAULT 0 AFTER email_verified_at',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. email_campaigns — one row per campaign
CREATE TABLE IF NOT EXISTS email_campaigns (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  subject           VARCHAR(255) NOT NULL,
  html_body         MEDIUMTEXT   NOT NULL,
  text_body         MEDIUMTEXT   NOT NULL,
  audience          ENUM('all','members','admins') NOT NULL DEFAULT 'all',
  status            ENUM('draft','sending','sent','failed','cancelled') NOT NULL DEFAULT 'draft',
  total_recipients  INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count        INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count      INT UNSIGNED NOT NULL DEFAULT 0,
  started_at        DATETIME     NULL,
  finished_at       DATETIME     NULL,
  created_by        BIGINT       NOT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status (status, created_at DESC),
  KEY idx_created_by (created_by, created_at DESC),
  CONSTRAINT fk_ec_user FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. email_campaign_recipients — per-recipient delivery log
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT       NOT NULL,
  user_id       BIGINT       NOT NULL,
  email         VARCHAR(254) NOT NULL,
  status        ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  error         VARCHAR(1024) NULL,
  sent_at       DATETIME     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_campaign_user (campaign_id, user_id),
  KEY idx_status (campaign_id, status),
  KEY idx_user (user_id),
  CONSTRAINT fk_ecr_campaign FOREIGN KEY (campaign_id)
    REFERENCES email_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecr_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;