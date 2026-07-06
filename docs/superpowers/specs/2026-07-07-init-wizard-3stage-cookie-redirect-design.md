# Init Wizard 3-Stage Redesign + Cookie-Based Auto-Redirect

**Goal:** 把 `/init` 从单页 3 视图改成 3 个独立 URL + 9 卡片按 3 组视觉分组 + middleware 用 cookie 替代 DATABASE_URL 缺失检查做自动跳转,顺手修旧 wizard 的 500 端点 `init-db`、密码回填、`autocomplete` 缺失 3 个 bug。

**Architecture:** 把 `app/init/page.tsx` 拆成 `app/init/db` + `app/init/admin` + `app/init/execute` 3 个独立 page,共享 `<InitHeader>` 顶栏。step 1 写 `.env` + 热加载 (沿用 `lib/setup.ts` 已实现的 `reloadProcessEnvFromFile()`),step 2 用 client-only `useState` + `sessionStorage` 暂存 admin,step 3 一次性顺序调 9 个现有 `/api/init/*-tables / *-app-config / *-poems / *-sutras / *-chars / *-create-admin / *-activate / migrate / *-mark-complete`,UI 把这 9 张子卡按 3 组 (数据库结构 / 数据导入 / 账号与激活) 折叠展现。`middleware.ts` 反转:任何非白名单路径 + `setup_completed` cookie 未设 → redirect `/init` (替换现有的 `!DATABASE_URL` 检查)。

**Tech Stack:** Next.js 15.5.19 App Router (RSC + Client Components), mysql2 (无改动), `lib/setup.ts` helpers 沿用, sessionStorage (无 deps), Vitest + happy-dom。

## Global Constraints

- 不重写 `lib/setup.ts` 的 writeEnvVars / reloadProcessEnvFromFile / testDbConnection — 全沿用,只在外层调整调用顺序
- 不动 `/api/init/*` 9 个端点的功能 — 接口签名、返回值、错误码不变
- 不改 `app/api/init/status/route.ts` 返回结构 — `setupComplete + routeEnabled` 两个 boolean 仍权威
- 不把 admin 密码写入 `.env` 或 `app_config` — 仅 client state + sessionStorage,执行后清空
- DB password 也不入 sessionStorage — 仅 useState 留到 step 1 提交,提交后立刻 reset
- 不改 `setup.completed` / `setup.route_enabled` 这两个 `app_config` 标志的语义
- 不改 `instrumentation.ts` 的 initAppConfig / initPoems / initSutras / initChars / initActivate 早期判断 — `app_config has 15 rows → skip seed` 等逻辑保留
- 不动 `<TSSuspense>` / `<InitHeader>` 的图标库 — 仍用 lucide-react (Database / User / Rocket / Check / X / Loader2)
- `tsconfig.json` path alias `@/*` 不变
- 不引入新 dep
- 文件改动 ~13 个 (9 new + 4 modified),新测试文件 ~3 个,改动量在 spec 范围内
- 仅本地 main 工作,产出后留待手动决定是否 push 到 origin/main (用户已 prod 在 `ziyun.pudafo.com`,但走的是手动同步;按 `no-prod-env-2026-06-21` 本地工作流,不主动 push)

## Concept

### 当前状态

#### Wizard

`app/init/page.tsx:54` 是单页 client component,`useState<Step>` 在 3 个视图 (`'db' | 'admin' | 'seed'`) 之间切换。所有数据走单页面内部 state。

#### 9 个 step 3 子步骤

`app/init/page.tsx:170-188` 列了 9 个 phases,每个一个 endpoint:

| 序号 | endpoint | 用途 |
|---|---|---|
| 1 | `init-tables` | 建 25 张表 |
| 2 | `init-app-config` | 写 app_config 默认行 |
| 3 | `init-poems` | 导入 624 首 |
| 4 | `init-sutras` | 导入 11 经 |
| 5 | `init-chars` | 导入 7909 字 |
| 6 | `create-admin` | 创管理员 (要 step 2 抓的 username/password) |
| 7 | `init-activate` | 写激活行 |
| 8 | `migrate` | 应用 18 个 migration |
| 9 | `mark-complete` | 置 setup.completed = true |

