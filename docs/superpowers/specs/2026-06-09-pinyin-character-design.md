# 拼音/汉字 互转工具 - 设计文档

**日期**：2026-06-09
**状态**：草案 v1

## 1. 概述

构建一个在线的汉字与拼音互转工具网站。核心能力：
- 输入汉字 → 获取带声调的拼音
- 输入拼音 → 转换为候选汉字（输入法模式）或整句
- 任意中文文本的朗读
- 用户注册 / 登录，记录历史、收藏、统计"读过多少字"
- 儿童模式：默认开启，过滤拼音→字 方向的不适宜内容
- 简/繁切换
- 响应式布局（移动端可用）

## 2. 目标用户

通用工具型（不限定用户群）。提供两档默认行为：**儿童模式（默认开）** 与 **通用模式**。提供注册账号以支持跨设备历史同步。

## 3. 功能清单（v1）

| # | 功能 | 范围 |
|---|---|---|
| F1 | 汉字 → 拼音 | 客户端，pinyin-pro |
| F2 | 拼音 → 汉字（输入码点选） | 服务端，内存词典 |
| F3 | 拼音 → 汉字（整句转换） | 服务端，Viterbi + 二元接续 |
| F4 | 朗读 | 浏览器 SpeechSynthesis |
| F5 | 儿童模式 | 顶部开关，默认开 |
| F6 | 用户注册 / 登录 / 登出 | JWT cookie（httpOnly, sameSite=lax） |
| F7 | 历史记录 | MySQL，分页、可清空 |
| F8 | 收藏夹 | MySQL |
| F9 | 统计 | 总转换次数、总字数、按日 |
| F10 | 简/繁切换 | OpenCC，客户端 |
| F11 | 响应式布局 | Tailwind 移动优先 |

## 4. 架构

### 4.1 拓扑

```
┌────────────────────────────────────────┐
│  浏览器 (React + Tailwind)              │
│  头部 / 主体 / 路由                      │
│  状态: zustand                          │
└────────┬───────────────────────────────┘
         │ 字→拼音 / TTS / OpenCC (本地)
         │ 其他走 HTTP + JWT cookie
         ▼
┌────────────────────────────────────────┐
│  Next.js 15 Route Handlers             │
│  /api/auth/*                           │
│  /api/pinyin/*                         │
│  /api/history, /api/favorites          │
│  /api/users/me                         │
└────┬────────────────────────┬──────────┘
     │                        │
     ▼                        ▼
┌──────────────┐    ┌──────────────────┐
│ MySQL 8      │    │ 内存字典           │
│ users        │    │ pinyin-hanzi     │
│ history      │    │ bigrams          │
│ favorites    │    │ bad-words        │
└──────────────┘    └──────────────────┘
```

### 4.2 目录结构

```
pinyin-character/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # 主转换页
│   ├── login/page.tsx
│   ├── history/page.tsx
│   ├── favorites/page.tsx
│   ├── profile/page.tsx
│   └── api/
│       ├── auth/{login,register,logout,me}/route.ts
│       ├── pinyin/{candidates,sentence}/route.ts
│       ├── history/{route.ts,[id]/route.ts,stats/route.ts}
│       ├── favorites/{route.ts,[id]/route.ts}
│       └── users/me/route.ts
├── components/
│   ├── Header.tsx
│   ├── SafeModeToggle.tsx
│   ├── ScriptSwitcher.tsx        # 简/繁
│   ├── TextToPinyin.tsx
│   ├── PinyinOutput.tsx
│   ├── ReadAloudButton.tsx
│   ├── PinyinInputMethod.tsx
│   ├── PinyinFullSentence.tsx
│   ├── HistoryList.tsx
│   ├── FavoritesList.tsx
│   ├── StatsCard.tsx
│   ├── LoginForm.tsx
│   └── UserMenu.tsx
├── lib/
│   ├── pinyin-client.ts          # 包装 pinyin-pro
│   ├── tts.ts
│   ├── opencc.ts                 # 简繁
│   ├── api.ts                    # fetch 客户端
│   └── store.ts                  # zustand
├── server/
│   ├── auth.ts
│   ├── db.ts                     # MySQL 连接池
│   ├── schema.sql                # 初始化 SQL
│   ├── dictionary.ts             # 启动加载 + 查询
│   ├── sentence-converter.ts     # Viterbi
│   ├── filter.ts                 # 儿童模式
│   └── history.ts
├── data/
│   ├── pinyin-hanzi.json
│   ├── bigrams.json
│   └── bad-words.json
├── scripts/
│   └── build-dict.ts             # 一次性：从 pypinyin 原始数据生成 json
├── tests/
│   ├── unit/
│   ├── api/
│   ├── component/
│   └── e2e/
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.ts
├── .env.example                  # DATABASE_URL, JWT_SECRET
└── README.md
```

