-- Public notes wall (留言笔记): flat feedback posts from anon + registered users.
-- Soft-delete preserves audit trail. Rate-limit table keyed by (scope, key_value, window_kind).
-- Idempotent: tables + indexes only created if missing.

CREATE TABLE IF NOT EXISTS notes (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  author_user_id  BIGINT NULL,
  author_name     VARCHAR(64) NOT NULL,
  author_email    VARCHAR(254) NULL,
  content         TEXT NOT NULL,
  ip              VARCHAR(45) NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME NULL,
  deleted_by      BIGINT NULL,
  PRIMARY KEY (id),
  KEY idx_notes_alive (deleted_at, created_at DESC),
  CONSTRAINT fk_notes_user FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_notes_deleted_by FOREIGN KEY (deleted_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes_rate_limits (
  scope        ENUM('ip', 'email') NOT NULL,
  key_value    VARCHAR(254) NOT NULL,
  window_kind  ENUM('minute', 'hour') NOT NULL,
  window_start DATETIME NOT NULL,
  post_count   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, key_value, window_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;