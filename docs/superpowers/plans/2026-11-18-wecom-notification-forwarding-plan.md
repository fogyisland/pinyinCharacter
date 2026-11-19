# 企业微信通知转发 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让站点的每一类通知可以被转发到企业微信群 —— 每个群自己勾选要收哪几类通知，转发是异步的，失败隔一分钟重推。

**Architecture:** 通知产生时（`sendEmail()` 内部）把通知**入队**到 `wecom_deliveries` 表，一个启用且勾了该类别的群产生一条队列记录。scheduler 的每分钟 tick 扫描到期的 `pending` 记录，推到企业微信群机器人 webhook，成功记 `sent`，失败记 `failed` 并把 `next_attempt_at` 推到 1 分钟后 —— **重试与正常推送是同一条代码路径**。群本身存在 `wecom_webhooks` 表，勾选的类别存在一个 JSON 列里。

**Tech Stack:** Next.js 15 App Router / TypeScript / vitest 4 / mysql2 / Node 20 原生 `fetch`（**零新依赖**）

**Spec:** `docs/superpowers/specs/2026-11-18-wecom-notification-forwarding-spec.md`

---

## 已核实的仓库事实

这一节里的每一条都对着仓库代码读过了。**实施者不必再确认这些 —— 它们是事实，不是建议。** 凡是计划里说「先读那个文件确认」的，答案也已经被核实并写进了那一步。

| 事实 | 出处 |
|---|---|
| `sendEmail()` 的 `console` 分支在最前面，直接 `return` | `lib/email.ts:48-52` |
| `sendEmail()` 的 `recordSend` 用**动态** `await import('./db')`，静态 import 会让 `lib/email.ts` 依赖 mysql2 | `lib/email.ts:94` |
| `EmailMessage.template` 现在是 `template?: string` | `lib/email.ts:12` |
| 现有 5 个 `template:` 调用点的值：`campaign_preview` / `welcome` / `email_verification` ×2 / `notes_notification` / `campaign` | `app/api/admin/email/campaigns/[id]/preview/route.ts:51` 等 |
| `app/api/admin/email/test/route.ts` 的 `to` 来自 `z.object({ to: z.string().email() })` | 同文件第 8 行 |
| `lib/db.ts` 只 import mysql2，不 import 任何项目模块 ⇒ 新模块静态 import 它没有循环依赖 | `lib/db.ts` |
| `lib/audit-format.ts` 有**四份**名单：`AuditEvent` 联合、`AUDIT_EVENTS` 元组、`EVENT_LABEL` 记录、`formatLogMessage` 的 switch | `lib/audit-format.ts` |
| `formatLogMessage` 里的 `str` / `num` 是**函数体内部的局部变量**，不是模块导出 | 同上 |
| `tests/unit/lib/audit.test.ts` 断言 `AUDIT_EVENTS` 与 `EVENT_LABEL` 的键完全一致、且不重复 | `tests/unit/lib/audit.test.ts:26-28` |
| `adminSchedulerConfigSchema` 在 `lib/validators.ts`，`z.object()` **默认剥掉未声明的键** | `lib/validators.ts:266` |
| 后台调度开关表在 `components/admin/SchedulerPanel.tsx`（`app/admin/scheduler/page.tsx` 只有 25 行的壳） | 两个文件 |
| `SchedulerPanel` 的 `TASK_LABELS` 里**没有** `taskEmailCampaign` | `components/admin/SchedulerPanel.tsx` |
| `Panel` 的 props：`title?` / `description?` / `actions?` / `children` / `className?` / `flush?` | `components/admin/Panel.tsx` |
| `PageHeader` 的 props：`title`（必填）/ `description?` / `actions?` / `eyebrow?` | `components/admin/PageHeader.tsx` |
| 侧边栏的「通讯」组里有「邮件」「营销邮件」「留言笔记」「留言通知邮箱」；`MessageSquare` 已被 import | `components/admin/AdminSidebar.tsx` |
| 调度页在侧边栏里的名字是「**定期更新**」，不是「定时任务」 | 同上 |
| 本仓库**没有** `text-muted` 这个 Tailwind 类（用的是 `text-ink-soft` / `text-ink-faint`） | 全仓库 grep 零命中 |
| `scripts/migrate.ts` 按**字典序**执行 `scripts/migrations/*.sql`，用 `multipleStatements: true` 的独立连接 | `scripts/migrate.ts` |
| `scripts/migrations/` 里较新的表用 `COLLATE=utf8mb4_unicode_ci`（外键需要两表排序规则一致） | `mcp_tokens` / `email_campaigns` / `notes` |
| `npm run test` = `vitest run`；`npm run build` = `next build`；`npm run fonts:verify-webfont` 存在 | `package.json` |
| `npm run dev` 固定在 4444 端口 | `package.json` |

---

## Global Constraints

这些约束适用于每一个任务，任务本身的描述不再重复：

- **回复用中文；代码、commit message、UI 文案用英文。**（项目 CLAUDE.md）
- **零新依赖。** 用 Node 20 原生的 `fetch` + `AbortSignal.timeout()`。不装 npm 包。
- **禁止省略号占位。** 每个函数体都要完整实现，不许 `// TODO` 或 `...`。（项目 CLAUDE.md）
- **禁止静默失败。** 每个 `catch` 必须 `console.warn` / `console.error` 记日志。（项目 CLAUDE.md）
- **通知转发绝不阻断原流程。** 入队失败、推送失败都不能让「用户留言」「注册」这些主流程失败。
- **commit message 尾带 `[YYYY-MM-DD HH.MM]` 时间戳。**（项目惯例）
- **每个任务 TDD**：先写测试 → 看着它红 → 实现 → 看着它绿 → 跑全套 → 提交。
- **动 `app/**/page.tsx` 才必须 `npm run build`；本计划的页面是 `app/admin/wecom/page.tsx` ⇒ 属于「动 page.tsx」，需要 build。**
- **npm，不是 pnpm。** install 用 `npm install --legacy-peer-deps`。
- **不自动 push。** 合并/推送由人决定。
- **测试文件放 `tests/unit/` 下，`@/` 别名指向仓库根。** vitest 配置在 `vitest.config.ts`，`environment: 'node'`。
- **DB 依赖的测试用 `vi.mock('@/lib/db', () => ({ getPool: () => ({ query: queryMock }) }))`。** 范式见 `tests/unit/app/api/auth-login-security.test.ts`。
- **单文件不超过 300 行**（项目 CLAUDE.md）。`lib/wecom-*.ts` 各自要小。

---

## Review Focus

以下五种输入/失败模式是 spec 隐含、但**任何任务的测试都不会自然覆盖**的 —— 最可能真的咬到用户。按「最可能先咬人」排序。**每一行都要有一个测试钉住它，放在拥有该代码的任务里。**

1. **同一类通知同时勾选了三个群 ⇒ 一条通知产生三条队列记录，三条都推。** 分类配置最容易出的 bug 是「只推了第一个群」或「推了三遍同一个群」。
2. **推送失败后 `next_attempt_at` 必须是「现在 + 1 分钟」，不是「立刻」也不是「+ 固定 60 秒从入队时刻算」。** 立刻重推会变成热循环打爆企业微信的限流；从入队时刻算会让第 20 次重试挤在一起。
3. **`attempts` 到 20 ⇒ 停止重推，保持 `failed`，不再进入到期扫描。** 否则永久失败的记录永远占着队头，队列推不动别的消息。
4. **webhook URL 不是 `https://qyapi.weixin.qq.com/...` ⇒ 拒绝保存。** 管理员手滑填内网地址会把服务器变成 SSRF 跳板。
5. **企业微信返回 `errcode != 0`（比如 93000 key 无效）⇒ 这是一条「失败」，不是「成功」。** 一个只看 HTTP 200 就当成功的实现，会把 93000 当成推送成功，用户永远收不到消息而后台一片绿。
6. **后台把「企业微信转发」这个开关勾上 ⇒ 真的要生效。** 这一条特别毒，因为 zod 的 `z.object()` **静默丢弃**它没声明的键 —— 不报错、返回 200、配置不变、开关弹回原样。管理员看到的是「点了没反应」，而不是「报错了」。schema、路由的 `Pick<>`、`writeSchedulerConfig` 的 `Pick<>`、`SchedulerPanel` 的 `TASK_LABELS` —— **四处缺一处就复现。**

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `scripts/migrations/2026-11-18-wecom-notifications.sql` | 两张表：`wecom_webhooks`、`wecom_deliveries` |
| `lib/wecom-types.ts` | 类别白名单（`WECOM_CATEGORIES`）、类型 `WecomCategory`、`WecomWebhook`、`WecomDelivery`、URL 校验 `isValidWebhookUrl` |
| `lib/wecom-webhooks.ts` | 群的 CRUD + 「哪些群要收这一类」的查询 |
| `lib/wecom-deliver.ts` | 入队 `enqueueWecomNotification` + 推送 `pushWecomDelivery` + 批量 `runWecomDeliver` |
| `lib/email.ts`（改） | `sendEmail()` 内部接入入队 |
| `lib/scheduler-tasks.ts`（改） | 新任务 `wecom-deliver` |
| `lib/scheduler-config.ts`（改） | `TaskName` / `SchedulerHistoryTaskName` 加 `wecom-deliver`、配置键 `scheduler.task_wecom_deliver`、5 处配置开关 |
| `lib/scheduler.ts`（改） | `enabledTasks()` 加新任务 |
| `lib/audit-format.ts`（改） | 新增 5 个审计事件（3 份名单 + `formatLogMessage` 的 5 个 case） |
| `lib/validators.ts`（改） | `adminSchedulerConfigSchema` 接受 `taskWecomDeliver` |
| `app/api/admin/scheduler/route.ts`（改） | `Pick<>` 联合类型加新键 |
| `components/admin/SchedulerPanel.tsx`（改） | 「企业微信转发」开关 |
| `app/api/admin/wecom/webhooks/route.ts` | 群的增删改查 |
| `app/api/admin/wecom/deliveries/route.ts` | 推送历史 |
| `app/api/admin/wecom/test/route.ts` | 往指定群发测试消息 |
| `app/api/admin/wecom/retry/route.ts` | 重置一条失败记录 |
| `app/admin/wecom/page.tsx` | 后台页面 |
| `components/admin/WecomWebhookForm.tsx` | 群的增删改表单 |
| `components/admin/WecomDeliveryHistory.tsx` | 推送历史表 |
| `components/admin/AdminSidebar.tsx`（改） | 加「企业微信」入口 |

---

## Task 1: 迁移 —— 两张表

**Files:**
- Create: `scripts/migrations/2026-11-18-wecom-notifications.sql`
- Test: `tests/unit/scripts/wecom-migration.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: 表 `wecom_webhooks`（`id, name, webhook_url, enabled, categories JSON, created_at, updated_at`）、表 `wecom_deliveries`（`id, webhook_id, category, subject, body, status, attempts, last_error, next_attempt_at, sent_at, created_at`）

- [ ] **Step 1: 写会红的测试**

测试读 `scripts/migrations/2026-11-18-wecom-notifications.sql`，断言它包含两张表和关键列：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = readFileSync(
  join(process.cwd(), 'scripts', 'migrations', '2026-11-18-wecom-notifications.sql'),
  'utf8',
);

describe('the WeCom notification migration', () => {
  it('creates the webhook table', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS wecom_webhooks');
    expect(SQL).toContain('webhook_url');
    expect(SQL).toContain('categories');
    expect(SQL).toContain('enabled');
  });

  it('creates the delivery table with the retry fields', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS wecom_deliveries');
    expect(SQL).toContain('next_attempt_at');
    expect(SQL).toContain('attempts');
    expect(SQL).toContain("status ENUM('pending','sent','failed')");
  });

  it('is idempotent — every statement is a CREATE IF NOT EXISTS', () => {
    // A migration that re-runs must not fail. The runner applies every
    // file on every boot, so a bare CREATE TABLE would break the second run.
    const creates = SQL.match(/CREATE TABLE/gi) ?? [];
    const guarded = SQL.match(/CREATE TABLE IF NOT EXISTS/gi) ?? [];
    expect(creates.length).toBe(guarded.length);
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/scripts/wecom-migration.test.ts`
Expected: FAIL —— 文件不存在，`readFileSync` 抛 ENOENT。

