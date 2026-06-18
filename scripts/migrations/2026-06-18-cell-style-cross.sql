-- 2026-06-18: add 'cross' (= 米字格) to worksheets.cell_style enum
-- Idempotent: same column type, just wider. No data loss.
ALTER TABLE worksheets
  MODIFY cell_style ENUM('brush','square','pen','cross') NOT NULL;