### 4.3 职责分配

| 方向 | 谁处理 | 理由 |
|---|---|---|
| 汉字 → 拼音 | 浏览器 (pinyin-pro) | 实时打字体验、零请求 |
| 拼音 → 候选 | 服务端 `/api/pinyin/candidates` | 词典大、可独立更新 |
| 拼音 → 整句 | 服务端 `/api/pinyin/sentence` | N-gram 在内存跑 |
| 朗读 | 浏览器 SpeechSynthesis | 零成本、跨平台 |
| 简/繁 | 浏览器 OpenCC | 客户端转换、不走网络 |
| 历史 / 收藏 / 统计 | 服务端 + MySQL | 跨设备同步、统计聚合 |
| 用户认证 | 服务端 + JWT cookie | 跨设备、httpOnly 防 XSS |

## 5. 数据模型

### 5.1 MySQL Schema

```sql
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  pref_script   ENUM('simplified','traditional') NOT NULL DEFAULT 'simplified',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE history (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  direction  ENUM('text2pinyin','pinyin2text') NOT NULL,
  input      TEXT NOT NULL,
  output     TEXT NOT NULL,
  char_count INT NOT NULL,           -- 输入字符数（"读过多少字"）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE favorites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  label      VARCHAR(128) NOT NULL,
  direction  ENUM('text2pinyin','pinyin2text') NOT NULL,
  input      TEXT NOT NULL,
  output     TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

启动时执行 `server/schema.sql`（幂等：使用 `CREATE TABLE IF NOT EXISTS`）。

### 5.2 服务端词典（启动加载到内存）

`data/pinyin-hanzi.json`：
```ts
type Candidate = { char: string; freq: number };
type Dict = Record<string, Candidate[]>;
```

`data/bigrams.json`：
```ts
type Bigrams = Record<string, Record<string, number>>;
```

`data/bad-words.json`：
```ts
type BadWords = { chars: string[]; words: string[] };
```

启动时序列化为 `Set` 以 O(1) 查找。

## 6. 模块设计

### 6.1 字→拼音（客户端）

```ts
// lib/pinyin-client.ts
import { pinyin } from 'pinyin-pro';

export interface PinyinToken {
  char: string;
  readings: string[];   // 多音字
}

export function textToPinyin(text: string): PinyinToken[] {
  return Array.from(text).map((c) => ({
    char: c,
    readings: pinyin(c, { type: 'array', toneType: 'symbol' }) as string[],
  }));
}

export function renderWithSpaces(tokens: PinyinToken[]): string {
  return tokens.map(t => t.readings[0] ?? '?').join(' ');
}
```

### 6.2 拼音→字 候选（服务端）

```ts
// server/dictionary.ts
let dict: Dict;
let bigrams: Bigrams;
let badChars: Set<string>;
let badWords: Set<string>;

export function loadDictionaries(): void      // 启动时调一次
export function getCandidates(
  pinyinStr: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): Candidate[]   // 已排序、按 freq 降序
```

实现：
- 查 `dict[pinyinStr]` 或 `dict[stripTone(pinyinStr)]`
- 应用 `filterCandidates(..., safeMode)`
- 应用 OpenCC（script='traditional' 时）

### 6.3 拼音→字 整句（服务端，Viterbi）

```ts
// server/sentence-converter.ts
export function convertSentence(
  pinyinStr: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): string