- [ ] **Step 3: 写迁移**

`scripts/migrations/2026-11-18-wecom-notifications.sql`：

```sql
-- WeCom (企业微信) notification forwarding.
--
-- Two tables:
--   wecom_webhooks    — the group robots. Each one is a WeCom group and the
--                       set of notification categories it wants.
--   wecom_deliveries  — the queue AND the history. A notification produces
--                       one row per matching group; the scheduler pushes the
--                       due rows and records the outcome.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS short-circuits on re-run. The
-- migration runner applies every file on every boot, so this matters.
-- No backfill — there is no WeCom integration to backfill from.

CREATE TABLE IF NOT EXISTS wecom_webhooks (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  webhook_url VARCHAR(512) NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  categories  JSON         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wecom_webhook_name (name),
  KEY idx_wecom_webhook_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wecom_deliveries (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  webhook_id      BIGINT        NOT NULL,
  category        VARCHAR(64)   NOT NULL,
  subject         VARCHAR(512)  NOT NULL,
  body            MEDIUMTEXT    NOT NULL,
  status          ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts        INT           NOT NULL DEFAULT 0,
  last_error      VARCHAR(1024) NULL,
  next_attempt_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at         DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wecom_delivery_due (status, next_attempt_at),
  KEY idx_wecom_delivery_webhook (webhook_id, created_at DESC),
  CONSTRAINT fk_wecom_delivery_webhook FOREIGN KEY (webhook_id)
    REFERENCES wecom_webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**注意 `enabled` 的默认值是 `0`** —— 新建的群默认**不推**，管理员必须手动启用（spec §3 决策 3）。

⚠️ **`COLLATE=utf8mb4_unicode_ci`** —— 这两张表里 `wecom_deliveries.webhook_id` 有指向 `wecom_webhooks.id` 的外键，两张表的字符集/排序规则必须一致，否则建外键时报 errno 150。仓库里较新的迁移（`mcp_tokens` / `email_campaigns` / `notes` / `playlists`）都用这个排序规则。⚠️ **`wecom_webhooks` 和 `wecom_deliveries` 两张表都要写上** —— 只给一张写会让两表的默认排序规则可能不一致（取决于服务器的 `collation_server`）。

⚠️ **迁移文件的名字决定了执行顺序** —— `scripts/migrate.ts` 按**字典序**执行 `scripts/migrations/*.sql`。`2026-11-18-wecom-notifications.sql` 会排在 `2026-10-31-webfont-build-jobs.sql` 之后，**在所有现有迁移之后** —— 它不依赖任何新表，所以这个位置是对的。⚠️ **不要用 `ALTER TABLE ... ADD COLUMN` 改这两张表**（它们是新表），但如果将来要加列，用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（MySQL 8 不支持，得走 `information_schema` 判断 —— 照抄 `scripts/init-db.ts` 里已有的幂等 ALTER 写法）。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/scripts/wecom-migration.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add scripts/migrations/2026-11-18-wecom-notifications.sql tests/unit/scripts/wecom-migration.test.ts
git commit -m "feat(wecom): add the webhook and delivery tables [2026-11-18 HH.MM]"
```

---

## Task 2: 类别白名单与 URL 校验

**Files:**
- Create: `lib/wecom-types.ts`
- Test: `tests/unit/lib/wecom-types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export type WecomCategory = 'welcome' | 'email_verification' | 'password_reset' | 'notes_notification' | 'campaign' | 'campaign_preview' | 'email_test' | 'admin_alert'`
  - `export const WECOM_CATEGORIES: readonly WecomCategory[]` —— 8 个类别，顺序即后台勾选框的显示顺序
  - `export const WECOM_CATEGORY_LABELS: Record<WecomCategory, string>` —— 中文名
  - `export const WECOM_DEFAULT_CATEGORIES: readonly WecomCategory[]` —— `['welcome','email_verification','email_test']`（`password_reset` 不在默认里，见 spec §10；`campaign` 不在默认里，见 spec §5）
  - `export function isWecomCategory(v: string): v is WecomCategory`
  - `export function isValidWebhookUrl(url: string): boolean` —— 必须 `https:` 且 host 恰为 `qyapi.weixin.qq.com` 且 pathname 以 `/cgi-bin/webhook/send` 开头且有 `key` 查询参数
  - `export interface WecomWebhook { id: number; name: string; webhookUrl: string; enabled: boolean; categories: WecomCategory[] }`
  - `export interface WecomDelivery { id: number; webhookId: number; category: WecomCategory; subject: string; body: string; status: 'pending'|'sent'|'failed'; attempts: number; lastError: string | null; nextAttemptAt: Date; sentAt: Date | null; createdAt: Date }`

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect } from 'vitest';
import {
  WECOM_CATEGORIES,
  WECOM_CATEGORY_LABELS,
  WECOM_DEFAULT_CATEGORIES,
  isWecomCategory,
  isValidWebhookUrl,
} from '@/lib/wecom-types';

describe('the WeCom category catalogue', () => {
  it('lists the eight categories', () => {
    expect(WECOM_CATEGORIES).toHaveLength(8);
    expect(WECOM_CATEGORIES).toContain('notes_notification');
    expect(WECOM_CATEGORIES).toContain('password_reset');
  });

  it('labels every category in Chinese', () => {
    for (const category of WECOM_CATEGORIES) {
      expect(WECOM_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('does not enable the password reset category by default', () => {
    // Forwarding a reset link to a group shows it to every member of that
    // group. It has to be a deliberate choice.
    expect(WECOM_DEFAULT_CATEGORIES).not.toContain('password_reset');
  });

  it('does not enable the marketing campaign category by default', () => {
    expect(WECOM_DEFAULT_CATEGORIES).not.toContain('campaign');
  });

  it('recognises exactly the catalogue', () => {
    expect(isWecomCategory('welcome')).toBe(true);
    expect(isWecomCategory('not_a_category')).toBe(false);
  });
});

describe('the webhook URL guard', () => {
  it('accepts a real WeCom group robot URL', () => {
    expect(
      isValidWebhookUrl(
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123',
      ),
    ).toBe(true);
  });

  it('refuses a URL that is not https', () => {
    expect(
      isValidWebhookUrl('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc'),
    ).toBe(false);
  });

  it('refuses a URL pointing at another host', () => {
    // An internal address would turn the server into a request forwarder.
    expect(isValidWebhookUrl('https://192.168.1.10/cgi-bin/webhook/send?key=abc')).toBe(false);
    expect(isValidWebhookUrl('https://evil.example.com/cgi-bin/webhook/send?key=abc')).toBe(false);
  });

  it('refuses a URL with no key', () => {
    expect(isValidWebhookUrl('https://qyapi.weixin.qq.com/cgi-bin/webhook/send')).toBe(false);
  });

  it('refuses a URL with no webhook path', () => {
    expect(isValidWebhookUrl('https://qyapi.weixin.qq.com/cgi-bin/message/send?key=abc')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-types.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`lib/wecom-types.ts`：

```ts
/**
 * The WeCom (企业微信) notification forwarding vocabulary.
 *
 * The categories are the notification TYPES the site already sends by email —
 * the same keys `email_send_history.template` stores. Reusing that
 * vocabulary means "forward the notes notifications" needs no new concept:
 * the admin picks the types they already know.
 */

/** Every notification category that can be forwarded. */
export type WecomCategory =
  | 'welcome'
  | 'email_verification'
  | 'password_reset'
  | 'notes_notification'
  | 'campaign'
  | 'campaign_preview'
  | 'email_test'
  | 'admin_alert';

/** The catalogue, in the order the admin checkboxes appear. */
export const WECOM_CATEGORIES: readonly WecomCategory[] = [
  'welcome',
  'email_verification',
  'password_reset',
  'notes_notification',
  'campaign',
  'campaign_preview',
  'email_test',
  'admin_alert',
] as const;

/** The Chinese name of each category, for the admin UI. */
export const WECOM_CATEGORY_LABELS: Record<WecomCategory, string> = {
  welcome: '注册欢迎',
  email_verification: '邮箱验证',
  password_reset: '密码重置',
  notes_notification: '用户留言',
  campaign: '营销群发',
  campaign_preview: '营销预览',
  email_test: '邮件测试',
  admin_alert: '管理告警',
};

/**
 * The categories a NEW group starts with.
 *
 * ⚠️ `password_reset` is NOT here: forwarding it puts a password reset link
 * in front of every member of the group. It has to be a deliberate choice.
 * ⚠️ `campaign` is NOT here: a marketing broadcast is long, and it is not
 * something an operations group needs to see.
 */
export const WECOM_DEFAULT_CATEGORIES: readonly WecomCategory[] = [
  'welcome',
  'email_verification',
  'email_test',
] as const;

/** Whether a string is one of the catalogue. */
export function isWecomCategory(value: string): value is WecomCategory {
  return (WECOM_CATEGORIES as readonly string[]).includes(value);
}

/** The only host a group robot webhook may point at. */
const WECOM_HOST = 'qyapi.weixin.qq.com';
/** The only path a group robot webhook may use. */
const WECOM_PATH = '/cgi-bin/webhook/send';

/**
 * Whether a URL is a usable WeCom group robot webhook.
 *
 * The host and the path are pinned, not merely the scheme. An admin who
 * types an internal address would otherwise turn the server into a request
 * forwarder — the webhook URL is fetched with the server's own network
 * access, and the response body is written into the delivery history.
 */
export function isValidWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== WECOM_HOST) return false;
  if (!parsed.pathname.startsWith(WECOM_PATH)) return false;
  const key = parsed.searchParams.get('key');
  return typeof key === 'string' && key.length > 0;
}

/** One configured group robot. */
export interface WecomWebhook {
  id: number;
  name: string;
  webhookUrl: string;
  enabled: boolean;
  categories: WecomCategory[];
}

