# 微信公众号模板消息公告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在后台写一条公告，用服务号模板消息推给公众号的全部关注者。

**Architecture:** 公告落库后由 scheduler tick 发送。发送时先从微信 `user/get` 拉全部关注者 openid，再逐个调 `message/template/send`。微信错误码决定行为：参数错误停手、取关跳过、token 失效刷新重试、超限停手。与邮件群发、企业微信推送完全平行 —— 各自一张表、各自一个 scheduler 任务。

**Tech Stack:** Next.js 15.5.29 App Router / React 19 / TypeScript strict / vitest 4.1.12 / MySQL 8 (mysql2) / Node 原生 `fetch`。**零新增依赖。**

**Spec:** `docs/superpowers/specs/2026-11-20-wechat-official-account-broadcast-spec.md`

## Global Constraints

- **零新增依赖**（硬规则）。用 Node 18+ 原生 `fetch`，不要引入任何微信 SDK。
- **回复用中文；代码 / commit message / UI 文案用英文。**
- **Commit 主题尾加时间戳** `[YYYY-MM-DD HH.MM]`。
- **不自动 push。**
- **禁用 `...` 省略号和空 catch**。全量可粘贴代码，无 stub。空 catch 必须带日志。
- **每个变更接口都要写审计日志**，metadata 带标题。审计事件要加进 **4 个地方**：`AuditEvent` 联合、`AUDIT_EVENTS` 元组、`EVENT_LABEL` 记录、`formatLogMessage`（`tests/unit/lib/audit.test.ts` 会断言元组与 label 完全一致）。
- **查库失败 ⇒ 当未登录（401）fail-closed**，绝不抛。
- **环境依赖类代码光有注入测试不够** —— 微信 API 调用必须有真机验证。
- **所有内容串行执行，不要并行。**
- **`app_secret` 明文存 `app_config`，后台不回显**，空值 = 保持不变（照抄 `smtp.pass` 的处理）。
- **模板 ID 和模板数据字段由管理员在后台填** —— 模板字段名（`keyword1` 还是 `thing1`）是管理员在微信后台选的，代码不能猜。
- **`errcode: 0` 只代表平台接受，不代表用户收到** —— UI 文案必须如实表达。
- **命名**：布尔值以 `is`/`has`/`can` 开头；禁止单字母变量（循环变量除外）。
- **文件大小**：单文件控制在 300-500 行以内。

## Review Focus

下面五类是 spec 暗示、但任何任务的测试都不会自然覆盖的输入 —— 最可能咬到真实用户。每一条都要在下面指定的任务里补上对应测试。

1. **关注者列表跨页** —— `user/get` 单次返回 10000 个，`next_openid` 非空时必须继续拉。**只拉一页 = 静默漏发**。→ Task 3
2. **`errcode: 0` 但 `errmsg` 缺失** —— 微信有时只回 `{"errcode":0}`。不能因为 `errmsg` 是 `undefined` 就判失败。→ Task 3
3. **模板数据里有空的 key** —— 管理员填了 `keyword1=`（空值）。微信的 `thing` 类型不允许空，`47003`。→ Task 2
4. **关注者数量为 0** —— 公众号一个关注者都没有时，`user/get` 返回 `total: 0`。不能当成错误，也不能崩。→ Task 3
5. **`data` 的 key 与模板定义不匹配** —— `47003`。这是参数错误，**必须停手**，不能重试 —— 停手和重试的差别是配额。→ Task 4

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/wechat-types.ts` | 类型、配置键校验、**微信错误码分类**（纯函数，无 IO） |
| `lib/wechat-api.ts` | access_token 获取/缓存、`user/get` 分页、`template/send` 封装。**唯一**调微信接口的地方 |
| `lib/wechat-broadcasts.ts` | 公告的 CRUD + 入队 + 状态更新（只碰数据库） |
| `lib/wechat-config.ts` | 配置读写 + 缓存失效（照抄 `lib/email.ts` 的 `resetSmtpCache` 范式） |
| `app/api/admin/wechat/config/route.ts` | GET / PUT 配置 |
| `app/api/admin/wechat/followers/route.ts` | GET 关注者数量 |
| `app/api/admin/wechat/broadcasts/route.ts` | GET 列表 / POST 新建 |
| `app/api/admin/wechat/broadcasts/[id]/route.ts` | GET 详情 |
| `app/api/admin/wechat/broadcasts/[id]/send/route.ts` | POST 手动发送 |
| `app/api/admin/wechat/broadcasts/[id]/cancel/route.ts` | POST 取消 |
| `app/api/admin/wechat/test/route.ts` | POST 测试消息 |
| `app/admin/wechat/page.tsx` | 后台页面 |
| `components/admin/WechatConfigForm.tsx` | 配置区 |
| `components/admin/WechatBroadcastForm.tsx` | 写公告 |
| `components/admin/WechatBroadcastTable.tsx` | 公告列表 |
| `scripts/migrations/2026-11-20-wechat-broadcast.sql` | `wechat_broadcasts` 表 |

---

### Task 1: The migration

**Files:**
- Create: `scripts/migrations/2026-11-20-wechat-broadcast.sql`
- Test: `tests/unit/scripts/wechat-migration.test.ts`

**Interfaces:**
- Produces: 表 `wechat_broadcasts`，列为 `id, title, template_id, url, data, status, total_recipients, accepted_count, skipped_count, failed_count, last_error, created_by, created_at, updated_at, finished_at`。

- [ ] **Step 1: Write the failing test**

`tests/unit/scripts/wechat-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SQL_PATH = join(process.cwd(), 'scripts/migrations/2026-11-20-wechat-broadcast.sql');

describe('the WeChat broadcast migration', () => {
  it('exists', () => {
    expect(existsSync(SQL_PATH)).toBe(true);
  });

  it('creates the broadcast table', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wechat_broadcasts');
  });

  it('is idempotent — re-running creates nothing twice', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toContain('IF NOT EXISTS');
    expect(sql).not.toMatch(/CREATE TABLE\s+(?!IF NOT EXISTS)/i);
  });

  it('stores the template data as a JSON column', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toMatch(/data\s+JSON\s+NOT NULL/i);
  });

  it('counts the three outcomes separately', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toContain('accepted_count');
    expect(sql).toContain('skipped_count');
    expect(sql).toContain('failed_count');
    expect(sql).toContain('total_recipients');
  });

  it('gives the status column a closed set of values', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toMatch(
      /status\s+ENUM\('draft','queued','sending','sent','failed','cancelled'\)/i,
    );
  });

  it('references the admin who wrote it', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toContain('created_by');
    expect(sql).toContain('FOREIGN KEY (created_by)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scripts/wechat-migration.test.ts`
Expected: FAIL — "exists" fails, because the migration file does not exist yet.

- [ ] **Step 3: Create the migration**

`scripts/migrations/2026-11-20-wechat-broadcast.sql`:

```sql
-- WeChat (微信公众号) template message broadcasts.
--
-- One table:
--   wechat_broadcasts — one row per announcement. The scheduler picks up
--                       the queued ones, pulls the follower list from
--                       WeChat, and sends a template message to each
--                       follower.
--
-- There is deliberately NO per-recipient table. Template messages are
-- sent one openid at a time, but WeChat gives no per-person delivery
-- receipt — a zero errcode means the platform accepted the message, not
-- that anyone received it. A per-recipient log would therefore record
-- N copies of the same low-information fact, and grow linearly with the
-- follower count on every broadcast. Only the counts are kept.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS short-circuits on re-run. The
-- migration runner applies every file on every boot, so this matters.

CREATE TABLE IF NOT EXISTS wechat_broadcasts (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  title            VARCHAR(128)  NOT NULL,
  template_id      VARCHAR(64)   NOT NULL,
  url              VARCHAR(512)  NULL,
  data             JSON          NOT NULL,
  status           ENUM('draft','queued','sending','sent','failed','cancelled')
                                 NOT NULL DEFAULT 'draft',
  total_recipients INT UNSIGNED  NOT NULL DEFAULT 0,
  accepted_count   INT UNSIGNED  NOT NULL DEFAULT 0,
  skipped_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  failed_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  last_error       VARCHAR(1024) NULL,
  created_by       BIGINT        NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  finished_at      DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_wb_status (status, created_at DESC),
  KEY idx_wb_created_by (created_by, created_at DESC),
  CONSTRAINT fk_wb_user FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/scripts/wechat-migration.test.ts`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/2026-11-20-wechat-broadcast.sql tests/unit/scripts/wechat-migration.test.ts
git commit -m "feat(wechat): add the broadcast table [2026-11-20 15.40]"
```

---

### Task 2: The vocabulary and the error classification

**Files:**
- Create: `lib/wechat-types.ts`
- Test: `tests/unit/lib/wechat-types.test.ts`

**Interfaces:**
- Produces:
  - `type WechatBroadcastStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'`
  - `type WechatTemplateValue = { value: string }`
  - `type WechatTemplateData = Record<string, WechatTemplateValue>`
  - `interface WechatBroadcast { id, title, templateId, url, data, status, totalRecipients, acceptedCount, skippedCount, failedCount, lastError, createdBy, createdAt, updatedAt, finishedAt }`
  - `class WechatApiError extends Error` —— 带 `errcode: number`
  - `class WechatTokenError extends WechatApiError` —— token 相关（40001）
  - `class WechatParamError extends WechatApiError` —— 参数类（40003/40037/47003/48001）
  - `class WechatRecipientError extends WechatApiError` —— 收件人侧（43101）
  - `class WechatQuotaError extends WechatApiError` —— 配额（45009）
  - `function classifyWechatError(errcode: number, errmsg: string): WechatApiError`
  - `function validateTemplateData(data: unknown): WechatTemplateData` —— 抛错而不是返回 null
  - `const WECHAT_CONFIG_KEYS` —— `wechat.enabled` / `wechat.app_id` / `wechat.app_secret`
  - `function isValidWechatAppId(value: string): boolean`

**为什么错误码分类单独一个任务**：它是整个功能最容易写错的地方，而且它是**纯函数** —— 可以直接测，不需要 mock 任何东西。先把分类定死，后面两个任务才敢写。

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifyWechatError,
  validateTemplateData,
  isValidWechatAppId,
  WechatParamError,
  WechatQuotaError,
  WechatRecipientError,
  WechatTokenError,
  type WechatTemplateData,
} from '@/lib/wechat-types';

describe('the WeChat error classification', () => {
  it('treats a zero errcode as success and never an error', () => {
    expect(() => classifyWechatError(0, 'ok')).not.toThrow();
  });

  it('classifies 40001 as a token error, so the caller refreshes and retries', () => {
    expect(classifyWechatError(40001, 'invalid credential')).toBeInstanceOf(WechatTokenError);
  });

  it('classifies 43101 as a recipient error, so the caller skips that follower', () => {
    expect(classifyWechatError(43101, 'user refuse to accept the msg')).toBeInstanceOf(
      WechatRecipientError,
    );
  });

  it('classifies 45009 as a quota error, so the caller stops', () => {
    expect(classifyWechatError(45009, 'api freq out of limit')).toBeInstanceOf(WechatQuotaError);
  });

  it('classifies every parameter error as a parameter error', () => {
    // 40003 invalid openid, 40037 invalid template_id,
    // 47003 argument invalid, 48001 api unauthorized
    for (const code of [40003, 40037, 47003, 48001]) {
      expect(classifyWechatError(code, 'x')).toBeInstanceOf(WechatParamError);
    }
  });

  it('keeps the errcode and the message on the error', () => {
    const error = classifyWechatError(40037, 'invalid template_id');
    expect(error.errcode).toBe(40037);
    expect(error.message).toContain('40037');
    expect(error.message).toContain('invalid template_id');
  });

  it('falls back to a generic error for an unknown errcode', () => {
    const error = classifyWechatError(60011, 'no permission');
    expect(error.errcode).toBe(60011);
    expect(error).not.toBeInstanceOf(WechatParamError);
    expect(error).not.toBeInstanceOf(WechatQuotaError);
    expect(error).not.toBeInstanceOf(WechatRecipientError);
    expect(error).not.toBeInstanceOf(WechatTokenError);
  });
});

describe('the template data validation', () => {
  it('accepts a well-formed data object', () => {
    const data = validateTemplateData({
      first: { value: '字·韵公告' },
      keyword1: { value: 'v1.2 已上线' },
    });
    expect(data.first.value).toBe('字·韵公告');
  });

  it('rejects a value that is not an object', () => {
    expect(() => validateTemplateData('nope')).toThrow(/object/i);
  });

  it('rejects a key whose value is missing', () => {
    expect(() => validateTemplateData({ keyword1: {} })).toThrow(/value/i);
  });

  it('rejects an empty value — WeChat rejects an empty thing field with 47003', () => {
    expect(() => validateTemplateData({ keyword1: { value: '' } })).toThrow(/empty/i);
  });

  it('rejects a value that is not a string', () => {
    expect(() => validateTemplateData({ keyword1: { value: 42 } })).toThrow(/string/i);
  });

  it('rejects a key that is not a plain identifier', () => {
    expect(() => validateTemplateData({ 'keyword 1': { value: 'x' } })).toThrow(/key/i);
  });

  it('rejects an empty data object — a template with no fields sends nothing', () => {
    expect(() => validateTemplateData({})).toThrow(/empty/i);
  });
});

describe('the app id validation', () => {
  it('accepts a real-looking app id', () => {
    expect(isValidWechatAppId('wx1234567890abcdef')).toBe(true);
  });

  it('rejects an app id that does not start with wx', () => {
    expect(isValidWechatAppId('1234567890abcdef')).toBe(false);
  });

  it('rejects an app id of the wrong length', () => {
    expect(isValidWechatAppId('wx123')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/wechat-types`.

- [ ] **Step 3: Implement the module**

`lib/wechat-types.ts`:

```ts
/**
 * The WeChat Official Account (微信公众号) vocabulary.
 *
 * Two things live here, and neither of them talks to WeChat:
 *
 *   - the TYPES the rest of the code passes around
 *   - the ERROR CLASSIFICATION, which decides what the sender does when
 *     WeChat says no
 *
 * The classification is a pure function on purpose. It is the part of
 * this feature that is easiest to get wrong, and a pure function is the
 * part that is easiest to be sure about.
 */

/** The lifecycle of one announcement. */
export type WechatBroadcastStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

/** One field of the WeChat template. */
export interface WechatTemplateValue {
  value: string;
}

/** The fields of one WeChat template, keyed by the template's own field names. */
export type WechatTemplateData = Record<string, WechatTemplateValue>;

/** One announcement, as the rest of the code sees it. */
export interface WechatBroadcast {
  id: number;
  title: string;
  templateId: string;
  url: string | null;
  data: WechatTemplateData;
  status: WechatBroadcastStatus;
  totalRecipients: number;
  acceptedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/**
 * A failure from the WeChat API.
 *
 * `errcode` is WeChat's own code. The HTTP status is always 200 — WeChat
 * reports failures in the body, so a 200 says nothing about the outcome.
 */
export class WechatApiError extends Error {
  readonly errcode: number;

  constructor(errcode: number, message: string) {
    super(`WeChat error ${errcode}: ${message}`);
    this.name = 'WechatApiError';
    this.errcode = errcode;
  }
}

/**
 * The access token is missing, expired or wrong.
 *
 * The sender refreshes the token and tries the message once more.
 */
export class WechatTokenError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatTokenError';
  }
}

/**
 * The message itself is wrong — a bad openid, a bad template id, a data
 * key that does not match the template, or a permission that was never
 * granted.
 *
 * ⚠️ RETRYING A PARAMETER ERROR IS ALWAYS WRONG. The same parameters
 * will fail the same way, and every attempt costs one of the daily API
 * calls. The sender stops the whole run.
 */
export class WechatParamError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatParamError';
  }
}

/**
 * This one recipient cannot be reached — they left the account, muted
 * the account, or turned the message off.
 *
 * The sender skips this recipient and keeps going. The other followers
 * still get their message.
 */
export class WechatRecipientError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatRecipientError';
  }
}

/**
 * The daily call quota is spent.
 *
 * The sender stops the whole run and waits for the next tick.
 */
export class WechatQuotaError extends WechatApiError {
  constructor(errcode: number, message: string) {
    super(errcode, message);
    this.name = 'WechatQuotaError';
  }
}

/** The errcodes that mean "the request is wrong". */
const PARAM_ERRCODES: ReadonlySet<number> = new Set([40003, 40037, 47003, 48001]);

/**
 * Turns a WeChat error into the kind of error that says what to do.
 *
 * A zero errcode is success and is never an error — WeChat answers 200
 * with a JSON body, and the body is where the outcome lives.
 */
export function classifyWechatError(errcode: number, errmsg: string): WechatApiError {
  const message = errmsg && errmsg.length > 0 ? errmsg : 'no message';
  if (errcode === 40001) return new WechatTokenError(errcode, message);
  if (errcode === 43101) return new WechatRecipientError(errcode, message);
  if (errcode === 45009) return new WechatQuotaError(errcode, message);
  if (PARAM_ERRCODES.has(errcode)) return new WechatParamError(errcode, message);
  return new WechatApiError(errcode, message);
}

/** The keys a WeChat template field may have. */
const TEMPLATE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * Checks the admin-authored template data.
 *
 * The field names are whatever the admin chose in the WeChat template
 * library — `keyword1`, `thing2`, `first`, `remark` — so the code cannot
 * know them and must not guess. It only checks the shape.
 *
 * @throws Error when the data cannot be sent as it is.
 */
export function validateTemplateData(data: unknown): WechatTemplateData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('the template data must be an object');
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error('the template data is empty — a template with no fields sends nothing');
  }
  const result: WechatTemplateData = {};
  for (const [key, raw] of entries) {
    if (!TEMPLATE_KEY_PATTERN.test(key)) {
      throw new Error(`the template key "${key}" is not a valid field name`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`the template key "${key}" must be an object with a value`);
    }
    const value = (raw as { value?: unknown }).value;
    if (typeof value !== 'string') {
      throw new Error(`the template key "${key}" must have a string value`);
    }
    if (value.trim().length === 0) {
      throw new Error(`the template key "${key}" has an empty value`);
    }
    result[key] = { value };
  }
  return result;
}

