# Membership + PayPal 集成 — 设计文档

**目标**: 给站点加会员体系。v1 范围:管理员手动开通(原 Section 1 设计保留) + 可编辑的 4 档套餐(月度/年度 × USD/CNY) + 通过 PayPal Sandbox/Live 跑通的美元支付流程 + 用户购买页 + /profile 状态展示 + 4 个 feature 权限位(只实际接入 AI endpoint 一处,v1 其他位预留)。

**架构**: Server Components 为主,checkout 按钮是 'use client' 小岛;webhook 是签名校验后的无状态 handler;OAuth token 用 module-level cache 以 `(mode + clientId)` 为 key;权限检查走 React `cache()` 单次请求内去重。

**技术栈**: Next.js 15 (App Router), TypeScript, mysql2, Tailwind v4, zod, vitest + jsdom, `react.cache`, `node:fs/promises`。**无新第三方 SDK** — PayPal 直接走 fetch + REST。

---

## 1. 背景与目标

### 现状

- `users` 表已存 8105 行,认证 / 审计 / admin 体系完整
- `audit_log` 表支持 JSON metadata, `writeAudit()` 写审计
- `app_config` 表存键值配置(已有 TTS/AI 配置复用)
- admin 侧已有 `/admin/users`, `/admin/chars`, `/admin/tts`, `/admin/ai` 模板可参考
- 用户侧 `/profile` 已有结构,只缺会员状态卡
- 用户侧 `/dictionary/[char]` 字典页 / `/pinyin` / `/worksheet` 等功能已上线,尚未做任何配额或付费墙
- 没有支付相关代码

### 目标

### 后台
1. `/admin/memberships` — 会员列表 + 统计(总人数 / 活跃 / 本月新增 / 本月收入)+ 手动开通 drawer
2. `/admin/memberships/plans` — 4 档套餐的可编辑表格(显示名/时长/金额/启用/排序/权限)
3. `/admin/memberships/config` — PayPal 凭据(mode + client_id + secret + webhook_id)+ 测试连接按钮
4. 侧边栏 "会员" 入口

### 用户
5. `/membership` — 套餐对比 + "立即开通" 按钮(登录后可用)
6. `/membership/success` — 轮询订单状态,展示开通成功
7. `/membership/cancel` — 静态取消页
8. `/profile` 顶部加 "会员状态" 卡(active 显示到期日,非 active 显示 "开通会员" CTA)

### 数据
9. 3 张新表(`membership_plans`, `membership_plan_features`, `payment_orders`)+ `memberships` 表(原 Section 1)+ `memberships.source_payment_order_id` 列(去重 webhook 幂等性)
10. 4 档套餐种子数据(CNY 默认 disabled)
11. 4 个 feature 枚举 + 16 行默认 feature 关联(每档套餐 4 个 feature)
12. 6 个新 audit 事件类型

### v1 不做 (YAGNI)

- 订阅自动续费(无 PayPal Subscriptions API)
- Stripe / 微信支付 / 支付宝
- PayPal disputes / refunds API(admin 用手动 revoke)
- 邮件 / 推送通知
- 多币种换汇
- 部分周期升级 prorate
- 套餐删除(admin 只能 disable,保留 FK 完整性)
- 第 5 档套餐创建 UI
- 免费层使用配额(只有 AI endpoint 接入 feature 检查,其他接口保持开放)
- 退款流程
- 分析 / 埋点
- 货币显示本地化切换
- 公开 API

---

## 2. 数据模型

### 新表: `membership_plans`