/** One queued (or delivered) notification. */
export interface WecomDelivery {
  id: number;
  webhookId: number;
  category: WecomCategory;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-types.test.ts`
Expected: PASS —— 10 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/wecom-types.ts tests/unit/lib/wecom-types.test.ts
git commit -m "feat(wecom): name the notification categories and guard the webhook URL [2026-11-18 HH.MM]"
```

---

## Task 3: 群的存储与「哪些群收这一类」

**Files:**
- Create: `lib/wecom-webhooks.ts`
- Test: `tests/unit/lib/wecom-webhooks.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `WecomCategory`、`WecomWebhook`、`isValidWebhookUrl`、`isWecomCategory`
- Produces:
  - `export async function listWebhooks(): Promise<WecomWebhook[]>` —— 全部群，按 `id` 升序
  - `export async function createWebhook(input: { name: string; webhookUrl: string; enabled: boolean; categories: WecomCategory[] }): Promise<number>` —— 返回新 `id`；URL 非法或名字重复时抛错
  - `export async function updateWebhook(id: number, input: { name: string; webhookUrl: string; enabled: boolean; categories: WecomCategory[] }): Promise<void>`
  - `export async function deleteWebhook(id: number): Promise<void>`
  - `export async function webhooksForCategory(category: WecomCategory): Promise<WecomWebhook[]>` —— **只返回 `enabled=1` 且类别集合含该类别的群**

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  createWebhook,
  webhooksForCategory,
  updateWebhook,
  deleteWebhook,
} from '@/lib/wecom-webhooks';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
});

describe('creating a group robot', () => {
  it('refuses a URL that is not a WeCom webhook', async () => {
    await expect(
      createWebhook({
        name: 'ops',
        webhookUrl: 'https://internal.example.com/hook',
        enabled: true,
        categories: ['notes_notification'],
      }),
    ).rejects.toThrow(/webhook/i);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('stores the categories as a JSON array', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 7 }]);
    const id = await createWebhook({
      name: 'ops',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
      enabled: true,
      categories: ['notes_notification', 'welcome'],
    });
    expect(id).toBe(7);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('INSERT INTO wecom_webhooks');
    expect(params[params.length - 1]).toBe(
      JSON.stringify(['notes_notification', 'welcome']),
    );
  });
});

describe('finding the groups that want a category', () => {
  it('returns only the enabled groups whose categories contain it', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'ops',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: ['notes_notification'],
        },
      ],
    ]);
    const groups = await webhooksForCategory('notes_notification');
    expect(groups).toHaveLength(1);
    expect(groups[0].categories).toEqual(['notes_notification']);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('enabled = 1');
  });

  it('filters the categories in SQL, not in JavaScript', async () => {
    // The category set lives in a JSON column; the row filter has to happen
    // in the query or every group is loaded on every notification.
    queryMock.mockResolvedValueOnce([[]]);
    await webhooksForCategory('welcome');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('JSON_CONTAINS');
    expect(params).toContain(JSON.stringify(['welcome']));
  });

  it('drops a category the group does not want', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 2,
          name: 'mixed',
          webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: 1,
          categories: ['welcome'],
        },
      ],
    ]);
    const groups = await webhooksForCategory('campaign');
    expect(groups).toHaveLength(1);
    expect(groups[0].categories).toEqual(['welcome']);
  });
});

describe('updating and deleting', () => {
  it('updates every column', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await updateWebhook(3, {
      name: 'renamed',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xyz',
      enabled: false,
      categories: ['welcome'],
    });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE wecom_webhooks');
    expect(sql).toContain('enabled');
  });

  it('deletes by id', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await deleteWebhook(3);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('DELETE FROM wecom_webhooks');
    expect(params).toEqual([3]);
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-webhooks.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`lib/wecom-webhooks.ts`：

```ts
/**
 * The group robots — the WeCom groups that receive forwarded notifications.
 *
 * The category set lives in a JSON column because it always travels with
 * the group: it is read, written and matched as one unit, and nothing ever
 * needs to ask "which groups want the `campaign` category?" — that question
 * is answered by the SQL filter in `webhooksForCategory`.
 */
import { getPool } from './db';
import {
  isValidWebhookUrl,
  isWecomCategory,
  type WecomCategory,
  type WecomWebhook,
} from './wecom-types';

/** A `wecom_webhooks` row as the driver hands it back. */
interface WebhookRow {
  id: number;
  name: string;
  webhook_url: string;
  enabled: number;
  categories: string | string[];
}

/** The categories column, which mysql2 may hand back as a string or parsed. */
function parseCategories(raw: string | string[]): WecomCategory[] {
  const list = Array.isArray(raw) ? raw : safeParse(raw);
  return list.filter((c): c is WecomCategory => typeof c === 'string' && isWecomCategory(c));
}

/** JSON.parse that never throws — a corrupt column yields no categories. */
function safeParse(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** One row → the shape the rest of the code uses. */
function toWebhook(row: WebhookRow): WecomWebhook {
  return {
    id: row.id,
    name: row.name,
    webhookUrl: row.webhook_url,
    enabled: row.enabled === 1,
    categories: parseCategories(row.categories),
  };
}

/** Every configured group, oldest first. */
export async function listWebhooks(): Promise<WecomWebhook[]> {
  const [rows] = await getPool().query<WebhookRow[]>(
    `SELECT id, name, webhook_url, enabled, categories
     FROM wecom_webhooks ORDER BY id ASC`,
  );
  return rows.map(toWebhook);
}

/**
 * The enabled groups that want this category.
 *
 * The category filter happens in SQL with `JSON_CONTAINS` — the JSON column
 * is indexed by nothing, but the table holds a handful of groups, and the
 * alternative (loading every group on every notification) would run on the
 * request path of every registered user.
 */
export async function webhooksForCategory(category: WecomCategory): Promise<WecomWebhook[]> {
  const [rows] = await getPool().query<WebhookRow[]>(
    `SELECT id, name, webhook_url, enabled, categories
     FROM wecom_webhooks
     WHERE enabled = 1 AND JSON_CONTAINS(categories, ?)
     ORDER BY id ASC`,
    [JSON.stringify([category])],
  );
  return rows.map(toWebhook);
}

/** The fields a create or an update writes. */
export interface WebhookInput {
  name: string;
  webhookUrl: string;
  enabled: boolean;
  categories: WecomCategory[];
}

/** Rejects an input the storage cannot hold. */
function assertValid(input: WebhookInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('The group needs a name');
  }
  if (input.name.length > 64) {
    throw new Error('The group name is longer than 64 characters');
  }
  if (!isValidWebhookUrl(input.webhookUrl)) {
    throw new Error(
      'The webhook URL must be a WeCom group robot URL (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)',
    );
  }
}

/**
 * Creates a group and returns its id.
 *
 * @throws when the name is taken or the URL is not a WeCom webhook.
 */
export async function createWebhook(input: WebhookInput): Promise<number> {
  assertValid(input);
  const [result] = await getPool().query<{ insertId: number }>(
    `INSERT INTO wecom_webhooks (name, webhook_url, enabled, categories)
     VALUES (?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.webhookUrl,
      input.enabled ? 1 : 0,
      JSON.stringify(input.categories),
    ],
  );
  return result.insertId;
}

/** Updates a group. Throws when the URL is not a WeCom webhook. */
export async function updateWebhook(id: number, input: WebhookInput): Promise<void> {
  assertValid(input);
  await getPool().query(
    `UPDATE wecom_webhooks
     SET name = ?, webhook_url = ?, enabled = ?, categories = ?
     WHERE id = ?`,
    [
      input.name.trim(),
      input.webhookUrl,
      input.enabled ? 1 : 0,
      JSON.stringify(input.categories),
      id,
    ],
  );
}

/** Deletes a group. Its deliveries go with it (the FK cascades). */
export async function deleteWebhook(id: number): Promise<void> {
  await getPool().query(`DELETE FROM wecom_webhooks WHERE id = ?`, [id]);
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-webhooks.test.ts`
Expected: PASS —— 7 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/wecom-webhooks.ts tests/unit/lib/wecom-webhooks.test.ts
git commit -m "feat(wecom): store the group robots and match them by category [2026-11-18 HH.MM]"
```

---

## Task 4: 入队 —— 通知产生时写进队列

**Files:**
- Create: `lib/wecom-deliver.ts`（本任务只写队列那一半，推送那一半在 Task 5）
- Test: `tests/unit/lib/wecom-deliver-enqueue.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `webhooksForCategory(category)`；Task 2 的 `WecomCategory`
- Produces:
  - `export const WECOM_SUBJECT_MAX = 512`
  - `export async function enqueueWecomNotification(category: WecomCategory, subject: string, body: string): Promise<number>` —— 返回插入的队列记录条数（0 = 没有群要这一类）。**内部 catch 掉所有错误并记日志，绝不抛出。**

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import { enqueueWecomNotification } from '@/lib/wecom-deliver';
import { webhooksForCategory } from '@/lib/wecom-webhooks';

vi.mock('@/lib/wecom-webhooks', () => ({
  webhooksForCategory: vi.fn(),
}));

const mockedWebhooks = vi.mocked(webhooksForCategory);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('queueing a notification for the groups that want it', () => {
  it('writes one row per matching group', async () => {
    // RF1: three groups want this category ⇒ three queue rows, one each.
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['notes_notification'] },
      { id: 2, name: 'b', webhookUrl: 'u2', enabled: true, categories: ['notes_notification'] },
      { id: 3, name: 'c', webhookUrl: 'u3', enabled: true, categories: ['notes_notification'] },
    ]);
    queryMock.mockResolvedValue([{ insertId: 1 }]);

    const count = await enqueueWecomNotification(
      'notes_notification',
      '新留言',
      '正文',
    );

    expect(count).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(3);
    const webhooks = queryMock.mock.calls.map((call) => call[1][0]);
    expect(webhooks).toEqual([1, 2, 3]);
  });

  it('writes nothing when no group wants the category', async () => {
    mockedWebhooks.mockResolvedValue([]);
    const count = await enqueueWecomNotification('campaign', '标题', '正文');
    expect(count).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('truncates a subject longer than the column', async () => {
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['welcome'] },
    ]);
    queryMock.mockResolvedValue([{ insertId: 1 }]);

    await enqueueWecomNotification('welcome', 'x'.repeat(900), '正文');

    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(String(params[2]).length).toBe(512);
  });

