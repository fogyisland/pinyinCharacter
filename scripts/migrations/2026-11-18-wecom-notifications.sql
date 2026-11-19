-- WeCom (企业微信) notification forwarding.
--
-- Two tables:
--   wecom_webhooks    — the group robots. Each one is a WeCom group and the
--                       set of notification categories it wants.
--   wecom_deliveries  — the queue AND the history. A notification produces
--                       one row per matching group; the scheduler pushes the
--                       due rows and records the outcome.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS short-circuits on re-run. The
-- migration runner applies every file on every boot, so this matters.
-- No backfill — there is no WeCom integration to backfill from.

CREATE TABLE IF NOT EXISTS wecom_webhooks (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  webhook_url VARCHAR(512) NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  categories  JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wecom_webhook_name (name),
  KEY idx_wecom_webhook_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wecom_deliveries (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  webhook_id      BIGINT        NOT NULL,
  category        VARCHAR(64)   NOT NULL,
  subject         VARCHAR(512)  NOT NULL,
  body            MEDIUMTEXT    NOT NULL,
  status          ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts        INT           NOT NULL DEFAULT 0,
  last_error      VARCHAR(1024) NULL,
  next_attempt_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at         DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wecom_delivery_due (status, next_attempt_at),
  KEY idx_wecom_delivery_webhook (webhook_id, created_at DESC),
  CONSTRAINT fk_wecom_delivery_webhook FOREIGN KEY (webhook_id)
    REFERENCES wecom_webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
