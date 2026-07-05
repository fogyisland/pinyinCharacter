-- Email verification (Task B, soft mode)
-- Idempotent: re-runs find column/table already added, ALTER TABLE is a no-op.
-- Soft verification only — UI shows "未验证" badge; no auth gating.
-- Triggered by /api/auth/register (auto-send), /api/auth/resend-verification (manual).

-- 1. Add email_verified_at to users (NULL = unverified, set = verified)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email_verified_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Create email_verifications table
CREATE TABLE IF NOT EXISTS email_verifications (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  expires_at  TIMESTAMP    NOT NULL,
  used_at     TIMESTAMP    NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ev_user (user_id, created_at DESC),
  KEY idx_ev_token_hash (token_hash),
  KEY idx_ev_expires (expires_at),
  CONSTRAINT fk_ev_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;