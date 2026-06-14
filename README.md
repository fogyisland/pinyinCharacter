# 字 ↔ 拼音 工具

在线汉字与拼音互转工具。

## 功能（v1 / Plan A）

- 汉字 → 拼音：客户端实时转换，pinyin-pro
- 拼音 → 汉字：两种模式
  - 输入码点选（类似输入法）
  - 整句智能转换（Viterbi + 二元接续）
- 朗读：浏览器内置 TTS
- 儿童模式：默认开启，过滤拼音→字 方向的不适宜内容
- 简/繁切换（占位，Plan C 实现）

## 启动

```bash
pnpm install
pnpm dict:build         # 生成词典文件
pnpm radicals:build     # 生成部首数据 (data/radicals.json, 一次性)
pnpm dev                # http://localhost:4444
```

## 测试

```bash
pnpm test             # 一次性
pnpm test:watch       # 监听
```

## 技术栈

- Next.js 15 + TypeScript
- pinyin-pro（客户端字→拼音）
- 内存词典 + Viterbi（服务端拼音→字）
- Tailwind CSS

## 账号系统（v1 / Plan B）

- 注册 / 登录：用户名 + 密码 (≥ 8 位)
- 字↔拼音 转换自动入库历史
- 收藏：历史列表上点 ⭐
- 统计：profile 页看总字数 + 收藏字数
- 审计日志：注册、登录、登出、history 创建/删除入 audit_log 表
- safeMode / 简繁切换仍在客户端

## 密码找回 + 管理员后台（v1 / Plan B+）

- **密码找回**：在登录框或 `/forgot-password` 输入用户名 → 系统发送一封带 magic link 的邮件（15 分钟内有效）。开发模式下邮件内容打印到 server console；生产环境配置 SMTP 后真实发送。
- **管理员后台**（首个注册的用户自动是 admin）：`/admin/users`、`/admin/audit`、`/admin/stats`
  - 写操作：删除用户（需输入用户名确认）、重置密码（生成临时密码）、提升/撤销管理员
  - 所有写操作都入审计日志
- **首个用户自动为 admin**：注册时检查 `users` 表行数，第一个注册的用户 `is_admin=1`，后续都是 0。
- **v1 限制**：密码重置成功后,旧会话的 JWT 仍有效至 7 天期满。如果需要立即失效所有旧会话,需在 `users` 表加 `token_version` 字段并在 `verifySession` 里比对 — 留待 Plan C。

### 邮件配置