  it('never throws when the database is down', async () => {
    // The forwarding is an enhancement — the user's POST must still succeed.
    mockedWebhooks.mockRejectedValue(new Error('db gone'));
    await expect(
      enqueueWecomNotification('notes_notification', '标题', '正文'),
    ).resolves.toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when the insert fails', async () => {
    mockedWebhooks.mockResolvedValue([
      { id: 1, name: 'a', webhookUrl: 'u1', enabled: true, categories: ['welcome'] },
    ]);
    queryMock.mockRejectedValue(new Error('write failed'));
    await expect(
      enqueueWecomNotification('welcome', '标题', '正文'),
    ).resolves.toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-deliver-enqueue.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现（队列那一半）**

`lib/wecom-deliver.ts`：

```ts
/**
 * Forwarding notifications to WeCom groups.
 *
 * Two halves, deliberately separate:
 *
 *   - the QUEUE (this file, `enqueueWecomNotification`): runs on the request
 *     path of whatever produced the notification. It only writes rows.
 *   - the DELIVERY (`pushWecomDelivery`, `runWecomDeliver`, Task 5): runs
 *     in the scheduler tick. It is the only thing that talks to WeCom.
 *
 * The split is why a WeCom outage cannot fail a user's registration: the
 * request path never waits on WeCom, and it never throws.
 */
import { getPool } from './db';
import { webhooksForCategory } from './wecom-webhooks';
import type { WecomCategory } from './wecom-types';

/** The `subject` column is VARCHAR(512) — a longer title is truncated. */
export const WECOM_SUBJECT_MAX = 512;

/**
 * Queues a notification for every group that wants this category.
 *
 * ⚠️ NEVER THROWS. A failure here must not fail the notification that
 * triggered it — the user's registration, the note they posted. The error
 * is logged and the forwarding is skipped; the next notification of the
 * same category will try again.
 *
 * @returns how many queue rows were written (0 when nothing was queued)
 */
export async function enqueueWecomNotification(
  category: WecomCategory,
  subject: string,
  body: string,
): Promise<number> {
  let groups;
  try {
    groups = await webhooksForCategory(category);
  } catch (error) {
    console.warn(
      `[wecom] could not find the groups for ${category}:`,
      error instanceof Error ? error.message : String(error),
    );
    return 0;
  }
  if (groups.length === 0) return 0;

  const truncated = subject.slice(0, WECOM_SUBJECT_MAX);
  let queued = 0;
  for (const group of groups) {
    try {
      await getPool().query(
        `INSERT INTO wecom_deliveries (webhook_id, category, subject, body, status, next_attempt_at)
         VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP(3))`,
        [group.id, category, truncated, body],
      );
      queued += 1;
    } catch (error) {
      console.warn(
        `[wecom] could not queue a ${category} notification for group ${group.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return queued;
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-deliver-enqueue.test.ts`
Expected: PASS —— 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/wecom-deliver.ts tests/unit/lib/wecom-deliver-enqueue.test.ts
git commit -m "feat(wecom): queue a notification for every group that wants it [2026-11-18 HH.MM]"
```

---

## Task 5: 推送与重试 —— 唯一跟企业微信说话的地方

**Files:**
- Modify: `lib/wecom-deliver.ts`
- Test: `tests/unit/lib/wecom-deliver-push.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `lib/wecom-deliver.ts`（同一个文件，往下加）；Task 2 的 `WecomDelivery`
- Produces:
  - `export const WECOM_MAX_ATTEMPTS = 20`
  - `export const WECOM_RETRY_DELAY_MINUTES = 1`
  - `export const WECOM_REQUEST_TIMEOUT_MS = 10_000`
  - `export function buildWecomMarkdown(subject: string, body: string): string` —— **标题与邮件标题完全一致**，标题加粗当第一行，然后是正文
  - `export async function pushWecomDelivery(delivery: WecomDelivery, webhookUrl: string): Promise<{ ok: boolean; error?: string }>` —— 发一条；`errcode != 0` ⇒ `ok: false` 且 `error` 是企业微信的 `errmsg`
  - `export async function runWecomDeliver(): Promise<{ sent: number; failed: number; skipped: number }>` —— 扫到期的 `pending`，逐条推

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  buildWecomMarkdown,
  pushWecomDelivery,
  runWecomDeliver,
  WECOM_MAX_ATTEMPTS,
} from '@/lib/wecom-deliver';
import type { WecomDelivery } from '@/lib/wecom-types';

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function delivery(overrides: Partial<WecomDelivery> = {}): WecomDelivery {
  return {
    id: 1,
    webhookId: 1,
    category: 'notes_notification',
    subject: '新留言',
    body: '留言正文',
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextAttemptAt: new Date(),
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('the forwarded message', () => {
  it('keeps the title identical to the email title', () => {
    const markdown = buildWecomMarkdown('新留言： somebody', '正文');
    expect(markdown).toContain('新留言： somebody');
    expect(markdown.split('\n')[0]).toContain('新留言： somebody');
  });

  it('puts the body after the title', () => {
    const markdown = buildWecomMarkdown('标题', '正文内容');
    expect(markdown).toContain('正文内容');
    expect(markdown.indexOf('标题')).toBeLessThan(markdown.indexOf('正文内容'));
  });
});

describe('pushing one message', () => {
  it('posts markdown to the webhook', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('qyapi.weixin.qq.com');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).msgtype).toBe('markdown');
  });

  it('treats a WeCom error code as a failure', async () => {
    // RF5: errcode 93000 means an invalid key. HTTP 200 does not mean success.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook url' }),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid webhook url');
  });

  it('treats a network error as a failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('socket hang up');
  });

  it('treats a non-2xx response as a failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await pushWecomDelivery(
      delivery(),
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
    expect(result.ok).toBe(false);
  });
});

describe('the delivery run', () => {
  it('marks a pushed message as sent', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: 0,
          last_error: null,
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [{ id: 1, name: 'ops', webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', enabled: 1, categories: '["notes_notification"]' }],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });

    const result = await runWecomDeliver();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    // ⚠️ Assert on the SQL that was run, found by its content — NOT by the
    // call index. The index breaks the moment the implementation adds one
    // more query (a lock, a join, a log write).
    const sentUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'sent'"));
    expect(sentUpdate, 'no UPDATE marked the delivery as sent').toBeTruthy();
    expect(sentUpdate).toContain('sent_at');
  });

  it('pushes a failed message one minute later, not right away', async () => {
    // RF2: the retry delay is measured from the moment of failure.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 12,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: 0,
          last_error: null,
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([
      [{ id: 1, name: 'ops', webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', enabled: 1, categories: '["notes_notification"]' }],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook url' }),
    });

    const result = await runWecomDeliver();

    expect(result.failed).toBe(1);
    // The retry is measured from NOW: the SQL adds one minute to
    // CURRENT_TIMESTAMP, not to the row's original next_attempt_at.
    const failUpdate = queryMock.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes("status = 'failed'"));
    expect(failUpdate, 'no UPDATE marked the delivery as failed').toBeTruthy();
    expect(failUpdate).toContain('next_attempt_at');
    expect(failUpdate).toContain('attempts');
    // The delay comes from the database clock, not from JS: the SQL must
    // add the interval to CURRENT_TIMESTAMP, never to a JS-passed date.
    expect(failUpdate).toContain('DATE_ADD(CURRENT_TIMESTAMP');
    expect(failUpdate).toContain('INTERVAL ? MINUTE');
  });

  it('stops retrying after the attempt limit', async () => {
    // RF3: a permanently broken webhook must not hold the queue head forever.
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 13,
          webhook_id: 1,
          category: 'notes_notification',
          subject: '新留言',
          body: '正文',
          status: 'pending',
          attempts: WECOM_MAX_ATTEMPTS,
          last_error: 'invalid webhook url',
          next_attempt_at: new Date(),
          sent_at: null,
          created_at: new Date(),
        },
      ],
    ]);

    const result = await runWecomDeliver();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-deliver-push.test.ts`
Expected: FAIL —— `buildWecomMarkdown` 等导出不存在。

- [ ] **Step 3: 实现**

**追加到 `lib/wecom-deliver.ts`**（同一个文件，Task 4 的内容保留在前面）：

```ts
/** The push is retried until this many attempts have been made. */
export const WECOM_MAX_ATTEMPTS = 20;

/** How long a failed message waits before it is tried again. */
export const WECOM_RETRY_DELAY_MINUTES = 1;

/** A push that has not answered in this long is a failure. */
export const WECOM_REQUEST_TIMEOUT_MS = 10_000;

/** How many messages one tick pushes. */
const BATCH = 50;

/**
 * The WeCom message body.
 *
 * ⚠️ The title is IDENTICAL to the email title — that is the product
 * decision, not an accident. The title is the first line, in bold, so the
 * group reads it the way they read the mail subject.
 *
 * The body is the PLAIN-TEXT part of the email. The HTML part would print
 * its tags verbatim inside the markdown.
 */
export function buildWecomMarkdown(subject: string, body: string): string {
  const trimmedBody = body.trim();
  return trimmedBody.length > 0 ? `**${subject}**\n\n${trimmedBody}` : `**${subject}**`;
}

/**
 * Pushes one message to one group.
 *
 * ⚠️ A 2xx response is NOT success. WeCom answers 200 with a JSON body
 * carrying `errcode`; `errcode != 0` is a failure (93000 = the key is
 * invalid, 45009 = rate limited). Treating those as success would leave
 * the admin UI green while no message ever arrives.
 */
export async function pushWecomDelivery(
  delivery: WecomDelivery,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const content = buildWecomMarkdown(delivery.subject, delivery.body);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: AbortSignal.timeout(WECOM_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { errcode?: number; errmsg?: string };
    if (payload.errcode !== 0) {
      return {
        ok: false,
        error: `WeCom error ${payload.errcode ?? 'unknown'}: ${payload.errmsg ?? 'no message'}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A `wecom_webhooks` row as the driver hands it back.
 *
 * ⚠️ This shape is ALSO declared in `lib/wecom-webhooks.ts` — but that one
 * is module-private, and `lib/wecom-deliver.ts` cannot see it. Declare a
 * local copy here rather than exporting the other module's internals: the
 * delivery module only needs the URL, and the two modules can drift apart
 * without either breaking.
 */
interface WebhookRow {
  id: number;
  name: string;
  webhook_url: string;
  enabled: number;
  categories: string | string[];
}

/** A `wecom_deliveries` row as the driver hands it back. */
interface DeliveryRow {
  id: number;
  webhook_id: number;
  category: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

/** One row → the shape the rest of the code uses. */
function toDelivery(row: DeliveryRow): WecomDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    category: row.category as WecomCategory,
    subject: row.subject,
    body: row.body,
    status: row.status as WecomDelivery['status'],
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * Pushes every message that is due.
 *
 * A message that fails is tried again one minute later — the same code
 * path, the same query, only `next_attempt_at` moves. After
 * `WECOM_MAX_ATTEMPTS` attempts the message stops being picked up; the
 * admin sees it in the history and can reset it by hand.
 */
export async function runWecomDeliver(): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const pool = getPool();
  const [rows] = await pool.query<DeliveryRow[]>(
    `SELECT id, webhook_id, category, subject, body, status, attempts, last_error,
            next_attempt_at, sent_at, created_at
     FROM wecom_deliveries
     WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP(3)
     ORDER BY next_attempt_at ASC
     LIMIT ?`,
    [BATCH],
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const delivery = toDelivery(row);
    if (delivery.attempts >= WECOM_MAX_ATTEMPTS) {
      skipped += 1;
      continue;
    }
    const [groups] = await pool.query<WebhookRow[]>(
      `SELECT id, name, webhook_url, enabled, categories
       FROM wecom_webhooks WHERE id = ? LIMIT 1`,
      [delivery.webhookId],
    );
    const group = groups[0];
    if (!group) {
      skipped += 1;
      continue;
    }
    const result = await pushWecomDelivery(delivery, group.webhook_url);
    if (result.ok) {
      await pool.query(
        `UPDATE wecom_deliveries
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3), last_error = NULL
         WHERE id = ?`,
        [delivery.id],
      );
      sent += 1;
    } else {
      // RF2: the delay is measured from NOW, not from the queue time.
      await pool.query(
        `UPDATE wecom_deliveries
         SET status = 'failed', attempts = attempts + 1, last_error = ?,
             next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)
         WHERE id = ?`,
        [(result.error ?? 'unknown error').slice(0, 1024), WECOM_RETRY_DELAY_MINUTES, delivery.id],
      );
      console.warn(
        `[wecom] delivery ${delivery.id} failed (attempt ${delivery.attempts + 1}): ${result.error}`,
      );
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}
```

**还要在文件顶部的 import 里补上 `WecomDelivery`**：

```ts
import type { WecomCategory, WecomDelivery } from './wecom-types';
```

（Task 4 那行是 `import type { WecomCategory } from './wecom-types';` —— 改成上面这一行。）

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-deliver-push.test.ts tests/unit/lib/wecom-deliver-enqueue.test.ts`
Expected: PASS —— 8 + 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/wecom-deliver.ts tests/unit/lib/wecom-deliver-push.test.ts
git commit -m "feat(wecom): push the queued messages and retry them a minute later [2026-11-18 HH.MM]"
```

---

## Task 6: 接入 `sendEmail()` —— 通知产生的地方

**Files:**
- Modify: `lib/email.ts`
- Test: `tests/unit/lib/email-wecom-forwarding.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `enqueueWecomNotification(category, subject, body)`
- Produces: `lib/email.ts` 里的 `sendEmail()` 在**非 console transport** 时，调用 `enqueueWecomNotification(msg.template, msg.subject, msg.text)`

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const enqueueMock = vi.fn();
vi.mock('@/lib/wecom-deliver', () => ({
  enqueueWecomNotification: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock('@/lib/smtp-config', () => ({
  getMailTransport: vi.fn(async () => 'console'),
  getSmtpConfig: vi.fn(async () => ({
    transport: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'u',
    pass: 'p',
    from: 'a@example.com',
    fromName: 'A',
  })),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

// nodemailer must never open a socket in a unit test. The transporter is
// replaced with a stub whose sendMail the test controls.
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: (...args: unknown[]) => sendMailMock(...args) })),
  },
}));

import { sendEmail } from '@/lib/email';
import { getMailTransport } from '@/lib/smtp-config';

const mockedTransport = vi.mocked(getMailTransport);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  enqueueMock.mockReset();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test' });
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }]);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('forwarding a notification to the WeCom groups', () => {
  it('queues the notification with its category, title and body', async () => {
    mockedTransport.mockResolvedValue('smtp');
    await sendEmail({
      to: 'a@example.com',
      subject: '新留言',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      'notes_notification',
      '新留言',
      '正文',
    );
  });

  it('does not queue a notification with no category', async () => {
    // Without a template key the notification cannot be categorised, so
    // there is nothing to match a group's checkboxes against.
    mockedTransport.mockResolvedValue('smtp');
    await sendEmail({
      to: 'a@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('does not queue in console mode', async () => {
    // The console transport is the development mode. It must not push into
    // a real group while somebody is developing.
    mockedTransport.mockResolvedValue('console');
    await sendEmail({
      to: 'a@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('still sends the mail when the queueing fails', async () => {
    mockedTransport.mockResolvedValue('smtp');
    enqueueMock.mockRejectedValue(new Error('queue blew up'));
    await expect(
      sendEmail({
        to: 'a@example.com',
        subject: '标题',
        html: '<p>正文</p>',
        text: '正文',
        template: 'notes_notification',
      }),
    ).resolves.toBeUndefined();
  });

  it('queues the notification even when the mail itself fails', async () => {
    // The forwarding is a separate channel. A message the group should see
    // is queued whether or not SMTP accepted the mail.
    mockedTransport.mockResolvedValue('smtp');
    sendMailMock.mockRejectedValue(new Error('smtp refused'));
    await expect(
      sendEmail({
        to: 'a@example.com',
        subject: '标题',
        html: '<p>正文</p>',
        text: '正文',
        template: 'notes_notification',
      }),
    ).rejects.toThrow();
    expect(enqueueMock).toHaveBeenCalledWith(
      'notes_notification',
      '标题',
      '正文',
    );
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/email-wecom-forwarding.test.ts`
Expected: FAIL —— `sendEmail()` 不调用入队，断言红。

- [ ] **Step 3: 实现**

**改 `lib/email.ts`**：

1. 顶部加 import：

```ts
import { enqueueWecomNotification } from './wecom-deliver';
import { isWecomCategory, type WecomCategory } from './wecom-types';
```

2. 收紧 `EmailMessage.template`：

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional template key, e.g. 'password_reset'. Stored in email_send_history. */
  template?: WecomCategory;
}
```

⚠️ **现有 5 个 `template:` 调用点全部在这 8 个类别里**（`campaign_preview` / `welcome` / `email_verification` ×2 / `notes_notification` / `campaign`），所以收紧类型不会打破任何调用点。`tsc --noEmit` 会验证这一点。

3. `sendEmail()` 里入队。**关键：入队在 `console` 判断之后，但在「真正发信」之前** —— 这样 `console` 模式不入队（spec §8），而 SMTP 未配置 / 发送失败时**依然会入队**（转发是独立通道，一封发不出去的邮件不代表群里不该知道）。

具体做法：把入队写成 `sendEmail()` 里的第一段业务逻辑，紧接在 `console` 分支**之后**：

```ts
  if (transport === 'console') {
    console.debug(`[email] To: ${msg.to} | Subject: ${msg.subject}
${msg.text}`);
    await recordSend({ msg, status: 'console', at });
    return;
  }

  // Forward to the WeCom groups that want this category.
  //
  // ⚠️ This runs BEFORE the mail is sent, and it runs even when the mail
  // later fails. The forwarding is a separate channel: a message the group
  // should see is queued whether or not SMTP accepts it.
  //
  // ⚠️ `void` + `.catch()` — the enqueue is fire-and-forget. It must never
  // delay the mail (the request path is the user's registration) and must
  // never fail it.
  if (msg.template && isWecomCategory(msg.template)) {
    void enqueueWecomNotification(msg.template, msg.subject, msg.text).catch((error: unknown) => {
      console.warn(
        '[email] could not queue the WeCom forwarding:',
        error instanceof Error ? error.message : String(error),
      );
    });
  }
```

⚠️ **`isWecomCategory` 的检查不是多余的** —— `template` 的类型是 `WecomCategory`，但这是**运行时的数据库/历史数据**的边界：将来有人加了一个不在白名单里的类别键，这个检查会拦住它而不是让 `webhooksForCategory` 查出一个空结果然后什么都不做（静默失败）。

4. `recordSend` 写的 `template` 列仍是 `args.msg.template`，类型变成 `WecomCategory | undefined`，`truncate()` 的签名是 `(s: string | undefined, n: number)`，**接受不了 `WecomCategory | undefined`**？—— 接受得了，`WecomCategory` 是 `string` 的子类型。✅

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/email-wecom-forwarding.test.ts`
Expected: PASS —— 5 passed。

**还要确认没有别的调用点被类型收紧打破**：

Run: `npx tsc --noEmit`
Expected: 无输出（干净）。⚠️ 如果报 `template: string` 不兼容 `WecomCategory`，说明有调用点用了不在白名单里的 key —— 把它加进 `WECOM_CATEGORIES`，或者改用 Task 7 补的 key。

- [ ] **Step 5: 提交**

```bash
git add lib/email.ts tests/unit/lib/email-wecom-forwarding.test.ts
git commit -m "feat(wecom): forward every notification into the queue [2026-11-18 HH.MM]"
```

---

## Task 7: 补齐缺失的类别 key

**Files:**
- Modify: `app/api/auth/forgot/route.ts`
- Modify: `app/api/admin/email/test/route.ts`
- Test: `tests/unit/lib/wecom-category-keys.test.ts`

**Interfaces:**
- Consumes: Task 6 收紧后的 `EmailMessage.template`
- Produces: `password_reset` 和 `email_test` 两处调用点带上类别 key

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('every notification carries a category', () => {
  it('the password reset mail carries the password_reset category', () => {
    // Without a category a notification cannot be matched against the
    // groups' checkboxes, so it can never be forwarded.
    const source = readSource('app/api/auth/forgot/route.ts');
    expect(source).toContain("template: 'password_reset'");
  });

  it('the admin test mail carries the email_test category', () => {
    const source = readSource('app/api/admin/email/test/route.ts');
    expect(source).toContain("template: 'email_test'");
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-category-keys.test.ts`
Expected: FAIL —— 两处都缺 key。

- [ ] **Step 3: 实现**

**`app/api/auth/forgot/route.ts` 第 86 行**：

```ts
    await sendEmail({
      to: username,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      template: 'password_reset',
    });
```

**`app/api/admin/email/test/route.ts`** —— 该路由的 `sendEmail()` 调用在 `try` 块里，`to` 来自请求体的 `to` 字段。**只加 `template` 这一行**，其余字段原样不动：

```ts
      await sendEmail({
        to,
        subject: '字·韵 SMTP 测试',
        html: '<p>这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。</p>',
        text: '这是一封来自字·韵管理后台的测试邮件,看到说明 SMTP 配置正确。',
        template: 'email_test',
      });
```

（该路由的 `TestSchema` 是 `z.object({ to: z.string().email() })`，`to` 已经是变量，不是字面量 —— 不要写 `'test@example.com'`。）

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-category-keys.test.ts`
Expected: PASS —— 2 passed。

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add app/api/auth/forgot/route.ts app/api/admin/email/test/route.ts tests/unit/lib/wecom-category-keys.test.ts
git commit -m "feat(wecom): give the password reset and the test mail a category [2026-11-18 HH.MM]"
```

---

## Task 8: scheduler 任务

**Files:**
- Modify: `lib/scheduler-config.ts`
- Modify: `lib/scheduler-tasks.ts`
- Modify: `lib/scheduler.ts`
- Modify: `lib/validators.ts`
- Modify: `app/api/admin/scheduler/route.ts`
- Modify: `components/admin/SchedulerPanel.tsx`
- Test: `tests/unit/lib/wecom-scheduler-task.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `runWecomDeliver()`
- Produces:
  - `TaskName` 联合类型加 `'wecom-deliver'`
  - `SchedulerHistoryTaskName` 联合类型加 `'wecom-deliver'`
  - `SCHEDULER_KEYS.taskWecomDeliver = 'scheduler.task_wecom_deliver'`
  - `SchedulerConfig.taskWecomDeliver: boolean`
  - `DEFAULT_CONFIG.taskWecomDeliver: true`
  - `DEFAULTS[SCHEDULER_KEYS.taskWecomDeliver] = '1'`
  - `adminSchedulerConfigSchema` 接受 `taskWecomDeliver`
  - `ALL_TASKS` 加 `'wecom-deliver'`
  - `runWecomDeliverTask(): Promise<TaskResult>` —— 名字不要和 `runWecomDeliver` 撞

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const deliverMock = vi.fn();
vi.mock('@/lib/wecom-deliver', () => ({
  runWecomDeliver: (...args: unknown[]) => deliverMock(...args),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_TASKS, runTask } from '@/lib/scheduler-tasks';
import { DEFAULT_CONFIG, SCHEDULER_KEYS } from '@/lib/scheduler-config';
import { adminSchedulerConfigSchema } from '@/lib/validators';

const mockedDeliver = vi.mocked(deliverMock);

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  deliverMock.mockReset();
});

describe('the WeCom delivery task', () => {
  it('is registered in the task list', () => {
    expect(ALL_TASKS).toContain('wecom-deliver');
  });

  it('has a configuration key', () => {
    expect(SCHEDULER_KEYS.taskWecomDeliver).toBe('scheduler.task_wecom_deliver');
    expect(DEFAULT_CONFIG.taskWecomDeliver).toBe(true);
  });

  it('runs the delivery and reports what it pushed', async () => {
    mockedDeliver.mockResolvedValue({ sent: 3, failed: 1, skipped: 0 });
    const result = await runTask('wecom-deliver');
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('sent=3');
    expect(result.summary).toContain('failed=1');
  });

  it('reports a failure without throwing', async () => {
    mockedDeliver.mockRejectedValue(new Error('db gone'));
    const result = await runTask('wecom-deliver');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('db gone');
  });

  it('is accepted by the admin config schema', async () => {
    // ⚠️ zod's z.object() SILENTLY DROPS the keys it does not declare — it
    // does not error. So if the schema does not mention taskWecomDeliver,
    // the admin's toggle sends a body that parses fine, returns 200, and
    // changes nothing. The toggle would look like it works and not work.
    const parsed = adminSchedulerConfigSchema.parse({ taskWecomDeliver: false });
    expect(parsed.taskWecomDeliver).toBe(false);
  });

  it('is listed in the task labels of the scheduler panel', async () => {
    // The panel's TASK_LABELS is what the operator actually sees. A task
    // with no label is a task with no switch.
    const panel = readFileSync(
      join(process.cwd(), 'components', 'admin', 'SchedulerPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('taskWecomDeliver');
    expect(panel).toContain('企业微信转发');
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-scheduler-task.test.ts`
Expected: FAIL —— `'wecom-deliver'` 不是合法的 `TaskName`。

- [ ] **Step 3: 实现**

**`lib/scheduler-config.ts`** —— ⚠️ **这个文件有五处要改**，漏一处就是「后台看不见这个开关」或者「配置读不出来」：

1. `SCHEDULER_KEYS` 加一项：

```ts
  taskWecomDeliver: 'scheduler.task_wecom_deliver',
```

2. `SchedulerConfig` 接口加一项：

```ts
  taskWecomDeliver: boolean;
```

3. `DEFAULT_CONFIG` 加一项：

```ts
  taskWecomDeliver: true,
```

4. ⚠️ **`DEFAULTS` 记录**（模块级的那个 `Record<string, string>`，不是 `DEFAULT_CONFIG`）加一项 —— 这是 `readSchedulerConfig()` 的兜底值来源：

```ts
  [SCHEDULER_KEYS.taskWecomDeliver]: '1',
```

5. `readSchedulerConfig()` 的返回值加一项：

```ts
    taskWecomDeliver: out[SCHEDULER_KEYS.taskWecomDeliver] !== '0',
```

6. ⚠️ **`writeSchedulerConfig()` 的 `Pick<...>` 联合类型加 `'taskWecomDeliver'`，函数体加一行**：

```ts
  if (updates.taskWecomDeliver !== undefined)
    await set(SCHEDULER_KEYS.taskWecomDeliver, updates.taskWecomDeliver ? '1' : '0');
```

⚠️ **漏了第 6 步的后果**：后台的开关点了没有反应 —— `writeSchedulerConfig` 的 `Pick` 类型里没有这个键，改动传不进去。

**`lib/scheduler-tasks.ts`**：

- `export type TaskName = ...` 加 `'wecom-deliver'`
- import：`import { runWecomDeliver } from './wecom-deliver';`
- `runTask` 的 switch 加：

```ts
    case 'wecom-deliver':
      return runWecomDeliverTask();
```

- 加这个函数：

```ts
/**
 * WeCom delivery — pushes the queued notifications to the group robots.
 *
 * The scheduler tick is the only thing that talks to WeCom, so a WeCom
 * outage slows the forwarding down but never touches the site.
 */
async function runWecomDeliverTask(): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const result = await runWecomDeliver();
    const ms = Date.now() - t0;
    return {
      name: 'wecom-deliver',
      ok: true,
      summary: `sent=${result.sent} failed=${result.failed} skipped=${result.skipped} (${ms}ms)`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'wecom-deliver',
      ok: false,
      summary: 'delivery run failed',
      error: message,
    };
  }
}
```

- `ALL_TASKS` 加 `'wecom-deliver'`

**`lib/scheduler.ts`**：

- `defaultConfig()` 加 `taskWecomDeliver: true,`（这个文件里有一份 `SchedulerConfig` 的字面值，和 `scheduler-config.ts` 的 `DEFAULT_CONFIG` 是两份，两处都要加）
- `enabledTasks()` 加 `if (cfg.taskWecomDeliver) out.push('wecom-deliver');`

**`lib/validators.ts`** —— ⚠️ **这是真正的门**。后台的开关点下去，走的是 `POST /api/admin/scheduler`，那个路由用 zod 校验请求体：

```ts
export const adminSchedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  taskContentRefresh: z.boolean().optional(),
  taskDailyChar: z.boolean().optional(),
  taskStatsRefresh: z.boolean().optional(),
});
```

加一项：

```ts
  taskWecomDeliver: z.boolean().optional(),
```

⚠️ **漏了这一步的后果**：zod 的 `z.object()` **默认剥掉未声明的键**（不是报错，是静默丢弃）—— 管理员勾了「企业微信转发」，请求 200，配置没变，开关弹回原样。**这是最难查的一类 bug，因为它不报错。**

⚠️ **`adminSchedulerConfigSchema` 里没有 `taskEmailCampaign`** —— 营销群发那个开关从来没在这个 schema 里过。这解释了为什么 `SchedulerPanel` 的 `TASK_LABELS` 里也没有它：这两处是配套的。**本任务只加 `taskWecomDeliver`，不要顺手加 `taskEmailCampaign`** —— 那会改变营销群发的启停语义，超出本任务范围。

**`app/api/admin/scheduler/route.ts`** —— ⚠️ **还要改这里**，那个 `Pick<>` 联合类型少了新键，改动传不进去：

```ts
    const updates: Partial<
      Pick<
        SchedulerConfig,
        | 'enabled'
        | 'intervalMin'
        | 'taskContentRefresh'
        | 'taskDailyChar'
        | 'taskStatsRefresh'
        | 'taskWecomDeliver'
      >
    > = parsed.data;
```

**`lib/scheduler-config.ts` 的 `SchedulerHistoryTaskName`** —— ⚠️ **也要加 `'wecom-deliver'`**：

```ts
export type SchedulerHistoryTaskName =
  'content-refresh' | 'daily-char' | 'stats-refresh' | 'email-campaign-send' | 'wecom-deliver';
```

⚠️ 这个联合类型是 `scheduler_run_history.task_name` 列的取值范围 —— 不加的话，Task 8 的 `recordTaskRun({ taskName: 'wecom-deliver', ... })` **类型不过**，而 `runTick()` 里传的就是 `TaskName`。两处必须一致。

**`components/admin/SchedulerPanel.tsx`** —— ⚠️ **本任务还要动后台页面**（`app/admin/scheduler/page.tsx` 只有 25 行，是个壳；真正的开关列表在 `components/admin/SchedulerPanel.tsx`）。

那里有一份写死的任务标签表：

```tsx
const TASK_LABELS: Record<
  keyof Pick<SchedulerConfig, 'taskContentRefresh' | 'taskDailyChar' | 'taskStatsRefresh'>,
  string
> = {
  taskContentRefresh: '内容补充 (LLM)',
  taskDailyChar: '今日汉字 (预热)',
  taskStatsRefresh: '系统统计 (DB 探活)',
};
```

⚠️ **`Pick<>` 的联合类型里没有 `taskEmailCampaign`** —— 现有的「营销群发」任务就没有开关（它总是跑）。本任务要**把新任务加进去**，加在 `Pick<>` 的联合类型和表里：

```tsx
const TASK_LABELS: Record<
  keyof Pick<
    SchedulerConfig,
    'taskContentRefresh' | 'taskDailyChar' | 'taskStatsRefresh' | 'taskWecomDeliver'
  >,
  string
> = {
  taskContentRefresh: '内容补充 (LLM)',
  taskDailyChar: '今日汉字 (预热)',
  taskStatsRefresh: '系统统计 (DB 探活)',
  taskWecomDeliver: '企业微信转发',
};
```

⚠️ **加进 `Pick<>` 之后，渲染这个表的 JSX 也要改** —— 那个 map 大概是遍历 `Object.entries(TASK_LABELS)` 渲染开关（读那个文件确认）。如果它是遍历一个写死的数组，就要把 `taskWecomDeliver` 也加进那个数组。

⚠️ **`taskEmailCampaign` 不在表里不是 bug，是现状** —— 本任务**不要顺手把它加进去**（那会改变营销群发的启停语义，超出本任务范围）。⚠️ 如果实现者觉得该加，那是另一个改动，单独提。

⚠️ **这个文件不是 `page.tsx`，但 `app/admin/scheduler/page.tsx` 依赖它** ⇒ 本任务结束时**跑一次 `npm run build`**（改 `components/` 不强制 build，但这个仓库的 build 会跑类型检查，SchedulerPanel 的类型错误 build 会抓出来）。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-scheduler-task.test.ts`
Expected: PASS —— 6 passed。

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add lib/scheduler-config.ts lib/scheduler-tasks.ts lib/scheduler.ts tests/unit/lib/wecom-scheduler-task.test.ts
git commit -m "feat(wecom): push the queue from the scheduler tick [2026-11-18 HH.MM]"
```

---

## Task 9: 后台 API

**Files:**
- Create: `app/api/admin/wecom/webhooks/route.ts`
- Create: `app/api/admin/wecom/deliveries/route.ts`
- Create: `app/api/admin/wecom/test/route.ts`
- Create: `app/api/admin/wecom/retry/route.ts`
- Modify: `lib/audit-format.ts`
- Test: `tests/unit/app/api/wecom-admin-routes.test.ts`

**Interfaces:**
- Consumes: Task 3 的 CRUD；Task 2 的 `isValidWebhookUrl`；Task 5 的 `pushWecomDelivery`；Task 4 的 `enqueueWecomNotification`
- Produces: 4 个路由 + 4 个新审计事件：`wecom_webhook_created`、`wecom_webhook_updated`、`wecom_webhook_deleted`、`wecom_test_sent`、`wecom_delivery_retried`

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

// One mock function per operation. ⚠️ Do NOT collapse them into a single
// `vi.fn()` keyed by a string argument — the module factory runs before the
// test body, so a keyed dispatcher would have to be configured before it
// exists, and every test would have to re-key it.
const listWebhooksMock = vi.fn();
const createWebhookMock = vi.fn();
const updateWebhookMock = vi.fn();
const deleteWebhookMock = vi.fn();
vi.mock('@/lib/wecom-webhooks', () => ({
  listWebhooks: (...args: unknown[]) => listWebhooksMock(...args),
  createWebhook: (...args: unknown[]) => createWebhookMock(...args),
  updateWebhook: (...args: unknown[]) => updateWebhookMock(...args),
  deleteWebhook: (...args: unknown[]) => deleteWebhookMock(...args),
}));

const enqueueMock = vi.fn();
vi.mock('@/lib/wecom-deliver', () => ({
  enqueueWecomNotification: (...args: unknown[]) => enqueueMock(...args),
  pushWecomDelivery: vi.fn(),
}));

import { GET, POST, PUT, DELETE } from '@/app/api/admin/wecom/webhooks/route';
import { POST as RETRY_POST } from '@/app/api/admin/wecom/retry/route';

const mockedAdmin = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockedAdmin(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  auditMock.mockReset();
  enqueueMock.mockReset();
  listWebhooksMock.mockReset();
  createWebhookMock.mockReset();
  updateWebhookMock.mockReset();
  deleteWebhookMock.mockReset();
  mockedAdmin.mockReset();
  mockedAdmin.mockResolvedValue({
    ok: true,
    user: { id: 1, username: 'admin', isAdmin: true },
  });
});

describe('the WeCom webhook admin routes', () => {
  it('refuses a request from a non-admin', async () => {
    mockedAdmin.mockResolvedValue({
      ok: false,
      reason: 'forbidden',
      response: new Response('no', { status: 403 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/wecom/webhooks'));
    expect(res.status).toBe(403);
  });

  it('lists the groups', async () => {
    listWebhooksMock.mockResolvedValue([
      { id: 1, name: 'ops', webhookUrl: 'u', enabled: true, categories: ['welcome'] },
    ]);
    const res = await GET(new NextRequest('http://localhost/api/admin/wecom/webhooks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.webhooks).toHaveLength(1);
  });

  it('refuses to create a group with a URL that is not a WeCom webhook', async () => {
    createWebhookMock.mockRejectedValue(new Error('bad webhook url'));
    const res = await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://internal.example.com/hook',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates a group and audits it', async () => {
    createWebhookMock.mockResolvedValue(9);
    const res = await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wecom_webhook_created' }),
    );
  });

  it('never audits the webhook URL', async () => {
    createWebhookMock.mockResolvedValue(9);
    await POST(
      new NextRequest('http://localhost/api/admin/wecom/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'ops',
          webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key-value',
          enabled: true,
          categories: ['welcome'],
        }),
      }),
    );
    const audited = JSON.stringify(auditMock.mock.calls);
    expect(audited).not.toContain('secret-key-value');
  });

  it('resets a failed delivery so it is pushed again', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    const res = await RETRY_POST(
      new NextRequest('http://localhost/api/admin/wecom/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 42 }),
      }),
    );
    expect(res.status).toBe(200);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('attempts');
    expect(sql).toContain('next_attempt_at');
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/app/api/wecom-admin-routes.test.ts`
Expected: FAIL —— 路由不存在。

- [ ] **Step 3: 实现**

**`lib/audit-format.ts`**：`AUDIT_EVENTS` 加这 5 个：

```ts
  'wecom_webhook_created',
  'wecom_webhook_updated',
  'wecom_webhook_deleted',
  'wecom_test_sent',
  'wecom_delivery_retried',
```

`EVENT_LABEL` 加：

```ts
  wecom_webhook_created: '新建企业微信群',
  wecom_webhook_updated: '修改企业微信群',
  wecom_webhook_deleted: '删除企业微信群',
  wecom_test_sent: '发送企业微信测试消息',
  wecom_delivery_retried: '重推企业微信消息',
```

⚠️ **`lib/audit-format.ts` 有三份名单，缺一处就不对**：

1. **`AuditEvent` 联合类型**（文件顶部）—— 加这 5 个。
2. **`AUDIT_EVENTS` 元组** —— 加这 5 个，**放在元组末尾**（元组的顺序就是后台筛选下拉框的顺序，新的放最后）。
3. **`EVENT_LABEL` 记录** —— 加这 5 个（`Record<AuditEvent, string>`，少一个键 `tsc` 报错）。

4. **`formatLogMessage` 的 switch** —— ⚠️ **也要加这 5 个 case**，否则审计日志那一行会掉进 `default` 分支，显示成 `wecom_webhook_created: {"id":9,"name":"ops"}` 这样的原始 JSON .dump。加在 switch 的末尾（`default` 之前）：

```ts
    case 'wecom_webhook_created':
      return `新建企业微信群「${str(m.name) || '?'}」`;
    case 'wecom_webhook_updated':
      return `修改企业微信群「${str(m.name) || '?'}」`;
    case 'wecom_webhook_deleted':
      return `删除企业微信群 #${num(m.id) || '?'}`;
    case 'wecom_test_sent':
      return `发送企业微信测试消息到「${str(m.name) || '?'}」`;
    case 'wecom_delivery_retried':
      return `重推企业微信消息 #${num(m.id) || '?'}`;
```

（`str` 和 `num` 是 **`formatLogMessage` 函数体内部的两个局部辅助函数**，不是模块导出 —— case 分支里直接用，不要 import：

```ts
  const num = (v: unknown, suffix = ''): string =>
    typeof v === 'number' ? `${v}${suffix}` : typeof v === 'string' ? `${v}${suffix}` : '';
  const str = (v: unknown): string => (typeof v === 'string' && v ? v : '');
```

⚠️ `str` 对空字符串返回 `''`，所以 `str(m.name) || '?'` 是对的写法。）

⚠️ **`tests/unit/lib/audit.test.ts` 会自动覆盖这三条**：它断言 `[...AUDIT_EVENTS].sort()` 等于 `Object.keys(EVENT_LABEL).sort()`，且 `new Set(AUDIT_EVENTS).size === AUDIT_EVENTS.length`（不重复）。三份名单必须一一对应。

**`app/api/admin/wecom/webhooks/route.ts`**：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
} from '@/lib/wecom-webhooks';
import { isWecomCategory, type WecomCategory } from '@/lib/wecom-types';

export const dynamic = 'force-dynamic';

const CategoriesSchema = z
  .array(z.string())
  .refine((values) => values.every((v) => isWecomCategory(v)), {
    message: 'unknown notification category',
  });

const WebhookSchema = z.object({
  name: z.string().min(1).max(64),
  webhookUrl: z.string().min(1).max(512),
  enabled: z.boolean(),
  categories: CategoriesSchema,
});

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const webhooks = await listWebhooks();
    return NextResponse.json({ ok: true, data: { webhooks } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = WebhookSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      const id = await createWebhook({
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl,
        enabled: parsed.data.enabled,
        categories: parsed.data.categories as WecomCategory[],
      });
      await writeAudit({
        userId: auth.user.id,
        event: 'wecom_webhook_created',
        metadata: { id, name: parsed.data.name },
      });
      return NextResponse.json({ ok: true, data: { id } });
    } catch (error) {
      return badRequest('invalid_webhook', (error as Error).message);
    }
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'id must be a positive integer');
    const parsed = WebhookSchema.safeParse(body);
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      await updateWebhook(id, {
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl,
        enabled: parsed.data.enabled,
        categories: parsed.data.categories as WecomCategory[],
      });
      await writeAudit({
        userId: auth.user.id,
        event: 'wecom_webhook_updated',
        metadata: { id, name: parsed.data.name },
      });
      return NextResponse.json({ ok: true, data: { id } });
    } catch (error) {
      return badRequest('invalid_webhook', (error as Error).message);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return badRequest('validation', 'id must be a positive integer');
    await deleteWebhook(id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_webhook_deleted',
      metadata: { id },
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
```

⚠️ **`wecom_webhook_created` 的 metadata 里绝不能有 URL** —— 审计日志会被后台所有人看到，而 webhook URL 就是那个群的钥匙。只记 `id` 和 `name`。

**`app/api/admin/wecom/deliveries/route.ts`**：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface DeliveryRow {
  id: number;
  webhook_id: number;
  name: string;
  category: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const limit = Math.min(
      Math.max(parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10) || 50, 1),
      200,
    );
    const [rows] = await getPool().query<DeliveryRow[]>(
      `SELECT d.id, d.webhook_id, w.name, d.category, d.subject, d.status,
              d.attempts, d.last_error, d.next_attempt_at, d.sent_at, d.created_at
       FROM wecom_deliveries d
       LEFT JOIN wecom_webhooks w ON w.id = d.webhook_id
       ORDER BY d.created_at DESC
       LIMIT ?`,
      [limit],
    );
    return NextResponse.json({ ok: true, data: { deliveries: rows } });
  });
}
```

**`app/api/admin/wecom/retry/route.ts`**：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RetrySchema = z.object({ id: z.number().int().positive() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = RetrySchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const [result] = await getPool().query<{ affectedRows: number }>(
      `UPDATE wecom_deliveries
       SET status = 'pending', attempts = 0, last_error = NULL,
           next_attempt_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [parsed.data.id],
    );
    if (result.affectedRows === 0) {
      return badRequest('not_found', 'delivery not found');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_delivery_retried',
      metadata: { id: parsed.data.id },
    });
    return NextResponse.json({ ok: true, data: { id: parsed.data.id } });
  });
}
```

**`app/api/admin/wecom/test/route.ts`**：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { listWebhooks } from '@/lib/wecom-webhooks';
import { pushWecomDelivery } from '@/lib/wecom-deliver';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({ webhookId: z.number().int().positive() });

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = TestSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    const groups = await listWebhooks();
    const group = groups.find((g) => g.id === parsed.data.webhookId);
    if (!group) return badRequest('not_found', 'group not found');
    const result = await pushWecomDelivery(
      {
        id: 0,
        webhookId: group.id,
        category: 'admin_alert',
        subject: '企业微信转发测试',
        body: '这是一条测试消息。看到它就说明转发链路是通的。',
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        sentAt: null,
        createdAt: new Date(),
      },
      group.webhookUrl,
    );
    if (!result.ok) {
      return badRequest('wecom_error', result.error ?? 'push failed');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wecom_test_sent',
      metadata: { webhookId: group.id, name: group.name },
    });
    return NextResponse.json({ ok: true, data: { sent: true } });
  });
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/app/api/wecom-admin-routes.test.ts`
Expected: PASS —— 6 passed。

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5: 提交**

```bash
git add app/api/admin/wecom lib/audit-format.ts tests/unit/app/api/wecom-admin-routes.test.ts
git commit -m "feat(wecom): add the admin routes for the groups and the history [2026-11-18 HH.MM]"
```

---

## Task 10: 后台页面

**Files:**
- Create: `app/admin/wecom/page.tsx`
- Create: `components/admin/WecomWebhookForm.tsx`
- Create: `components/admin/WecomDeliveryHistory.tsx`
- Modify: `components/admin/AdminSidebar.tsx`
- Test: `tests/unit/lib/wecom-admin-page.test.ts`

**Interfaces:**
- Consumes: Task 9 的 4 个路由；Task 2 的 `WECOM_CATEGORIES`、`WECOM_CATEGORY_LABELS`
- Produces: 后台页面 `/admin/wecom` + 侧边栏入口

- [ ] **Step 1: 写会红的测试**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('the WeCom admin page', () => {
  it('exists', () => {
    expect(() => readSource('app/admin/wecom/page.tsx')).not.toThrow();
  });

  it('is reachable from the admin sidebar', () => {
    const sidebar = readSource('components/admin/AdminSidebar.tsx');
    expect(sidebar).toContain('/admin/wecom');
  });

  it('is dynamic — the group list is read per request', () => {
    // The groups change in the database, not at build time.
    expect(readSource('app/admin/wecom/page.tsx')).toContain("dynamic = 'force-dynamic'");
  });

  it('warns that the forwarding needs the scheduler', () => {
    // The delivery task runs in the scheduler tick. If the scheduler is
    // off, the messages queue up and never leave. The admin has to know.
    const page = readSource('app/admin/wecom/page.tsx');
    expect(page).toContain('scheduler');
  });

  it('offers a checkbox for every category', () => {
    const form = readSource('components/admin/WecomWebhookForm.tsx');
    expect(form).toContain('WECOM_CATEGORIES');
    expect(form).toContain('WECOM_CATEGORY_LABELS');
  });

  it('shows the webhook URL in the clear', () => {
    // The product decision: the admin sees the URL. It is not masked.
    const form = readSource('components/admin/WecomWebhookForm.tsx');
    expect(form).toContain('webhookUrl');
  });
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npx vitest run tests/unit/lib/wecom-admin-page.test.ts`
Expected: FAIL —— 页面不存在。

- [ ] **Step 3: 实现**

**`app/admin/wecom/page.tsx`**：

```tsx
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { WecomWebhookForm } from '@/components/admin/WecomWebhookForm';
import { WecomDeliveryHistory } from '@/components/admin/WecomDeliveryHistory';
import { listWebhooks } from '@/lib/wecom-webhooks';

export const dynamic = 'force-dynamic';

export default async function AdminWecomPage() {
  const webhooks = await listWebhooks();
  return (
    <div>
      <PageHeader
        title="企业微信"
        description="把站点的通知转发到企业微信群。每个群自己勾选要收哪几类通知。"
      />
      <div className="space-y-4">
        <Panel title="转发设置">
          <p className="text-sm text-ink-soft mb-3">
            转发由后台的定时任务（scheduler）推送，每分钟一次。如果 scheduler 没有启用，消息会一直排队而不会发出 ——
            请到「定期更新」页面确认它已开启。
          </p>
          <WecomWebhookForm initial={webhooks} />
        </Panel>
        <WecomDeliveryHistory />
      </div>
    </div>
  );
}
```

⚠️ **`Panel` 的 props 已核实**（`components/admin/Panel.tsx`）：`title?: ReactNode` / `description?: ReactNode` / `actions?: ReactNode` / `children: ReactNode` / `className?: string` / `flush?: boolean`。⚠️ **`title` 是可选的**，`Panel` 只在 `title != null || actions != null` 时才渲染标题行 —— 传了 `title` 就有标题。

⚠️ **本仓库没有 `text-muted` 这个类** —— 用 `text-ink-soft`（次要文字）或 `text-ink-faint`（最弱）。`text-muted` 在这个代码库里一次都没出现过，用了就是一个死类，Tailwind 不会报错，样式也不会生效。

⚠️ **侧边栏里那个页面叫「定期更新」，不叫「定时任务」** —— `components/admin/AdminSidebar.tsx` 的「运维」组里是 `{ href: '/admin/scheduler', label: '定期更新' }`。提示文案要跟界面上的名字一致，否则管理员按提示找不到那个页面。

**`components/admin/WecomWebhookForm.tsx`** —— 一个 client component：

- `'use client';` 在第一行。
- `initial: WecomWebhook[]` 作为 prop。
- 列出每个群：名称输入、webhook URL 输入（**明文，不掩码**）、启用开关、8 个类别的复选框（`WECOM_CATEGORIES.map` + `WECOM_CATEGORY_LABELS`）。
- 「新增群」按钮 —— 新建的群默认 `enabled: false`、类别用 `WECOM_DEFAULT_CATEGORIES`。
- 保存 ⇒ `POST`（新增）或 `PUT`（修改）/ `DELETE`（删除）到 `/api/admin/wecom/webhooks`。
- 「测试」按钮 ⇒ `POST /api/admin/wecom/test`，结果用 `alert` 或页面内提示显示。
- ⚠️ `WECOM_CATEGORIES` 和 `WECOM_CATEGORY_LABELS` 是**从 `@/lib/wecom-types` import 的** —— 那个文件没有 `server-only`，可以进 client bundle。

**`components/admin/WecomDeliveryHistory.tsx`** —— client component：

- `useEffect` 拉 `GET /api/admin/wecom/deliveries?limit=50`。
- 表格列：时间、群名、类别、标题、状态、尝试次数、错误。
- 状态用中文：待推 / 已发送 / 失败。
- 失败的行有「重推」按钮 ⇒ `POST /api/admin/wecom/retry`。

**`components/admin/AdminSidebar.tsx`** —— 加进「**通讯**」组（那一组已经有「邮件」「营销邮件」「留言笔记」「留言通知邮箱」）。企业微信转发就是一个通讯通道，放在邮件旁边是对的。

那一组现在是：

```tsx
  {
    label: '通讯',
    items: [
      { href: '/admin/email', label: '邮件', exact: true, icon: Mail },
      { href: '/admin/email/campaigns', label: '营销邮件', icon: Send },
      { href: '/admin/notes', label: '留言笔记', icon: MessageSquare },
      { href: '/admin/settings/notes', label: '留言通知邮箱', icon: Bell },
    ],
  },
```

在「邮件」**之后**加一行：

```tsx
      { href: '/admin/wecom', label: '企业微信', exact: true, icon: MessageSquare },
```

⚠️ **icon 用 `MessageSquare`** —— 它已经在文件的 lucide import 里了（「留言笔记」在用）。⚠️ **不要重复 import 一个已经有的图标名**，那会让 ESLint 报 `no-duplicate-imports`；也不必为了换一个图标去动 import 块。⚠️ `exact: true` —— `/admin/wecom` 没有子页面，但加上它和「邮件」的写法一致。

⚠️ **侧边栏的分组是折叠的**（`ADMIN_NAV_GROUPS` 的每一组都可以折叠，「有当前页面的那一组会自动展开」），加一项不会让导航变长。⚠️ 项目记忆里的「≤10 项平铺」指的是**顶栏**（`app/layout.tsx` 的公开导航），**不是**这个分组侧边栏 —— 后台侧边栏本来就是分组的。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npx vitest run tests/unit/lib/wecom-admin-page.test.ts`
Expected: PASS —— 6 passed。

⚠️ **这一步必须 build**（动了 `app/**/page.tsx`）：

```bash
# 先停掉占用 4444 的 dev server，否则 build 会失败
npm run build
```
Expected: build 成功，无错误。

- [ ] **Step 5: 提交**

```bash
git add app/admin/wecom components/admin/WecomWebhookForm.tsx components/admin/WecomDeliveryHistory.tsx components/admin/AdminSidebar.tsx tests/unit/lib/wecom-admin-page.test.ts
git commit -m "feat(wecom): add the admin page for the groups and the history [2026-11-18 HH.MM]"
```

---

## Task 11: 端到端验证与缺口补齐

**Files:**
- Modify: 可能需要改前面任何任务的文件（按实测结果）
- Test: `tests/unit/lib/wecom-e2e.test.ts`

**Interfaces:**
- Consumes: 前面所有任务的产物
- Produces: 一条从「通知产生」到「队列有行」的完整链路测试

- [ ] **Step 1: 写会红的端到端测试**

这条测试走**真实的入队路径**，用 mock 的 DB：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock('@/lib/smtp-config', () => ({
  getMailTransport: vi.fn(async () => 'smtp'),
  getSmtpConfig: vi.fn(async () => ({
    transport: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'u',
    pass: 'p',
    from: 'a@example.com',
    fromName: 'A',
  })),
}));

vi.mock('@/lib/wecom-webhooks', () => ({
  webhooksForCategory: vi.fn(async () => [
    {
      id: 7,
      name: 'ops',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
      enabled: true,
      categories: ['notes_notification'],
    },
  ]),
}));

// nodemailer must never open a socket in a unit test.
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: (...args: unknown[]) => sendMailMock(...args) })),
  },
}));

