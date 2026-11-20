# 微信公众号群发公告 — 设计文档

**日期：** 2026-11-20
**状态：** 待用户审阅
**分支：** `feature/wechat-official-account-broadcast`（从 `main` @ `d0df40264` 起）

---

## 1. 目标

让站点能把**公告**推送到**微信公众号的关注者**手里 —— 版本更新、活动通知、新功能上线。

**这不是**"给每个用户发通知"。收件人是**关注了公众号的人**，不是站点的注册用户。管理员在后台写一篇公告，勾选关注者群，发送。

### 非目标（明确不做）

- **不做逐用户定向推送** —— 不做 `openid` ↔ `users.id` 绑定表，不做 OAuth 登录。那是另一套东西（收件人是每个用户自己）。
- **不做关注者全量列表拉取** —— 微信公众平台**没有**这个接口（见 §3.2）。
- **不做服务号模板消息 / 客服消息** —— 那是逐用户通知，不是公告。
- **不做图片素材库管理 UI** —— 公告只用**纯文本**消息（`msgtype=text`），不需要上传图文素材。
- **不改邮件发送链路** —— 邮件群发照旧，公众号群发是**并行的第二条通道**。

---

## 2. 现状（已核实的事实）

### 2.1 代码库零微信公众平台设施

全仓库 grep `openid` / `wx_` / `appid` / `secret`（排除 wecom 与 qyapi）**零命中**：

- `users` 表**没有** `openid` / `unionid` / `wechat_*` 任何列（`scripts/init-db.ts:76`）
- **没有** OAuth 回调路由
- **没有** `appid` / `secret` 配置键
- **没有** `media/uploadnews` 或 `mass/send` 调用

这是**全新**功能，不是扩展。

### 2.2 现有的通知/群发通道

| 通道 | 实现 | 收件人 | 频次限制 |
|---|---|---|---|
| 邮件（单发） | `lib/email.ts` `sendEmail()` | 一个邮箱 | 无 |
| 邮件（群发） | `email_campaigns` + `email_campaign_recipients` + scheduler `email-campaign-send` | 站点用户（按 `audience`） | 无硬限制 |
| 企业微信群机器人 | `wecom_webhooks` + `wecom_deliveries` + scheduler `wecom-deliver` | 一个群 | 无硬限制 |

**已有的可复用机制：**

- `app_config` 键值表（`lib/config.ts`）+ `KEY_VALIDATORS` 白名单（`lib/config.ts:67`）
- 后台配置页范式：`app/admin/email/page.tsx` + `app/api/admin/email/config/route.ts`
- 后台群发范式：`app/admin/email/campaigns/` + `components/admin/CampaignForm.tsx`
- 队列 + scheduler 模式：`lib/scheduler-tasks.ts`（`TaskName` 联合类型 + `runTask()` 分发）
- 审计：`lib/audit.ts` 的 `writeAudit()`
- 迁移：`scripts/migrations/*.sql`（幂等，由 `scripts/migrate.ts` 按字典序执行）
- 后台导航：`components/admin/AdminSidebar.tsx`

---

## 3. 微信平台的硬约束（已核实，决定架构）

这一节是整个方案的地基。**下面每一条都直接来自微信的接口限制**，不是设计偏好。

### 3.1 群发接口

```
POST https://api.weixin.qq.com/cgi-bin/message/mass/send?access_token=ACCESS_TOKEN
```

| 约束 | 值 | 影响 |
|---|---|---|
| **权限** | 仅**认证服务号** | 订阅号不能用这个接口 |
| `touser` openid 数量 | **最少 2 个，最多 10000 个** | ⚠️ **只有 1 个关注者时接口直接报错** `invalid_openid_list_size` |
| 群发频次 | 认证服务号：**每用户每月 4 条** | 公告是"每月几条"的量级 |
| 群发方式 | **异步任务** —— 返回 `msg_id` 即"提交成功" | 用 `mass/get` 查最终状态 |
| `msgtype=text` | 纯文本，**不需要** `media_id` | 公告用纯文本，免掉素材管理 |
| 每日调用 | 群发 1000 次 / 分钟 60 次 | 分批时留余量 |