UI 把这 9 张卡一字排开 (`app/init/page.tsx:421-475`),用户嫌"混在一起"。

#### Middleware

`middleware.ts:14-48` 顺序检查:
1. 白名单 (init 自身 / api/init/* / _next / favicon)
2. `setup_completed=1` cookie → allow
3. `!process.env.DATABASE_URL` → redirect `/init`
4. → allow

问题:DB 已配但 setup 未跑完时,`!DATABASE_URL` 假 → 第 4 步 allow → **用户访问首页完全进不来 /init**,得手动打 URL。用户明确要求"部署的开始默认进 /init"。

#### 旧 bug

浏览器控制台:
- `POST https://ziyun.pudafo.com/api/init/init-db 500` — 端点已被 `a00c6106` 删除,但旧 client bundle 缓存仍在调
- `<input type="password" value="Admin909217">` — step 1 的 dbConfig.password 提交后还留在 state,NAV 回到 step 1 时回显
- `[DOM] Input elements should have autocomplete attributes` — Browser 报警,所有 `<input>` 都没 `autoComplete`

### 期望行为

#### Wizard 流程

```
fresh deploy (没 .env + 没 cookie)
  → 任何 URL 都跳 /init
  → /init → /init/db (因 wizard.db_done === false)
  
/init/db submit
  → 写 .env (DATABASE_URL + JWT_SECRET + COOKIE_SECURE)
  → reloadProcessEnvFromFile() + closePool()
  → (db_done 由 `process.env.DATABASE_URL` 是否配置推断,无需写 app_config 标志)
  → 跳 /init/admin

/init/admin submit
  → zod validation only (无 DB 写, 无 .env 写)
  → POST /api/init/stash-admin 拿 token (密码走服务端内存,不入 sessionStorage)
  → sessionStorage['piyin.init.admin.creds'] = {username, email, token} (无密码)
  → 写入 app_config: setup.wizard.admin_done = 'true'
  → 跳 /init/execute

/init/execute click "开始初始化"
  → 9 张子卡片依次 POST 9 个 endpoints (沿用现有顺序, 现有错误处理, 失败 abort)
  → 全部 done → mark-complete 顺带 Set-Cookie: setup_completed=1
  → 跳 /init (locked state: 显示 "系统已初始化完成")
```

#### Step 3 视觉分组

```
┌────────────────────────────────────────────────────┐
│ ▼ 数据库结构 (0/3 完成)                            │
│   • 建表           [   ] 等待                      │
│   • app_config 默认 [   ] 等待                      │
│   • 应用迁移        [   ] 等待                      │
├────────────────────────────────────────────────────┤
│ ▼ 数据导入 (0/3 完成)                              │
│   • 古诗           [   ] 等待                      │
│   • 佛经           [   ] 等待                      │
│   • 字典           [   ] 等待                      │
├────────────────────────────────────────────────────┤
│ ▼ 账号与激活 (0/3 完成)                            │
│   • 创建管理员     [   ] 等待                      │
│   • 平台激活       [   ] 等待                      │
│   • 标记完成       [   ] 等待                      │
└────────────────────────────────────────────────────┘
[ 开始初始化 ]   ← 失败时变 [ 重试失败步骤 ]
```

每组 3 张,组内小组件 (icon + 名 + 状态 badge + 详情文字),组标题 `▼/▶` 可折叠 (默认展开),全组完成后整组合并绿色边框。每个 endpoint 的 `detail` 沿用当前格式 (e.g., "新增 624 行" 或 "已跳过 (表内已有数据)")。

#### Middleware 反转

`middleware.ts:14-48` 改成:

```ts
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. 白名单 — 不变
  if (pathname === '/init' || pathname.startsWith('/api/init/')) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/icon') || pathname.startsWith('/apple-icon')) return NextResponse.next();

  // 2. setup 完成 → allow
  if (req.cookies.get('setup_completed')?.value === '1') return NextResponse.next();

  // 3. 任何 setup 未完成的状态 → 强制跳 /init
  const url = req.nextUrl.clone();
  url.pathname = '/init';
  return NextResponse.redirect(url);
}
```

影响:
- 没 .env 部署:① 通过,因为 wizard 在白名单
- 有 .env 但 setup 没跑: ① 落到 /init → /init/db 已 DB 配置完了,直跳 /init/admin
- setup 跑完:② 通过

#### 旧端点 `init-db` 加 410 shim

`app/api/init/init-db/route.ts` 加回来,只返回:
```ts
return NextResponse.json(
  { ok: false, error: { code: 'stale_build', message: '请硬刷新浏览器 (Ctrl+Shift+R) 后重试。这是旧版 wizard 的端点,新版已分拆。' } },
  { status: 410 }
);
```

#### Form bug 修复

| Bug | 修法 |
|---|---|
| `<input value="Admin909217">` | step 1 提交成功后立刻 `setDbConfig({...DEFAULT_DB, ...cfg, password: ''})`; screen 1 重渲染不携带 password |
| `[DOM] Input elements should have autocomplete` | DB host/user: `autoComplete="off"`<br>DB password: `autoComplete="current-password"`<br>Admin username: `autoComplete="username"`<br>Admin password: `autoComplete="new-password"`<br>Admin email: `autoComplete="email"` |
| Admin password 在 step 2 → 3 后泄漏 | step 3 调完 `/api/init/mark-complete` 后,`sessionStorage.removeItem('piyin.init.admin.creds')` + `setPassword('')` |

## Architecture

### 路由分层

```
app/
├── init/
│   ├── page.tsx               # orchestrator: 读 /api/init/status, 重定向到 /init/{db|admin|execute} 或显示 locked card
│   ├── db/page.tsx            # NEW: 第 1 屏 (server component 壳 + client form)
│   ├── admin/page.tsx         # NEW: 第 2 屏
│   └── execute/page.tsx       # NEW: 第 3 屏
├── api/init/
│   ├── status/route.ts        # 不变 (现成的 status 返回)
│   ├── db-config/route.ts     # 不变 (已在 step 1 submit 调)
│   ├── admin/route.ts         # 不变 (validation only)
│   ├── init-tables/route.ts   # 不变
│   ├── init-app-config/route.ts # 不变
│   ├── init-poems/route.ts    # 不变
│   ├── init-sutras/route.ts   # 不变
│   ├── init-chars/route.ts    # 不变
│   ├── create-admin/route.ts  # 不变 (已有 username/password/email body)
│   ├── init-activate/route.ts # 不变
│   ├── migrate/route.ts       # 不变
│   ├── mark-complete/route.ts # 不变 (cookie 不变)
│   └── init-db/route.ts       # NEW: 410 shim
components/
├── init/
│   ├── InitHeader.tsx         # NEW: 三步指示器 (复用 lucide ReactNode)
│   ├── InitStepHeader.tsx     # NEW: 单步 page header (复用)
│   └── StepGroup.tsx          # NEW: step 3 的分组折叠卡片
```

### `/init` orchestrator 逻辑

`app/init/page.tsx` 改为 RSC server component,读 `isSetupComplete()` + `isSetupRouteEnabled()`,然后 `redirect()` 到对应 URL:

```tsx
export const dynamic = 'force-dynamic';

export default async function InitOrchestrator() {
  if (await isSetupComplete()) {
    // Set the cookie on first visit so this browser can navigate freely
    // (e.g., click "前往登录") without being redirected back to /init by
    // the cookie-only middleware. 10-year maxAge mirrors mark-complete.
    cookies().set('setup_completed', '1', {
      path: '/', maxAge: 60 * 60 * 24 * 365 * 10, sameSite: 'lax', httpOnly: false,
    });
    return <AlreadyDoneCard />;
  }
  // setup 没跑完 → orchestrator 落到第 1 屏; 各屏自己再 redirect 到正确位置
  redirect('/init/db');
}
```

> 关键:orchestrator 必须设 cookie,否则已完成 setup 的新浏览器第一次访问 /login 会被中间件 → /init → /init 又是 locked → AlreadyDoneCard → 死循环。设了 cookie 后后续 navigation 走 middleware 第 2 步 allow。

但要拿到 setup.wizard.admin_done 这个新标志需要新 helper。我倾向于在 `lib/setup.ts` 加:

```ts
export async function isInitWizardAdminDone(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const { getPool } = await import('./db');
  const [rows] = await getPool().query<any[]>(
    `SELECT value FROM app_config WHERE \`key\` = 'setup.wizard.admin_done' LIMIT 1`
  );
  return rows.length > 0 && rows[0].value === 'true';
}
```

`setup.wizard.admin_done` 在 `/api/init/admin` route 收到有效请求后写入 (validation pass 即写),作为"管理员信息已采集过"的标记。同时也作为重入保护:已写过的就不再展示表单,直接跳到 /init/execute。

> 注:db_done 直接由 `process.env.DATABASE_URL` 是否配置推断,不需要单独 helper/标志。`/init/db` page 在 server component 用 `process.env.DATABASE_URL` 直接判断。

### Step 1 (`/init/db`) 设计

- Server component: 检查 `process.env.DATABASE_URL` (直接读) — 已配就 `redirect('/init/admin')`
- Client form:
  - 用 `useState<DbConfig>` (DEFAULT_DB 沿用现有)
  - 输入字段: host (autoComplete="off") / port / user (autoComplete="off") / database / password (autoComplete="current-password")
  - 提交 `/api/init/db-config`,onSuccess:
    1. `setDbConfig({ ...DEFAULT_DB, ...cfg, password: '' })` (清密码)
    2. `router.push('/init/admin')`
  - onError 沿用现有 `setErr(...)` 模式

### Step 2 (`/init/admin`) 设计

- Server component: 检查 `isInitWizardAdminDone()` — 已 mark 就 `redirect('/init/execute')`
- Client form:
  - useState: username / password / email
  - autoComplete: username / new-password / email
  - 提交 `/api/init/stash-admin`,onSuccess:
    1. 把 `token` + `{username, email}` (无密码) 写到 sessionStorage
    2. `router.push('/init/execute')`
  - 注: password 走服务端内存 Map (见 `lib/init-credentials.ts`);sessionStorage 仅存 token + 展示用 `{username, email}`,密码绝不落客户端。

**这里有个 trade-off**:`/init/admin` 和 `/init/execute` 是两个独立的 RSC page tree,client state 不共享。pass password 跨 page 的选项:

**选项 A:** sessionStorage 也存密码 (但加密/标记 expire,30s 内 step 3 拿完即删)
- 优点:实现简单
- 缺点:密码短暂落盘 (即使 sessionStorage),稍微弱化安全

**选项 B:** step 2 提交时把 password POST 给新端点 `/api/init/stash-admin`,服务端存在内存 (Map<token, {username,password,email,expiresAt}>) 返回 token;step 3 从 sessionStorage 拿 token,execute 时把它跟 username/email 一起 POST 给 create-admin 端点
- 优点:密码不落 sessionStorage,服务端内存短 TTL
- 缺点:新端点 + 状态管理

**选项 C:** step 2 提交 `/api/init/create-admin/preset` 端,直接把 username/password/email 写到一个 `app_config` 行 (e.g., `setup.wizard.admin_creds` JSON,值 base64 编码),step 3 后续 `init-db` 流程读这个值,完成后清掉
- 优点:server-side state,无 sessionStorage 风险
- 缺点:密码短暂存 DB,理论不安全

**选项 D:** 把 wizard 改成 single-page 3 views 但 URL 走 query (e.g., `/init?step=2`),保留 useState
- 优点:client state 自动保留
- 缺点:跟用户要求的"3 个独立 URL"违背

权衡后我推荐 **选项 B (token 模式)**。理由:
- sessionStorage 存密码即使是 30s TTL 也违反"无敏感数据落客户端"的工程原则
- 选项 C 把密码写 DB 太重,虽然加密但仍然不对
- 选项 D 违背用户的 "3 屏独立 URL" 要求
- 选项 B 实现 50 行代码,内存 Map 几行就够,30s 内 step 3 必须用掉否则重新登录

实现:
```ts
// lib/init-credentials.ts
const STORE = new Map<string, { username: string; password: string; email?: string; expiresAt: number }>();

export function stashAdminCredentials(input: { username; password; email? }) {
  const token = randomBytes(16).toString('hex');
  STORE.set(token, { ...input, expiresAt: Date.now() + 30_000 });
  return token;
}

export function consumeAdminCredentials(token: string) {
  const v = STORE.get(token);
  if (!v) return null;
  if (v.expiresAt < Date.now()) { STORE.delete(token); return null; }
  STORE.delete(token);  // 一次性消费
  return { username: v.username, password: v.password, email: v.email };
}

export function gcExpired(): void {
  for (const [k, v] of STORE) if (v.expiresAt < Date.now()) STORE.delete(k);
}
setInterval(gcExpired, 60_000).unref();
```

新端点 `app/api/init/stash-admin/route.ts`:
```ts
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    if (!(await isSetupRouteEnabled())) return badRequest('setup_disabled', '/init is disabled.');
    const parsed = adminSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest('invalid_input', parsed.error.issues.map(i => i.message).join('; '));
    const token = stashAdminCredentials(parsed.data);
    return NextResponse.json({ ok: true, data: { token, expiresInSec: 30 } });
  });
}
```

`/api/init/create-admin/route.ts` 改 body:从 `{username, password, email}` 改为 `{token}`。服务端 `consumeAdminCredentials(token)` 拿真值。如果 token 过期 / 错,返回 `token_expired` 错误。

`* 注:` sessionStorage 仍存 `token` 和 `{username, email}` (无密码) 用于 step 3 UI 显示"创建的用户名:foo (foo@bar.com)"。密码绝不落客户端。

### Step 3 (`/init/execute`) 设计

- Server component: 检查 setup 未完成 (isSetupComplete 假才允许进)
- Client component:
  - `<InitHeader currentStep={2}>` (0-indexed: db=0, admin=1, execute=2)
  - `<StepGroup>` 三组:数据库结构 / 数据导入 / 账号与激活
  - 9 张子卡片,数据从 `subSteps` state (现有模式沿用)
  - "开始初始化" 按钮 (沿用)
  - 失败 "重试失败步骤" 按钮 (沿用)
  - "完成 — 前往登录" 按钮 (沿用)
- fetch 链条 (沿用现有 handler 模式):
  - 读 `sessionStorage['piyin.init.admin.creds']` 拿 `{username, email}` + `token`
  - 9 phases:
    - `tables` → `init-tables`
    - `app_config` → `init-app-config`
    - `poems` → `init-poems`
    - `sutras` → `init-sutras`
    - `chars` → `init-chars`
    - `create_admin` → `create-admin` body: `{token}`
    - `activate` → `init-activate`
    - `migrations` → `migrate`
    - `mark_complete` → `mark-complete`
- 完成全部 → `sessionStorage.removeItem('piyin.init.admin.creds')` + `router.push('/init')` 显示 locked card

### 路由失败表

| Page | `!DATABASE_URL` | DB 已配, `!admin_done` | DB + admin_done, 没 setup.completed | setup.completed=true |
|---|---|---|---|---|
| `/init` | → `/init/db` | → `/init/admin` | → `/init/execute` | AlreadyDoneCard |
| `/init/db` | render form | → `/init/admin` | → `/init/admin` | AlreadyDoneCard |
| `/init/admin` | → `/init/db` | render form | → `/init/execute` | AlreadyDoneCard |
| `/init/execute` | → `/init/db` | → `/init/admin` | render | AlreadyDoneCard |

locked state:任意一页检测到 `setup.completed=true` → render AlreadyDoneCard 而不是 form (防呆)。

### InitiateHeader + StepGroup

`<InitHeader currentStep={0|1|2}>`
- 复用现有 `TOP_STEPS` + icons (Database / User / Rocket)
- 三段水平指示器,已完成绿色,当前 seal 高亮,未到灰色

`<StepGroup title status total>`
- 标题行:`▼/▶ {title} ({completedCount}/{total} 完成)`
- 折叠:点击切 visible,默认展开
- 子内容:`children` (子卡片 list)

`<SubStepCard>` 沿用现有 div + icon + label + detail + status badge 模式 (从 app/init/page.tsx:429-475 提取)。

### 不在本 spec 内 (out of scope)

- 增量 admin 创建 (e.g., setup 完成后 user 用 admin 再加 admin)— 已有 requireAdmin API
- 远程 env 来源 (e.g., 从 KMS / Vault 拉 DATABASE_URL)— 仍走手动 .env.example 模板
- Docker entrypoint 自动跑 wizard— spec 仅覆盖 UI 层
- 检查 `setup.wizard.admin_done` 标志的定期 GC (一次性 setup 完成后这个标志失去语义价值,但清不清都行)— 跟随 `cleanup` 留 TODO

## File Structure

### 新建

1. `app/init/db/page.tsx` — 第 1 屏 (server component check + client form)
2. `app/init/admin/page.tsx` — 第 2 屏
3. `app/init/execute/page.tsx` — 第 3 屏
4. `components/init/InitHeader.tsx` — 三步指示器
5. `components/init/StepGroup.tsx` — step 3 分组折叠器
6. `components/init/InitStepForm.tsx` — 通用 wizard form 壳 (cls + error display)
7. `app/api/init/init-db/route.ts` — 旧端点 410 shim
8. `app/api/init/stash-admin/route.ts` — admin credentials stashing
9. `lib/init-credentials.ts` — 内存 Map store + token 发放 + GC

### 改

10. `app/init/page.tsx` — 简化为 orchestrator (RSC, redirect)
11. `middleware.ts` — cookie-not-set → /init (替换 !DATABASE_URL 检查)
12. `app/api/init/create-admin/route.ts` — body 从 `{username,password,email}` 改为 `{token}`
13. `app/api/init/admin/route.ts` — 改用 `setup.wizard.admin_done` 标记 (validation pass 后写入)

### 测试

14. `tests/unit/lib/init-credentials.test.ts` — stash + consume + GC
15. `tests/unit/lib/middleware-redirect.test.ts` — cookie 检查行为 (assertion: 重写为可测的形式)
16. `tests/integration/init-wizard.test.ts` — 整链: db-config → admin → execute → mark-complete, 跑真 DB (piyin_deploy_test 类似 scratch DB)

## Implementation Steps (TDD)

### Task 1 — init-credentials token 库 (foundation)

1. 写 `tests/unit/lib/init-credentials.test.ts`:
   - `stash() returns token; consume(token) returns same credentials`
   - `consume(unknown token) returns null`
   - `consume(expired token) returns null` (用 fake timer)
   - `GC removes expired entries`
2. 实现 `lib/init-credentials.ts` (Map + expiresAt + interval)
3. `npx vitest run tests/unit/lib/init-credentials.test.ts`

### Task 2 — stash-admin 端点

1. 写 `tests/integration/api/stash-admin.test.ts`: valid → token; invalid → 400
2. 实现 `app/api/init/stash-admin/route.ts` (zod schema + `isSetupRouteEnabled` gate + `stashAdminCredentials`)
3. `npx vitest run tests/integration/api/stash-admin.test.ts`

### Task 3 — create-admin 端点改用 token

1. 改 `app/api/init/create-admin/route.ts`: body schema 改 `{token: z.string().length(32)}`, `consumeAdminCredentials(token)`, 过期 → 401 `token_expired`
2. 写测试: valid token → user created; expired token → 401; no token → 400
3. `npx vitest run tests/integration/api/create-admin.test.ts`

### Task 4 — Admin route 写 setup.wizard.admin_done + InitStatus helper

1. 改 `app/api/init/admin/route.ts`: validation 通过后 `INSERT INTO app_config ('setup.wizard.admin_done', 'true')` (也用 ON DUPLICATE)
2. `lib/setup.ts` 加 `isInitWizardAdminDone()` (查 app_config)
3. 测试: validation pass → flag 写入

### Task 5 — InitHeader + StepGroup 公共组件

1. 写 `components/init/InitHeader.tsx` (server component, props: currentStep) — 复用 page.tsx 现有的 TOP_STEPS + icons
2. 写 `components/init/StepGroup.tsx` (client, props: title, completedCount, total) — `useState<open>` toggle
3. 测试: snapshot (不深测,因为是纯展示)

### Task 6 — /init/db page (Task 1)

1. `app/init/db/page.tsx` (server component): check DATABASE_URL missing → render client form; else `redirect('/init/admin')`
2. Client form: 复用现有 DbConfig / DEFAULT_DB / `autoComplete` 字段 / 提交调 `/api/init/db-config`
3. onSuccess: 清 password + `router.push('/init/admin')`
4. 测试: snapshot + integration 跑真 DB (mock fetch)

### Task 7 — /init/admin page (Task 2)

1. `app/init/admin/page.tsx` (server component): check `process.env.DATABASE_URL` 存在 → render form; else `redirect('/init/db')`
2. Client form: useState {username, password, email} + autoComplete, 提交调新 `/api/init/stash-admin`
3. onSuccess: sessionStorage.setItem('piyin.init.admin.creds', JSON.stringify({username, email, token})) + `router.push('/init/execute')`
4. 测试

### Task 8 — /init/execute page (Task 3)

1. `app/init/execute/page.tsx`: render `<InitHeader currentStep=2>` + 3 个 `<StepGroup>` 包裹 9 张 `<SubStepCard>`
2. Client handleSeed: 沿用现有循环 + 9 phases 顺序; `create-admin` body 改 `{token: sessionStorage.getItem('piyin.init.admin.creds') -> token}`
3. onAllDone: sessionStorage.removeItem + `router.push('/init')`
4. 测试 + integration 全链

### Task 9 — /init orchestrator

1. 改 `app/init/page.tsx` 为 RSC: `if (await isSetupComplete()) → AlreadyDoneCard`; else `redirect('/init/db')` (由各屏自己再 redirect 到正确位置)
2. 测试: locked state 卡显示

### Task 10 — middleware 反转

1. 改 `middleware.ts:14-48`: 删掉 `!DATABASE_URL` 检查; 改成 `cookie not set → redirect /init`
2. 测试 `tests/unit/lib/middleware-redirect.test.ts`: 模拟 NextRequest (cookie 有 / 无)
   - 注: middleware 是 edge runtime,可能要 import {middleware} 然后直调
3. 验证:dev 启 + curl 无 cookie 路径 → 302 /init

### Task 11 — 旧 init-db shim

1. 写 `app/api/init/init-db/route.ts` (仅 POST, 410 + 友好错误)
2. 测试: 410 + error.code === 'stale_build'

### Task 12 — 全链 integration 测试

1. 写 `tests/integration/init-wizard.test.ts`: 真 scratch DB (类似 `piyin_deploy_test`)
2. 步骤: DELETE FROM app_config WHERE key LIKE 'setup.%'; GET / → 302 /init; POST /api/init/db-config with real params → 写 .env + reload + db_done mark; POST /api/init/stash-admin → token; GET /init/admin → 200 form; POST form → mark admin_done; POST create-admin with token → user created; POST mark-complete → setup.completed=true + cookie set; GET / → 200 (cookie set)
3. 验证每步响应

### Task 13 — Build + dev verify

1. `pnpm build` (per memory `dev-build cache stomp`,先 `pkill` dev; 这里我们改的是 dev 上线前)
2. `npx next dev -p 4444 &`
3. 验证流程:curl 测试每个端点

## Testing Approach

- **单元测试**: `tests/unit/lib/init-credentials.test.ts`, 覆盖 Map store 行为 + GC
- **集成测试**: `tests/integration/init-wizard.test.ts` + `tests/integration/api/*` (用真 scratch DB `piyin_deploy_test` 类,real `mysql2/promise`)
- **手动测试**:
  1. Dev 起,无 .env → curl / → 302 /init
  2. 浏览器跑通三屏,看 Step 3 三组 9 卡显示
  3. 提交 step 1 → .env 写好,DATABASE_URL 可用
  4. 提交 step 2 → token 落 sessionStorage (DevTools 看)
  5. 提交 step 3 → 9 卡依次变绿 → mark-complete → Set-Cookie
  6. 关浏览器,新开隐身,catalog to homepage → locked state card 显示
  7. curl 一连串验证

## Notes / Risks

- **生产部署时 init-db 旧端点**:用户已经手动部署过老的 prod (`ziyun.pudafo.com`)。新代码部署后,旧 client bundle 仍可能 POST 到 `/api/init/init-db` (已被删),加 410 shim 后前端会看到「请刷新浏览器」提示。这是预期。无需担心,因为用户的浏览器刷新一次就走新 wizard。
- **sessionStorage token 模型**:token 仅 30s TTL,过完就 `null`,用户必须重新跑 step 2。这是预防 sleep / 离开的情况。
- **Admin 现有 `.env` 已有 `setup.completed=true` 不动**:本 spec 不清这两个 `setup.wizard.*` 标志;它们是 wizard 状态机用的,setup 完成后这两个标志失去意义但无害。清理留 TODO 给后续 spec。
- **`/api/init/admin/route.ts` 实际上目前已经 validation-only**,只是没写 admin_done mark。改起来 minimal。
- **CREATE TABLE 之后才能 SET FOREIGN KEY 检查**:init-tables 一次创建所有表,FK 在 DDL 阶段就完成;后续 initChars 之类只是 INSERT,不涉及结构性变更。
- **token 内存 Map 在多进程部署下的问题**:用户目前只有单进程 Node (`pnpm start`)。多进程需要 redis 共享 session。但 setup wizard 只在初始化时跑一次,影响 0。无需引入。
- **`NODE_ENV` 在 server-side**:本 spec 不动 .env.example 的 NODE_ENV 默认值。

## Open Questions

None — 所有 trade-off 跟用户已对齐。

## Commit Strategy

4 个 commit on local main (per memory `feedback-commit-timestamps`,append `[YYYY-MM-DD HH.MM]`):

1. `feat(init): cookie-based setup_completed redirect + /init orchestrator` (Task 10 + Task 9 + Task 11)
2. `feat(init): 3-URL wizard with token-based admin credentials` (Task 1-8 combined)
3. `test(init): full /init wizard integration on scratch DB` (Task 12)
4. `chore(init): build + dev verify wizard 3-stage on 4444` (Task 13)

全部 NOT pushed (`no-prod-env-2026-06-21` 仍生效,等用户手动决定)。
