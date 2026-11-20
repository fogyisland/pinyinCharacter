# 微信公众号模板消息公告 — 设计文档

**日期：** 2026-11-20
**状态：** 待用户审阅
**分支：** `feature/wechat-template-broadcast`（从 `main` @ `ae0563394` 起）

---

## 1. 目标

把站点公告推送到**微信公众号的关注者**手里 —— 版本更新、功能上线、活动通知。

用**服务号模板消息**（`message/template/send`）逐个 openid 发送。

### 非目标（明确不做）

- **不做图文消息（`mpnews`）** —— 图文要 `media/uploadnews` + 永久素材库 + 封面图管理。模板消息本身更省事。
- **不做 `mass/send` 群发** —— 群发每用户每月 4 条配额，且 `touser` 最少 2 个 openid。模板消息无此限制。
- **不做小程序订阅消息** —— 那是小程序侧的能力，公众号用不了。
- **不做 OAuth 网页授权** —— ⚠️ 见 §3.2，推送名单直接从微信拉，**不需要**。
- **不与 `users` 表绑定** —— 收件人是关注者，不是站内注册用户。
- **不改邮件发送链路** —— 邮件群发照旧，这是并行的第三条通道。

---

## 2. 现状（已核实的事实）

### 2.1 代码库零微信公众平台设施

全仓库 grep `openid` / `wx_` / `appid` / `secret`（排除 wecom 与 qyapi）**零命中**：

- `users` 表**没有** `openid` / `unionid` / `wechat_*` 任何列（`scripts/init-db.ts:76`）
- **没有** OAuth 回调路由
- **没有** `appid` / `secret` 配置键
- **没有**任何微信接口调用

这是**全新**功能，不是扩展。

### 2.2 现有的通知/群发通道

| 通道 | 实现 | 收件人 | 频次限制 |
|---|---|---|---|
| 邮件（单发） | `lib/email.ts` `sendEmail()` | 一个邮箱 | 无 |
| 邮件（群发） | `email_campaigns` + `email_campaign_recipients` + scheduler `email-campaign-send` | 站点用户（按 `audience`） | 无硬限制 |
| 企业微信群机器人 | `wecom_webhooks` + `wecom_deliveries` + scheduler `wecom-deliver` | 一个群 | 无硬限制 |

**可复用的机制：**

- `app_config` 键值表（`lib/config.ts`）+ `KEY_VALIDATORS` 白名单（`lib/config.ts:67`）
- 后台配置页范式：`app/admin/email/page.tsx` + `app/api/admin/email/config/route.ts`
- 后台群发范式：`app/admin/email/campaigns/` + `components/admin/CampaignForm.tsx`
- 队列 + scheduler 模式：`lib/scheduler-tasks.ts`（`TaskName` 联合类型 + `runTask()` 分发）
- 审计：`lib/audit.ts` 的 `writeAudit()`
- 迁移：`scripts/migrations/*.sql`（幂等，由 `scripts/migrate.ts` 按字典序执行）
- 后台导航：`components/admin/AdminSidebar.tsx`

---

## 3. 微信平台的硬约束（已核实，决定架构）

### 3.1 模板消息接口

```
POST https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=ACCESS_TOKEN
```

```json
{
  "touser": "OPENID",
  "template_id": "TM00001",
  "url": "https://站点/路径",
  "data": {
    "first":  { "value": "字·韵版本公告" },
    "keyword1": { "value": "v1.2 已上线" },
    "keyword2": { "value": "2026-11-20" },
    "remark": { "value": "点击查看详情" }
  }
}
```