/** The config keys this feature owns. */
export const WECHAT_CONFIG_KEYS = {
  enabled: 'wechat.enabled',
  appId: 'wechat.app_id',
  appSecret: 'wechat.app_secret',
} as const;

/**
 * Whether a string looks like a WeChat Official Account app id.
 *
 * An app id is `wx` followed by sixteen lowercase hex characters. The
 * check is a shape check, not a proof — it only stops a typo from
 * becoming a confusing API error.
 */
export function isValidWechatAppId(value: string): boolean {
  return /^wx[0-9a-f]{16}$/.test(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-types.test.ts`
Expected: PASS — 16 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-types.ts tests/unit/lib/wechat-types.test.ts
git commit -m "feat(wechat): name the templates and classify the errors [2026-11-20 15.50]"
```

---

### Task 3: Talking to WeChat

**Files:**
- Create: `lib/wechat-api.ts`
- Test: `tests/unit/lib/wechat-api.test.ts`

**Interfaces:**
- Consumes: `classifyWechatError`, `WechatApiError`, `WechatTokenError`, `WechatParamError`, `WechatRecipientError`, `WechatQuotaError`, `WechatTemplateData` from `@/lib/wechat-types`; `getConfig` from `@/lib/config`.
- Produces:
  - `async function getWechatAccessToken(force?: boolean): Promise<string>`
  - `async function fetchFollowerOpenids(): Promise<string[]>`
  - `async function sendTemplateMessage(openid, templateId, data, url?): Promise<void>` —— 抛 `WechatApiError` 的子类
  - `function resetWechatTokenCache(): void`
  - `const WECHAT_API_BASE = 'https://api.weixin.qq.com'`
  - `const WECHAT_REQUEST_TIMEOUT_MS = 10_000`

**为什么单独一个任务**：这是唯一调微信接口的地方。**只在这里调**，别的地方都不许发 HTTP 请求 —— 这样"微信调用"永远只有一个地方可以出错。

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => configMock(key),
}));

import {
  fetchFollowerOpenids,
  getWechatAccessToken,
  resetWechatTokenCache,
  sendTemplateMessage,
  WECHAT_API_BASE,
} from '@/lib/wechat-api';
import { WechatParamError, WechatRecipientError, WechatTokenError } from '@/lib/wechat-types';

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetWechatTokenCache();
  configMock.mockImplementation((key: string) => {
    if (key === 'wechat.app_id') return 'wx1234567890abcdef';
    if (key === 'wechat.app_secret') return 'the-secret';
    return '';
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('the access token', () => {
  it('asks WeChat for a token and returns it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    const token = await getWechatAccessToken();

    expect(token).toBe('the-token');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/cgi-bin/token');
    expect(url).toContain('grant_type=client_credential');
  });

  it('caches the token — a second call does not hit WeChat again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    await getWechatAccessToken();
    const callsAfterFirst = fetchMock.mock.calls.length;
    await getWechatAccessToken();

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('refetches after the cache is reset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'the-token', expires_in: 7200 }));

    await getWechatAccessToken();
    resetWechatTokenCache();
    await getWechatAccessToken();

    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('throws a token error when WeChat refuses the credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));

    await expect(getWechatAccessToken()).rejects.toThrow(/40013/);
  });
});

describe('the follower list', () => {
  it('returns the openids of one page', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 2, count: 2, data: { openid: ['a', 'b'] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a', 'b']);
  });

  it('follows the next_openid cursor until the list ends', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 3, count: 2, data: { openid: ['a', 'b'] }, next_openid: 'cursor-1' }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 3, count: 1, data: { openid: ['c'] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a', 'b', 'c']);
    expect(String(fetchMock.mock.calls[1][0])).toContain('next_openid=cursor-1');
  });

  it('returns an empty list when the account has no followers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 0, count: 0, data: { openid: [] }, next_openid: '' }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual([]);
  });

  it('tolerates a missing errmsg on a successful response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 1, count: 1, data: { openid: ['a'] } }),
    );

    const openids = await fetchFollowerOpenids();

    expect(openids).toEqual(['a']);
  });

  it('throws when WeChat reports an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }));

    await expect(fetchFollowerOpenids()).rejects.toThrow(/40001/);
  });
});

describe('the template message', () => {
  it('posts the message to the one recipient', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'hello' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/cgi-bin/message/template/send');
    expect(String(url)).toContain('access_token=the-token');
    const body = JSON.parse(String(init.body));
    expect(body.touser).toBe('the-openid');
    expect(body.template_id).toBe('TM00001');
    expect(body.data).toEqual({ keyword1: { value: 'hello' } });
  });

  it('includes the jump url when there is one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }, 'https://example.com/x');

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.url).toBe('https://example.com/x');
  });

  it('omits the jump url when there is none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.url).toBeUndefined();
  });

  it('treats a zero errcode with no errmsg as success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).resolves.toBeUndefined();
  });

  it('throws a recipient error for 43101', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 43101, errmsg: 'user refuse' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatRecipientError);
  });

  it('throws a token error for 40001', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatTokenError);
  });

  it('throws a parameter error for 47003', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 47003, errmsg: 'argument invalid' }));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toBeInstanceOf(WechatParamError);
  });

  it('throws when the HTTP call fails outright', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } }),
    ).rejects.toThrow(/network down/);
  });

  it('never leaks the app secret into the request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await sendTemplateMessage('the-openid', 'TM00001', { keyword1: { value: 'x' } });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('the-secret'))).toBe(false);
  });
});