> ⚠️ **最少 2 个 openid** 是最尖锐的一条。新号关注者只有 1 人时，**任何**群发都会失败。必须优雅处理 —— 不能让管理员点「发送」后收到一个看不懂的微信错误。

### 3.2 关注者 openid 从哪来

**微信公众平台不提供"已关注用户列表"接口。** openid 只有两个来源：

1. **关注事件推送** —— 用户关注时，微信向服务器推一段 XML（含 `FromUserName` = openid）。需要配服务器回调。
2. **OAuth 静默授权**（`snsapi_base`）—— 用户从微信里点开站内页面，站点用 `code` 换 openid。需要配「网页授权域名」（一级域名 + ICP 备案）。

**没有第三条路。** 这意味着**关注者数量完全取决于有多少人从微信里点进站点**。

### 3.3 access_token

- 有效期 **7200 秒**
- ⚠️ **重复获取会让上一次的 token 立刻失效** —— 多实例 / 多进程并发刷新会互相踢掉
- 获取接口 `GET /cgi-bin/token?grant_type=client_credential&appid=&secret=`
- **服务器 IP 必须加进白名单**，否则调用失败
- 每日获取上限 2000 次（12 次/天足够）

---

## 4. 决策（我做的判断，你来推翻）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **纯文本公告**（`msgtype=text`），不做图文 | 图文要 `media/uploadnews` + 素材库 + 封面图，复杂度翻倍。文字公告够用，且**免掉一整套素材管理** |
| 2 | **一次群发给所有关注者**（`touser` = 全部 openid），不做分组/标签 | 微信的 `sendall` 按标签群发需要先建标签体系。关注者规模不大时，一次全发最简单 |
| 3 | **openid 收集靠 OAuth 静默授权**（`snsapi_base`） | 不用配服务器回调（不用公网可解析的回调 URL）。用户在微信里点任何站内页面都能被记录 |
| 4 | **复用现有群发 UI 范式** | `email_campaigns` 的草稿/预览/发送/历史，已经被验证过一次 |
| 5 | **不与 `users` 表绑定** | 关注者可能不是注册用户。单独一张 `wechat_followers` 表 |
| 6 | **access_token 缓存在 `app_config`，进程内再缓存一层** | `app_config` 跨进程共享；进程内缓存避免每次请求都打微信接口 |
| 7 | **公告自己一张表**（`wechat_broadcasts`），不塞进 `email_campaigns` | 两条通道的字段差异大（openid 批次 vs 邮箱）。塞一起会让两边都别扭 |

---

## 5. 数据模型

### 5.1 `wechat_followers` —— 关注者名单

