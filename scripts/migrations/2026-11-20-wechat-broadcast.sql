-- WeChat (微信公众号) template message broadcasts.
--
-- One table:
--   wechat_broadcasts — one row per announcement. The scheduler picks up
--                       the queued ones, pulls the follower list from
--                       WeChat, and sends a template message to each
--                       follower.
--
-- There is deliberately NO per-recipient table. Template messages are
-- sent one openid at a time, but WeChat gives no per-person delivery receipt
-- — a zero errcode means the platform accepted the message, not that anyone
-- received it. A per-recipient log would therefore record N copies of the
-- same low-information fact, and grow linearly with the follower count on
-- every broadcast. Only the counts are kept.
--
-- The four counts answer four different questions:
--   total_recipients — how many followers the run addressed
--   accepted_count   — how many the WeChat platform accepted
--   skipped_count    — how many could not be reached (the follower left
--                      the account, or turned the message off)
--   failed_count     — how many hit an error that stopped the run
--
-- Idempotent: CREATE TABLE IF NOT EXISTS short-circuits on re-run. The
-- migration runner applies every file on every boot, so this matters.

CREATE TABLE IF NOT EXISTS wechat_broadcasts (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  title            VARCHAR(128)  NOT NULL,
  template_id      VARCHAR(64)   NOT NULL,
  url              VARCHAR(512)  NULL,
  data             JSON          NOT NULL,
  status           ENUM('draft','queued','sending','sent','failed','cancelled')
                                 NOT NULL DEFAULT 'draft',
  total_recipients INT UNSIGNED  NOT NULL DEFAULT 0,
  accepted_count   INT UNSIGNED  NOT NULL DEFAULT 0,
  skipped_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  failed_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  last_error       VARCHAR(1024) NULL,
  created_by       BIGINT        NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  finished_at      DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_wb_status (status, created_at DESC),
  KEY idx_wb_created_by (created_by, created_at DESC),
  CONSTRAINT fk_wb_user FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
