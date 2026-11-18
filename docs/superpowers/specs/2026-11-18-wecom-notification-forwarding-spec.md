# 企业微信通知转发 — 设计文档

**日期：** 2026-11-18
**状态：** 待用户审阅
**分支：** `feature/wecom-notification-forwarding`（从 `main` @ `057733edc` 起）

---

## 1. 目标

让站点的各类通知**可以被转发到企业微信群**。每个群自己决定收哪几类通知。转发是**异步**的，**失败隔一分钟重推**。Webhook URL 由管理员在后台填写，**明文存数据库**。

### 非目标（明确不做）

- **不做企业微信应用消息**（`cgi-bin/message/send`）—— 不需要 `userid` 绑定表，不需要授权流程。只做**群机器人 webhook**。
- **不做用户级推送** —— 通知推给群，群里的人自己看。不给单个用户发企业微信。
- **不做通知内容的重新设计** —— 转发内容的**标题与邮件标题完全一致**。正文用邮件的纯文本版本。
- **不改邮件发送链路本身** —— 邮件照发，转发是**旁路**。

---

## 2. 现状（已核实的事实）

### 2.1 通知只有一条通道：邮件

`lib/email.ts` 的 `sendEmail()` 是唯一的通知出口。调用点共 8 处：

| 调用点 | 类别 (`template`) | 收件人 |
|---|---|---|
| `app/api/auth/register/route.ts:122` | `welcome` | 新用户 |
| `app/api/auth/register/route.ts:157` | `email_verification` | 新用户 |
| `app/api/auth/resend-verification/route.ts:48` | `email_verification` | 新用户 |
| `app/api/auth/forgot/route.ts:86` | **（无 key）** | 请求者 |
| `app/api/notes/route.ts:125` | `notes_notification` | 管理员 |
| `lib/scheduler-tasks.ts:180` | `campaign` | 用户群（可退订） |
| `app/api/admin/email/campaigns/[id]/preview/route.ts:51` | `campaign_preview` | 管理员 |
| `app/api/admin/email/test/route.ts:21` | **（无 key）** | 管理员 |

**已存在的可复用机制：**

- `app_config` 键值表（`lib/config.ts`）+ `KEY_VALIDATORS` 白名单（`lib/config.ts:67`）
- 后台配置页范式：`app/admin/email/page.tsx` + `app/api/admin/email/config/route.ts`
- 后台审计：`lib/audit.ts` 的 `writeAudit()`
- 定时任务：`lib/scheduler.ts` 的 `setInterval`（**分钟级**，`intervalMin` 最短 1 分钟）+ `lib/scheduler-tasks.ts` 的任务注册表
- 迁移：`scripts/migrations/*.sql`（幂等，由 `scripts/migrate.ts` 按字典序执行）
- 后台导航：`components/admin/AdminSidebar.tsx`

### 2.2 「类别」的口径已存在

`email_send_history.template` 那一列就是天然的类别口径。它已经是 `VARCHAR(64) NULL`，可空。

⚠️ **`password_reset` 目前没有 template key**（`app/api/auth/forgot/route.ts:86` 没传 `template`），`email/test` 也没有。这两个要在本方案里补上 —— 否则这两类通知在按类别配置时无处归类。

---

## 3. 决策（用户已确认）

| # | 决策 | 说明 |
|---|---|---|
| 1 | **多个群** | 每个群一条记录，独立配置 |
| 2 | **每个群各自勾选通知类别** | 不是全局开关。这是「分类」的真实价值 |
| 3 | **转发内容标题与邮件标题一致** | 正文用邮件的纯文本版本 |
| 4 | **异步** | 通知产生时入队，不在请求路径上等企业微信 |
| 5 | **失败隔一分钟重推** | 与 scheduler 的每分钟 tick 同一套机制 |
| 6 | **Webhook URL 明文存数据库** | 不加密 |
| 7 | **管理员看得见 URL** | 后台明文显示 |

### 3.1 数据模型选择：一张表 + JSON 列

**`wecom_webhooks`**：

