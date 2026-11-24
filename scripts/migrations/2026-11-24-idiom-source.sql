-- Add the 出处 (source) column to the idioms table.
--
-- `data/idioms.json` now carries a `source` on every one of its 378 entries,
-- and the /idioms page prints it beneath the meaning. The importer
-- (`scripts/import-idioms.ts`) upserts that field, and `scripts/build-idioms.ts`
-- carries it through a rebuild, so the database needs somewhere to keep it.
--
-- The default is an honest placeholder, never a guessed classic attribution:
-- a row whose source is unknown reads 出处待考 on the page. Existing rows get
-- the same placeholder until the importer runs again and fills them in.
--
-- Idempotent: the ADD COLUMN lives inside a quoted DDL literal guarded by an
-- information_schema check, the same pattern as 2026-07-04-hsk-level.sql. A
-- re-run never fails with ER_DUP_FIELDNAME, and an already-migrated database
-- keeps its reviewed sources untouched.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'idioms'
    AND column_name = 'source'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE idioms ADD COLUMN source VARCHAR(512) NOT NULL DEFAULT ''出处待考'' AFTER category',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
