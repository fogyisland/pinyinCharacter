-- 班级与作业（班级/作业管理，第一期）。
--
-- 三张表，回答三个问题：
--   classes          这个班叫什么、谁在教、学生怎么进来
--   class_members    谁在这个班里
--   class_assignments 这个班派了什么作业、截止到哪天
--
-- ## 为什么成员表直接存 user_id，不存「学生档案」
--
-- 站内已经有账号体系（users）。一个「学生」就是登了站的人；课堂场景里
-- 学生注册一次就能同时用字帖、听写、复习和班级作业。再造一套学生档案
-- 会让同一份学习记录分裂成两份。
--
-- ## 为什么班级只有一个老师
--
-- 孔子学院的课通常是一位老师带一个班。多个老师会带来「谁能改谁的
-- 作业、谁能移出成员」的权限矩阵，第一期不做。需要时把
-- classes.teacher_id 换成一张 class_teachers 表即可，成员表不用动。
--
-- ## 为什么作业的内容是一个 JSON 列
--
-- 作业有两种形状（字帖：一串字；听写：一串「词 + 拼音」），未来还可能有
-- 第三种。用一个 JSON 列承载，新形状不加列、不迁移；代价是数据库不校验
-- 内容，所以 lib/classes.ts 的 parseAssignmentPayload() 把每一种形状
-- 都验到底，未知形状一律当「没有内容」。
--
-- ## 邀请码
--
-- 学生用六位邀请码加入班级，不需要老师逐个拉人。邀请码是班级的准入
-- 凭证：可预测的码等于可枚举的班级，所以生成用 crypto.getRandomValues
-- （见 lib/classes.ts）。码的大小写由生成器保证全大写，查询时统一转大写。
--
-- ## 幂等
--
-- 迁移器每次启动都会把 scripts/migrations/ 全部跑一遍，所以每个语句
-- 都必须可重入：CREATE TABLE IF NOT EXISTS 短路，索引写在 CREATE 里。

CREATE TABLE IF NOT EXISTS classes (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  teacher_id  BIGINT        NOT NULL,
  name        VARCHAR(64)   NOT NULL,
  join_code   VARCHAR(8)    NOT NULL,
  note        VARCHAR(512)  NOT NULL DEFAULT '',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_classes_join_code (join_code),
  KEY idx_classes_teacher (teacher_id, created_at DESC),
  CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS class_members (
  id         BIGINT   NOT NULL AUTO_INCREMENT,
  class_id   BIGINT   NOT NULL,
  user_id    BIGINT   NOT NULL,
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 同一个人不能在一个班里出现两次。
  UNIQUE KEY uk_members_class_user (class_id, user_id),
  KEY idx_members_user (user_id, joined_at DESC),
  CONSTRAINT fk_members_class FOREIGN KEY (class_id)
    REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS class_assignments (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  class_id    BIGINT        NOT NULL,
  title       VARCHAR(64)   NOT NULL,
  kind        ENUM('worksheet','dictation') NOT NULL,
  -- 作业内容。形状由 kind 决定，校验在 lib/classes.ts。
  payload     JSON          NOT NULL,
  -- 截止日期（YYYY-MM-DD）。NULL = 没有截止，随时可交。
  due_at      DATE          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_assignments_class (class_id, created_at DESC),
  KEY idx_assignments_due (class_id, due_at),
  CONSTRAINT fk_assignments_class FOREIGN KEY (class_id)
    REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
