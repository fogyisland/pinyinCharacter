-- Per-task scheduler run history. One row per task per run.
-- run_id groups tasks that ran in the same tick (so the UI can show batches).
-- Idempotent: re-runs find the table already present, CREATE TABLE IF NOT EXISTS short-circuits.
-- No backfill — historical ticks only have aggregate summaries in app_config.

CREATE TABLE IF NOT EXISTS scheduler_run_history (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;