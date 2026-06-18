-- 2026-06-18: grant 'multi_worksheet_print' to all existing plans
-- Idempotent (INSERT IGNORE) so reruns are safe.
INSERT IGNORE INTO membership_plan_features (plan_id, feature_key)
SELECT id, 'multi_worksheet_print' FROM membership_plans;
