# Plan B: 用户系统 — 设计文档

> **For agentic workers:** 完成后通过 superpowers:writing-plans 进入实现。

**Goal:** 给 Plan A 的字↔拼音工具加上账号系统。登录后用户的字→拼音和拼音→字转换自动入库，统计总阅读字数和收藏字数。后端留审计日志记录注册和关键使用事件。

**Architecture:** Next.js 15 App Router + MySQL 8 + JWT cookie auth。bcryptjs 哈希密码（纯 JS，免编译），jsonwebtoken 签 token，mysql2/promise 驱动。前端登录态存 zustand（持久化），服务端读 cookie。

**Tech Stack:** mysql2, bcryptjs, jsonwebtoken, zustand (已用), React 19, Tailwind 4

**Out of scope (Plan C):** 简繁真实实现、响应式深度优化、E2E 测试。**Out of scope for Plan B itself:** 密码找回、邮箱验证、OAuth、用户主动删除账号。

---

## 1. 数据模型

### 1.1 users

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `username` | VARCHAR(32) | UNIQUE, NOT NULL |
| `password_hash` | VARCHAR(72) | NOT NULL（bcrypt 输出固定 60 字符，72 给兼容） |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

索引：`UNIQUE(username)`（隐式）。

### 1.2 history

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `user_id` | BIGINT | FK → users.id, ON DELETE CASCADE |
| `kind` | ENUM('text2pinyin','pinyin2text') | NOT NULL |
| `input` | TEXT | NOT NULL（字或拼音原文） |
| `output` | TEXT | NULL（text2pinyin 可重算，存 NULL；pinyin2text 存结果汉字） |
| `is_favorite` | BOOLEAN | DEFAULT FALSE |
| `char_count` | INT UNSIGNED | NOT NULL（用于统计，预先算好） |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

索引：
- `(user_id, created_at DESC)` — 列表默认按时间倒序
- `(user_id, is_favorite, created_at DESC)` — 收藏页过滤

### 1.3 audit_log

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT |
| `user_id` | BIGINT | NULLABLE（注册事件时该值是新用户 id，注册前为 NULL 也行；统一写新 id） |
| `event` | VARCHAR(32) | NOT NULL，见枚举 |
| `metadata` | JSON | NULL（事件附加信息，如 `{ kind, char_count }`） |
| `ip` | VARCHAR(45) | NULL（IPv6 最长 45 字符） |
| `user_agent` | VARCHAR(255) | NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

索引：`(user_id, created_at DESC)`, `(event, created_at DESC)`。

**event 枚举**：`register`, `login`, `logout`, `history_create`, `history_delete`。**不记录** `history_favorite`/`history_unfavorite`（避免频繁状态变化污染日志；收藏仅是 history 行的字段变化，不是用户关键事件）。

### 1.4 字符计数规则

`char_count` = `input` 字符串长度（JavaScript `.length`，即 UTF-16 code units）。
- 简化统计：不去 emoji 算、不去标点算。CJK 占 1 unit，所以"你好"=2。
- 如果需要更精确（CJK 占 1 实际字符），后续可改用 `[...input].length`（code points）。

---

## 2. 认证

### 2.1 注册 / 登录

- 用户名：3-32 字符，`/^[a-zA-Z0-9_\-]+$/`。
- 密码：≥ 8 字符，≥ 72 字符拒收（bcrypt 截断），中间无空白检查。
- 注册：bcrypt cost 10 哈希。失败时返回 400 with 字段错误。
- 登录：bcrypt 比对。成功签发 JWT。

### 2.2 JWT / Cookie

- Payload: `{ userId: number, username: string, iat, exp }`
- 过期：7 天。
- 签名：`HS256`，secret 从 `JWT_SECRET` env 读（必须 ≥ 32 字节，启动时校验，缺失则启动失败）。
- Cookie：HTTP-only, SameSite=Lax, Path=/, Max-Age=7d, Secure 由 env 决定（生产开）。
- Cookie 名：`auth_token`。
- Server Components / Route Handlers 用 `lib/auth.ts:getCurrentUser()` 读 cookie 解析。

### 2.3 接口

| Method | Path | Body | 行为 |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | 创建用户，签 JWT，set cookie，返回 user |
| POST | `/api/auth/login` | `{username, password}` | 校验，签 JWT，set cookie，返回 user |
| POST | `/api/auth/logout` | — | 清 cookie，返回 204 |
| GET | `/api/auth/me` | — | 读 cookie，返回 user 或 401 |