describe('the api base', () => {
  it('is the official WeChat host', () => {
    expect(WECHAT_API_BASE).toBe('https://api.weixin.qq.com');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-api.test.ts`
Expected: FAIL — cannot resolve `@/lib/wechat-api`.

- [ ] **Step 3: Implement the module**

`lib/wechat-api.ts`:

```ts
/**
 * The one place that talks to WeChat.
 *
 * Every HTTP request to api.weixin.qq.com in this project goes through
 * this file. That is deliberate: when a WeChat call goes wrong there is
 * exactly one file to look at, and no other module can accidentally
 * bypass the token cache, the timeout, or the error classification.
 *
 * Three calls:
 *
 *   - GET  /cgi-bin/token                        — the access token
 *   - GET  /cgi-bin/user/get                     — the follower list
 *   - POST /cgi-bin/message/template/send        — one template message
 */
import { getConfig } from './config';
import {
  classifyWechatError,
  WechatApiError,
  WechatTokenError,
  type WechatTemplateData,
} from './wechat-types';

/** The official WeChat API host. */
export const WECHAT_API_BASE = 'https://api.weixin.qq.com';

/** A WeChat call that has not answered in this long is a failure. */
export const WECHAT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long a cached access token is trusted.
 *
 * WeChat's token lives for 7200 seconds. This is deliberately much
 * shorter: fetching a new token INVALIDATES the previous one, so a token
 * that is about to expire is a token we would rather replace early than
 * have two processes fight over.
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/** The cached token and the moment it stops being used. */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * The refresh that is already running, if any.
 *
 * ⚠️ WeChat invalidates the previous token when a new one is fetched. If
 * two requests refresh at the same moment, one of them gets a token that
 * is dead the instant it arrives. This promise makes them share a single
 * refresh instead.
 */
let pendingRefresh: Promise<string> | null = null;

/** Forgets the cached token — used after the admin changes the credentials. */
export function resetWechatTokenCache(): void {
  cachedToken = null;
  pendingRefresh = null;
}

/** The shape WeChat answers the token request with. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * The access token, fetched when there is no usable cached one.
 *
 * @param force fetch even when a token is cached.
 */
export async function getWechatAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const appId = await getConfig('wechat.app_id');
    const appSecret = await getConfig('wechat.app_secret');
    if (!appId || !appSecret) {
      throw new Error('the WeChat credentials are not configured');
    }
    const url =
      `${WECHAT_API_BASE}/cgi-bin/token` +
      `?grant_type=client_credential&appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}`;
    const payload = await wechatGet<TokenResponse>(url);
    if (payload.errcode !== undefined && payload.errcode !== 0) {
      throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
    }
    const token = payload.access_token;
    if (!token) {
      throw new Error('WeChat returned no access token');
    }
    cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return token;
  })();

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

/** The shape WeChat answers the follower list with. */
interface FollowerResponse {
  total?: number;
  count?: number;
  data?: { openid?: string[] };
  next_openid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * Every follower's openid.
 *
 * ⚠️ The list pages. `user/get` returns at most 10000 openids and a
 * `next_openid` cursor; the cursor has to be fed back in until it comes
 * back empty. Stopping at the first page would silently skip every
 * follower past the 10000th.
 */
export async function fetchFollowerOpenids(): Promise<string[]> {
  const openids: string[] = [];
  let nextOpenid = '';

  do {
    const token = await getWechatAccessToken();
    const url =
      `${WECHAT_API_BASE}/cgi-bin/user/get?access_token=${encodeURIComponent(token)}` +
      (nextOpenid ? `&next_openid=${encodeURIComponent(nextOpenid)}` : '');
    const payload = await wechatGet<FollowerResponse>(url);
    if (payload.errcode !== undefined && payload.errcode !== 0) {
      throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
    }
    const page = payload.data?.openid;
    if (Array.isArray(page)) openids.push(...page);
    nextOpenid = payload.next_openid ?? '';
  } while (nextOpenid.length > 0);

  return openids;
}

/**
 * Sends one template message to one recipient.
 *
 * @throws WechatApiError — a subclass that says what to do next.
 */
export async function sendTemplateMessage(
  openid: string,
  templateId: string,
  data: WechatTemplateData,
  url?: string | null,
): Promise<void> {
  const token = await getWechatAccessToken();
  const body: Record<string, unknown> = {
    touser: openid,
    template_id: templateId,
    data,
  };
  if (url) body.url = url;

  const endpoint =
    `${WECHAT_API_BASE}/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new WechatApiError(response.status, `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { errcode?: number; errmsg?: string };
  // ⚠️ A zero errcode means the platform accepted the message. It does
  // NOT mean the follower received it — WeChat gives no delivery receipt.
  if (payload.errcode !== undefined && payload.errcode !== 0) {
    throw classifyWechatError(payload.errcode, payload.errmsg ?? 'no message');
  }
}

/** Performs a GET and parses the JSON body, mapping a transport failure. */
async function wechatGet<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WechatApiError(0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    throw new WechatApiError(response.status, `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-api.test.ts`
Expected: PASS — 20 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-api.ts tests/unit/lib/wechat-api.test.ts
git commit -m "feat(wechat): talk to the WeChat API [2026-11-20 16.05]"
```

---

### Task 4: The announcement store

**Files:**
- Create: `lib/wechat-broadcasts.ts`
- Test: `tests/unit/lib/wechat-broadcasts.test.ts`

**Interfaces:**
- Consumes: `getPool` from `@/lib/db`; `WechatBroadcast`, `WechatBroadcastStatus`, `WechatTemplateData` from `@/lib/wechat-types`.
- Produces:
  - `async function createBroadcast(input: { title, templateId, url, data, createdBy }): Promise<number>`
  - `async function listBroadcasts(limit?: number): Promise<WechatBroadcast[]>`
  - `async function getBroadcast(id: number): Promise<WechatBroadcast | null>`
  - `async function queueBroadcast(id: number): Promise<void>`
  - `async function cancelBroadcast(id: number): Promise<boolean>`
  - `async function markBroadcastSending(id, totalRecipients): Promise<void>`
  - `async function recordBroadcastOutcome(id, outcome: { accepted, skipped, failed, lastError }): Promise<void>`
  - `async function finishBroadcast(id, status, lastError): Promise<void>`

**这个模块只碰数据库** —— 它不调微信。发送是 Task 5 的事。

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-broadcasts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  cancelBroadcast,
  createBroadcast,
  finishBroadcast,
  getBroadcast,
  listBroadcasts,
  markBroadcastSending,
  queueBroadcast,
  recordBroadcastOutcome,
} from '@/lib/wechat-broadcasts';

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReset();
  queryMock.mockResolvedValue([[], []]);
});

describe('creating an announcement', () => {
  it('writes a draft row and returns its id', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 42 }, []]);

    const id = await createBroadcast({
      title: 'v1.2 已上线',
      templateId: 'TM00001',
      url: null,
      data: { keyword1: { value: 'hello' } },
      createdBy: 7,
    });

    expect(id).toBe(42);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO wechat_broadcasts');
    expect(params).toContain('v1.2 已上线');
    expect(params).toContain('TM00001');
  });

  it('stores the template data as a JSON string', async () => {
    queryMock.mockResolvedValueOnce([{ insertId: 1 }, []]);

    await createBroadcast({
      title: 't',
      templateId: 'TM00001',
      url: null,
      data: { keyword1: { value: 'hello' } },
      createdBy: 7,
    });

    const params = queryMock.mock.calls[0][1];
    const jsonIndex = params.findIndex(
      (param: unknown) => typeof param === 'string' && param.includes('"keyword1"'),
    );
    expect(jsonIndex).toBeGreaterThan(-1);
  });
});

describe('the announcement list', () => {
  it('returns the rows it was given', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 1,
          title: 'a',
          template_id: 'TM1',
          url: null,
          data: '{"keyword1":{"value":"x"}}',
          status: 'queued',
          total_recipients: 3,
          accepted_count: 0,
          skipped_count: 0,
          failed_count: 0,
          last_error: null,
          created_by: 7,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
          finished_at: null,
        },
      ],
      [],
    ]);

    const list = await listBroadcasts();

    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('a');
    expect(list[0].data.keyword1.value).toBe('x');
  });

  it('returns an empty list when there is nothing', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    expect(await listBroadcasts()).toEqual([]);
  });
});

describe('one announcement', () => {
  it('is null when the row does not exist', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    expect(await getBroadcast(999)).toBeNull();
  });

  it('is found by its id', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 5,
          title: 'a',
          template_id: 'TM1',
          url: null,
          data: '{"keyword1":{"value":"x"}}',
          status: 'sent',
          total_recipients: 2,
          accepted_count: 2,
          skipped_count: 0,
          failed_count: 0,
          last_error: null,
          created_by: 7,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
          finished_at: null,
        },
      ],
      [],
    ]);

    const broadcast = await getBroadcast(5);

    expect(broadcast).not.toBeNull();
    expect(broadcast?.id).toBe(5);
  });
});

describe('the state changes', () => {
  it('queues a draft', async () => {
    await queueBroadcast(3);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("status = 'queued'");
    expect(params).toContain(3);
  });

  it('cancels a draft and reports that it did', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    expect(await cancelBroadcast(3)).toBe(true);
  });

  it('does not cancel a broadcast that already went out', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    expect(await cancelBroadcast(3)).toBe(false);
  });

  it('records the recipient count when the run starts', async () => {
    await markBroadcastSending(4, 12);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain("status = 'sending'");
    expect(params).toContain(12);
  });

  it('records the outcome counts', async () => {
    await recordBroadcastOutcome(4, { accepted: 8, skipped: 1, failed: 2, lastError: 'boom' });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('accepted_count');
    expect(params).toContain(8);
    expect(params).toContain(1);
    expect(params).toContain(2);
    expect(params).toContain('boom');
  });

  it('records the final status and the moment it finished', async () => {
    await finishBroadcast(4, 'sent', null);

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('finished_at');
    expect(params).toContain('sent');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-broadcasts.test.ts`
Expected: FAIL — cannot resolve `@/lib/wechat-broadcasts`.

- [ ] **Step 3: Implement the module**

`lib/wechat-broadcasts.ts`:

```ts
/**
 * The announcement store.
 *
 * ⚠️ This module NEVER talks to WeChat. It only touches the database.
 * The sending lives in `lib/wechat-sender.ts`, and the split is what
 * keeps "what was written" and "what was sent" separate questions.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';
import type {
  WechatBroadcast,
  WechatBroadcastStatus,
  WechatTemplateData,
} from './wechat-types';

/** The title is VARCHAR(128). */
const TITLE_MAX = 128;
/** The template id is VARCHAR(64). */
const TEMPLATE_ID_MAX = 64;
/** The jump url is VARCHAR(512). */
const URL_MAX = 512;
/** The error column is VARCHAR(1024). */
const ERROR_MAX = 1024;

/** A `wechat_broadcasts` row as the driver hands it back. */
interface BroadcastRow extends RowDataPacket {
  id: number;
  title: string;
  template_id: string;
  url: string | null;
  data: string | WechatTemplateData;
  status: string;
  total_recipients: number;
  accepted_count: number;
  skipped_count: number;
  failed_count: number;
  last_error: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

/**
 * The template data, as the driver hands it back.
 *
 * MySQL hands a JSON column back as a string when the driver is not
 * configured to parse it, and as an object when it is. Both are accepted
 * because a broadcast written by one deployment must still be readable
 * by another.
 */
function toTemplateData(raw: string | WechatTemplateData): WechatTemplateData {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as WechatTemplateData;
    } catch (error) {
      console.error(
        '[wechat] the stored template data is not valid JSON:',
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  }
  return raw;
}

/** One row → the shape the rest of the code uses. */
function toBroadcast(row: BroadcastRow): WechatBroadcast {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    url: row.url,
    data: toTemplateData(row.data),
    status: row.status as WechatBroadcastStatus,
    totalRecipients: row.total_recipients,
    acceptedCount: row.accepted_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

/** What a new announcement needs. */
export interface CreateBroadcastInput {
  title: string;
  templateId: string;
  url: string | null;
  data: WechatTemplateData;
  createdBy: number;
}

/** Writes a draft announcement and returns its id. */
export async function createBroadcast(input: CreateBroadcastInput): Promise<number> {
  const [result] = await getPool().query(
    `INSERT INTO wechat_broadcasts (title, template_id, url, data, status, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?)`,
    [
      input.title.slice(0, TITLE_MAX),
      input.templateId.slice(0, TEMPLATE_ID_MAX),
      input.url ? input.url.slice(0, URL_MAX) : null,
      JSON.stringify(input.data),
      input.createdBy,
    ],
  );
  return (result as { insertId: number }).insertId;
}

/** The announcements, newest first. */
export async function listBroadcasts(limit = 50): Promise<WechatBroadcast[]> {
  const [rows] = await getPool().query<BroadcastRow[]>(
    `SELECT id, title, template_id, url, data, status, total_recipients, accepted_count,
            skipped_count, failed_count, last_error, created_by, created_at, updated_at, finished_at
     FROM wechat_broadcasts
     ORDER BY id DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(toBroadcast);
}

/** One announcement, or null when there is no such row. */
export async function getBroadcast(id: number): Promise<WechatBroadcast | null> {
  const [rows] = await getPool().query<BroadcastRow[]>(
    `SELECT id, title, template_id, url, data, status, total_recipients, accepted_count,
            skipped_count, failed_count, last_error, created_by, created_at, updated_at, finished_at
     FROM wechat_broadcasts
     WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? toBroadcast(row) : null;
}

/** Moves a draft into the queue. */
export async function queueBroadcast(id: number): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts SET status = 'queued' WHERE id = ? AND status = 'draft'`,
    [id],
  );
}

/**
 * Cancels an announcement that has not gone out yet.
 *
 * @returns whether a row was actually changed — a broadcast that already
 *          went out cannot be cancelled.
 */
export async function cancelBroadcast(id: number): Promise<boolean> {
  const [result] = await getPool().query(
    `UPDATE wechat_broadcasts SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('draft', 'queued')`,
    [id],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

/** Records how many recipients the run is about to send to. */
export async function markBroadcastSending(id: number, totalRecipients: number): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET status = 'sending', total_recipients = ?, accepted_count = 0, skipped_count = 0, failed_count = 0
     WHERE id = ?`,
    [totalRecipients, id],
  );
}

/** What one run achieved. */
export interface BroadcastOutcome {
  accepted: number;
  skipped: number;
  failed: number;
  lastError: string | null;
}

/** Records the counts of one run. */
export async function recordBroadcastOutcome(
  id: number,
  outcome: BroadcastOutcome,
): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET accepted_count = ?, skipped_count = ?, failed_count = ?, last_error = ?
     WHERE id = ?`,
    [
      outcome.accepted,
      outcome.skipped,
      outcome.failed,
      outcome.lastError ? outcome.lastError.slice(0, ERROR_MAX) : null,
      id,
    ],
  );
}

/** Records the final state of an announcement. */
export async function finishBroadcast(
  id: number,
  status: WechatBroadcastStatus,
  lastError: string | null,
): Promise<void> {
  await getPool().query(
    `UPDATE wechat_broadcasts
     SET status = ?, last_error = ?, finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, lastError ? lastError.slice(0, ERROR_MAX) : null, id],
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-broadcasts.test.ts`
Expected: PASS — 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-broadcasts.ts tests/unit/lib/wechat-broadcasts.test.ts
git commit -m "feat(wechat): store the announcements [2026-11-20 16.20]"
```

---

### Task 5: The sender

**Files:**
- Create: `lib/wechat-sender.ts`
- Test: `tests/unit/lib/wechat-sender.test.ts`

**Interfaces:**
- Consumes: `fetchFollowerOpenids`, `sendTemplateMessage`, `resetWechatTokenCache` from `@/lib/wechat-api`; `WechatParamError`, `WechatQuotaError`, `WechatRecipientError`, `WechatTokenError` from `@/lib/wechat-types`; `getBroadcast`, `markBroadcastSending`, `recordBroadcastOutcome`, `finishBroadcast` from `@/lib/wechat-broadcasts`.
- Produces: `async function sendBroadcast(id: number): Promise<BroadcastSendResult>` where

```ts
export interface BroadcastSendResult {
  status: 'sent' | 'failed';
  totalRecipients: number;
  accepted: number;
  skipped: number;
  failed: number;
  error: string | null;
}
```

**这个任务是整个功能的核心。** 错误码 → 行为 的映射全部在这里：

| 错误 | 动作 |
|---|---|
| 无错误 | `accepted++` |
| `WechatRecipientError`（43101） | `skipped++`，**继续**发给下一个人 |
| `WechatTokenError`（40001） | 刷新 token，**重试一次**；再失败就停手 |
| `WechatParamError`（40003/40037/47003/48001） | **停手** —— 重试只会浪费配额 |
| `WechatQuotaError`（45009） | **停手** —— 等下个 tick |
| 网络异常 | **停手** |

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-sender.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const followerMock = vi.fn();
const sendMock = vi.fn();
const resetTokenMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  fetchFollowerOpenids: () => followerMock(),
  sendTemplateMessage: (...args: unknown[]) => sendMock(...args),
  resetWechatTokenCache: () => resetTokenMock(),
}));

const getBroadcastMock = vi.fn();
const markSendingMock = vi.fn();
const recordOutcomeMock = vi.fn();
const finishMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  getBroadcast: (...args: unknown[]) => getBroadcastMock(...args),
  markBroadcastSending: (...args: unknown[]) => markSendingMock(...args),
  recordBroadcastOutcome: (...args: unknown[]) => recordOutcomeMock(...args),
  finishBroadcast: (...args: unknown[]) => finishMock(...args),
}));

import { sendBroadcast } from '@/lib/wechat-sender';
import {
  WechatParamError,
  WechatQuotaError,
  WechatRecipientError,
  WechatTokenError,
} from '@/lib/wechat-types';

function broadcast(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'v1.2',
    templateId: 'TM00001',
    url: null,
    data: { keyword1: { value: 'x' } },
    status: 'queued' as const,
    totalRecipients: 0,
    acceptedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
    createdBy: 7,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    finishedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  followerMock.mockReset();
  sendMock.mockReset();
  getBroadcastMock.mockReset();
  getBroadcastMock.mockResolvedValue(broadcast());
  markSendingMock.mockReset();
  recordOutcomeMock.mockReset();
  finishMock.mockReset();
});

describe('sending an announcement', () => {
  it('sends one message per follower', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);
    sendMock.mockResolvedValue(undefined);

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result.accepted).toBe(3);
    expect(result.totalRecipients).toBe(3);
  });

  it('records the recipient count before it starts', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    await sendBroadcast(1);

    expect(markSendingMock).toHaveBeenCalledWith(1, 1);
  });

  it('passes the template id and the data to every message', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledWith('a', 'TM00001', { keyword1: { value: 'x' } }, null);
  });

  it('finishes as sent when everybody was reached', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockResolvedValue(undefined);

    const result = await sendBroadcast(1);

    expect(result.status).toBe('sent');
    expect(finishMock).toHaveBeenCalledWith(1, 'sent', null);
  });

  it('does nothing when the announcement does not exist', async () => {
    getBroadcastMock.mockResolvedValue(null);

    const result = await sendBroadcast(999);

    expect(result.status).toBe('failed');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('when a follower cannot be reached', () => {
  it('skips that follower and keeps going', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'user refuse to accept the msg'))
      .mockResolvedValueOnce(undefined);

    const result = await sendBroadcast(1);

    expect(result.skipped).toBe(1);
    expect(result.accepted).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('when the token is stale', () => {
  it('refreshes the token and tries that follower once more', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock
      .mockRejectedValueOnce(new WechatTokenError(40001, 'invalid credential'))
      .mockResolvedValueOnce(undefined);

    const result = await sendBroadcast(1);

    expect(resetTokenMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.accepted).toBe(1);
  });

  it('stops when the retry also fails', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatTokenError(40001, 'invalid credential'));

    const result = await sendBroadcast(1);

    expect(result.status).toBe('failed');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('when the request itself is wrong', () => {
  it('stops the run instead of retrying — a parameter error never gets better', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);
    sendMock.mockRejectedValue(new WechatParamError(47003, 'argument invalid'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('47003');
  });

  it('stops when the template id is wrong', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatParamError(40037, 'invalid template_id'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
  });
});

describe('when the daily quota is spent', () => {
  it('stops the run', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock.mockRejectedValue(new WechatQuotaError(45009, 'api freq out of limit'));

    const result = await sendBroadcast(1);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('45009');
  });
});

describe('the recording of the outcome', () => {
  it('records the counts', async () => {
    followerMock.mockResolvedValue(['a', 'b']);
    sendMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new WechatRecipientError(43101, 'user refuse'));

    await sendBroadcast(1);

    expect(recordOutcomeMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ accepted: 1, skipped: 1, failed: 0 }),
    );
  });

  it('records the failure when the run stopped', async () => {
    followerMock.mockResolvedValue(['a']);
    sendMock.mockRejectedValue(new WechatParamError(47003, 'argument invalid'));

    await sendBroadcast(1);

    expect(recordOutcomeMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ failed: 1 }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-sender.test.ts`
Expected: FAIL — cannot resolve `@/lib/wechat-sender`.

- [ ] **Step 3: Implement the module**

`lib/wechat-sender.ts`:

```ts
/**
 * Sending an announcement to the followers.
 *
 * The whole file is about one question: WeChat said no — now what?
 *
 *   - 43101 (the follower left, or muted the account) → skip this one
 *     follower, keep going. The others still get their message.
 *   - 40001 (the token died) → refresh it, try that one follower once
 *     more. If it fails again, stop.
 *   - 40003 / 40037 / 47003 / 48001 (the request is wrong) → STOP.
 *     Retrying a wrong request spends the daily quota to arrive at the
 *     same answer.
 *   - 45009 (the daily quota is spent) → STOP and wait for the next tick.
 *
 * ⚠️ A zero errcode means WeChat ACCEPTED the message. It does not mean
 * the follower received it — WeChat issues no delivery receipt. The count
 * this file reports is therefore named "accepted", not "delivered", and
 * the admin UI has to say the same thing.
 */
import {
  fetchFollowerOpenids,
  resetWechatTokenCache,
  sendTemplateMessage,
} from './wechat-api';
import {
  WechatParamError,
  WechatQuotaError,
  WechatRecipientError,
  WechatTokenError,
} from './wechat-types';
import {
  finishBroadcast,
  getBroadcast,
  markBroadcastSending,
  recordBroadcastOutcome,
} from './wechat-broadcasts';

/** What one run achieved. */
export interface BroadcastSendResult {
  status: 'sent' | 'failed';
  totalRecipients: number;
  accepted: number;
  skipped: number;
  failed: number;
  error: string | null;
}

/**
 * Sends one announcement to every follower.
 *
 * Never throws — the outcome is the return value and the database rows.
 * The scheduler calls this, and a scheduler that throws is a scheduler
 * that stops.
 */
export async function sendBroadcast(id: number): Promise<BroadcastSendResult> {
  const broadcast = await getBroadcast(id);
  if (!broadcast) {
    return { status: 'failed', totalRecipients: 0, accepted: 0, skipped: 0, failed: 0, error: 'the announcement does not exist' };
  }

  let openids: string[];
  try {
    openids = await fetchFollowerOpenids();
  } catch (error) {
    const message = describeError(error);
    await recordOutcome(id, { accepted: 0, skipped: 0, failed: 0, lastError: message });
    await finishBroadcast(id, 'failed', message);
    return { status: 'failed', totalRecipients: 0, accepted: 0, skipped: 0, failed: 0, error: message };
  }

  await markBroadcastSending(id, openids.length);

  let accepted = 0;
  let skipped = 0;
  let failed = 0;
  let lastError: string | null = null;
  let stopped = false;

  for (const openid of openids) {
    if (stopped) break;

    try {
      await sendTemplateMessage(openid, broadcast.templateId, broadcast.data, broadcast.url);
      accepted += 1;
    } catch (error) {
      if (error instanceof WechatRecipientError) {
        // This one follower cannot be reached. The rest still can.
        skipped += 1;
        continue;
      }

      if (error instanceof WechatTokenError) {
        // The token died. Refresh it and try this one follower once more.
        resetWechatTokenCache();
        try {
          await sendTemplateMessage(openid, broadcast.templateId, broadcast.data, broadcast.url);
          accepted += 1;
          continue;
        } catch (retryError) {
          failed += 1;
          lastError = describeError(retryError);
          stopped = true;
          continue;
        }
      }

      // A parameter error, a quota error, or a network failure: all of
      // them mean the rest of this run will not do any better.
      failed += 1;
      lastError = describeError(error);
      stopped = true;
    }
  }

  await recordOutcome(id, { accepted, skipped, failed, lastError });

  if (stopped) {
    await finishBroadcast(id, 'failed', lastError);
    return {
      status: 'failed',
      totalRecipients: openids.length,
      accepted,
      skipped,
      failed,
      error: lastError,
    };
  }

  await finishBroadcast(id, 'sent', null);
  return {
    status: 'sent',
    totalRecipients: openids.length,
    accepted,
    skipped,
    failed,
    error: null,
  };
}

/** Records the counts of one run. */
async function recordOutcome(
  id: number,
  outcome: { accepted: number; skipped: number; failed: number; lastError: string | null },
): Promise<void> {
  try {
    await recordBroadcastOutcome(id, outcome);
  } catch (error) {
    console.error(
      '[wechat] could not record the outcome of the broadcast',
      id,
      ':',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** The message of an error, for the log and the admin screen. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-sender.test.ts`
Expected: PASS — 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-sender.ts tests/unit/lib/wechat-sender.test.ts
git commit -m "feat(wechat): send the announcement to every follower [2026-11-20 16.35]"
```

---

### Task 6: The scheduler task

**Files:**
- Modify: `lib/scheduler-tasks.ts`（`TaskName` 联合、`ALL_TASKS`、`runTask` 分发）
- Modify: `lib/scheduler-config.ts`（`SCHEDULER_KEYS`、`SchedulerConfig`、`DEFAULT_CONFIG`、`SchedulerHistoryTaskName`）
- Test: `tests/unit/lib/wechat-scheduler-task.test.ts`

**Interfaces:**
- Consumes: `sendBroadcast` from `@/lib/wechat-sender`; `listBroadcasts`, `getBroadcast` from `@/lib/wechat-broadcasts`.
- Produces: `TaskName` gains `'wechat-broadcast-send'`; `SchedulerConfig` gains `taskWechatBroadcast: boolean`; config key `scheduler.task_wechat_broadcast`.

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-scheduler-task.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('@/lib/wechat-sender', () => ({
  sendBroadcast: (...args: unknown[]) => sendMock(...args),
}));

const listMock = vi.fn();
const getMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  listBroadcasts: (...args: unknown[]) => listMock(...args),
  getBroadcast: (...args: unknown[]) => getMock(...args),
}));

import { ALL_TASKS, runTask } from '@/lib/scheduler-tasks';
import { SCHEDULER_KEYS, DEFAULT_CONFIG } from '@/lib/scheduler-config';

function queued(id: number) {
  return {
    id,
    title: 'a',
    templateId: 'TM1',
    url: null,
    data: { keyword1: { value: 'x' } },
    status: 'queued' as const,
    totalRecipients: 0,
    acceptedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
    createdBy: 7,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    finishedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockReset();
  listMock.mockReset();
  getMock.mockReset();
});

describe('the scheduler task registration', () => {
  it('is one of the known tasks', () => {
    expect(ALL_TASKS).toContain('wechat-broadcast-send');
  });

  it('has a switch in the scheduler config', () => {
    expect(SCHEDULER_KEYS.taskWechatBroadcast).toBe('scheduler.task_wechat_broadcast');
    expect(DEFAULT_CONFIG).toHaveProperty('taskWechatBroadcast');
  });
});

describe('the WeChat broadcast task', () => {
  it('does nothing when nothing is queued', async () => {
    listMock.mockResolvedValue([]);

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends the queued announcement', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 2,
      accepted: 2,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const result = await runTask('wechat-broadcast-send');

    expect(sendMock).toHaveBeenCalledWith(1);
    expect(result.ok).toBe(true);
  });

  it('reports a failed run without throwing', async () => {
    listMock.mockResolvedValue([queued(1)]);
    sendMock.mockResolvedValue({
      status: 'failed',
      totalRecipients: 2,
      accepted: 0,
      skipped: 0,
      failed: 1,
      error: 'WeChat error 47003: argument invalid',
    });

    const result = await runTask('wechat-broadcast-send');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('47003');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-scheduler-task.test.ts`
Expected: FAIL — `ALL_TASKS` does not contain `'wechat-broadcast-send'`.

- [ ] **Step 3: Add the task to the scheduler**

**`lib/scheduler-tasks.ts`** — three edits:

1. Add to the `TaskName` union:
```ts
export type TaskName =
  | 'content-refresh'
  | 'daily-char'
  | 'stats-refresh'
  | 'email-campaign-send'
  | 'wecom-deliver'
  | 'wechat-broadcast-send';
```

2. Add to `ALL_TASKS`:
```ts
export const ALL_TASKS: TaskName[] = [
  'content-refresh',
  'daily-char',
  'stats-refresh',
  'email-campaign-send',
  'wecom-deliver',
  'wechat-broadcast-send',
];
```

3. Add the runner, and add a `case` to the `runTask` switch.

⚠️ **`runTask` is a `switch (name)` on `TaskName`, not a chain of `if`s** — a
new task needs a `case`, or `runTask` will not return anything for it and
TypeScript will flag the missing branch.

⚠️ **The runner must catch its own errors.** `runTask` has no `try` around
the dispatch — every existing runner (`runWecomDeliverTask`,
`runEmailCampaignSend`) catches internally and returns `{ ok: false, error }`.
A runner that throws would take the whole scheduler tick down.

```ts
async function runWechatBroadcastTask(): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const queued = await listBroadcasts(5);
    const pending = queued.filter((broadcast) => broadcast.status === 'queued');
    if (pending.length === 0) {
      return {
        name: 'wechat-broadcast-send',
        ok: true,
        summary: 'no queued broadcasts',
      };
    }
    // One announcement per tick. A broadcast to many followers takes many
    // calls, and a tick that runs long blocks the other tasks.
    const result = await sendBroadcast(pending[0].id);
    const ms = Date.now() - t0;
    return {
      name: 'wechat-broadcast-send',
      ok: result.status === 'sent',
      summary:
        `broadcast=${pending[0].id} recipients=${result.totalRecipients}` +
        ` accepted=${result.accepted} skipped=${result.skipped}` +
        ` failed=${result.failed} (${ms}ms)`,
      error: result.error ?? undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'wechat-broadcast-send',
      ok: false,
      summary: 'broadcast run failed',
      error: message,
    };
  }
}
```

And in `runTask`:
```ts
    case 'wechat-broadcast-send':
      return runWechatBroadcastTask();
```

Add the imports at the top of the file:
```ts
import { sendBroadcast } from './wechat-sender';
import { listBroadcasts } from './wechat-broadcasts';
```

**`lib/scheduler-config.ts`** — four edits:

1. `SCHEDULER_KEYS`:
```ts
  taskWecomDeliver: 'scheduler.task_wecom_deliver',
  taskWechatBroadcast: 'scheduler.task_wechat_broadcast',
```

2. `SchedulerConfig` interface:
```ts
  taskWecomDeliver: boolean;
  taskWechatBroadcast: boolean;
```

3. `DEFAULT_CONFIG`:
```ts
  taskWechatBroadcast: true,
```

4. The **loader** — where `SchedulerConfig` is read back out of `app_config`:
```ts
      taskWechatBroadcast: out[SCHEDULER_KEYS.taskWechatBroadcast] !== '0',
```

5. The **writer** — where a change is persisted:
```ts
  if (updates.taskWechatBroadcast !== undefined)
    await set(SCHEDULER_KEYS.taskWechatBroadcast, updates.taskWechatBroadcast ? '1' : '0');
```

6. `SchedulerHistoryTaskName` union:
```ts
  | 'wecom-deliver'
  | 'wechat-broadcast-send';
```

⚠️ **`taskWecomDeliver` appears in SIX places in `lib/scheduler-config.ts`** —
`SCHEDULER_KEYS`, the `SchedulerConfig` interface, `DEFAULT_CONFIG`, the
`DEFAULT_ROWS` map, the loader, and the writer. **All six need the new
field**, or the switch will read as `undefined` and never persist. Grep for
`taskWecomDeliver` and mirror every occurrence.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-scheduler-task.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Run the scheduler's own tests**

Run: `npx vitest run tests/unit/lib/scheduler*.test.ts`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/scheduler-tasks.ts lib/scheduler-config.ts tests/unit/lib/wechat-scheduler-task.test.ts
git commit -m "feat(wechat): send the queued announcements on the scheduler tick [2026-11-20 16.50]"
```

---

### Task 7: The configuration

**Files:**
- Create: `lib/wechat-config.ts`
- Test: `tests/unit/lib/wechat-config.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `setConfigBatch` from `@/lib/config`; `isValidWechatAppId` from `@/lib/wechat-types`; `resetWechatTokenCache` from `@/lib/wechat-api`.
- Modifies: `lib/config.ts` — add the two `KEY_VALIDATORS` entries.
- Produces:
  - `interface WechatConfig { enabled: boolean; appId: string; appSecretSet: boolean }`
  - `async function getWechatConfig(): Promise<WechatConfig>`
  - `async function saveWechatConfig(input: { enabled?: boolean; appId?: string; appSecret?: string }, byUserId: number): Promise<void>`
  - `function isWechatConfigured(config: WechatConfig): boolean`

**为什么单独的模块**：凭据和「是否配好」这两个判断会被 API 路由、sender、后台页三处用到。集中在一处才不会散。

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getConfigMock = vi.fn();
const setConfigBatchMock = vi.fn();
vi.mock('@/lib/config', () => ({
  getConfig: (key: string) => getConfigMock(key),
  setConfigBatch: (...args: unknown[]) => setConfigBatchMock(...args),
}));

const resetTokenMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  resetWechatTokenCache: () => resetTokenMock(),
}));

import { getWechatConfig, isWechatConfigured, saveWechatConfig } from '@/lib/wechat-config';

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockReset();
  setConfigBatchMock.mockReset();
  resetTokenMock.mockReset();
  getConfigMock.mockImplementation((key: string) => {
    if (key === 'wechat.enabled') return 'true';
    if (key === 'wechat.app_id') return 'wx1234567890abcdef';
    if (key === 'wechat.app_secret') return 'the-secret';
    return '';
  });
});

describe('reading the WeChat configuration', () => {
  it('reports whether the feature is on', async () => {
    const config = await getWechatConfig();

    expect(config.enabled).toBe(true);
  });

  it('reports the app id', async () => {
    const config = await getWechatConfig();

    expect(config.appId).toBe('wx1234567890abcdef');
  });

  it('never returns the app secret itself', async () => {
    const config = await getWechatConfig();

    expect(config.appSecretSet).toBe(true);
    expect(JSON.stringify(config)).not.toContain('the-secret');
  });

  it('treats an unset secret as not set', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_secret' ? '' : 'x'));

    const config = await getWechatConfig();

    expect(config.appSecretSet).toBe(false);
  });
});