```sql
CREATE TABLE IF NOT EXISTS membership_plans (
  id BIGINT NOT NULL AUTO_INCREMENT,
  plan_key VARCHAR(32) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  duration_days INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency ENUM('CNY','USD') NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_key (plan_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 新表: `membership_plan_features`

```sql
CREATE TABLE IF NOT EXISTS membership_plan_features (
  plan_id BIGINT NOT NULL,
  feature_key VARCHAR(32) NOT NULL,
  PRIMARY KEY (plan_id, feature_key),
  CONSTRAINT fk_mpf_plan FOREIGN KEY (plan_id)
    REFERENCES membership_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`feature_key` 是 TS 层 enum:

```ts
type MembershipFeature =
  | 'unlimited_history'
  | 'download_pdf'
  | 'ai_calls'
  | 'priority_tts';
```

### 新表: `payment_orders`

```sql
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL,
  paypal_order_id VARCHAR(64) NOT NULL,
  status ENUM('created','approved','paid','failed','expired') NOT NULL DEFAULT 'created',
  amount DECIMAL(10,2) NOT NULL,
  currency ENUM('CNY','USD') NOT NULL,
  approval_url VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_paypal_order (paypal_order_id),
  KEY idx_po_user (user_id, created_at DESC),
  CONSTRAINT fk_po_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 修改: `memberships` 表(原 Section 1)

```sql
ALTER TABLE memberships
  ADD COLUMN plan_key VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER user_id,
  ADD COLUMN source ENUM('manual','paypal') NOT NULL DEFAULT 'manual' AFTER plan_key,
  ADD COLUMN amount DECIMAL(10,2) NULL AFTER source,
  ADD COLUMN currency ENUM('CNY','USD') NULL AFTER amount,
  ADD COLUMN source_payment_order_id BIGINT NULL AFTER currency,
  ADD UNIQUE KEY uk_source_payment_order (source_payment_order_id);

ALTER TABLE memberships
  ADD CONSTRAINT fk_memberships_payment_order
  FOREIGN KEY (source_payment_order_id) REFERENCES payment_orders(id) ON DELETE SET NULL;
```

`UNIQUE` on `source_payment_order_id` 保证 webhook 幂等 — 重复 webhook 触发 `ER_DUP_ENTRY`,handler 捕获后 noop。

(原 Section 1 的 `plan ENUM('monthly','yearly')` 由 `plan_key VARCHAR` 替代,覆盖更灵活。)

### 种子数据

```ts
const SEED_PLANS = [
  { plan_key: 'monthly_usd', display_name: '月度会员',  duration_days: 30,  amount: '3.00',   currency: 'USD', enabled: 1, display_order: 1 },
  { plan_key: 'yearly_usd',  display_name: '年度会员',  duration_days: 365, amount: '15.00',  currency: 'USD', enabled: 1, display_order: 2 },
  { plan_key: 'monthly_cny', display_name: '月度会员',  duration_days: 30,  amount: '15.00',  currency: 'CNY', enabled: 0, display_order: 3 },
  { plan_key: 'yearly_cny',  display_name: '年度会员',  duration_days: 365, amount: '100.00', currency: 'CNY', enabled: 0, display_order: 4 },
];

const ALL_FEATURES = ['unlimited_history', 'download_pdf', 'ai_calls', 'priority_tts'];
// 4 plans × 4 features = 16 rows in membership_plan_features
```

CNY 计划默认 enabled=0,等以后接微信/支付宝时改 1。

---

## 3. API

### Admin

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/api/admin/memberships/plans` | `?enabledOnly=` | `{ items, total }` |
| `PATCH` | `/api/admin/memberships/plans/[id]` | `{ displayName?, durationDays?, amount?, enabled?, displayOrder?, features? }` | `{ plan }` |
| `POST` | `/api/admin/memberships/plans/seed` | — | `{ seeded: 4 }` |
| `GET` | `/api/admin/paypal/config` | — | `{ mode, hasClientId, hasSecret, hasWebhookId, webhookUrl }` (secrets masked) |
| `PUT` | `/api/admin/paypal/config` | `{ mode?, clientId?, clientSecret?, webhookId? }` | `{ ok }` |
| `POST` | `/api/admin/paypal/test-connection` | — | `{ ok, message }` |
| `GET` | `/api/admin/memberships` | `?userId=&status=&plan=&page=&pageSize=` | `{ items, total, page, pageSize }` |
| `POST` | `/api/admin/memberships` | `{ userId, planKey, currency, note? }` | `{ id, expiresAt }` |
| `POST` | `/api/admin/memberships/[id]/revoke` | `{ reason? }` | `{ id, revokedAt }` |

PATCH empty string = "no change"(zod 用 `.optional()` + 手动过滤)。

### User

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/membership/plans` | — | `{ items: PublicPlan[] }` (enabled only) |
| `POST` | `/api/membership/checkout` | `{ planKey }` | `{ approvalUrl, orderId }` |
| `GET` | `/api/membership/orders/[id]` | — | `{ status, planDisplayName }` |
| `GET` | `/api/membership/me` | — | `{ active, plan?, expiresAt?, expiresInDays? }` |

`/membership/me` 单 endpoint,登录态即可;admin 不单独走(他们查的是 `/admin/memberships`)。

### Webhook

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/webhooks/paypal` | PayPal event | `{ ok }` |

Public,但必须通过 `verify-webhook-signature` 才处理。返回 200 即使 event_type 未识别(避免 PayPal 无限重试)。

### Checkout flow (`POST /api/membership/checkout`)

1. zod 验证 body,按 `planKey` 查 plan → 404 if `!enabled`
2. 拿 PayPal access token(50min TTL,key = `mode+clientId`)
3. `POST {PAYPAL_API}/v2/checkout/orders`
   ```json
   { "intent": "CAPTURE",
     "purchase_units": [{
       "amount": { "currency_code": "USD", "value": "3.00" },
       "description": "月度会员" }],
     "application_context": {
       "return_url": "https://<host>/membership/success",
       "cancel_url": "https://<host>/membership/cancel" }}
   ```
4. `INSERT payment_orders (status='created', paypal_order_id, approval_url)`
5. 返回 `{ approvalUrl, orderId }`(orderId = `payment_orders.id`,客户端用它轮询 `/api/membership/orders/[id]`)

### Webhook flow (`POST /api/webhooks/paypal`)

1. 读 raw body (不 parse,签名校验需要原始字节)
2. `POST {PAYPAL_API}/v1/notifications/verify-webhook-signature` → 不通过 401 + 写 `paypal_webhook_rejected` 审计
3. parse event,按 `event_type` switch:
   - `CHECKOUT.ORDER.APPROVED` → UPDATE payment_orders status='approved',然后 `POST /v2/checkout/orders/{id}/capture`
   - `PAYMENT.CAPTURE.COMPLETED` → 通过 `paypal_order_id` 查 payment_orders → UPDATE status='paid', paid_at=NOW() → 调 `grantMembership({ source: 'paypal', sourcePaymentOrderId, grantedBy: null })`,捕获 `ER_DUP_ENTRY` 视为幂等 noop
4. 写 `paypal_webhook_received` 审计

### Lib 模块

#### `lib/membership.ts`

```ts
export type MembershipPlan = 'monthly' | 'yearly';
export type MembershipCurrency = 'CNY' | 'USD';
export const PLAN_KEYS = ['monthly_usd', 'yearly_usd', 'monthly_cny', 'yearly_cny'] as const;
export type PlanKey = typeof PLAN_KEYS[number];
export type MembershipFeature =
  | 'unlimited_history' | 'download_pdf' | 'ai_calls' | 'priority_tts';

export interface MembershipPlanRow { /* full row incl. features[] */ }

// Plans
export async function listPlans(opts?: { enabledOnly?: boolean }): Promise<MembershipPlanRow[]>;
export async function getPlanByKey(key: PlanKey): Promise<MembershipPlanRow | null>;
export async function getPlanById(id: number): Promise<MembershipPlanRow | null>;
export async function updatePlan(id: number, patch: PlanPatch): Promise<MembershipPlanRow>;
export async function seedDefaultPlans(): Promise<number>;

// Granting
export interface GrantMembershipArgs {
  targetUserId: number; planKey: PlanKey;
  note?: string | null;
  grantedBy: number | null;
  source: 'manual' | 'paypal';
  sourcePaymentOrderId?: number | null;
}
export async function grantMembership(args: GrantMembershipArgs): Promise<{ id: number; expiresAt: Date }>;
// Renewal: extends from current active expires_at if exists, else from NOW()

// Listing / revoking (原 Section 1)
export async function listMemberships(opts): Promise<{ items; total; page; pageSize }>;
export async function revokeMembership(opts): Promise<MembershipRow>;

// User queries
import { cache } from 'react';
export async function getMyActiveMembership(userId: number): Promise<
  | { active: true; planKey: PlanKey; expiresAt: string; expiresInDays: number }
  | { active: false }>;
export const getMyFeatures = cache(async (userId: number): Promise<Set<MembershipFeature>>);
export async function hasFeature(userId: number, feature: MembershipFeature): Promise<boolean>;
```

`hasFeature` 实现:`SELECT 1 FROM memberships m JOIN membership_plan_features f ON f.plan_id = (SELECT id FROM membership_plans WHERE plan_key = m.plan_key) WHERE m.user_id = ? AND m.revoked_at IS NULL AND m.expires_at > NOW() AND f.feature_key = ? LIMIT 1`

`getMyFeatures` 走 React `cache()`,同请求多次调用只执行一次 SELECT。

#### `lib/paypal.ts`

```ts
export type PayPalMode = 'sandbox' | 'live';
export interface PayPalConfig { mode: PayPalMode; clientId: string; clientSecret: string; webhookId: string; }

export async function getPayPalConfig(): Promise<PayPalConfig | null>;
// Reads from app_config; null if any required field missing

export async function getPayPalAccessToken(cfg: PayPalConfig): Promise<string>;
// Module-level cache, key = `${mode}:${clientId}`, TTL 50min

export interface PayPalOrder { id: string; status: string; links: { href: string; rel: string }[]; }
export async function createPayPalOrder(args: {
  amount: string; currency: 'CNY' | 'USD'; description: string;
  returnUrl: string; cancelUrl: string;
}): Promise<PayPalOrder>;

export async function capturePayPalOrder(orderId: string): Promise<unknown>;
export async function verifyWebhookSignature(args: {
  rawBody: string; headers: Record<string, string>;
}): Promise<boolean>;

// Base URL switch on mode
const BASE = (mode: PayPalMode) => mode === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';
```

PayPal 调用统一用 `fetch`(无 SDK),access token 401 自动 refresh 一次。

#### `lib/payment-orders.ts`

```ts
export async function createPaymentOrder(args: { userId; planId; paypalOrderId; amount; currency; approvalUrl }): Promise<number>;
export async function getPaymentOrder(paypalOrderId: string): Promise<PaymentOrder | null>;
export async function updatePaymentOrderStatus(paypalOrderId: string, status: PaymentOrderStatus): Promise<void>;
```

---

## 4. UI

### Admin

| 路径 | 内容 |
|---|---|
| `/admin/memberships` | 4 个统计卡片(总 / 活跃 / 本月新增 / 本月收入) + filter(状态/套餐/user_id/每页) + 表格(时间/用户/套餐/金额/状态/操作 revoke) + 头部 3 个按钮:「手动开通」drawer / 「套餐设置」→ plans / 「支付配置」→ config |
| `/admin/memberships/plans` | 4 行可编辑表格,每行:显示名/时长/金额/启用 toggle/排序/feature chips,单行 PATCH |
| `/admin/memberships/config` | mode 单选 / Client ID(明文)/ Client Secret(完全遮罩)/ Webhook ID / Webhook URL(只读复制)/ 状态指示器 / 「测试连接」按钮 |

侧边栏 `AdminSidebar.tsx` 加 `{ href: '/admin/memberships', label: '会员' }`,放在 "字典 / 字源" 之后。

### User

| 路径 | 内容 |
|---|---|
| `/membership` | 顶部状态徽章(登录后) + 已启用套餐 grid(按 display_order 排序) + 每卡:显示名/时长/`¥/$`金额/feature 列表 + 「立即开通」按钮 → 调 checkout API → 跳 PayPal |
| `/membership/success` | 客户端组件,每 2s 轮询 `/api/membership/orders/[id]`(max 30s),状态:等待确认/已开通/失败 |
| `/membership/cancel` | 静态文案 + 回 `/membership` 链接 |
| `/profile` | 顶部加 `MembershipStatusCard` 卡(active 显示到期日,非 active 显示 CTA) |

`Header.tsx` 加 "会员" 链接(仅登录用户)。

### 新增文件清单

| 文件 | LoC(估) |
|---|---|
| `app/admin/memberships/page.tsx` | 250 |
| `app/admin/memberships/plans/page.tsx` | 200 |
| `app/admin/memberships/config/page.tsx` | 180 |
| `app/api/admin/memberships/route.ts` | 90 |
| `app/api/admin/memberships/[id]/revoke/route.ts` | 50 |
| `app/api/admin/memberships/plans/route.ts` | 50 |
| `app/api/admin/memberships/plans/[id]/route.ts` | 70 |
| `app/api/admin/memberships/plans/seed/route.ts` | 25 |
| `app/api/admin/paypal/config/route.ts` | 90 |
| `app/api/admin/paypal/test-connection/route.ts` | 40 |
| `app/api/membership/plans/route.ts` | 25 |
| `app/api/membership/checkout/route.ts` | 70 |
| `app/api/membership/orders/[id]/route.ts` | 40 |
| `app/api/membership/me/route.ts` | 35 |
| `app/api/webhooks/paypal/route.ts` | 130 |
| `app/membership/page.tsx` | 120 |
| `app/membership/success/page.tsx` | 80 |
| `app/membership/cancel/page.tsx` | 20 |
| `components/admin/memberships/PlanRow.tsx` | 120 |
| `components/admin/memberships/ManualGrantDrawer.tsx` | 150 |
| `components/admin/memberships/RevokeButton.tsx` | 60 |
| `components/membership/PlanCard.tsx` | 80 |
| `components/membership/MembershipBadge.tsx` | 30 |
| `components/membership/CheckoutButton.tsx` | 60 |
| `components/membership/MembershipStatusCard.tsx` | 50 |
| `lib/membership.ts` | 280 |
| `lib/membership-stats.ts` | 60 |
| `lib/paypal.ts` | 180 |
| `lib/payment-orders.ts` | 50 |
| `scripts/migrate-membership.ts` | 100 |

**合计 ≈ 2785 LoC / 29 个新文件**

---

## 5. 错误处理 & 边界

| 场景 | 处理 |
|---|---|
| 未登录访问 `/membership` | 重定向 `/?auth=login&next=/membership` |
| 套餐 disabled 时点 Buy | 前端隐藏按钮;若 UI 过期 API 返 404 |
| PayPal OAuth 失败 | 返回 `paypal_unavailable`,admin 端在 logs 看到 |
| Webhook 签名校验失败 | 401 + 写 `paypal_webhook_rejected` 审计 |
| Webhook 收到未知 `paypal_order_id` | 200 noop (PayPal retry-safe) |
| `grantMembership` 重复 (webhook 重发) | UNIQUE on `source_payment_order_id` 触发 `ER_DUP_ENTRY`,handler 捕获视为幂等 |
| 用户已有 active 会员,再购买 | 允许,过期时间从当前 expires_at 累加(原 Section 1 续费规则) |
| `revokeMembership` 重复 | 409 `already_revoked` |
| PATCH plan `duration_days < 1` | zod 拒 |
| `payment_orders` 数据增长 | 不清理,只查询带 index |
| 用户改货币选 USD 但 plan 是 CNY | zod 校验 plan.currency 必须匹配 |
| webhook 在 client redirect 前到达 | success page 轮询 `/api/membership/orders/[id]` 自动跟上 |
| admin 禁用所有 USD plan | `/membership` 显示空状态 |

---

## 6. Audit & 日志

新增 6 个 `AuditEvent`:

| Event | 触发 | userId | metadata |
|---|---|---|---|
| `membership_granted` | 管理员手动开通 | admin.id | `{ targetUserId, planKey, currency, expiresAt }` |
| `membership_granted_paypal` | PayPal webhook 自动开通 | null (系统) | `{ targetUserId, planKey, amount, paymentOrderId }` |
| `membership_revoked` | 管理员撤销 | admin.id | `{ membershipId, targetUserId, reason }` |
| `paypal_config_updated` | 管理员改配置 | admin.id | `{ changed: ['mode','clientId','webhookId'] }` |
| `paypal_webhook_received` | webhook 校验通过 + 处理 | null | `{ event_type, paypal_order_id }` |
| `paypal_webhook_rejected` | 签名校验失败 | null | `{ reason }` |

`app/admin/logs/page.tsx` 的 `EVENT_TYPES` 数组加 6 个新值。

---

## 7. 权限位接入点 (v1)

`hasFeature` 导出,但只在 **AI endpoint** 实际接入:

- `app/api/ai/.../route.ts` POST → 入口处 `await hasFeature(user.id, 'ai_calls')`,非会员返 403 `membership_required`
- 其他 endpoint(history/worksheet 等)暂不接入,v1 留接口

文档说明写在 `lib/membership.ts` 顶部注释,提示未来扩展点。

---

## 8. 迁移 / 部署

新脚本 `scripts/migrate-membership.ts`(运行后删除),按顺序执行:

1. `CREATE TABLE IF NOT EXISTS membership_plans`
2. `CREATE TABLE IF NOT EXISTS membership_plan_features`
3. `CREATE TABLE IF NOT EXISTS payment_orders`
4. `ALTER TABLE memberships ADD COLUMN plan_key ...` 等 5 条(每条前查 `INFORMATION_SCHEMA.COLUMNS` 跳过已存在)
5. `INSERT IGNORE 4 plans`
6. `INSERT IGNORE 16 plan_feature rows`

幂等。运行命令:`pnpm tsx --env-file=.env scripts/migrate-membership.ts`

部署步骤:
1. `pnpm tsc --noEmit` + `pnpm test` 通过
2. 跑迁移
3. commit + push
4. admin 端:首次访问 `/admin/memberships/plans` → 点「重新初始化」(如果迁移没跑 plan seed 兜底)

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| PayPal sandbox 临时故障 | 集成测试用 mock,manual smoke 可推迟 |
| Webhook 需公网 URL | 文档提供 ngrok 步骤,prod 用真域名 |
| token 缓存跨 mode 切换失效 | key 含 `mode+clientId`,切 mode 立即失效 |
| 金额浮点精度 | `DECIMAL(10,2)` + 字符串传输 + 客户端 `toFixed(2)` |
| 用户连点 Buy 两次 | 两个 `payment_orders` 行都会创建,但 webhook 处理时第二个会被 UNIQUE 约束捕获为幂等 noop |
| Webhook 先于 client redirect | success page 轮询订单状态,自动捕获 |
| 手动开通与 PayPal 流程并行 | 都允许;续费规则统一;双方都审计 |
| `hasFeature` 高频调用 | React `cache()` 单请求内去重,1 个 SELECT |
| feature_key 扩展 | TS enum 是契约,加 feature 只需 INSERT 一行 + 加 enum 成员 |
| admin 禁用全部 USD plan | `/membership` 友好空态,引导联系客服 |

---

## 10. 里程碑 (4 阶段独立部署)

1. **M1 — DB + 手动开通**:表 + grantMembership + `/admin/memberships` + audit ≈ 800 LoC
2. **M2 — 套餐编辑 + PayPal 配置 UI**:`/admin/memberships/plans` + `/admin/memberships/config` + `lib/paypal.ts` token + 连接测试 ≈ 700 LoC
3. **M3 — 用户购买 + webhook**:`/membership` + checkout + webhook + success/cancel + `/profile` + `hasFeature` 接入 AI endpoint ≈ 1200 LoC。**这里 sandbox 端到端跑通**
4. **M4 (可选) — feature 接入扩展**:`hasFeature` 接入更多 endpoint(histroy limit / PDF download)≈ 200 LoC

推荐:一次性把 M1→M2→M3 写在一个 implementation plan 里,M4 留 follow-up。
