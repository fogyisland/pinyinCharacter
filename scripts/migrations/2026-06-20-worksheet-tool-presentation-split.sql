-- G5: Split cellStyle into composite ${tool}-${presentation} format
-- Idempotent: old values remain in ENUM so re-runs are safe.
--   brush    -> brush-cross  (preserves diagonal X distinctive to brush cells)
--   pen      -> pen-square
--   square   -> pen-square
--   cross    -> pen-cross

-- Step 1: widen ENUM to include 4 new composite values
ALTER TABLE worksheets
  MODIFY COLUMN cell_style
    ENUM('brush','square','pen','cross','brush-square','brush-cross','pen-square','pen-cross')
    NOT NULL;

-- Step 2: backfill old values to new composites (idempotent: re-runs find no matches)
UPDATE worksheets SET cell_style = 'brush-cross' WHERE cell_style = 'brush';
UPDATE worksheets SET cell_style = 'pen-square'  WHERE cell_style = 'pen';
UPDATE worksheets SET cell_style = 'pen-square'  WHERE cell_style = 'square';
UPDATE worksheets SET cell_style = 'pen-cross'   WHERE cell_style = 'cross';