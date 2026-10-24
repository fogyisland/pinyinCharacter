-- Add ip column + index for anonymous rate-limit queries on ai_calls.
-- Existing schema (per scripts/init-db.ts:281-297) has user_id BIGINT NULL.
-- Anonymous rows will have user_id IS NULL + ip = <client-ip>.
--
-- Idempotent: a fresh DB created by scripts/init-db.ts already ships the
-- column and the index, so a plain ALTER TABLE would abort with
-- ER_DUP_FIELDNAME / ER_DUP_KEYNAME and break the /init wizard's
-- run-seed phase. Both statements are therefore guarded the same way as
-- 2026-06-27-02-email-campaigns.sql.

-- 1. ip column
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ai_calls' AND column_name = 'ip'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE ai_calls ADD COLUMN ip VARCHAR(45) NULL AFTER user_id',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. idx_ai_calls_ip_created (ip, created_at DESC)
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'ai_calls' AND index_name = 'idx_ai_calls_ip_created'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at DESC)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