```

算法：
1. **分词**：将拼音串切成 token 序列，每个 token 长度 1~4（pinyin 子串）
2. **Viterbi DP**：
   - 状态：`f[i][w]` = 前 i 个 token 拼出以字 w 结尾的最大对数似然
   - 转移：对 token 长度 k=1..4，枚举候选 c ∈ getCandidates(tokenStr)，累加 `log freq(c) + log bigram[w][c]`
   - 安全模式：含 `badChars` 的候选加 -100 大负分
3. **剪枝**：每个状态 top-K=20
4. **回溯**：最大概率路径 → 字符序列
5. **应用 OpenCC**（script='traditional' 时）
6. 边界：若无任何候选，返回空串

### 6.4 儿童模式过滤

```ts
// server/filter.ts
export function isBadChar(c: string, on: boolean): boolean
export function isBadWord(w: string, on: boolean): boolean
export function filterCandidates(c: Candidate[], on: boolean): Candidate[]
export function viterbiPenalty(text: string, on: boolean): number  // 已含时返回大负分
```

- 字符级 + 词组级双重检查
- 候选接口：直接剔除
- Viterbi 接口：累加大负分

### 6.5 简/繁（客户端 OpenCC）

```ts
// lib/opencc.ts
import * as OpenCC from 'opencc-js';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

