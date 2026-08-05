-- Add ip column + index for anonymous rate-limit queries on ai_calls.
-- Existing schema (per scripts/init-db.ts:281-297) has user_id BIGINT NULL.
-- Anonymous rows will have user_id IS NULL + ip = <client-ip>.

ALTER TABLE ai_calls ADD COLUMN ip VARCHAR(45) NULL AFTER user_id;
ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at DESC);
