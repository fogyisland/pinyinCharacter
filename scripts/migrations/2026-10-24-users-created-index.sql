-- Index for the admin user list.
--
-- The list query sorts with `ORDER BY u.created_at DESC`, but `users` only had
-- indexes on (id), (username) and (email) — so MySQL had to filesort the whole
-- table on every page render. This index turns that into an index scan.
--
-- Idempotent: guarded the same way as the other migrations, so a fresh DB
-- (scripts/init-db.ts) and an upgraded one converge on the same schema.

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND index_name = 'idx_users_created'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE users ADD KEY idx_users_created (created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