export function toTraditional(text: string): string
export function toSimplified(text: string): string
```

### 6.6 TTS

```ts
// lib/tts.ts
export function speak(
  text: string,
  opts?: { rate?: number; onBoundary?: (charIndex: number) => void }
): void
export function pickChineseVoice(): SpeechSynthesisVoice | null
export function stopSpeaking(): void
```

- 优先选 `lang === 'zh-CN'` 的 voice
- onBoundary 回调用于 UI 高亮当前朗读字

### 6.7 认证

```ts
// server/auth.ts
export async function register(username: string, password: string): Promise<User>
export async function login(username: string, password: string): Promise<{ user: User; token: string }>
export async function verifyToken(token: string): Promise<User | null>
```

- bcrypt cost=10
- JWT in httpOnly cookie `auth_token`
- 密码最少 8 位

### 6.8 状态管理（客户端）

```ts
// lib/store.ts (zustand)
interface AppState {
  user: User | null;
  safeMode: boolean;     // 默认 true
  script: 'simplified' | 'traditional';
  setUser, setSafeMode, setScript
}
```

- `safeMode` 持久化到 `localStorage`（即使用户未登录也保留偏好）
- `script` 未登录时存 `localStorage`，登录后写 `users.pref_script`

## 7. API 设计

统一响应：
```ts
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
```

| Method | Path | 请求 | 响应 |
|---|---|---|---|
| POST | /api/auth/register | { username, password } | { user } |
| POST | /api/auth/login | { username, password } | { user } |
| POST | /api/auth/logout | — | 204 |
| GET | /api/me | — | { user } \| 401 |
| GET | /api/pinyin/candidates | ?pinyin=&safeMode=&script= | { candidates: Candidate[] } |
| GET | /api/pinyin/sentence | ?pinyin=&safeMode=&script= | { sentence: string } |
| GET | /api/history | ?limit=20&offset=0 | { items, total } |
| GET | /api/history/stats | — | { totalConversions, totalChars, byDay } |
| DELETE | /api/history/:id | — | 204 |
| DELETE | /api/history | — | 204 |
| GET | /api/favorites | — | { items } |
| POST | /api/favorites | { label, direction, input, output } | { item } |
| DELETE | /api/favorites/:id | — | 204 |
| PATCH | /api/users/me | { prefScript? } | { user } |

`/api/pinyin/*` 在用户登录时自动写入 history（带 user_id）；未登录时仍可用但不入库。

## 8. UI 设计

### 8.1 页面布局（桌面端）

```
┌──────────────────────────────────────────────────────────┐
│  字 ↔ 拼音        🔒 儿童模式[ON]  简/繁[简]   [登录/用户] │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  ┌─ 汉字 → 拼音 ─────────────────────────┐               │
│  │  [textarea, 自动高度]                  │               │
│  │  [清空]  [复制]  [🔊 朗读]              │               │
│  │  输出: nǐ hǎo shì jiè                 │               │
│  │  [带空格/不带空格 toggle]                │               │
│  └─────────────────────────────────────┘               │
│                                                          │
│  ┌─ 拼音 → 汉字 ────────────────────────┐               │
│  │  [输入码点选 | 整句转换]               │               │
│  │  模式 A: 候选 ① ② ③...                 │               │
│  │  模式 B: 整句输出                       │               │
│  │  [🔊 朗读] [复制] [清空]                 │               │
│  └─────────────────────────────────────┘               │
│                                                          │
│  底部导航（移动端 tab）：[转换] [历史] [收藏] [我的]          │
└──────────────────────────────────────────────────────────┘
```

### 8.2 组件清单

| 组件 | 职责 |
|---|---|
| Header | 标题 + 儿童模式 + 简繁 + 用户菜单 |
| SafeModeToggle | 开关（默认 ON，绿色 = 开） |
| ScriptSwitcher | 简/繁 toggle |
| TextToPinyin | 字→拼音 整块 |
| PinyinOutput | 渲染带声调 / 多音字标注 / 切换读音 |
| ReadAloudButton | 调 SpeechSynthesis |
| PinyinInputMethod | 模式 A |
| PinyinFullSentence | 模式 B |
| HistoryList | 历史分页列表 + 删除 + 清空 |
| FavoritesList | 收藏列表 + 复用 + 删除 |
| StatsCard | 总转换、总字数、按日柱图 |
| LoginForm | 登录/注册（同一表单切换） |
| UserMenu | 已登录态下拉 |

### 8.3 关键交互

- **多音字**：每字显示为 `汉字 (拼音)` 卡片，点击"拼音"区域循环切到下一个读音
- **候选键盘**：1-9 选 / 点击 / Space 选 1 / Backspace 退格 / `'` 分隔拼音（`xi'an`）
- **朗读**：🔊 图标；朗读时高亮当前字（onBoundary 回调）
- **儿童模式视觉**：开启时输入框绿边 + 顶部"已开启儿童模式"徽章
- **复制**：按当前 spacing 设置复制
- **简/繁切换**：实时作用于输出

### 8.4 响应式断点

| 设备 | 宽度 | 布局 |
|---|---|---|
| 手机 | < 640px | 单列、底部 Tab 切换 4 个页面、按钮全宽 |
| 平板 | 640-1024px | 单列宽间距、按钮自适应 |
| 桌面 | > 1024px | 居中 max-w 1200px、左右留白 |

## 9. 错误处理

| 情况 | 行为 |
|---|---|
| 转换接口 pinyin 为空 | 400 `pinyin required` |
| 候选为空（被儿童模式过滤） | 200 `{ candidates: [] }`，前端提示"无可用候选" |
| 整句无解 | 200 `{ sentence: "" }`，前端提示"未能匹配，请检查输入" |
| 未登录访问受保护 | 401 `auth required` |
| MySQL 不可用 | 500 `db unavailable`，前端降级提示 |
| 词典加载失败 | 启动失败 + 进程退出，PM2/Docker 重启 |
| 用户名已存在 | 409 `username taken` |
| 密码 < 8 位 | 400 `password too short` |
| JWT 过期 | 401，前端跳登录页 |

## 10. 测试

| 层级 | 工具 | 范围 |
|---|---|---|
| 单元 | Vitest | 词典查询、Viterbi、儿童模式过滤、OpenCC 转换 |
| API | Vitest + supertest | 转换/认证/历史/收藏 路由 + 错误分支 |
| 组件 | Vitest + Testing Library | TextToPinyin、PinyinInputMethod 关键交互 |
| E2E | Playwright | 注册 → 转换 → 看历史 → 收藏 → 切换简繁 → 开启儿童模式 |
| 手动 | 浏览器 | TTS 朗读、响应式视觉确认 |

覆盖率目标：核心算法 ≥ 80%，API 路由 100%。

## 11. 部署

依赖：
- Node 20+
- MySQL 8（本地安装或 Docker）
- pnpm

启动命令：
```bash
pnpm install
pnpm db:init     # 执行 schema.sql (CREATE TABLE IF NOT EXISTS)
pnpm dict:build  # 生成 pinyin-hanzi.json / bigrams.json / bad-words.json
pnpm dev         # 开发
pnpm build && pnpm start  # 生产
```

环境变量（.env.example）：
```
DATABASE_URL=mysql://user:pass@localhost:3306/pinyin
JWT_SECRET=<随机 32 字节>
NODE_ENV=development
```

首次启动会自动执行 `pnpm db:init` 内的 `CREATE TABLE IF NOT EXISTS`，无破坏性。

## 12. 不在 v1 范围

- 离线模式
- 繁体字典（用 OpenCC 转换）
- 英文 / 数字混排处理
- 自定义词库
- 用户举报 / 自动学习
- 深色模式
- 移动端 PWA 优化 / 安装到桌面
- 多语言界面（仅中文）
- 邮箱验证、找回密码
- 第三方登录
