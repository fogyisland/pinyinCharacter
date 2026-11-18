-- Add 'classic' to the downloads.source_type enum.
--
-- The classic (古籍) detail page gained a print button on 2026-11-18. The
-- print endpoint records the download the same way the poem and the sutra
-- endpoints do, and the source type has to carry 'classic' for the row to
-- be storable at all — the column is an ENUM, so a value outside it is
-- rejected by MySQL.
--
-- Idempotent: MODIFY COLUMN re-declares the same enum on every run, so a
-- second application is a no-op. The old values are all kept, so the
-- historical rows stay readable. No backfill — there are no classic
-- downloads to backfill from, the feature is new.

ALTER TABLE downloads
  MODIFY COLUMN source_type
    ENUM('worksheet','poem','sutra','classic','rare-char-card')
    NOT NULL;
