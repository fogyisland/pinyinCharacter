-- Webfont build jobs: one row per build attempt of the admin font pipeline.
--
-- The row is the cross-process truth for "is a build already running?" — the
-- in-process globalThis mutex is only the fast path (design §3.2). The row
-- also survives a process restart, which is what lets the startup sweep mark
-- a job that died mid-build as failed instead of leaving it running forever.
--
-- `log` is append-only and holds the build transcript. It is emptied (never
-- deleted) for jobs outside the retention window, so the metadata of an old
-- job — status, version, timestamps — outlives its transcript.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is a no-op once the table exists,
-- and the two lookup indexes are declared inside the CREATE TABLE (KEY ...),
-- so re-running this file is safe. The /init wizard runs every migration on
-- every deploy, and a bare statement that creates a schema object would
-- abort the run with ER_DUP_FIELDNAME / ER_DUP_KEYNAME (see
-- tests/unit/migrations-idempotent.test.ts).

CREATE TABLE IF NOT EXISTS webfont_build_jobs (
  id            VARCHAR(40)  NOT NULL,
  status        VARCHAR(16)  NOT NULL,          -- pending | running | done | failed | cancelled
  step          VARCHAR(16)  NOT NULL DEFAULT '',-- download | instance | subset | verify | apply
  step_progress VARCHAR(8)   NOT NULL DEFAULT '',-- 文本，例如「切分第 2/3 族」
  message       VARCHAR(500) NOT NULL DEFAULT '',
  error         TEXT        NULL,
  log           MEDIUMTEXT  NOT NULL,
  manifest_version VARCHAR(16) NOT NULL DEFAULT '', -- apply 之后 = 新的 manifest version
  release_dir   VARCHAR(64)  NOT NULL DEFAULT '',   -- apply 之后 = 新建的 release 目录名
  started_by    BIGINT       NULL,                 -- 触发作业的管理员 user id
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_webfont_build_jobs_status (status),
  KEY idx_webfont_build_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