| 约束 | 值 | 影响 |
|---|---|---|
| **权限** | **认证服务号** | 订阅号无模板消息权限（`48001`） |
| **`touser`** | **单个 openid** | 推给 N 个人 = **N 次 API 调用** |
| **模板 ID** | 必须在公众号后台「模板库」里申请 | `template_id` 是**外部输入**，不能写死在代码里 |
| **`data` 的 key** | 必须**严格等于**模板里的 `keyword1/2/3`、`first`、`remark` | key 不匹配 ⇒ `47003` |
| **每日接口调用限额** | 约 2000 次/天（各账号不同，**以后台「接口权限」页为准**） | 关注者多时会撞 `45009` |
| **`errcode: 0`** | ⚠️ **只代表平台接受并投递**，**不代表用户收到** | UI 上不能写"已送达" |
| **参数错误不可重试** | `40003`（openid 非法）、`40037`（模板 ID 错）、`47003`（data key 不匹配） | 重试无意义，应停手并报错 |
| **`43101`** | 用户取关 / 关闭消息 / 免打扰 | **不可重试**，标记该 openid 后跳过 |
| **`40001`** | access_token 失效 | 可重试：刷新 token 后再发 |
| **`45009`** | 接口调用超限 | **必须停手**，等下一个周期，不能继续打 |
| **`40164`** | 服务器 IP 不在白名单 | 微信侧配置，代码代劳不了 |
| **`48001`** | 接口未授权 | 公众号后台没开模板消息权限 |

### 3.2 关注者名单从哪来 —— ⚠️ 修正了我上一版 spec 的错误结论

**我上一版 spec 写「微信公众平台没有已关注用户列表接口」—— 这是错的。** 核实后：

```
GET https://api.weixin.qq.com/cgi-bin/user/get?access_token=ACCESS_TOKEN
```

| 项 | 值 |
|---|---|
| 返回 | `total`（总数）、`count`（本次条数）、`data.openid[]`、`next_openid`（游标） |
| 单次上限 | 10000 个 openid |
| 分页 | 把上次的 `next_openid` 作为下次的 `next_openid` 参数继续请求，直到 `next_openid` 为空 |
| 限制 | 每日 500 次调用（拉列表） |
| 返回内容 | **只有 openid**，没有昵称/头像 |

**这大幅简化了设计：**

- ❌ 不需要 OAuth 网页授权回调
- ❌ 不需要 `wechat_followers` 表（微信是名单的唯一事实来源）
- ❌ 不需要「关注者至少 2 人」的限制（`template/send` 是单 openid，1 人也能发）
- ❌ 不需要「配服务器事件回调」来收集 openid

### 3.3 access_token

- 有效期 **7200 秒**
- ⚠️ **重复获取会让上一次的 token 立刻失效** —— 多进程并发刷新会互相踢掉
- 获取：`GET /cgi-bin/token?grant_type=client_credential&appid=&secret=`
- **服务器 IP 必须加进白名单**，否则 `40164`
- 每日获取上限 2000 次（12 次/天足够）

---

## 4. 决策（我做的判断，你来推翻）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **模板消息，不用群发** | 你已定。模板消息无「每月 4 条」配额，`touser` 单 openid 也避开了「最少 2 个」的限制 |
| 2 | **收件人 = 全部关注者，逐个发** | 你已定。代价是 N 次 API 调用，撞每日限额的风险 |
| 3 | **名单每次从 `user/get` 现拉，不落库** | 微信是唯一事实来源。落库就要处理取关同步（而取关我们收不到事件），反而更容易不一致 |
| 4 | **模板 ID 由管理员在后台填** | `template_id` 是外部输入，代码里写死等于把站点绑死在某一个公众号上 |
| 5 | **模板的 `data` key 也在后台填** | 因为模板的字段名是管理员在微信后台选的（`keyword1` 还是 `thing1`？），代码猜不出来 |
| 6 | **纯文本公告** | 模板消息本身就是模板结构（first/keyword/remark），天然是纯文本 |
| 7 | **access_token 缓存在 `app_config`，进程内再缓存 30 分钟** | 跨进程共享 + 避免每次打微信接口 |
| 8 | **发送失败按错误码分类处理** | 参数类错误停手，人效类错误（取关）跳过，token 错误刷新重试，超限停手 |
| 9 | **公告自己一张表** | 与 `email_campaigns` 平行，不塞进去 |

---

## 5. 数据模型

### 5.1 `wechat_broadcasts` —— 公告

