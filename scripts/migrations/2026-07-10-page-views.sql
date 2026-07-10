-- Page views (页面访问): one row per server-side page hit (Task 1 of page_views plan).
-- user_id has no FK (mirrors audit_log) so views survive user deletion.
-- 3 indexes: created_at (global time range), user_id+created_at (per-user activity), path+created_at (popular pages).
-- Idempotent: CREATE TABLE IF NOT EXISTS — safe to re-run on prod during init wizard migrate phase.

CREATE TABLE IF NOT EXISTS page_views (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NULL,
  path VARCHAR(255) NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pv_created (created_at DESC),
  KEY idx_pv_user_created (user_id, created_at DESC),
  KEY idx_pv_path_created (path, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
