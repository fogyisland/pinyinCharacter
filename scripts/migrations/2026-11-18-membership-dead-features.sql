-- Remove the three membership features that nothing enforces.
--
-- 'unlimited_history', 'download_pdf' and 'priority_tts' were seeded onto
-- every plan and shown to buyers as Chinese labels ("无限历史记录",
-- "PDF 下载", "优先 TTS"), but no code path ever checked them with
-- `hasFeature()`:
--
--   - the history list is capped at 200 rows for every user alike
--   - the practice PDF download is open to anonymous visitors
--   - the TTS pipeline has no priority branch at all
--
-- So a paying customer received exactly what a non-member received, while
-- the checkout page promised three perks. The features were removed from
-- the code on 2026-11-18; this migration removes the rows that would
-- still have granted them.
--
-- Idempotent: the DELETE matches zero rows on a re-run. No schema change
-- — `feature_key` is VARCHAR(32), not an ENUM, so nothing needs widening
-- or narrowing.

DELETE FROM membership_plan_features
 WHERE feature_key IN ('unlimited_history', 'download_pdf', 'priority_tts');
