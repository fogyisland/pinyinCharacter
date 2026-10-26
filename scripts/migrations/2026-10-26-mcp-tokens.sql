-- Per-user MCP tokens.
--
-- One row per user (the UNIQUE key on user_id): issuing a token again
-- rotates it in place. The raw token is never stored — only its sha256
-- hex digest, the same shape as password_resets.token_hash.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is a no-op once the table exists,
-- so the /init wizard can re-run every migration safely.
--
-- Prerequisite: users.disabled_at. The column is created by the idempotent
-- ALTER inside scripts/init-db.ts and by no file in scripts/migrations/ --
-- but lib/auth.ts already selects it, so every live database has it. The
-- resolveToken query reads it too and inherits the same prerequisite.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_mcp_tokens_user (user_id),
  UNIQUE KEY uniq_mcp_tokens_hash (token_hash),
  CONSTRAINT fk_mcp_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
