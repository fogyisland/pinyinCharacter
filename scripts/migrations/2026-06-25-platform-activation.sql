-- Platform activation & instance monitoring table.
-- One row per server install (singleton, id=1). The local install reports
-- status to www.booming.one (cloud), and the cloud can set `lock`=1 to
-- disable this instance remotely. A local daemon (future) reads/writes
-- last_heartbeat_at and last_cloud_sync_at to track the handshake.
--
-- Idempotent: re-runs find the table already present.
-- No backfill: this is the first version of the table.

CREATE TABLE IF NOT EXISTS activate (
  id                 BIGINT       NOT NULL AUTO_INCREMENT,
  short_name         VARCHAR(64)  NOT NULL,
  installation_data  JSON         NULL,
  is_activated       TINYINT(1)   NOT NULL DEFAULT 0,
  activated_at       TIMESTAMP    NULL,
  is_expired         TINYINT(1)   NOT NULL DEFAULT 0,
  expire_date        TIMESTAMP    NULL,
  `lock`             TINYINT(1)   NOT NULL DEFAULT 0,
  last_heartbeat_at  TIMESTAMP    NULL,
  last_cloud_sync_at TIMESTAMP    NULL,
  cloud_endpoint     VARCHAR(255) NULL DEFAULT 'https://www.booming.one',
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