```sql
CREATE TABLE IF NOT EXISTS wechat_broadcasts (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  title           VARCHAR(128) NOT NULL,
  template_id     VARCHAR(64)  NOT NULL,
  url             VARCHAR(512) NULL,
  data            JSON         NOT NULL,
  status          ENUM('draft','queued','sending','sent','failed','cancelled')
                               NOT NULL DEFAULT 'draft',
  total_recipients INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_count  INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count   INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count    INT UNSIGNED NOT NULL DEFAULT 0,
  last_error      VARCHAR(1024) NULL,
  created_by      BIGINT       NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at     DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_status (status, created_at DESC),
  KEY idx_created_by (created_by, created_at DESC),
  CONSTRAINT fk_wb_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**`accepted_count` 的含义是「微信平台接受了多少条」**，**不是**「多少人收到了」。`errcode: 0` 只代表平台接受并投递。这是微信接口的固有限制，UI 上必须写清楚。

### 5.2 为什么没有 per-recipient 表

模板消息**逐个发送**，理论上可以记每个人的结果。但：

1. 这张表会随关注者数量线性膨胀（每次群发 N 行）
2. 微信**不给逐人的送达回执** —— 记下来的也只是"平台接受了"，信息量极低
3. 名单每次现拉（决策 3），**没有稳定的 openid 主键可关联**

所以只记汇总计数 + 最后一个错误。**要看详情就再发一次测试**，别建日志表。

### 5.3 配置键（`app_config`）

| 键 | 说明 | 校验 |
|---|---|---|
| `wechat.enabled` | `true`/`false` | 布尔 |
| `wechat.app_id` | 公众号 AppID | `^wx[0-9a-f]{16}$` |
| `wechat.app_secret` | 公众号 AppSecret | 长度 ≤ 256 |
| `wechat.access_token` | 缓存的 token | 内部写，不在 UI 显示 |

> ⚠️ **`app_secret` 明文存 `app_config`** —— 与 `smtp.pass` 现有处理一致（后台不回显，空值 = 保持不变）。AppSecret 是服务号的核心凭据，比企微 webhook URL 更敏感。**记录在此以备将来收紧。**

---

## 6. 架构

```
管理员在 /admin/wechat 写公告
    │
    ▼
POST /api/admin/wechat/broadcasts  { title, templateId, url, data }
    │
    ├─ 校验：wechat.enabled / app_id / app_secret 已配置
    ├─ 插一行 wechat_broadcasts (status='queued')
    └─ 返回 broadcastId

scheduler tick（每分钟）
    │
    ▼
runWechatBroadcastSend()  [新任务 'wechat-broadcast-send']
    │
    ├─ SELECT ... WHERE status='queued' LIMIT 5
    ├─ 取 access_token（缓存过期就刷新，进程内 Promise 去重防并发刷新）
    │
    ├─ 拉名单：GET /cgi-bin/user/get（跟 next_openid 分页）
    │    └─ openid[] → total_recipients = len
    │
    └─ 逐个 openid 发送（串行，限速）：
         POST /cgi-bin/message/template/send
           ├─ errcode=0        → accepted_count++
           ├─ errcode=40001    → 刷新 token，重试一次（再失败则停手）
           ├─ errcode=43101    → skipped_count++（取关/免打扰，不重试）
           ├─ errcode=40003/40037/47003/48001
           │                    → 参数类错误，**停手**（重试无意义）
           ├─ errcode=45009    → 撞限额，**停手**，等下一个 tick
           └─ 网络异常         → 停手
```

**关键设计点：**

- **与邮件群发完全平行** —— 各自一张表、各自一个 scheduler 任务。
- **串行发送 + 限速** —— 微信对单账号的接口调用有频率限制。**不能并发轰**。
- **错误码分类决定行为**（决策 8）—— 参数错误停手，人效错误跳过，token 错误重试，超限停手。**这是整个设计里最容易写错的地方。**
- **一个 tick 只发一条公告** —— 发不完下次 tick 接着发（`status` 保持 `sending`）。

---

## 7. 后台界面

**新页面**：`app/admin/wechat/page.tsx`，侧边栏入口「微信公众号」。

**三个区块：**

1. **配置区** —— 是否启用、AppID、AppSecret（密码框，空值 = 保持）、**「测试发送」按钮**（给自己发一条，验证配置和 IP 白名单）
2. **公告列表** —— 每条：标题、模板 ID、状态、收件人数、平台接受数、跳过数、失败数、创建时间
3. **写公告** —— 标题、模板 ID、跳转 URL、**模板数据字段（动态 key=value 列表）**

**新 API**（全部 `requireAdmin()` + `writeAudit()`）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/admin/wechat/config` | GET / PUT | 读写配置 |
| `/api/admin/wechat/followers` | GET | 拉取关注者数量（调 `user/get`） |
| `/api/admin/wechat/broadcasts` | GET / POST | 公告列表 / 新建并入队 |
| `/api/admin/wechat/broadcasts/[id]` | GET | 公告详情 + 状态 |
| `/api/admin/wechat/broadcasts/[id]/send` | POST | 手动触发发送 |
| `/api/admin/wechat/broadcasts/[id]/cancel` | POST | 取消 |
| `/api/admin/wechat/test` | POST | 给自己发一条测试消息 |