`.env` 中：
- `MAIL_TRANSPORT=console`（默认）：邮件打印到 server console，无需 SMTP
- `MAIL_TRANSPORT=smtp`：启用真实 SMTP，需填 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`

## 管理员后台扩展（v1 / Plan H）

在 Plan B+ 的 `/admin/users`、`/admin/audit`、`/admin/stats` 基础上新增:

- **`/admin/logs`** — 统一日志查看器 (audit + downloads + AI calls，可按 source / 用户 / IP / 时间筛选)
- **`/admin/downloads`** — 用户生成字帖 / 打印 / 下载历史 (worksheet / poem / sutra / rare-char 分类)
- **`/admin/ai`** — AI 调用记录 + 可编辑配置 (model, rate_limit_per_user_per_day, timeout_ms, temperature)

新增管理员 API (需 `is_admin=1`):
- `POST /api/admin/users/[id]/disable` — 软禁用用户
- `POST /api/admin/users/[id]/enable` — 恢复
- `GET  /api/admin/users/[id]/activity` — 最近 100 条用户事件
- `GET  /api/admin/logs?source=&type=&userId=&ip=&from=&to=` — 统一日志查询
- `GET  /api/admin/downloads?userId=&sourceType=&from=&to=` — 下载历史
- `GET  /api/admin/downloads/stats?days=7` — 下载聚合
- `GET  /api/admin/ai/calls?feature=&status=&userId=` — AI 调用记录
- `GET  /api/admin/ai/stats?days=7` — AI 聚合
- `GET  /api/admin/ai/config` — 当前 AI 配置
- `PUT  /api/admin/ai/config` — 更新 AI 配置 (按字段校验)

用户面 print 端点 (登录用户调用，记入 downloads 表):
- `POST /api/worksheets/[id]/print`
- `POST /api/poetry/[id]/print`
- `POST /api/sutra/[slug]/print` — body: `{ sourceId: "{slug}#{chunkId}" }`
- `POST /api/rare-chars/[char]/print`

## 罕见字库 + 字帖生成器 + 识字游戏（v1 / Plan D）

- **罕见字库**:从《通用规范汉字表》三级导入 ~1600 字,每字含拼音、释义、故事(AI 生成)。`/rare-chars` 浏览 + 搜索,`/rare-chars/[char]` 详情。
- **字帖生成器**:`/worksheet` 支持自由输入或从字库选字,毛笔格/田字格两种样式,浏览器原生打印 → 另存为 PDF。登录用户可保存到 `/worksheet/history`。
- **识字游戏**:`/game` 提供两种玩法,拖拽匹配,计时计错配:
  - **声调·部首** (默认,Plan I) — 给 4 个汉字,把对应的声调数字 (1-5) 和部首拖到字上
  - **拼音·字** (Plan D) — 给 4 个汉字,把对应的拼音拖到字上

### 数据初始化（一次性）

```bash
pnpm tsx --env-file=.env scripts/fetch-rare-chars.ts
pnpm tsx --env-file=.env scripts/generate-stories.ts --provider openai --model gpt-4o-mini
pnpm tsx --env-file=.env scripts/show-stats.ts
```

需要 `LLM_API_KEY` 和 `LLM_BASE_URL` 在 `.env` 中。脚本可重复运行(已填的释义/故事不覆盖)。

### 部首数据生成（一次性）

```bash
pnpm radicals:build        # 重新生成 data/radicals.json
```

部首数据来自 `data/radicals.json` (由 `pnpm radicals:build` 从 `cnchar` + `cnchar-radical` npm 包生成, ~6920 简体汉字)。声调数据来自 pinyin-pro (内置)。

## 字典 + 字源（v1 / Plan L）

- `/dictionary` — 完整字典浏览 (8105 字)
  - 按拼音 A-Z 锚点 / 按部首 214 侧栏 (顶部 toggle)
  - 搜索: 拼音 / 汉字 / 英文
- `/dictionary/[char]` — 详情页 (4 tabs: 字典/字源/故事/+字帖)
  - 7 字段: 拼音/部首/笔画/释义/英文/Unicode/异体字
  - 相关字: 同部首 / 同拼音
- `/etymology/[char]` — 沉浸式字源页
  - 5 个时代字形: 甲骨文/金文/小篆/隶书/楷书
  - 用专门古字字体渲染;字体未覆盖的字显示「暂无」
  - 字源故事: LLM 生成 (管理员触发 + cron @50-100/天)
  - 键盘 ←/→ 切换时代

### Admin 字典

- `/admin/chars` — 覆盖率 (按 level)
- `/admin/chars/generate` — 手动批量生成字源

### 字典数据初始化（一次性）

```bash
pnpm tsx --env-file=.env scripts/import-chars-data.ts    # 导入 8105 通用规范汉字到 chars 表
pnpm radicals:build                                      # 重新生成 data/radicals.json（若尚未生成）
```

需要 `DATABASE_URL` 在 `.env` 中。脚本可重复运行（`INSERT IGNORE`，已存在不覆盖）。

### 笔画顺序 (Stroke Order)

字典详情页 (`/dictionary/[char]`) 卡片下方展示 280×280 田字格 + 浓墨笔顺动画。

**特性**
- 加载后自动循环播放笔画动画 (可手动关闭)
- ⟲ 重播按钮
- 笔数显示 (`N / M 画`) 实时更新
- 覆盖 8105 通用规范汉字中约 6866 个 (87% BMP 覆盖率,hanzi-writer-data 不含的生僻字 graceful hide)
- 数据: `public/strokes/{char}.json` (build 阶段从 hanzi-writer-data 拉取)

**数据初始化**

```bash
pnpm strokes:build
```

首次运行约 10-15 分钟,会写 ~30-50MB JSON 到 `public/strokes/`。该目录已在 `.gitignore` 中,需在每台 dev 机 / CI 上分别运行。

## 识字游戏难度分级 + 独立登录注册 + 佛经阅读模式（v1 / Plan N）

### 难度分级（3 级）

两款识字游戏 + 拼音输入法都支持 3 级难度,设置存 localStorage 跨刷新保留：

- **简单 (easy)** — 4 个选项 / 3 个候选字
- **复杂 (medium)** — 4 个选项 / 5 个候选字
- **超难 (hard)** — 4 个选项 / 9 个候选字

入口 UI 共享 `DifficultyPicker` 组件 (`components/common/DifficultyPicker.tsx`),核心切片逻辑在 `lib/pinyin-input-difficulty.ts` (单测覆盖)。

### 独立登录 / 注册页

`/login` 和 `/register` 是独立路由,不再用 modal。

- **注册**: 必填用户名 / 邮箱 / 密码 (≥ 8 位),邮箱必须合法格式,服务端用 `lib/validators.ts` 的 `registerSchema` 校验,重复邮箱返回 `email_taken`。
- **登录**: 用户名 + 密码,支持 `?next=/foo/bar` 跳转回原页面。
- **忘记密码**: `/forgot-password` 输入用户名 → 邮件 magic link → `/reset-password?token=...` 重置。
- Header 已把原 modal 入口换成 `/login` + `/register` 两个按钮。所有「保存到字帖」按钮未登录时跳到 `/login?next=<current path>`。

### 佛经阅读模式 (3 种)

`/sutra/[id]` 详情页支持切换：

- **横向** (默认) — 现代横排
- **竖排从右到左** — 经典繁体竖排,符合古籍习惯
- **竖排从左到右** — 部分日韩/海外版本习惯

设置存 localStorage (`useSutraReading` hook),切换不刷新页面。

## 读故事 (/stories)（v1 / Plan G）

单字翻页阅读器, 从 `rare_chars` 表里随机抽一个有 AI 生成故事的字阅读. 支持:
- 键盘快捷键 (→ 下一个 / ← 上一个 / L 朗读 / Esc 停止)
- TTS 朗读 (Web Speech API)
- localStorage 进度 ("已读 X 字" 持久化)
- "加字帖" 快捷按钮

入口: `/rare-chars` 页面的 "今日一字" banner (没有顶部 nav 链接 — 故意隐藏, 保持首页干净).

## 环境变量

复制 `.env.example` 为 `.env` 并填入：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✓ | MySQL 连接串，例 `mysql://root:pw@localhost:3306/pinyin` |
| `JWT_SECRET` | ✓ | 32+ 字节随机串，例 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DATABASE_URL_TEST` |   | 集成测试用，缺省时 skip |
| `COOKIE_SECURE` |   | 生产环境设为 `true` 让 cookie 带 Secure 标志 |
| `MAIL_TRANSPORT` |   | `console`（默认，邮件打印到 console） 或 `smtp`（需配 SMTP_* / MAIL_FROM） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` |   | `MAIL_TRANSPORT=smtp` 时填入 |
| `MAIL_FROM` |   | `MAIL_TRANSPORT=smtp` 时填入（`noreply@example.com`） |
| `MAIL_FROM_NAME` |   | 发件人显示名，缺省为空 |
| `PUBLIC_BASE_URL` |   | 密码重置邮件里的链接域名，缺省取请求 host |

## 路线图

- Plan B：用户注册、历史、收藏、统计
- Plan B+：密码找回 + 管理员后台（用户、审计、统计）+ SMTP 邮件
- Plan C：简繁真实实现、响应式优化、E2E 测试
- Plan D: 罕见字库 + 字帖生成器 + 拼音·字 识字游戏
- Plan H: admin 平台扩展（统一日志 / 下载 / AI 配置）
- Plan I: 第二款识字游戏 — 声调 + 部首匹配 (复用 cnchar-radical 数据)
- Plan G: 读故事 (/stories) — 单字翻页阅读器, TTS + localStorage 进度
- Plan L: 完整字典（8105 通用规范汉字）+ 字源页（5 时代字形 + AI 故事）+ admin 字源批量生成
- Plan M: 笔画顺序 / 动画（hanzi-writer 田字格笔顺,hanzi-writer-data 数据集）
- Plan N: 难度分级（3 级,2 款游戏 + 拼音输入法）+ 独立登录/注册（必填邮箱）+ 佛经阅读模式（横/竖从右到左/竖从左到右）