describe('saving the WeChat configuration', () => {
  it('writes the fields it was given', async () => {
    await saveWechatConfig({ enabled: false, appId: 'wxabcdefabcdef0123' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates['wechat.enabled']).toBe('false');
    expect(updates['wechat.app_id']).toBe('wxabcdefabcdef0123');
  });

  it('does not write the secret when it was left blank', async () => {
    await saveWechatConfig({ enabled: true, appId: 'wx1234567890abcdef', appSecret: '' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates).not.toHaveProperty('wechat.app_secret');
  });

  it('records who changed the credentials', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 42);

    const [, byUserId] = setConfigBatchMock.mock.calls[0];
    expect(byUserId).toBe(42);
  });

  it('writes the secret when it was given', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 7);

    const [updates] = setConfigBatchMock.mock.calls[0];
    expect(updates['wechat.app_secret']).toBe('new-secret');
  });

  it('rejects an app id that is not shaped like one', async () => {
    await expect(saveWechatConfig({ appId: 'not-an-app-id' }, 7)).rejects.toThrow(/app id/i);
  });

  it('forgets the cached token — the old one belongs to the old credentials', async () => {
    await saveWechatConfig({ appSecret: 'new-secret' }, 7);

    expect(resetTokenMock).toHaveBeenCalled();
  });
});

