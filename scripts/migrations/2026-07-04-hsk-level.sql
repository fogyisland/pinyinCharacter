-- Add HSK level column to chars table for /game difficulty tiers.
-- NULL means HSK data not yet assigned; clients fall back to chars.level.
ALTER TABLE chars ADD COLUMN hsk_level TINYINT NULL;
CREATE INDEX idx_chars_hsk_level ON chars (hsk_level);
