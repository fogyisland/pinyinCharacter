-- 语音评测记录（跟读「精评」）—— 只记元数据，不存录音。
--
-- ## 为什么要有这张表
--
-- Azure 按音频秒数计费。没有记录就没有配额：一个学生按住「精评」不放，
-- 或者有人写个循环打这个接口，账单没有上限。这张表是配额的唯一依据，
-- 也是「今天用了多少次」的唯一来源。
--
-- ## 为什么存的是分数而不是音频
--
-- 录音是学生的声音，属于个人数据。本站只需要两个数字：谁、什么时候、
-- 打了几分。音频留在 Azure 那一侧（Azure 也不为评测保留），本站不落盘。
-- 这样这张表泄露了也不含任何可识别的声音。
--
-- ## 幂等
--
-- 迁移器每次启动都全跑一遍：CREATE TABLE IF NOT EXISTS 短路。

CREATE TABLE IF NOT EXISTS speech_assessments (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  user_id          BIGINT       NOT NULL,
  -- 被评测的词。用于「这个词我练了多少次」，也用于排查「为什么某个词总是低分」。
  reference        VARCHAR(32)  NOT NULL,
  -- Azure 听到的文本。可能是别的词 —— 这正是要留下的信息。
  recognised       VARCHAR(64)  NOT NULL DEFAULT '',
  -- 0–100 的综合分。小数：Azure 的 PronScore 是 93.5 这种。
  pronunciation    DECIMAL(5,1) NOT NULL DEFAULT 0,
  accuracy         DECIMAL(5,1) NOT NULL DEFAULT 0,
  fluency          DECIMAL(5,1) NOT NULL DEFAULT 0,
  completeness     DECIMAL(5,1) NOT NULL DEFAULT 0,
  -- 什么时候。配额按这个列的自然日算。
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 配额查询的形状：按人、按日期。
  KEY idx_speech_user_day (user_id, created_at),
  CONSTRAINT fk_speech_assessment_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