成功响应统一 `{ ok: true, data: { user } }`，错误 `{ ok: false, error: { code, message } }`（与 Plan A 一致）。

---

## 3. History / Stats API

| Method | Path | Query / Body | 行为 |
|---|---|---|---|
| GET | `/api/history` | `?favorite=true&limit=50&offset=0` | 列出当前用户的记录，按时间倒序，filter by favorite |
| POST | `/api/history` | `{kind, input, output, char_count}` | 新建一条；写 audit_log |
| PATCH | `/api/history/:id` | `{is_favorite: boolean}` | 切换收藏位（**不**写 audit_log） |
| DELETE | `/api/history/:id` | — | 删除一条（写 audit_log） |
| GET | `/api/stats` | — | `{ total: int, favorites: int }` |

**限流**（v1 简化）：仅校验 401，不做速率限制。后续可加 per-IP 限流。

**分页**：默认 `limit=50`，最大 `200`。`offset` 简单分页，够 v1 用。

**所有权**：所有 `GET/PATCH/DELETE` 都校验 `user_id == currentUser.id`，否则 404（不暴露存在性）。

---

## 4. 前端

### 4.1 状态管理（`lib/store.ts`）

新增 `user: User | null` + `setUser(user)`，依然走 zustand persist 存到 localStorage（key 同 `pinyin-app-state`）。**注意**：cookie 才是权威，store 里只是缓存。组件挂载时（`app/layout.tsx` 顶层 effect）调 `/api/auth/me` 同步一次。

```ts
interface User { id: number; username: string; }
interface AppState {
  safeMode: boolean; script: Script; user: User | null;
  setSafeMode, setScript, setUser: (u: User | null) => void;
}
```

### 4.2 Header 变化

- 未登录：右上角 `[登录 / 注册]` 按钮（点开 modal）。
- 已登录：右上角 `[用户名 ⌄]` 按钮，展开下拉：
  - 我的主页（`/profile`）
  - 历史记录（`/history`）
  - 收藏夹（`/history?favorite=true`）
  - 退出登录

下拉用纯 CSS + React state，**不引第三方下拉库**。

### 4.3 AuthModal 组件

`components/AuthModal.tsx`：
- 顶部两个 tab：[登录] [注册]
- 表单字段：username, password
- 客户端预校验（≥ 3 字符、≥ 8 字符）
- 提交时调 `/api/auth/{login,register}`，成功后 close + 刷新
- 错误时显示后端返回的 message

### 4.4 History 页面

`app/history/page.tsx`（server component）：从 cookie 取 user，调 `/api/history?favorite=...`，渲染列表。

`components/HistoryList.tsx`（client component，每行）：
- 显示 `kind` 图标、`input` 截断、`output` 截断、`char_count` 字符数、`created_at` 相对时间
- ⭐ 按钮（实心/空心），点击 PATCH
- 🗑 按钮，点击 DELETE（**无确认**）
- 空状态：提示"还没有记录，先去试试上面的工具"。

`favorites=true` 时整页只显示收藏的。Header 链接直接 `?favorite=true`。

### 4.5 Profile 页面

`app/profile/page.tsx`：调 `/api/stats` 显示两个大字：总字数 / 收藏字数。也列出"按月"的简单分布（最近 6 个月每月字数）。如果用户未登录则 redirect 到 `/?auth=login`。

### 4.6 自动入库触发

| 组件 | 触发时机 |
|---|---|
| `TextToPinyin` | 输入非空 → 1.5s debounce → POST；同时记录 `output = null, char_count = input.length`。组件 unmount 时 flush pending。 |
| `PinyinInputMethod` | 6s 无候选点击 / 输入框清空时 POST（保存已选汉字串）。如果只选了 0-1 个字并清空，跳过。 |
| `PinyinFullSentence` | 点 转换 按钮瞬间 POST（与 fetch sentence 并行）。 |

**去重**：每次 POST 前查最近 60 秒内 `kind + input` 相同则跳过（用 `useRef` 缓存最近一次时间戳 + input hash，避免多余请求）。

**网络失败**：静默失败，仅 console.error，不打扰用户（用户已在 UI 看到结果了，日志丢失无伤大雅）。

**未登录时**：直接跳过 POST，组件功能照常工作（历史是 optional）。

