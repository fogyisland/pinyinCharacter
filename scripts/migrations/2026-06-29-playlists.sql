-- Playlists (plan: sutra-audio-playlist, 2026-06-29)
-- Site-wide ordered playlists of audio_tracks. /sutra/[id] reads the default
-- playlist and SutraAudioPlayer plays tracks in position order.
-- Junction uses (playlist_id, position) composite PK for ordering; a track can
-- only appear once per playlist (uq_playlist_track).

CREATE TABLE IF NOT EXISTS playlists (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(128) NOT NULL,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_playlists_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INT UNSIGNED NOT NULL,
  track_id    INT UNSIGNED NOT NULL,
  position    INT UNSIGNED NOT NULL,
  PRIMARY KEY (playlist_id, position),
  UNIQUE KEY uq_playlist_track (playlist_id, track_id),
  KEY idx_pt_track (track_id),
  CONSTRAINT fk_pt_playlist FOREIGN KEY (playlist_id)
    REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_track FOREIGN KEY (track_id)
    REFERENCES audio_tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;