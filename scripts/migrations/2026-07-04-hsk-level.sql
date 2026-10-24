-- Add HSK level column to chars table for /game difficulty tiers.
-- NULL means HSK data not yet assigned; clients fall back to chars.level.
--
-- Idempotent: the column + index are guarded so a re-run of the wizard's
-- migrate phase (or a DB where scripts/init-db.ts already shipped them)
-- does not abort with ER_DUP_FIELDNAME / ER_DUP_KEYNAME. Same idiom as
-- 2026-06-27-02-email-campaigns.sql.

-- 1. hsk_level column
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'chars' AND column_name = 'hsk_level'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. idx_chars_hsk_level
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'chars' AND index_name = 'idx_chars_hsk_level'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_chars_hsk_level ON chars (hsk_level)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