---

## 5. 文件结构（最终）

```
app/
  api/
    auth/
      register/route.ts          +
      login/route.ts             +
      logout/route.ts            +
      me/route.ts                +
    history/
      route.ts                   +
      [id]/route.ts              +
    stats/
      route.ts                   +
  history/
    page.tsx                     +
  profile/
    page.tsx                     +
  layout.tsx                     ~ (新增 sync user)
  page.tsx                       (无变化)
components/
  AuthModal.tsx                  +
  UserMenu.tsx                   +
  HistoryList.tsx                +
  Header.tsx                     ~ (未登录显示按钮 / 已登录显示菜单)
  TextToPinyin.tsx               ~ (auto-save)
  PinyinInputMethod.tsx          ~ (auto-save)
  PinyinFullSentence.tsx         ~ (auto-save)
lib/
  auth.ts                        + (jwt 签/验、cookie 读写、getCurrentUser)
  db.ts                          + (mysql2 pool)
  history.ts                     + (CRUD)
  audit.ts                       + (writeAudit)
  store.ts                       ~ (加 user)
  api.ts                         ~ (history 端点)
scripts/
  init-db.ts                     + (CREATE TABLE IF NOT EXISTS)
instrumentation.ts               ~ (启动时 init DB pool + run init-db)
.env.example                     ~ (DATABASE_URL, JWT_SECRET)
README.md                        ~ (新增账号部分)
```

---

## 6. 数据库初始化

`scripts/init-db.ts`：
- 读 `DATABASE_URL`，连 MySQL。
- 执行 3 条 `CREATE TABLE IF NOT EXISTS`。
- 用 `IF NOT EXISTS` 保证幂等。
- 失败抛错（启动中止）。

`instrumentation.ts` 在 `NEXT_RUNTIME === 'nodejs'` 时先 `await import('./scripts/init-db')` 再 `loadDictionaries()`。**注意**：`init-db` 用 top-level await + 顶层 connect，开发模式 Next.js 重启时只连一次（pool 缓存）。

---

## 7. 测试策略

### 7.1 单元测试
- `lib/auth.ts`: JWT 签/验 roundtrip、过期检测、错误 secret 检测
- `lib/db.ts`: pool 创建（不连真实库，注入 mock）
- `lib/history.ts`: CRUD with in-memory MySQL（或 vitest 用 sqlite 替身，谨慎标注差异）
- `lib/audit.ts`: 写入格式
- `bcrypt` 密码 roundtrip
- 用户名/密码校验函数

**测试 DB**：dev/test 用同一个 MySQL 实例不同 schema。`init-db.ts` 加 `IF NOT EXISTS` schema_name 切换。

### 7.2 集成测试
- register → me → 拿到 user
- register → login → me
- 未登录访问 /api/history → 401
- register → POST history → GET 看到记录 → PATCH favorite → DELETE → GET 看不到
- register → GET stats → { total: 0, favorites: 0 }
- 注册 / 登录 / 删除 history 时 audit_log 各 +1 行

### 7.3 手动冒烟
1. 注册新用户 → cookie 设置
2. 用 字→拼音 输入"你好世界" → 1.5s 后 history 多一行
3. 在 history 页 ⭐ → 收藏
4. profile 页看到 total=4, favorites=4
5. 退出登录 → 右上角变回登录按钮
6. 重登 → 数据还在
7. 短时间重复输"你好世界" → history 只有一行（去重生效）

---

## 8. 已知限制 / 不做

- **无密码找回**：忘记密码 = 重新注册（生产前要加）
- **无邮箱验证**：username 唯一即可
- **无 soft delete**：history 删除是真删
- **无数据导出**：v1 不做
- **无管理员后台**：audit_log 存在但 v1 不做查看 UI
- **无速率限制**：被刷就刷，依赖后续 reverse proxy
- **safeMode / script 仍是客户端**：跨设备不同步

---

## 9. 与 Plan A 的边界

- 现有 API 路由（`/api/pinyin/candidates`、`/api/pinyin/sentence`）**不变**，继续 anonymous 可用。
- `instrumentation.ts` 在 `loadDictionaries` 之外加 `initDb`。
- 不影响 Plan C（简繁 + 响应式 + E2E）。
- Plan C 后续可以：加用户 settings 页（同步 safeMode 到服务端）、加 audit_log 查看 UI。