```sql
CREATE TABLE IF NOT EXISTS wecom_webhooks (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  name          VARCHAR(64)  NOT NULL,
  webhook_url   VARCHAR(512) NOT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  categories    JSON         NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_name (name),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**为什么类别存 JSON 列而不是关联表**：类别集合**跟着群走**，永远整体读写，不存在按类别反查「哪些群收了 campaign」的需求。加 JSON 列是最小实现 —— 一张表、一个后台页面、增删改都在一处。

**`wecom_deliveries`**（推送队列 + 历史）：

```sql
CREATE TABLE IF NOT EXISTS wecom_deliveries (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  webhook_id    BIGINT       NOT NULL,
  category      VARCHAR(64)  NOT NULL,
  subject       VARCHAR(512) NOT NULL,
  body          MEDIUMTEXT   NOT NULL,
  status        ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts      INT          NOT NULL DEFAULT 0,
  last_error    VARCHAR(1024) NULL,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at       DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_due (status, next_attempt_at),
  KEY idx_webhook (webhook_id, created_at DESC),
  CONSTRAINT fk_wecom_delivery_webhook FOREIGN KEY (webhook_id)
    REFERENCES wecom_webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**为什么要有这张表**：

1. **异步**（决策 4）—— 通知产生时只入队，不等企业微信。
2. **失败重推**（决策 5）—— `next_attempt_at` 就是重试时刻。
3. **幂等** —— 一条记录一个状态，`pending → sent` 只会发生一次。
4. **不阻断原流程** —— 企业微信挂了，用户的「留言」照样成功。
5. **历史** —— 后台能看到推了什么、什么时候、成功没。

---

## 4. 架构

```
通知产生点 (sendEmail 的 8 个调用点)
    │
    │ ① 邮件照发（同步，现有行为不变）
    │
    │ ② enqueueWecomNotification(category, subject, body)
    │      ├─ 读 wecom_webhooks，enabled=1 且 categories 含该类别
    │      ├─ 无匹配 → 什么都不做（不写库）
    │      └─ 有匹配 → 每个群插一条 wecom_deliveries（status='pending'）
    │
    ▼
scheduler tick（每分钟，intervalMin=1）
    │
    └─ runWecomDeliver()  [新任务 'wecom-deliver']
         ├─ SELECT ... WHERE status='pending' AND next_attempt_at <= NOW() LIMIT BATCH
         ├─ 逐条 POST 到企业微信
         │    ├─ 成功 → status='sent', sent_at=NOW()
         │    └─ 失败 → status='failed', attempts+1,
         │              next_attempt_at = NOW() + INTERVAL 1 MINUTE
         └─ 失败记录在下次 tick 再试（= 隔一分钟重推）
```

**关键设计点：**

- **②是 fire-and-forget**。入队失败（DB 挂了）**不能让原流程失败** —— catch 掉，记日志。
- **失败重推与正常推送走同一条路**。`next_attempt_at` 初始值 = 入队时刻（立即可推），失败后 = 现在 + 1 分钟。**一套代码，不两套。**
- **失败不是终态**。`failed` 的记录 `next_attempt_at` 到期后重新变回可推。理论上会无限重推 —— 这是决策 5 的直接后果（"隔一分钟推"），但需要一个上限来防止永久失败的记录永远占着队列。

### 4.1 重试上限

**`attempts >= 20`（约 20 分钟）后停止重推，保持 `status='failed'`**，不再自动重试。

理由：企业微信的 45009（限流，每机器人 20 条/分钟）和网络故障通常几分钟内自愈。20 次 ≈ 20 分钟足够了。再往后重推只是浪费资源并把失败记录永久留在队头。**超限的记录在后台可见** —— 管理员能手动重置它（`next_attempt_at` 置回当前时刻，`attempts` 归零）。

> ⚠️ 这个上限是**我加的**，你只说了「隔一分钟推」。无限重推的代价是队列被永久失败的记录占住。如果你希望真的无限重推，告诉我，我把这个上限去掉。

---

## 5. 通知类别清单

**类别 = `email_send_history.template` 的取值**（决策：沿用已有口径，不新造概念）。

| 类别 | 中文名 | 说明 |
|---|---|---|
| `welcome` | 注册欢迎 | 新用户注册 |
| `email_verification` | 邮箱验证 | 注册验证 + 重发验证 |
| `password_reset` | 密码重置 | 忘记密码 —— **本次要补 template key** |
| `notes_notification` | 用户留言 | 用户留言给管理员 |
| `campaign` | 营销群发 | 定时群发 |
| `campaign_preview` | 营销预览 | 后台预览 |
| `email_test` | 邮件测试 | 后台发测试邮件 —— **本次要补 template key** |
| `admin_alert` | 管理告警 | 预留（本次无产生点） |

**类别是白名单**（不是自由文本）。后台只列这 8 个，勾选框。

**「邮件测试」和「密码重置」这两类要不要转发？** 默认**都勾上**（`notes_notification` 和 `campaign` 默认**不勾** —— 营销群发转进群会很吵，而且往往涉及用户隐私）。但默认勾选只是首次创建时的初值，管理员随时能改。

---

## 6. 企业微信 API 调用

**端点**：`POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<KEY>`

**请求体**（markdown 类型）：

```json
{ "msgtype": "markdown", "markdown": { "content": "..." } }
```

**标题一致（决策 3）的实现**：

- 邮件标题 = `msg.subject`
- 企业微信消息的第一行 = **同一个 `msg.subject`**
- 之后是邮件的纯文本正文 `msg.text`

**为什么用 markdown 而不是 text**：markdown 支持 `**加粗**`、`>` 引用、链接，标题能突出。纯 text 会把换行挤成一坨。

**为什么用 `msg.text` 而不是 `msg.html`**：邮件的 `html` 是 HTML，markdown 不认，标签会原样显示成乱码。`msg.text` 是纯文本，直接嵌进 markdown 安全。

⚠️ **`msg.text` 可能是 undefined** —— `sendEmail()` 的 `EmailMessage.text` 是必填，但 `campaign` 的 `campaignEmail()` 一定会给。我会在入队时做 `text ?? ''` 兜底，并把 `subject` 截断到 512（表列宽）。

**响应**：

```json
{ "errcode": 0, "errmsg": "ok" }
```

`errcode != 0` ⇒ 失败。常见：
- `93000` invalid webhook key ⇒ **配置错了，重试无用**
- `45009` 接口调用超过限制 ⇒ 限流，**重试有用**
- `40001` access_token 失效（群机器人一般不涉及）

**区分「重试有用」和「重试无用」**：决策 5 说「失败隔一分钟重推」，那就**一律重推**，包括配置错的情况 —— 但上限 20 次后停。这样管理员有 20 分钟时间改配置。配置改对后，下一个 tick 就能推成功。**这比「立刻放弃」更符合「失败隔一分钟推」的字面意思。**

**超时**：`fetch` 用 `AbortSignal.timeout(10_000)` —— 10 秒不响应就当失败。不能无限等，否则 scheduler tick 会被一个挂死的请求拖住。

**依赖**：**零新依赖**。用 Node 18+ 原生 `fetch`（项目已有 Node 20+ 要求）。

---

## 7. 后台界面

**新页面**：`app/admin/wecom/page.tsx`，侧边栏入口「企业微信」。

**两个区块**：

1. **群列表** —— 每个群一行：名称、webhook URL（**明文显示**，决策 6/7）、启用开关、勾选的类别。
2. **推送历史** —— 最近 N 条：时间、群、类别、标题、状态（待推/成功/失败）、尝试次数、错误。

**新 API**（全部 `requireAdmin()` + `writeAudit()`）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/admin/wecom/webhooks` | GET / POST / PUT / DELETE | 群的增删改查 |
| `/api/admin/wecom/deliveries` | GET | 推送历史（分页） |
| `/api/admin/wecom/test` | POST | 往指定群发一条测试消息 |
| `/api/admin/wecom/retry` | POST | 重置一条失败记录，让它立刻重推 |

---

## 8. 接入点（8 个通知产生点）

每个产生点加**一行**调用：

```ts
enqueueWecomNotification('notes_notification', msg.subject, msg.text).catch(() => {});
```

**但 `sendEmail()` 是所有 8 处的公共出口** —— 所以**更好的做法是在 `sendEmail()` 内部接入**，一次改动覆盖全部 8 处，且**将来新增的邮件通知自动被覆盖**。

⚠️ **但 `sendEmail()` 没有 `template` 必填**（`template?: string`）。`password_reset` 和 `email_test` 没传。所以：

- `sendEmail()` 内部接入时，**`template` 为空就不入队**（无法归类）。
- 同时**补上** `password_reset` 和 `email_test` 两个 template key，让这两类也能被转发。

**`sendEmail()` 内部接入的另一个问题**：`sendEmail()` 内部有 `console` transport 模式（开发环境）。**console 模式下要不要入队？** 我的选择：**要** —— console 模式只是不真发邮件，转发是独立通道。但这意味着开发环境也会往真群里推。⚠️ **这是个风险点**。我的建议：**console 模式不入队**（开发环境不该打扰真人群），并且**默认 `enabled=0`** —— 管理员必须手动启用。

### 8.1 我的推荐实现

**在 `sendEmail()` 内部接入**，理由：

1. 一次改动覆盖 8 处，将来新增的邮件通知自动覆盖。
2. `sendEmail()` 已经是「发通知」这个语义的唯一入口 —— 转发挂在它上面，语义正确。
3. 不会漏 —— 8 个调用点里只要有一个漏了加调用，那类通知就静默不转发。

**配套的两个决定**：

- `template` 为空 ⇒ 不入队（无法归类）。补齐 `password_reset` / `email_test` 两个 key。
- **`console` transport 不入队** —— 开发环境不打扰真人群。

---

## 9. 失败与可观测性

**每一个失败都要留下痕迹**（项目规范：拒绝静默失败）：

| 位置 | 记录什么 |
|---|---|
| `wecom_deliveries.last_error` | 推送失败的原因（企业微信的 `errmsg` 或网络错误） |
| `wecom_deliveries.attempts` | 试了几次 |
| `wecom_deliveries.status` | `pending` / `sent` / `failed` |
| `audit_log` | 群的增删改（`wecom_webhook_created` / `_updated` / `_deleted`）、测试推送、手动重试 |
| `console.warn` / `console.error` | 入队失败、推送失败 |

**入队失败**（DB 挂了）**不阻断原流程** —— 邮件照发，记日志。因为「企业微信转发」是**增强**，不是通知本身的一部分。

**推送失败不阻断** —— 它是 scheduler 里的独立任务，失败只影响那一条记录。

---

## 10. 安全考量

| 顾虑 | 处置 |
|---|---|
| webhook URL = 群的钥匙（拿到就能往群里发消息） | 决策 6/7：明文存、明文显示。**这是你明确要的**。记录在此以备将来收紧。 |
| URL 会不会进日志 / 进 git | URL 只在 `wecom_webhooks` 表里，**不进 `app_config`**（不是配置文件，不会被误提交）；不进审计日志的 metadata（审计只记群名和类别） |
| SSRF | webhook URL 由管理员填（已是管理员权限）。**但仍要校验**：`https://` 开头、host 必须是 `qyapi.weixin.qq.com`（防止管理员手滑填内网地址把服务器变成跳板）。这是一个真实的加固点。 |
| 消息里的敏感信息 | 转发内容 = 邮件正文。`password_reset` 类邮件含重置链接 —— 转进群意味着**群成员能看到重置链接**。⚠️ **这是一个真实的安全后果**。建议：`password_reset` 默认**不勾选**。 |
| 队列积压 | `BATCH` 上限（每次 tick 50 条），`pending` 记录一直可查 |

⚠️ **`password_reset` 转发 = 重置链接进群** —— 我把它默认设为**不勾选**。你要转发就手动勾。

---

## 11. 实施计划（概要）

实施时用 superpowers 的流程：写实施计划 → 你审 → TDD 逐任务执行 → 全分支评审 → 收尾。

| 任务 | 内容 | 主要文件 |
|---|---|---|
| 1 | 迁移：两张表 | `scripts/migrations/2026-11-18-wecom-notifications.sql` |
| 2 | `lib/wecom-types.ts`：类别白名单 + 类型 | 新 |
| 3 | `lib/wecom-webhooks.ts`：群的 CRUD + 类别匹配 | 新 |
| 4 | `lib/wecom-deliver.ts`：入队 + 推送 + 重试 | 新 |
| 5 | 接进 `lib/email.ts` 的 `sendEmail()` | `lib/email.ts` |
| 6 | 补 `password_reset` / `email_test` 的 template key | 2 个路由 |
| 7 | scheduler 新任务 `wecom-deliver` | `lib/scheduler-tasks.ts` + `lib/scheduler-config.ts` + `lib/scheduler.ts` |
| 8 | 后台 API 路由 | `app/api/admin/wecom/*` |
| 9 | 后台页面 + 侧边栏 | `app/admin/wecom/page.tsx` + `components/admin/` + `AdminSidebar.tsx` |
| 10 | 补齐缺失的 template key / 端到端验证 | — |

**每个任务走 TDD**：先写会红的测试，看它红，再实现，再跑全套。

---

## 12. 需要你确认的三点

写实施计划前，有三个我做的判断想跟你对一下（你回「没问题」我就按这个写计划）：

1. **`password_reset` 默认不勾选** —— 转进群等于把重置链接给群成员看。
2. **重试上限 20 次（约 20 分钟）** —— 超过就停，后台可见并可手动重置。真的无限重推也行，但我建议有个上限。
3. **`console` transport（开发环境）不入队** —— 开发时不该往真群里推；且新建的群默认 `enabled=0`，要管理员手动启用。
