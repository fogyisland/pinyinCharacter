-- Email send history. Logs every sendEmail() call (success or failure) so
-- the admin UI can show recent deliveries for debugging.
-- Idempotent: CREATE TABLE IF NOT EXISTS short-circuits on re-run.
-- No backfill — historical sends are not recoverable.

CREATE TABLE IF NOT EXISTS email_send_history (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  to_addr     VARCHAR(254) NOT NULL,
  subject     VARCHAR(512) NOT NULL,
  template    VARCHAR(64)  NULL,
  status      ENUM('sent','failed','console') NOT NULL,
  error       VARCHAR(1024) NULL,
  sent_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sent_at (sent_at DESC),
  KEY idx_status (status, sent_at DESC),
  KEY idx_to (to_addr, sent_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;