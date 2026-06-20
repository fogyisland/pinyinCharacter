-- Plan G6 — Ancient Classics table.
-- Stores classical Chinese texts (论语, 孟子, 弟子规, etc.) as JSON chunks,
-- each chunk = one chapter. Pinyin is pre-computed at ingest time.
CREATE TABLE IF NOT EXISTS classics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  category ENUM('four-books','five-classics','mengxue','philosophy','history','other') NOT NULL DEFAULT 'other',
  author VARCHAR(64) NULL,
  era VARCHAR(16) NULL,
  chunks JSON NOT NULL,
  chunk_count INT UNSIGNED GENERATED ALWAYS AS (JSON_LENGTH(chunks)) STORED,
  source VARCHAR(64) NOT NULL DEFAULT 'chinese-poetry@master',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug (slug),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;