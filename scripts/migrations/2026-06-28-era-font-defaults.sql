-- Seed default era font config (2026-06-28 plan era-font-admin).
-- Idempotent: re-runs find rows already present, ON DUPLICATE KEY UPDATE is a no-op
-- when value already matches.
-- Apply on existing piyin_dev / piyin DB:
--   "E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev < this_file
--   (same for piyin when prod exists)

INSERT INTO app_config (`key`, value, updated_by) VALUES
  ('era.jiaguwen.font', 'Oracular',          NULL),
  ('era.jinwen.font',    'WangHanzongWeibei', NULL),
  ('era.xiaozhuan.font', 'QuanZiKuShuoWen',   NULL),
  ('era.lishu.font',     'WangHanzongLishu',  NULL),
  ('era.kaishu.font',    'ZCOOLXiaoWei',      NULL)
ON DUPLICATE KEY UPDATE value = VALUES(value);