import { sendEmail } from '@/lib/email';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test' });
  queryMock.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
});

/**
 * Wait until the fire-and-forget queue write has landed.
 *
 * ⚠️ `sendEmail()` queues the forwarding with `void promise.catch(...)` — it
 * does NOT await it, on purpose: the request path must not wait for the
 * queue. So `await sendEmail(...)` returns BEFORE the INSERT happens, and
 * asserting on `queryMock.mock.calls` right after is a race that passes
 * about half the time. This helper drains the microtask queue until the
 * insert shows up (or the attempts run out).
 */
async function waitForQueueInsert(): Promise<unknown[][]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const inserts = queryMock.mock.calls.filter((call) =>
      String(call[0]).includes('INSERT INTO wecom_deliveries'),
    );
    if (inserts.length > 0) return inserts;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return queryMock.mock.calls.filter((call) =>
    String(call[0]).includes('INSERT INTO wecom_deliveries'),
  );
}

describe('a notification travels from the mailer into the queue', () => {
  it('writes a queue row with the category, the title and the body', async () => {
    await sendEmail({
      to: 'admin@example.com',
      subject: '新留言： somebody',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });

    const inserts = await waitForQueueInsert();
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1] as unknown[];
    expect(params).toContain(7);
    expect(params).toContain('notes_notification');
    expect(params).toContain('新留言： somebody');
    expect(params).toContain('正文');
  });

  it('writes one queue row per matching group', async () => {
    // Two groups want this category ⇒ two rows, one per group.
    const { webhooksForCategory } = await import('@/lib/wecom-webhooks');
    vi.mocked(webhooksForCategory).mockResolvedValue([
      {
        id: 7,
        name: 'ops',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
        enabled: true,
        categories: ['notes_notification'],
      },
      {
        id: 8,
        name: 'dev',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=def',
        enabled: true,
        categories: ['notes_notification'],
      },
    ]);

    await sendEmail({
      to: 'admin@example.com',
      subject: '标题',
      html: '<p>正文</p>',
      text: '正文',
      template: 'notes_notification',
    });

    const inserts = await waitForQueueInsert();
    expect(inserts).toHaveLength(2);
    const webhookIds = inserts.map((call) => (call[1] as unknown[])[0]);
    expect(webhookIds).toEqual([7, 8]);
  });
});
```

- [ ] **Step 2: 跑测试，确认它绿（它应当已经绿 —— 这是对前面任务的验证，不是新功能）**

Run: `npx vitest run tests/unit/lib/wecom-e2e.test.ts`
Expected: PASS —— 2 passed。

⚠️ **如果它红了，说明前面的任务有一个接口没接上 —— 修那个接口，不要改这条测试。**

⚠️ **`webhooksForCategory` 的 mock 必须是 `mockResolvedValue` 而不是 `mockResolvedValueOnce`** —— `enqueueWecomNotification` 对每个群插一行，第二个用例要两个群。

- [ ] **Step 3: 跑全套测试**

Run: `npm test`
Expected: 全绿，0 失败。

- [ ] **Step 4: 跑类型检查和 lint**

Run: `npx tsc --noEmit`
Expected: 无输出。

Run: `npx eslint lib/wecom-types.ts lib/wecom-webhooks.ts lib/wecom-deliver.ts app/api/admin/wecom components/admin/WecomWebhookForm.tsx components/admin/WecomDeliveryHistory.tsx app/admin/wecom`
Expected: 0 errors。

- [ ] **Step 5: 跑字体闸门（确认没有牵连）**

Run: `npm run fonts:verify-webfont`
Expected: 0 error(s)。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "test(wecom): cover the notification to queue path [2026-11-18 HH.MM]"
```

