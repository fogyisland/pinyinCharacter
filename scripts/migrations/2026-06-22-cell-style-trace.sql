-- G5+ : Add trace variants for brush worksheets (描红 mode)
-- Idempotent: re-runs find ENUM already widened, MODIFY COLUMN is a no-op.
-- No backfill needed — existing rows use non-trace variants by default.

ALTER TABLE worksheets
  MODIFY COLUMN cell_style
    ENUM(
      'brush','square','pen','cross',
      'brush-square','brush-cross','pen-square','pen-cross',
      'brush-trace-square','brush-trace-cross'
    )
    NOT NULL;