---

## 8. 失败与可观测性

| 位置 | 记录什么 |
|---|---|
| `wechat_broadcasts.last_error` | 微信的 `errmsg` 或网络错误 |
| `wechat_broadcasts.status` | `draft` / `queued` / `sending` / `sent` / `failed` / `cancelled` |
| `audit_log` | 配置修改、公告创建、发送、取消、测试 |
| `console.warn` / `console.error` | token 刷新失败、发送失败、限额停手 |

**参数类错误不自动重试** —— 重试只是浪费配额，且同样的参数必然同样失败。

**限额（45009）停手，管理员手动重发** —— 撞限额说明今天的量用完了。

---

## 9. 安全考量

| 顾虑 | 处置 |
|---|---|
| `app_secret` 明文存库 | ⚠️ 与 `smtp.pass` 同款。UI 不回显 |
| 服务器 IP 白名单 | **微信侧配置**。后台要提示管理员（否则 `40164`，100% 失败） |
| `template_id` 注入 | 后台只填**字符串**，不拼进任何 SQL；发微信接口时作为 JSON 字段 |
| `data` 的 key | 由管理员填，**必须与模板定义严格一致**，否则 `47003`。UI 上要写清这一点 |
| `url` 跳转 | 必须是站内路径或 `site.url` 同源域名，防开放重定向 |
| 公告内容 | 纯文本，不渲染 HTML |
| 群发骚扰 | 一次公告 = 每个关注者一条。**每月不要超过 1~2 条**，这是内容纪律不是技术限制 |

---

## 10. 实施计划（概要）

| 任务 | 内容 | 主要文件 |
|---|---|---|
| 1 | 迁移：公告表 | `scripts/migrations/2026-11-20-wechat-broadcast.sql` |
| 2 | `lib/wechat-types.ts`：类型 + 配置键校验 + 错误码分类 | 新 |
| 3 | `lib/wechat-api.ts`：token 获取/缓存 + `user/get` 分页 + `template/send` 封装 | 新 |
| 4 | `lib/wechat-broadcasts.ts`：公告 CRUD + 入队 | 新 |
| 5 | scheduler 新任务 `wechat-broadcast-send` | `lib/scheduler-tasks.ts` + `lib/scheduler-config.ts` + `lib/scheduler.ts` |
| 6 | 后台 API 路由 | `app/api/admin/wechat/*` |
| 7 | 后台页面 + 侧边栏 | `app/admin/wechat/page.tsx` + `components/admin/` + `AdminSidebar.tsx` |
| 8 | 端到端验证（真机 + 真实关注者） | — |

**每个任务走 TDD**：先写会红的测试，看它红，再实现，再跑全套。

---

## 11. 需要你确认的四点

写实施计划前，有四个我做的判断想跟你对一下（你回「没问题」我就写计划）：

1. **名单每次从微信现拉，不落库** —— 微信是唯一事实来源；落库要处理取关同步，反而更容易不一致。
2. **模板 ID 和模板数据字段都由后台填** —— 模板字段名（`keyword1` 还是 `thing1`？）是管理员在微信后台选的，代码猜不出来。
3. **参数类错误（40003/40037/47003）停手不重试** —— 重试只是浪费配额。
4. **`app_secret` 明文存 `app_config`，后台不回显** —— 与现有 `smtp.pass` 处理一致。

**另外三件必须提前知道的事：**

- ⚠️ **模板 ID 必须在公众号后台「模板库」申请**（1~3 个工作日审核）。后台「模板库」里能看到已申请的模板和它的字段结构。
- ⚠️ **服务器 IP 必须加进公众号后台白名单**，否则所有调用返回 `40164`。
- ⚠️ **每日接口调用限额约 2000 次** —— 关注者数量 × 公告次数不能超。**后台要显示今日已用次数**，让管理员有概念。