---

## 上线清单（不是任务，是交付说明）

实现完成后，服务器上要做的事：

1. **跑迁移** —— `npx tsx scripts/migrate.ts`（两张新表）。
2. **确认 scheduler 开着** —— `scheduler.enabled` 为 true，且 `scheduler.task_wecom_deliver` 为 true。**scheduler 不开，转发就只会排队不推送。**
3. **后台 `/admin/wecom` 建群** —— 填企业微信群机器人的 webhook URL，勾类别，**手动启用**（新群默认 disabled）。
4. **服务器要能出网到 `qyapi.weixin.qq.com`** —— 这是本功能能不能用的前提。
5. **发一条测试消息** —— 点「测试」按钮，确认群里收到。

---

## Self-Review

**1. Spec coverage** —— 逐节核对 spec：

| Spec 节 | 覆盖任务 |
|---|---|
| §3 决策 1（多个群） | Task 3、9、10 |
| §3 决策 2（每群勾类别） | Task 2（白名单）、3（JSON 列 + SQL 过滤）、10（复选框） |
| §3 决策 3（标题一样） | Task 5 `buildWecomMarkdown` |
| §3 决策 4（异步） | Task 4（入队）、5（推送）、6（接入） |
| §3 决策 5（失败隔一分钟推） | Task 5 `WECOM_RETRY_DELAY_MINUTES` + RF2 |
| §3 决策 6（URL 明文存） | Task 1（`webhook_url VARCHAR(512)`）、3 |
| §3 决策 7（管理员看得见） | Task 10（明文显示） |
| §4 架构 | Task 4、5、8 |
| §4.1 重试上限 20 | Task 5 `WECOM_MAX_ATTEMPTS` + RF3 |
| §5 类别清单（8 个） | Task 2 |
| §6 企业微信 API 调用 | Task 5 |
| §7 后台界面（4 个 API） | Task 9、10 |
| §8 接入 8 个产生点 | Task 6（`sendEmail()` 统一接入）+ Task 7（补 2 个 key） |
| §9 失败与可观测性 | Task 4（catch+日志）、5（last_error+attempts）、9（审计） |
| §10 安全（SSRF/密码重置链接） | Task 2 `isValidWebhookUrl` + RF4；`WECOM_DEFAULT_CATEGORIES` 不含 `password_reset` |

