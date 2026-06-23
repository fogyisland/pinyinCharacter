-- Add user_agent column to downloads for parity with audit_log.
-- Idempotent: re-runs find column already present, error 1060 suppressed by NOT EXISTS guard.
-- No backfill — historical rows have user_agent = NULL.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'downloads'
    AND COLUMN_NAME = 'user_agent'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE downloads ADD COLUMN user_agent VARCHAR(512) NULL AFTER ip',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;