-- 班级作业的「学生完成状态」（班级/作业单体系统，第二期）。
--
-- ## 为什么单独一张表，而不是在 class_assignments 上加一列
--
-- 一份作业派给一个班，N 个学生各自有完成状态。加一列只能记录「这个班
-- 有人做完了」，记不下「谁做完了」。所以是 assignment × user 的交叉表。
--
-- ## 「完成」的口径
--
-- 学生**手动勾选**「我练完了」才算完成。打印记录（是否存在）作为佐证
-- 显示在老师视图里，但**不**自动把作业标成完成 —— 打印一张纸不等于练了。
--
-- 这是刻意的取舍：自动化判定会让老师误以为学生练过，而误判在课堂上的
-- 代价（家长与院方看到的报告）比「学生忘了勾」大得多。
--
-- ## 为什么允许 note
--
-- 学生可以留一句话（「第三行没看懂」）。老师看到的是完成状态 + 留言，
-- 而不是一个只有对勾的表格。
--
-- ## 幂等
--
-- 迁移器每次启动都会全跑一遍：CREATE TABLE IF NOT EXISTS 短路。

CREATE TABLE IF NOT EXISTS class_submissions (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT       NOT NULL,
  user_id       BIGINT       NOT NULL,
  note          VARCHAR(512) NOT NULL DEFAULT '',
  completed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 一个人对一份作业只有一条完成记录：重复提交是「更新留言」，不是新增。
  UNIQUE KEY uk_submissions_assignment_user (assignment_id, user_id),
  KEY idx_submissions_user (user_id, completed_at DESC),
  CONSTRAINT fk_submissions_assignment FOREIGN KEY (assignment_id)
    REFERENCES class_assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_submissions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