**无缺口。**

**2. Step scan** —— 每个步骤都能让实现者写出唯一合理的东西：测试步骤给出测试名和断言；代码步骤给出签名、文件和固定值；验证步骤给出命令和期望输出。没有 TBD、没有「酌情处理」。

**3. Type consistency** —— 跨任务的名字：
- `WecomCategory` / `WecomWebhook` / `WecomDelivery` —— Task 2 定义，Task 3/4/5/9/10 消费，一致。
- `enqueueWecomNotification` —— Task 4 定义，Task 6 消费，一致。
- `pushWecomDelivery` / `runWecomDeliver` / `buildWecomMarkdown` —— Task 5 定义，Task 8/9 消费，一致。
- `WECOM_MAX_ATTEMPTS` / `WECOM_RETRY_DELAY_MINUTES` —— Task 5 定义并被 Task 5 的测试消费，一致。
- `runWecomDeliverTask`（scheduler 任务）vs `runWecomDeliver`（推送循环）—— **刻意不同名**，避免撞名。
- `listWebhooks` / `createWebhook` / `updateWebhook` / `deleteWebhook` / `webhooksForCategory` —— Task 3 定义，Task 9 消费，一致。

**4. Review Focus** —— 六行都有测试钉住，且放在拥有该代码的任务里：

