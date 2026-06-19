-- 2026-06-19: 抄经 (scripture-copying) progress per user × sutra × chunk
-- Idempotent. Single-table DDL.
CREATE TABLE IF NOT EXISTS sutra_copy_progress (
  user_id INT UNSIGNED NOT NULL,
  sutra_id INT UNSIGNED NOT NULL,
  chunk_idx INT UNSIGNED NOT NULL,
  written_chars JSON NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (user_id, sutra_id, chunk_idx),
  INDEX idx_user_completed (user_id, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