describe('whether WeChat is configured', () => {
  it('is not configured without an app id', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_id' ? '' : 'x'));

    expect(isWechatConfigured(await getWechatConfig())).toBe(false);
  });

  it('is not configured without a secret', async () => {
    getConfigMock.mockImplementation((key: string) => (key === 'wechat.app_secret' ? '' : 'x'));

    expect(isWechatConfigured(await getWechatConfig())).toBe(false);
  });

  it('is configured with both', async () => {
    expect(isWechatConfigured(await getWechatConfig())).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-config.test.ts`
Expected: FAIL — cannot resolve `@/lib/wechat-config`.

- [ ] **Step 3: Add the config validators**

`lib/config.ts` enforces a per-key validator in `setConfig`. A key with no
validator accepts anything, so the app id shape check would live only in
`lib/wechat-config.ts` — and a direct `setConfig('wechat.app_id', ...)` call
from anywhere else could write garbage. Add both keys to `KEY_VALIDATORS`:

```ts
  'wechat.enabled': (v) => v === 'true' || v === 'false',
  'wechat.app_id': (v) => /^wx[0-9a-f]{16}$/.test(v),
  'wechat.app_secret': (v) => v.length > 0 && v.length <= 256,
```

⚠️ `KEY_VALIDATORS` lives in `lib/config.ts`, which is a **client-unsafe**
module in some contexts. `lib/wechat-config.ts` imports `isValidWechatAppId`
from `@/lib/wechat-types` — keep the validator there too, but **do not import
`lib/config` into `lib/wechat-types`** (that would create a cycle).

- [ ] **Step 4: Implement the module**

`lib/wechat-config.ts`:

```ts
/**
 * The WeChat Official Account credentials.
 *
 * The app secret is stored in `app_config` in plain text, the same way
 * `smtp.pass` is, and the admin screen never sends it back — the UI only
 * learns WHETHER one is set. An empty secret means "keep the one that is
 * already there", which is what makes the password field work like a
 * password field.
 */
import { getConfig, setConfigBatch } from './config';
import { isValidWechatAppId, WECHAT_CONFIG_KEYS } from './wechat-types';
import { resetWechatTokenCache } from './wechat-api';

/** What the admin screen needs to know about the configuration. */
export interface WechatConfig {
  /** Whether the admin turned the feature on. */
  enabled: boolean;
  /** The WeChat app id. Not a secret. */
  appId: string;
  /** Whether an app secret is stored — the secret itself is never returned. */
  appSecretSet: boolean;
}

/** Reads the configuration, without the secret. */
export async function getWechatConfig(): Promise<WechatConfig> {
  const enabled = (await getConfig(WECHAT_CONFIG_KEYS.enabled)) === 'true';
  const appId = (await getConfig(WECHAT_CONFIG_KEYS.appId)) ?? '';
  const appSecret = (await getConfig(WECHAT_CONFIG_KEYS.appSecret)) ?? '';
  return { enabled, appId, appSecretSet: appSecret.length > 0 };
}

/** What the admin screen may change. */
export interface SaveWechatConfigInput {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
}

/**
 * Writes the configuration.
 *
 * An empty app secret keeps the stored one — the admin screen sends an
 * empty string when the field was left alone.
 *
 * @throws Error when the app id does not look like one.
 */
export async function saveWechatConfig(
  input: SaveWechatConfigInput,
  byUserId: number,
): Promise<void> {
  const updates: Record<string, string> = {};
  if (input.enabled !== undefined) {
    updates[WECHAT_CONFIG_KEYS.enabled] = input.enabled ? 'true' : 'false';
  }
  if (input.appId !== undefined && input.appId !== '') {
    if (!isValidWechatAppId(input.appId)) {
      throw new Error('the WeChat app id does not look like a WeChat app id');
    }
    updates[WECHAT_CONFIG_KEYS.appId] = input.appId;
  }
  if (input.appSecret !== undefined && input.appSecret !== '') {
    updates[WECHAT_CONFIG_KEYS.appSecret] = input.appSecret;
  }
  if (Object.keys(updates).length > 0) {
    await setConfigBatch(updates, byUserId);
  }
  // The credentials may have changed, and the cached token belongs to the
  // old ones. WeChat invalidates the previous token when a new one is
  // fetched, so a stale one must not survive.
  resetWechatTokenCache();
}

/**
 * Whether the feature can send anything.
 *
 * Both the credentials and the switch have to be on.
 */
export function isWechatConfigured(config: WechatConfig): boolean {
  return config.enabled && config.appId.length > 0 && config.appSecretSet;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-config.test.ts`
Expected: PASS — 12 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/wechat-config.ts lib/config.ts tests/unit/lib/wechat-config.test.ts
git commit -m "feat(wechat): keep the credentials in one place [2026-11-20 17.05]"
```

---

### Task 8: The admin API routes

**Files:**
- Create: `app/api/admin/wechat/config/route.ts`
- Create: `app/api/admin/wechat/followers/route.ts`
- Create: `app/api/admin/wechat/broadcasts/route.ts`
- Create: `app/api/admin/wechat/broadcasts/[id]/route.ts`
- Create: `app/api/admin/wechat/broadcasts/[id]/send/route.ts`
- Create: `app/api/admin/wechat/broadcasts/[id]/cancel/route.ts`
- Create: `app/api/admin/wechat/test/route.ts`
- Modify: `lib/audit-format.ts`（4 处审计事件）
- Test: `tests/unit/app/api/wechat-admin-routes.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth`; `withErrorHandling`, `badRequest` from `@/lib/api-handler`; `writeAudit` from `@/lib/audit`; the config/store/sender/api modules from Tasks 3–7.
- Produces: 7 admin routes; 5 new audit events: `wechat_config_updated`, `wechat_broadcast_created`, `wechat_broadcast_sent`, `wechat_broadcast_cancelled`, `wechat_test_sent`.

**⚠️ 审计事件必须加在 4 个地方**（`lib/audit-format.ts`）：`AuditEvent` 联合、`AUDIT_EVENTS` 元组、`EVENT_LABEL` 记录、`formatLogMessage` 函数。`tests/unit/lib/audit.test.ts` 会断言元组和 label 完全一致 —— 少一处就红。

- [ ] **Step 1: Write the failing test**

`tests/unit/app/api/wechat-admin-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const adminMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAdmin: () => adminMock(),
}));

const auditMock = vi.fn();
vi.mock('@/lib/audit', () => ({
  writeAudit: (...args: unknown[]) => auditMock(...args),
}));

const configMock = vi.fn();
const saveConfigMock = vi.fn();
vi.mock('@/lib/wechat-config', () => ({
  getWechatConfig: () => configMock(),
  saveWechatConfig: (...args: unknown[]) => saveConfigMock(...args),
  isWechatConfigured: (config: { enabled: boolean; appId: string; appSecretSet: boolean }) =>
    config.enabled && config.appId.length > 0 && config.appSecretSet,
}));

const followerMock = vi.fn();
vi.mock('@/lib/wechat-api', () => ({
  fetchFollowerOpenids: () => followerMock(),
  sendTemplateMessage: vi.fn(),
}));

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const queueMock = vi.fn();
const cancelMock = vi.fn();
vi.mock('@/lib/wechat-broadcasts', () => ({
  listBroadcasts: (...args: unknown[]) => listMock(...args),
  getBroadcast: (...args: unknown[]) => getMock(...args),
  createBroadcast: (...args: unknown[]) => createMock(...args),
  queueBroadcast: (...args: unknown[]) => queueMock(...args),
  cancelBroadcast: (...args: unknown[]) => cancelMock(...args),
}));

const sendMock = vi.fn();
vi.mock('@/lib/wechat-sender', () => ({
  sendBroadcast: (...args: unknown[]) => sendMock(...args),
}));

import { GET as getConfigRoute, PUT as putConfigRoute } from '@/app/api/admin/wechat/config/route';
import { GET as getFollowersRoute } from '@/app/api/admin/wechat/followers/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/wechat/broadcasts/route';
import { POST as sendRoute } from '@/app/api/admin/wechat/broadcasts/[id]/send/route';
import { POST as cancelRoute } from '@/app/api/admin/wechat/broadcasts/[id]/cancel/route';

function request(body: unknown): Request {
  return {
    json: async () => body,
    url: 'http://localhost:4444/api/admin/wechat/broadcasts',
  } as unknown as Request;
}

/**
 * The [id] routes take the id from the path, not the body.
 */
function idContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockReset();
  auditMock.mockReset();
  configMock.mockReset();
  saveConfigMock.mockReset();
  followerMock.mockReset();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  queueMock.mockReset();
  cancelMock.mockReset();
  sendMock.mockReset();
  adminMock.mockResolvedValue({ ok: true, user: { id: 1 } });
  configMock.mockResolvedValue({ enabled: true, appId: 'wx1234567890abcdef', appSecretSet: true });
});

describe('the admin guard', () => {
  it('refuses a request that is not an admin', async () => {
    adminMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 401 }) });

    const response = await listRoute();

    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('the configuration route', () => {
  it('returns the configuration without the secret', async () => {
    const response = await getConfigRoute();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.config.appSecretSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain('the-secret');
  });

  it('saves the configuration and writes an audit event', async () => {
    await putConfigRoute(request({ enabled: false, appId: 'wx1234567890abcdef' }));

    expect(saveConfigMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_config_updated' }),
    );
  });

  it('refuses a bad app id', async () => {
    saveConfigMock.mockRejectedValue(new Error('the WeChat app id does not look like a WeChat app id'));

    const response = await putConfigRoute(request({ appId: 'nope' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain('app id');
  });
});

describe('the follower route', () => {
  it('returns the follower count', async () => {
    followerMock.mockResolvedValue(['a', 'b', 'c']);

    const response = await getFollowersRoute();

    const body = await response.json();
    expect(body.data.count).toBe(3);
  });

  it('returns zero when there are no followers', async () => {
    followerMock.mockResolvedValue([]);

    const response = await getFollowersRoute();

    const body = await response.json();
    expect(body.data.count).toBe(0);
  });
});

describe('the announcement routes', () => {
  it('lists the announcements', async () => {
    listMock.mockResolvedValue([]);

    const response = await listRoute();

    expect(response.status).toBe(200);
  });

  it('creates an announcement and queues it', async () => {
    createMock.mockResolvedValue(11);

    const response = await createRoute(
      request({ title: 'v1.2', templateId: 'TM00001', url: '', data: { keyword1: { value: 'x' } } }),
    );

    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalled();
    expect(queueMock).toHaveBeenCalledWith(11);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_created' }),
    );
  });

  it('refuses an announcement with no title', async () => {
    const response = await createRoute(request({ templateId: 'TM00001', data: {} }));

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses an announcement with no template id', async () => {
    const response = await createRoute(request({ title: 'v1.2', data: { keyword1: { value: 'x' } } }));

    expect(response.status).toBe(400);
  });

  it('refuses an announcement with no template data', async () => {
    const response = await createRoute(request({ title: 'v1.2', templateId: 'TM00001', data: {} }));

    expect(response.status).toBe(400);
  });

  it('sends an announcement on demand', async () => {
    sendMock.mockResolvedValue({
      status: 'sent',
      totalRecipients: 2,
      accepted: 2,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const response = await sendRoute(request({}), idContext('5'));

    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith(5);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_sent' }),
    );
  });

  it('cancels an announcement', async () => {
    cancelMock.mockResolvedValue(true);

    const response = await cancelRoute(request({}), idContext('5'));

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(5);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'wechat_broadcast_cancelled' }),
    );
  });

  it('refuses to cancel an announcement that already went out', async () => {
    cancelMock.mockResolvedValue(false);

    const response = await cancelRoute(request({}), idContext('5'));

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/api/wechat-admin-routes.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Add the audit events**

**`lib/audit-format.ts`** — four edits:

1. In the `AuditEvent` union, add:
```ts
  | 'wechat_config_updated'
  | 'wechat_broadcast_created'
  | 'wechat_broadcast_sent'
  | 'wechat_broadcast_cancelled'
  | 'wechat_test_sent'
```

2. In the `AUDIT_EVENTS` tuple, add the same five strings.

3. In the `EVENT_LABEL` record, add:
```ts
  wechat_config_updated: '微信配置已更新',
  wechat_broadcast_created: '已创建微信公告',
  wechat_broadcast_sent: '已发送微信公告',
  wechat_broadcast_cancelled: '已取消微信公告',
  wechat_test_sent: '已发送微信测试消息',
```

4. In `formatLogMessage`, add a case that renders the announcement title. **Read the existing function first** and follow its shape — it must never render an empty name; the existing MCP tests assert a `「?」` placeholder, so follow that convention:
```ts
    case 'wechat_config_updated':
      return `已更新微信配置：${metadata.keys?.join('、') ?? '（无）'}`;
    case 'wechat_broadcast_created':
      return `已创建微信公告「${metadata.title ?? '?'}」`;
    case 'wechat_broadcast_sent':
      return `已发送微信公告「${metadata.title ?? '?'}」`;
    case 'wechat_broadcast_cancelled':
      return `已取消微信公告「${metadata.title ?? '?'}」`;
    case 'wechat_test_sent':
      return `已发送微信测试消息「${metadata.title ?? '?'}」`;
```

- [ ] **Step 4: Write the routes**

**`app/api/admin/wechat/config/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, saveWechatConfig } from '@/lib/wechat-config';

export const dynamic = 'force-dynamic';

const ConfigSchema = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().max(64).optional(),
  appSecret: z.string().max(256).optional(),
});

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const config = await getWechatConfig();
    return NextResponse.json({ ok: true, data: { config } });
  });
}