```sql
CREATE TABLE IF NOT EXISTS wechat_followers (
  id             BIGINT      NOT NULL AUTO_INCREMENT,
  openid         VARCHAR(64) NOT NULL,
  nickname       VARCHAR(128) NULL,
  subscribed_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active      TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_openid (openid),
  KEY idx_active (is_active, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**为什么 `is_active` 而不是删行**：用户取关后，微信不推取消关注事件给**非**关注事件配置的账号（除非配了 `subscribe` 事件推送）。所以"取关"我们**检测不到** —— openid 留在表里，推送时微信会**静默丢弃**已取关的用户。这是可接受的：微信返回成功，但对方没收到。

### 5.2 `wechat_broadcasts` —— 公告

```sql
CREATE TABLE IF NOT EXISTS wechat_broadcasts (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  title          VARCHAR(128) NOT NULL,
  content        TEXT         NOT NULL,
  status         ENUM('draft','queued','sending','sent','failed','cancelled')
                              NOT NULL DEFAULT 'draft',
  total_recipients INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count     INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count  INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count   INT UNSIGNED NOT NULL DEFAULT 0,
  wechat_msg_id  VARCHAR(64)  NULL,
  last_error     VARCHAR(1024) NULL,
  created_by     BIGINT       NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sent_at        DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_status (status, created_at DESC),
  KEY idx_created_by (created_by, created_at DESC),
  CONSTRAINT fk_wb_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**为什么没有 per-recipient 表**：微信的群发是**一次请求发给一批人**，不是逐个发。没有逐个收件人的状态可记录 —— 微信只返回"提交成功"。所以 `sent_count` 是"提交给了多少人"，不是"确认送达多少人"。

### 5.3 配置键（`app_config`）

| 键 | 说明 | 校验 |
|---|---|---|
| `wechat.enabled` | `true`/`false` | 布尔 |
| `wechat.app_id` | 公众号 AppID | `^wx[0-9a-f]{16}$` |
| `wechat.app_secret` | 公众号 AppSecret | 长度 ≤ 256 |
| `wechat.token` | 群发内容里的跳转链接（如站点首页） | URL 或空 |
| `wechat.access_token` | 缓存的 access_token + 过期时间 | 内部写，不在 UI 显示 |

> ⚠️ **`app_secret` 存在 `app_config`（数据库）** —— 这是**明文**。和企业微信 webhook URL 的决策一致（决策 6/7：明文存、明文显示）。AppSecret 是服务号的核心凭据，比 webhook URL 更敏感。**记录在此以备将来收紧。**
>
> ⚠️ 后台 UI **不显示** `app_secret` 明文（只显示是否已配置），与 `smtp.pass` 的现有处理保持一致。

---

## 6. 架构

```
管理员在 /admin/wechat 写公告
    │
    ▼
POST /api/admin/wechat/broadcasts  { title, content }
    │
    ├─ 校验：wechat.enabled / app_id / app_secret 已配置
    ├─ 读 wechat_followers where is_active=1
    ├─ 关注者数 < 2 ⇒ 拒绝，提示「关注者不足 2 人，微信接口不允许」
    └─ 插一行 wechat_broadcasts (status='queued', total_recipients=N)

scheduler tick（每分钟）
    │
    ▼
runWechatBroadcastSend()  [新任务 'wechat-broadcast-send']
    │
    ├─ SELECT ... WHERE status='queued' LIMIT 5
    ├─ 取 access_token（缓存过期就刷新，且要防并发刷新）
    ├─ 切批：每批 ≤ 1000 个 openid（留余量）
    ├─ 每批 POST /cgi-bin/message/mass/send
    │    ├─ errcode=0 ⇒ sent_count += 批大小，记录 msg_id
    │    └─ errcode≠0 ⇒ failed，last_error
    └─ 全部批次完成 ⇒ status='sent', sent_at=NOW()
```

**关键设计点：**

- **与邮件群发完全平行** —— 各自一张表、各自一个 scheduler 任务。**不共用** `email_campaigns`。
- **批大小 1000** —— 官方上限 10000，取 1000 是留足余量（分批串行、每分钟 60 次的调用限制）。
- **群发是异步的** —— 微信返回 `msg_id` 只代表"提交成功"，实际发送要一段时间。**我们不追踪送达率**（微信不给逐人回执）。`sent_count` 的含义在 UI 上要写清楚。
- **`access_token` 防并发刷新** —— 进程内用一个「正在刷新」的 Promise 去重。同进程内并发请求共用一次刷新。
- **`access_token` 存 `app_config`** —— 跨进程共享。进程内再缓存 30 分钟（远短于 2 小时 TTL）。

---

## 7. OAuth 静默授权 —— 关注者怎么进来

### 7.1 流程

```
用户从微信里点开站点任意页面
    │
    ▼
GET /api/wechat/oauth/start?redirect=<原路径>
    │  没有 openid cookie ⇒
    │  302 → https://open.weixin.qq.com/connect/oauth2/authorize
    │           ?appid=<APPID>
    │           &redirect_uri=<站点>/api/wechat/oauth/callback
    │           &response_type=code
    │           &scope=snsapi_base
    │           &state=<随机串>
    │           #wechat_redirect
    ▼
GET /api/wechat/oauth/callback?code=<code>&state=<随机串>
    │
    ├─ 用 code + appid + app_secret 换 openid
    │   GET /sns/oauth2/access_token?appid=&secret=&code=&grant_type=authorization_code
    ├─ 存 wechat_followers（openid 已存在 ⇒ 更新 last_seen_at）
    ├─ 设 cookie: wechat_openid（HttpOnly, SameSite=Lax）
    └─ 302 回原路径
```

### 7.2 什么时候触发

**不在每个页面都触发。** 那会让每个页面多一次 302 往返，太重，而且会让普通浏览器用户（不在微信里）莫名被拦。

**建议：只在「微信内打开」时触发一次。** 判据：请求的 `User-Agent` 含 `MicroMessenger`。

**更进一步：加一个显式入口** —— 页脚放一个「关注公众号」按钮，点了才走 OAuth。这样：
- 不打扰普通用户
- 关注者数量增长靠这个入口
- 也符合"关注了才能收公告"的逻辑

> ⚠️ **这是本方案里我唯一没有把握的部分。** 依赖"用户从微信点进站点"来积累关注者名单 —— 而这依赖站点本身在微信里有分享/传播渠道。**如果站点在微信里几乎没有流量，关注者会一直是 0，公告功能形同虚设。**
>
> **所以后台必须清楚显示当前关注者人数**，并在人数 < 2 时明确警告"暂时无法群发"。不能让管理员写完公告点了发送才失败。

### 7.3 安全

| 顾虑 | 处置 |
|---|---|
| `state` 参数 | 随机串 + 签名，防 CSRF。回调时校验 |
| `redirect_uri` | 必须与后台配置的域名一致（微信会校验），且**不能是任意 URL**（开放重定向） |
| `openid` cookie | HttpOnly + SameSite=Lax。**不用它做鉴权**，只用于"这个浏览器已经记过了"的去重 |
| `app_secret` | 只在服务端用，绝不返回给前端 |
| 群发内容 | 管理员自撰，但要做长度限制（微信文本消息有长度上限） |

---

## 8. 后台界面

**新页面**：`app/admin/wecom/../wechat/page.tsx`，侧边栏入口「微信公众号」。

**三个区块：**

1. **配置区** —— 是否启用、AppID、AppSecret（密码框）、群发附带的链接、**当前关注者人数**（醒目显示，< 2 时红色警告）
2. **公告列表** —— 每条：标题、内容预览、状态、收件人数、提交时间、`msg_id`
3. **写公告** —— 标题 + 正文（纯文本），「预览」和「发送」

**新 API**（全部 `requireAdmin()` + `writeAudit()`）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/admin/wechat/config` | GET / PUT | 读写配置 |
| `/api/admin/wechat/followers` | GET | 关注者列表 + 人数 |
| `/api/admin/wechat/broadcasts` | GET / POST | 公告列表 / 新建并入队 |
| `/api/admin/wechat/broadcasts/[id]` | GET | 公告详情 + 状态 |
| `/api/admin/wechat/broadcasts/[id]/send` | POST | 手动触发发送 |
| `/api/admin/wechat/oauth/start` | GET | 302 到微信授权页 |
| `/api/admin/wechat/oauth/callback` | GET | 换 openid + 落库 + 回跳 |
| `/api/admin/wechat/broadcasts/[id]/cancel` | POST | 取消草稿 |

---

## 9. 失败与可观测性

| 位置 | 记录什么 |
|---|---|
| `wechat_broadcasts.last_error` | 微信的 `errmsg` 或网络错误 |
| `wechat_broadcasts.status` | `draft` / `queued` / `sending` / `sent` / `failed` / `cancelled` |
| `audit_log` | 配置修改、公告创建、发送、取消 |
| `console.warn` / `console.error` | token 刷新失败、群发失败 |

**入队失败不阻断** —— 公告是"增强"，不是核心流程。

**群发失败自动重试** —— 与企业微信一致：`next_attempt_at` 式的一分钟重推。但这里**用 `last_error` + `status='failed'` + scheduler 捡 `queued` 重试**更简单。我倾向**失败即 `failed`，管理员手动重发**（因为微信的月度 4 条配额很宝贵，自动重试可能撞配额）。

> ⚠️ **这里我选了"不自动重试"** —— 理由是配额稀缺。邮件群发和企微推送都可以随便重试，公众号群发每一次尝试都可能消耗用户的一个月名额。**你如果希望自动重试，告诉我。**

---

## 10. 安全考量

| 顾虑 | 处置 |
|---|---|
| `app_secret` 明文存库 | ⚠️ 与企微 webhook 同款决策。**UI 不回显**，只显示"已配置" |
| 服务器 IP 白名单 | **微信侧配置**，代码无法代劳。**后台要提示管理员去配**（否则 100% 失败，错误码 40164） |
| 网页授权域名 | **微信侧配置**（一级域名 + ICP 备案）。后台同样要提示 |
| `redirect_uri` 开放重定向 | 只允许站内相对路径，或与 `site.url` 同源 |
| 群发内容 XSS | 纯文本，不渲染 HTML |
| 月度 4 条配额 | 后台显示本月的群发次数计数 |
| 订阅者 openid 泄露 | openid 只在库和微信接口之间流动，不在前端暴露 |

---

## 11. 实施计划（概要）

| 任务 | 内容 | 主要文件 |
|---|---|---|
| 1 | 迁移：两张表 | `scripts/migrations/2026-11-20-wechat-broadcast.sql` |
| 2 | `lib/wechat-types.ts`：类型 + 配置键校验 | 新 |
| 3 | `lib/wechat-api.ts`：token 获取/缓存 + `mass/send` 封装 | 新 |
| 4 | `lib/wechat-followers.ts`：关注者 CRUD + OAuth 换 openid | 新 |
| 5 | `lib/wechat-broadcasts.ts`：公告 CRUD + 入队 | 新 |
| 6 | scheduler 新任务 `wechat-broadcast-send` | `lib/scheduler-tasks.ts` + `lib/scheduler-config.ts` + `lib/scheduler.ts` |
| 7 | OAuth 路由（start / callback） | `app/api/wechat/oauth/*` |
| 8 | 后台 API 路由 | `app/api/admin/wechat/*` |
| 9 | 后台页面 + 侧边栏 + 「关注公众号」入口 | `app/admin/wechat/page.tsx` + `components/admin/` + `AdminSidebar.tsx` |
| 10 | 端到端验证（真机 + 真实关注者） | — |

**每个任务走 TDD**：先写会红的测试，看它红，再实现，再跑全套。

---

## 12. 需要你确认的五点

写实施计划前，有五个我做的判断想跟你对一下（你回「没问题」我就写计划）：

1. **纯文本公告，不做图文** —— 图文要素材库 + 封面图，复杂度翻倍。
2. **一次全发关注者，不做分组/标签** —— 标签群发要先建标签体系。
3. **openid 靠 OAuth 静默授权收集**（配「关注公众号」按钮），**不配服务器事件回调**。
4. **群发失败不自动重试**，管理员手动重发 —— 因为微信每用户每月只有 4 条配额，自动重试可能撞配额。
5. **`app_secret` 明文存 `app_config`，后台不回显** —— 与现有 `smtp.pass` 处理一致。

**另外两件必须提前知道的事：**

- ⚠️ **必须有「认证服务号」**，订阅号用不了 `mass/send`。你手上是认证服务号吗？
- ⚠️ **必须有已关注用户，且至少 2 个** —— 否则接口直接报错。
