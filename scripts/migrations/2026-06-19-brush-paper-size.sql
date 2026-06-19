-- 2026-06-19: add 'brush-12', 'brush-24', 'brush-28' to worksheets.paper_size enum
-- Idempotent: same column type, just wider. No data loss.
ALTER TABLE worksheets
  MODIFY paper_size ENUM('A3','A4','B5','brush-12','brush-24','brush-28') NOT NULL;
