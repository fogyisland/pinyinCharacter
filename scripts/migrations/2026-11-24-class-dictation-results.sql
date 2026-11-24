-- 班级听写作业的成绩回写（班级/作业闭环）。
--
-- ## 为什么单独一张表
--
-- class_submissions 记录的是「我练完了」这个布尔状态，它刻意不自动判定
-- 对错（见 2026-11-22-class-submissions.sql 的注释）。但听写在浏览器里
-- 跑完以后，学生其实知道自己对了几条；如果不记录，老师在班级页只能看到
-- 一个勾，看不到学习效果。
--
-- 这张表保存学生**主动提交**的听写成绩：总条数、答对条数、错词列表。
-- 它不把「打印」或「打开听写页」当成完成，也不改 class_submissions 的
-- 完成口径 —— 两个信号各自独立，老师可以同时看到「是否自报完成」和
-- 「自报成绩」。
--
-- ## 幂等
--
-- 迁移器每次启动全跑一遍，CREATE TABLE IF NOT EXISTS 必须可重入。

CREATE TABLE IF NOT EXISTS class_dictation_results (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT       NOT NULL,
  user_id       BIGINT       NOT NULL,
  total         INT          NOT NULL,
  correct       INT          NOT NULL,
  -- 错词数组（JSON 字符串）；正确时为空数组。
  wrong_words   JSON         NOT NULL,
  submitted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 一个人对一份作业只保留一份最新成绩：重复提交是更新。
  UNIQUE KEY uk_dictation_result_assignment_user (assignment_id, user_id),
  KEY idx_dictation_result_assignment (assignment_id, submitted_at DESC),
  CONSTRAINT fk_dictation_result_assignment FOREIGN KEY (assignment_id)
    REFERENCES class_assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_dictation_result_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
