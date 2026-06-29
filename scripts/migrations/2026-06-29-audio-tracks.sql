-- Audio tracks (plan: sutra-audio-player, 2026-06-29)
-- One default track for the whole site; admins can upload multiple MP3s and
-- toggle which is the default. Files stored under public/audio/<id>.mp3;
-- the `filename` column stores the on-disk name (always `<id>.mp3` for v1).
-- uploaded_by matches users.id (BIGINT).

CREATE TABLE IF NOT EXISTS audio_tracks (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(128) NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  size_bytes  INT UNSIGNED NOT NULL DEFAULT 0,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  uploaded_by BIGINT       NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audio_default (is_default),
  CONSTRAINT fk_audio_uploaded_by FOREIGN KEY (uploaded_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