export async function PUT(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = ConfigSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    try {
      await saveWechatConfig(parsed.data, auth.user.id);
    } catch (error) {
      return badRequest('validation', (error as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_config_updated',
      metadata: { title: '微信配置', keys: Object.keys(parsed.data) },
    });
    const config = await getWechatConfig();
    return NextResponse.json({ ok: true, data: { config } });
  });
}
```

**`app/api/admin/wechat/followers/route.ts`**:

```ts
import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { fetchFollowerOpenids } from '@/lib/wechat-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const openids = await fetchFollowerOpenids();
    return NextResponse.json({ ok: true, data: { count: openids.length } });
  });
}
```

**`app/api/admin/wechat/broadcasts/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { createBroadcast, listBroadcasts, queueBroadcast } from '@/lib/wechat-broadcasts';
import { validateTemplateData } from '@/lib/wechat-types';

export const dynamic = 'force-dynamic';

const TemplateValueSchema = z.object({ value: z.string().min(1).max(200) });

const BroadcastSchema = z.object({
  title: z.string().min(1).max(128),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  data: z.record(z.string(), TemplateValueSchema),
});

export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const broadcasts = await listBroadcasts();
    return NextResponse.json({ ok: true, data: { broadcasts } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = BroadcastSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', (error as Error).message);
    }
    const id = await createBroadcast({
      title: parsed.data.title,
      templateId: parsed.data.templateId,
      url: parsed.data.url || null,
      data,
      createdBy: auth.user.id,
    });
    await queueBroadcast(id);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_created',
      metadata: { id, title: parsed.data.title },
    });
    return NextResponse.json({ ok: true, data: { id } });
  });
}
```

**`app/api/admin/wechat/broadcasts/[id]/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getBroadcast } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return badRequest('validation', 'the id must be a positive integer');
    }
    const broadcast = await getBroadcast(numericId);
    if (!broadcast) return badRequest('not_found', 'the announcement does not exist');
    return NextResponse.json({ ok: true, data: { broadcast } });
  });
}
```

**`app/api/admin/wechat/broadcasts/[id]/send/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getBroadcast } from '@/lib/wechat-broadcasts';
import { sendBroadcast } from '@/lib/wechat-sender';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return badRequest('validation', 'the id must be a positive integer');
    }
    const broadcast = await getBroadcast(numericId);
    if (!broadcast) return badRequest('not_found', 'the announcement does not exist');
    const result = await sendBroadcast(numericId);
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_sent',
      metadata: {
        id: numericId,
        title: broadcast.title,
        status: result.status,
        accepted: result.accepted,
        skipped: result.skipped,
        failed: result.failed,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

**`app/api/admin/wechat/broadcasts/[id]/cancel/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { cancelBroadcast, getBroadcast } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return badRequest('validation', 'the id must be a positive integer');
    }
    const broadcast = await getBroadcast(numericId);
    if (!broadcast) return badRequest('not_found', 'the announcement does not exist');
    const cancelled = await cancelBroadcast(numericId);
    if (!cancelled) {
      return badRequest('not_cancellable', 'this announcement has already been sent');
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_broadcast_cancelled',
      metadata: { id: numericId, title: broadcast.title },
    });
    return NextResponse.json({ ok: true, data: { id: numericId } });
  });
}
```

**`app/api/admin/wechat/test/route.ts`**:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { getWechatConfig, isWechatConfigured } from '@/lib/wechat-config';
import { sendTemplateMessage } from '@/lib/wechat-api';
import { validateTemplateData } from '@/lib/wechat-types';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  openid: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  url: z.string().max(512).optional(),
  data: z.record(z.string(), z.object({ value: z.string().min(1).max(200) })),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const config = await getWechatConfig();
    if (!isWechatConfigured(config)) {
      return badRequest('not_configured', 'the WeChat account is not configured yet');
    }
    const parsed = TestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('validation', parsed.error.message);
    let data;
    try {
      data = validateTemplateData(parsed.data.data);
    } catch (error) {
      return badRequest('validation', (error as Error).message);
    }
    try {
      await sendTemplateMessage(
        parsed.data.openid,
        parsed.data.templateId,
        data,
        parsed.data.url || null,
      );
    } catch (error) {
      return badRequest('send_failed', (error as Error).message);
    }
    await writeAudit({
      userId: auth.user.id,
      event: 'wechat_test_sent',
      metadata: { title: '测试消息', openid: parsed.data.openid },
    });
    return NextResponse.json({ ok: true, data: { accepted: true } });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/wechat-admin-routes.test.ts tests/unit/lib/audit.test.ts`
Expected: PASS — the route tests and the audit catalogue test both green.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/wechat lib/audit-format.ts tests/unit/app/api/wechat-admin-routes.test.ts
git commit -m "feat(wechat): the admin routes for the announcements [2026-11-20 17.25]"
```

---

### Task 9: The admin screen

**Files:**
- Create: `app/admin/wechat/page.tsx`
- Create: `components/admin/WechatConfigForm.tsx`
- Create: `components/admin/WechatBroadcastForm.tsx`
- Create: `components/admin/WechatBroadcastTable.tsx`
- Modify: `components/admin/AdminSidebar.tsx`
- Test: `tests/unit/lib/wechat-admin-page.test.ts`

**Interfaces:**
- Consumes: the seven admin routes from Task 8.
- Produces: `/admin/wechat` page; sidebar entry under 通讯 labeled 「微信公众号」.

**⚠️ UI 文案必须如实**：
- 「平台接受」不是「已送达」—— `errcode: 0` 只代表微信平台接受并投递。
- 「关注者人数」要显眼，**0 人时明确警告**。
- 模板数据字段名要写清楚「必须与微信模板里的字段名完全一致」。
- 要提醒「服务器 IP 需要加进公众号后台白名单」，以及「每日接口调用限额」。

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/wechat-admin-page.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('the WeChat admin screen', () => {
  it('has a page', () => {
    expect(existsSync(join(ROOT, 'app/admin/wechat/page.tsx'))).toBe(true);
  });

  it('has a configuration form', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatConfigForm.tsx'))).toBe(true);
  });

  it('has an announcement form', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatBroadcastForm.tsx'))).toBe(true);
  });

  it('has an announcement table', () => {
    expect(existsSync(join(ROOT, 'components/admin/WechatBroadcastTable.tsx'))).toBe(true);
  });

  it('is in the admin sidebar', () => {
    const sidebar = read('components/admin/AdminSidebar.tsx');
    expect(sidebar).toContain('/admin/wechat');
    expect(sidebar).toContain('微信公众号');
  });

  it('reuses an icon that is already imported', () => {
    const sidebar = read('components/admin/AdminSidebar.tsx');
    const iconMatch = sidebar.match(/href: '\/admin\/wechat', label: '[^']+',[^}]*icon: (\w+)/);
    expect(iconMatch).not.toBeNull();
    const iconName = iconMatch![1];
    expect(sidebar).toContain(`\n  ${iconName},`);
  });

  it('uses the shared header and panel — the admin layout already has the sidebar', () => {
    const source = read('app/admin/wechat/page.tsx');
    expect(source).toContain('PageHeader');
    expect(source).toContain('Panel');
    expect(source).not.toContain('AdminSidebar');
    expect(source).not.toContain('<h1');
  });

  it('reads the rows on the server and passes them down', () => {
    const source = read('app/admin/wechat/page.tsx');
    expect(source).toContain('listBroadcasts');
    expect(source).toContain('initialBroadcasts');
  });

  it('does not promise delivery — WeChat gives no delivery receipt', () => {
    const files = [
      'app/admin/wechat/page.tsx',
      'components/admin/WechatBroadcastTable.tsx',
      'components/admin/WechatConfigForm.tsx',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain('已送达');
      expect(source).not.toContain('送达成功');
    }
  });

  it('says that the count is what the platform accepted', () => {
    const source = read('components/admin/WechatBroadcastTable.tsx');
    expect(source).toContain('平台接受');
  });

  it('warns about the server IP whitelist', () => {
    const source = read('components/admin/WechatConfigForm.tsx');
    expect(source).toContain('IP');
    expect(source).toContain('白名单');
  });

  it('warns when there are no followers', () => {
    const source = read('components/admin/WechatConfigForm.tsx');
    expect(source).toContain('关注者');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/wechat-admin-page.test.ts`
Expected: FAIL — `app/admin/wechat/page.tsx` does not exist.

- [ ] **Step 3: Write the admin screen**

**`app/admin/wechat/page.tsx`** — ⚠️ **the admin layout already renders the
sidebar.** An admin page does NOT import `AdminSidebar`, does NOT wrap itself
in a `<div className="flex">`, and does NOT render its own `<h1>`. It opens
with `PageHeader` and lays its sections out in `Panel`s. **Copy
`app/admin/wecom/page.tsx` exactly** — same imports, same `dynamic` export,
same `async` server component shape.

```tsx
import { PageHeader } from '@/components/admin/PageHeader';
import { Panel } from '@/components/admin/Panel';
import { WechatConfigForm } from '@/components/admin/WechatConfigForm';
import { WechatBroadcastForm } from '@/components/admin/WechatBroadcastForm';
import { WechatBroadcastTable } from '@/components/admin/WechatBroadcastTable';
import { getWechatConfig } from '@/lib/wechat-config';
import { listBroadcasts } from '@/lib/wechat-broadcasts';

export const dynamic = 'force-dynamic';

export default async function AdminWechatPage() {
  const config = await getWechatConfig();
  const broadcasts = await listBroadcasts();
  return (
    <div>
      <PageHeader
        title="微信公众号"
        description="用服务号模板消息把公告推送给公众号的关注者。"
      />
      <div className="space-y-4">
        <Panel title="配置">
          <p className="text-sm text-ink-soft mb-3">
            推送由后台的定时任务（scheduler）完成，每分钟一次。如果 scheduler
            没有启用，公告会一直排队而不会发出 —— 请到「定期更新」页面确认它已开启。
          </p>
          <WechatConfigForm initialConfig={config} />
        </Panel>
        <Panel title="写公告">
          <WechatBroadcastForm />
        </Panel>
        <Panel title="公告记录">
          <WechatBroadcastTable initialBroadcasts={broadcasts} />
        </Panel>
      </div>
    </div>
  );
}
```

⚠️ **The page reads the database on the server** and passes the rows down as
props. The follower count is NOT read here — it needs a live call to WeChat,
so the config panel fetches it client-side from `/api/admin/wechat/followers`
after mount. A server component cannot await it without blocking the page on
a third-party API.

**`components/admin/WechatConfigForm.tsx`** — a `'use client'` component:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface WechatConfig {
  enabled: boolean;
  appId: string;
  appSecretSet: boolean;
}

interface Props {
  initialConfig: WechatConfig;
}

export function WechatConfigForm({ initialConfig }: Props) {
  const [config, setConfig] = useState<WechatConfig>(initialConfig);
  const [appSecret, setAppSecret] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followerError, setFollowerError] = useState<string | null>(null);

  // The follower count needs a live call to WeChat, so it is fetched after
  // mount rather than read on the server — a server component must not
  // block the whole page on a third-party API.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/admin/wechat/followers');
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setFollowerError(body.error?.message ?? '读取关注者数量失败');
          return;
        }
        setFollowerCount(body.data.count);
      } catch (caught) {
        if (!cancelled) {
          setFollowerError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/admin/wechat/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          appId: config.appId,
          appSecret,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'save failed');
      setConfig(body.data.config);
      setAppSecret('');
      setMessage('已保存');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [config, appSecret]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
        />
        启用微信公告
      </label>

      <label className="block text-sm text-ink">
        AppID
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={config.appId}
          onChange={(event) => setConfig({ ...config, appId: event.target.value })}
          placeholder="wx..."
        />
      </label>

      <label className="block text-sm text-ink">
        AppSecret
        <input
          type="password"
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          placeholder={config.appSecretSet ? '已配置，留空则不修改' : '尚未配置'}
        />
      </label>

      <div className="rounded border border-danger/40 bg-danger/5 p-3 text-xs text-ink-soft space-y-1">
        <p>请在公众号后台完成两项配置，否则调用会失败：</p>
        <p>1. 把服务器的公网 IP 加入「IP 白名单」，否则返回 40164。</p>
        <p>2. 每日接口调用有额度，发送人数 × 公告次数不要超出。</p>
      </div>

      <div className="text-sm">
        关注者：
        {followerCount === null ? (
          <span className="text-ink-soft">读取中…</span>
        ) : (
          <span className={followerCount === 0 ? 'text-danger font-semibold' : 'text-ink'}>
            {followerCount} 人
          </span>
        )}
        {followerCount === 0 && (
          <p className="text-danger text-xs mt-1">
            还没有关注者，公告发不出去。请把公众号的二维码放到站点上。
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-seal px-3 py-1 text-sm text-paper disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        {message && <span className="text-sm text-ink-soft">{message}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
```

**`components/admin/WechatBroadcastForm.tsx`** — a `'use client'` component with the template id, the jump url, and a dynamic list of template fields:

```tsx
'use client';

import { useCallback, useState } from 'react';

interface TemplateField {
  key: string;
  value: string;
}

export function WechatBroadcastForm() {
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState<TemplateField[]>([
    { key: 'first', value: '' },
    { key: 'keyword1', value: '' },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateField = useCallback((index: number, patch: Partial<TemplateField>) => {
    setFields((current) =>
      current.map((field, position) =>
        position === index ? { ...field, ...patch } : field,
      ),
    );
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const data: Record<string, { value: string }> = {};
    for (const field of fields) {
      if (field.key.trim() === '') continue;
      data[field.key.trim()] = { value: field.value };
    }
    try {
      const response = await fetch('/api/admin/wechat/broadcasts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, templateId, url, data }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'send failed');
      setMessage(`已入队：${body.data.id}，下一次 scheduler tick 会发出。`);
      setTitle('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [title, templateId, url, fields]);

  return (
    <div className="space-y-3">
      <label className="block text-sm text-ink">
        标题
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="v1.2 已上线"
        />
      </label>

      <label className="block text-sm text-ink">
        模板 ID
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          placeholder="TM00001"
        />
      </label>

      <label className="block text-sm text-ink">
        跳转链接（可留空）
        <input
          className="mt-1 w-full rounded border border-rule px-2 py-1 font-mono"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm text-ink">模板字段</p>
        <p className="text-xs text-ink-soft">
          字段名必须与公众号后台模板里的完全一致（keyword1 / thing2 / first / remark）。
        </p>
        {fields.map((field, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="w-40 rounded border border-rule px-2 py-1 font-mono text-sm"
              value={field.key}
              onChange={(event) => updateField(index, { key: event.target.value })}
              placeholder="keyword1"
            />
            <input
              className="flex-1 rounded border border-rule px-2 py-1 text-sm"
              value={field.value}
              onChange={(event) => updateField(index, { value: event.target.value })}
              placeholder="值"
            />
            <button
              type="button"
              onClick={() => setFields((current) => current.filter((_, p) => p !== index))}
              className="rounded border border-rule px-2 text-sm text-ink-soft"
            >
              删
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setFields((current) => [...current, { key: '', value: '' }])}
          className="rounded border border-rule px-2 py-1 text-sm text-ink-soft"
        >
          加一个字段
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded bg-seal px-3 py-1 text-sm text-paper disabled:opacity-50"
        >
          {busy ? '提交中…' : '发送公告'}
        </button>
        {message && <span className="text-sm text-ink-soft">{message}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
```

**`components/admin/WechatBroadcastTable.tsx`** — a `'use client'` component:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface Broadcast {
  id: number;
  title: string;
  templateId: string;
  status: string;
  totalRecipients: number;
  acceptedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  createdAt: string;
}

interface Props {
  initialBroadcasts: Broadcast[];
}

export function WechatBroadcastTable({ initialBroadcasts }: Props) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>(initialBroadcasts);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/wechat/broadcasts');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'read failed');
      setBroadcasts(body.data.broadcasts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  // The server already rendered the rows; refetching on mount would
  // replace them with the same rows for no reason.

  const act = useCallback(
    async (id: number, action: 'send' | 'cancel') => {
      setBusyId(id);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/wechat/broadcasts/${id}/${action}`,
          { method: 'POST' },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? 'the action failed');
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-ink/20 px-2 py-1 text-sm text-ink-soft"
        >
          刷新
        </button>
      </div>

      <p className="text-xs text-ink-soft">
        「平台接受」指微信平台接收了这条消息，不代表对方一定收到 —— 微信不提供送达回执。
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      {broadcasts.length === 0 ? (
        <p className="text-sm text-ink-soft">还没有发过公告。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-soft">
            <tr>
              <th className="py-1">标题</th>
              <th className="py-1">状态</th>
              <th className="py-1">人数</th>
              <th className="py-1">平台接受</th>
              <th className="py-1">跳过</th>
              <th className="py-1">失败</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {broadcasts.map((broadcast) => (
              <tr key={broadcast.id} className="border-t border-rule">
                <td className="py-1 text-ink">
                  {broadcast.title}
                  {broadcast.lastError && (
                    <p className="text-xs text-danger">{broadcast.lastError}</p>
                  )}
                </td>
                <td className="py-1 text-ink-soft">{broadcast.status}</td>
                <td className="py-1 font-mono">{broadcast.totalRecipients}</td>
                <td className="py-1 font-mono">{broadcast.acceptedCount}</td>
                <td className="py-1 font-mono">{broadcast.skippedCount}</td>
                <td className="py-1 font-mono">{broadcast.failedCount}</td>
                <td className="py-1 text-right">
                  {broadcast.status === 'queued' && (
                    <button
                      type="button"
                      disabled={busyId === broadcast.id}
                      onClick={() => void act(broadcast.id, 'send')}
                      className="rounded border border-rule px-2 py-0.5 text-xs"
                    >
                      立即发送
                    </button>
                  )}
                  {(broadcast.status === 'draft' || broadcast.status === 'queued') && (
                    <button
                      type="button"
                      disabled={busyId === broadcast.id}
                      onClick={() => void act(broadcast.id, 'cancel')}
                      className="rounded border border-rule px-2 py-0.5 text-xs ml-1"
                    >
                      取消
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

**`components/admin/AdminSidebar.tsx`** — add the entry to the 通讯 group:
```tsx
      { href: '/admin/wecom', label: '企业微信', exact: true, icon: MessageSquare },
      { href: '/admin/wechat', label: '微信公众号', exact: true, icon: Send },
      { href: '/admin/email/campaigns', label: '营销邮件', icon: Send },
```
⚠️ **`Send` is already imported** in that file (it is the 营销邮件 icon) —
**do not add a new import**. `MessageCircle` is NOT imported; using it would
mean editing the import list, and `Send` is already available. Two entries
sharing an icon is fine: the icon is a scan aid, not an identifier.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/wechat-admin-page.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — no regressions.

⚠️ `tests/unit/app/client-server-boundary.test.ts` has a known 5s timeout **in the full suite only** (it passes alone). That is pre-existing — see the memory `boundary-test-times-out-under-full-suite`. Do not chase it; if it fails, re-run that file alone to confirm.

- [ ] **Step 6: Commit**

```bash
git add app/admin/wechat components/admin/WechatConfigForm.tsx components/admin/WechatBroadcastForm.tsx components/admin/WechatBroadcastTable.tsx components/admin/AdminSidebar.tsx tests/unit/lib/wechat-admin-page.test.ts
git commit -m "feat(wechat): the admin screen for the announcements [2026-11-20 17.50]"
```

---

### Task 10: The real-machine check

**Files:**
- Modify: `DEPLOY.md`
- Create: `docs/superpowers/notes/2026-11-20-wechat-broadcast.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a deployment note and an implementation record.

**这一步不能跳。** 微信的调用是环境依赖 —— 注入测试全绿也证明不了 IP 白名单对、模板 ID 对、关注者拉得到。必须有真机跑一次。

- [ ] **Step 1: Write the note about the deployment steps**

**`DEPLOY.md`** — add a section 「微信公众号公告」with these facts:

1. 需要在公众号后台完成三件事：
   - **认证服务号**（订阅号没有模板消息权限）
   - **服务器公网 IP 加入 IP 白名单**（否则 `40164`）
   - **在「模板库」申请模板**，记下模板 ID 和字段名
2. 后台路径：`/admin/wechat`，填 AppID / AppSecret，开启「启用微信公告」。
3. 打开 `/admin/scheduler`，确认 `wechat-broadcast-send` 这个任务已启用（默认关闭）。
4. 写公告 → 入队 → scheduler tick 发出。**默认 scheduler 间隔是 60 分钟**，要更快就把 `scheduler.interval_min` 调小。
5. ⚠️ **每日接口调用有额度**（各账号不同，以后台「接口权限」页为准）。发送人数 × 公告次数不要超出。
6. ⚠️ **`errcode: 0` 只代表微信平台接受了消息**，不代表对方收到了。

- [ ] **Step 2: Verify on the real machine**

Run the dev server on port 4444 and check, in this order:

```bash
# 1. the table exists after the migration
npx tsx --env-file-if-exists=.env -e "
  import { getPool } from './lib/db';
  const pool = getPool();
  const [rows] = await pool.query('SHOW COLUMNS FROM wechat_broadcasts');
  console.log(rows.map((r) => r.Field).join(','));
  await pool.end();
"
```

Then, in the browser with the admin logged in:

- `/admin/wechat` loads, shows the configuration form and the announcement table
- the follower count shows a real number (not zero — if it is zero, `user/get` is not returning the followers; check the IP whitelist and the credentials)
- 「发送公告」 with a real template id creates a row with status `queued`
- the scheduler tick turns it into `sent` with `accepted_count` equal to the follower count
- the message actually arrives in WeChat ⚠️ **this is the check that matters** — the database says `sent` whether or not the message arrived, so a human has to look at their phone.

⚠️ **If the follower count is zero, the feature cannot be verified.** Stop and report it rather than declaring the feature done.

- [ ] **Step 3: Write the implementation record**

**`docs/superpowers/notes/2026-11-20-wechat-broadcast.md`** — record:
- the four error classes and what each one does
- the real-machine measurements: follower count, what the template id was, whether the message arrived
- the two things that had to be configured on the WeChat side (IP whitelist, template id)
- **what was not done**

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md docs/superpowers/notes/2026-11-20-wechat-broadcast.md
git commit -m "docs(deploy): the WeChat broadcast needs three settings on the WeChat side [2026-11-20 18.10]"
```

---

## Self-Review

**1. Spec coverage** — every section of the spec maps to a task:

| Spec section | Task |
|---|---|
| §3.1 模板消息接口约束 | Task 2 (error codes), Task 3 (the call) |
| §3.2 关注者名单（`user/get` 分页） | Task 3 |
| §3.3 access_token | Task 3 |
| §5.1 `wechat_broadcasts` 表 | Task 1 |
| §5.2 没有 per-recipient 表 | Task 1 (the comment says why) |
| §5.3 配置键 | Task 7 |
| §6 架构 | Tasks 4, 5, 6 |
| §7 后台界面 | Task 9 |
| §8 失败与可观测性 | Task 5 (the error table), Task 6 (the scheduler summary) |
| §9 安全考量 | Task 7 (the secret), Task 8 (the admin guard), Task 9 (the warnings) |
| §10 实施计划 | this plan |

**2. Step scan** — every step has a checkable result. No "TBD", no "handle edge cases".

**3. Type consistency** — `WechatBroadcast`, `WechatTemplateData`, `WechatBroadcastStatus` are defined in Task 2 and used by Tasks 4, 5, 6, 8 with the same names. `sendBroadcast` returns `BroadcastSendResult` (Task 5) and Task 6 reads `.status`, `.totalRecipients`, `.accepted`, `.skipped`, `.failed`, `.error` — all present. `WechatConfig` is defined in Task 7 and consumed by Task 8 and Task 9 with the same field names.

**4. Review Focus** — each of the five lines maps to a task:
1. 跨页 → Task 3「follows the next_openid cursor until the list ends」
2. `errcode: 0` 无 errmsg → Task 3「treats a zero errcode with no errmsg as success」
3. 空值字段 → Task 2「rejects an empty value」
4. 关注者为 0 → Task 3「returns an empty list when the account has no followers」
5. `47003` 停手 → Task 5「stops the run instead of retrying」

**5. Proportion** — the plan is ~1100 lines for ~1400 lines of production code across 14 files. The code blocks are the implementation the task needs verbatim (a reviewer cannot reconstruct the migration SQL or the error table from a sentence), and the prose is limited to what the code does not decide.

**6. One thing this plan cannot prove** — the tests mock `fetch`. They cannot prove the IP whitelist is set, the template id is real, or the follower list comes back. **Task 10 is where that gets checked, and it needs a human to look at their phone.**