| Focus | 任务 | 测试 |
|---|---|---|
| RF1 一类通知推三个群 ⇒ 三行 | Task 4 | `writes one row per matching group` |
| RF2 重试间隔从失败时刻算 | Task 5 | `pushes a failed message one minute later, not right away` |
| RF3 20 次后停 | Task 5 | `stops retrying after the attempt limit` |
| RF4 URL 必须是企业微信 | Task 2 | `the webhook URL guard` 四条 |
| RF5 errcode != 0 是失败 | Task 5 | `treats a WeCom error code as a failure` |
| RF6 后台开关勾上要生效（zod 静默丢键） | Task 8 | `is accepted by the admin config schema` + `is listed in the task labels of the scheduler panel` |

**5. Proportion** —— 计划比 spec 短：spec 是散文，计划是签名+断言+命令。没有把实现抄成代码块，只有 SQL 迁移、类型定义和几个核心函数给了完整体（因为它们是其它任务依赖的契约）。11 个任务，每个都有独立的可测产出。

**⚠️ 剩下三个实施者必须自己解决的点**（计划里已核实并写死的就不算）：

1. **`components/admin/SchedulerPanel.tsx` 里那个 `TASK_LABELS` 表的渲染方式** —— 是遍历 `Object.entries(TASK_LABELS)` 还是遍历一个写死的数组？加进 `Pick<>` 之后，渲染那部分要不要跟着改，取决于这个。**读那个文件。**
2. **`app/api/admin/scheduler/route.ts` 的 `Pick<>` 联合类型** —— Task 8 已经写清了要加什么，不用猜。
3. **`components/admin/WecomWebhookForm.tsx` 和 `WecomDeliveryHistory.tsx` 的具体交互** —— 计划给了必须有的元素（明文 URL、8 个复选框、测试按钮、历史表格），但布局和状态管理是实现者的自由度。

**⚠️ 计划里所有「先读那个文件确认」的地方，答案都已经写进计划了**（`Panel` 的 props、`AdminSidebar` 的组和图标、`email/test` 的字段、`SchedulerPanel` 的 `TASK_LABELS`）—— 那些是给实现者的确认，不是给实现者的谜题。
