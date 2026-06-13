# Plan G — 汉字故事 翻页阅读器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `rare_chars` 表里已生成的 ~1400 个故事可发现 — 单一字一屏的翻页阅读器, 随机下一个, TTS 朗读, 客户端进度追踪.

**Architecture:** 客户端 SPA — server shell 拿首个随机 char, `<StoryClient>` 自管 current/history 状态. "下一个" 调 `/api/stories/random`, "上一个" 走本地 history 栈 (不调 API). 复用现有 `lib/tts.ts` (Web Speech API).

**Tech Stack:** Next.js 15 (RSC + client islands), TypeScript, Tailwind v4, Web Speech API, localStorage, vitest + happy-dom.

---

## 背景

`rare_chars` 表已存 ~1400 条 `(char, pinyin, meaning, story)`, 由 `lib/ai-rare-chars.ts` 批量生成. 现有展示只在 `/rare-chars/[char]` 详情页, 用户需先在 80 个/页的卡片墙里翻找才能看到. 没有任何 "随机阅读" 或 "进度追踪" 体验.

已有基础设施 (全部复用, 不动):
- `lib/rare-chars.ts:listChars / getChar / getDailyChar` — DB queries
- `lib/tts.ts:speak / stopSpeaking / pickChineseVoice` — Web Speech API
- `components/rare/DailyCharBanner.tsx` — 今日一字入口
- `lib/design.ts:NAV_LINKS` — 顶部 nav (本 Plan **不**加新链接)

---

## 用户体验

**入口** (单一): 用户在 `/rare-chars` 看到 "今日一字" banner, 点击进入 `/stories/[char]`.

**单屏内容**:
1. 顶部条: 左 "返回字库" 链接 + 右 "已读 X 字" 进度徽章
2. 巨字号汉字 (text-9xl, font-kai)
3. Pinyin (text-3xl, 灰)
4. 简短释义 (sm, 浅灰)
5. 故事段落 (max-w-2xl, 衬线字体, whitespace-pre-line)
6. 底部操作栏: [← 上一个] [朗读/停止] [加字帖 →] [下一个 →]

**键盘**: → / Space = 下一个, ← = 上一个, L = 朗读切换, Esc = 停止朗读.

**随机策略**: 每次 "下一个" 调 `GET /api/stories/random` 拿一个新随机 char, 推入 history 栈. "上一个" 弹出栈, 不调 API.

**进度**: `localStorage["pinyin-character:read-stories"]` 存累计访问的 char Set (cap 500, FIFO 修剪). 进度 = Set size. 不区分访问/读完.

**TTS**: 朗读 "meaning。story" 拼接文本, rate=0.85. 切 char 时自动停止当前朗读.

---

## 文件结构

### 新增

| 文件 | 责任 |
|---|---|
| `app/stories/page.tsx` | RSC, server 调 `getRandomStoryChar()` 拿 initial, 渲染 `<StoryClient>` |
| `app/stories/[char]/page.tsx` | RSC, 调 `getChar(char)`, 渲染 `<StoryClient>`. char 不存在 → notFound() |
| `app/stories/StoryClient.tsx` | 'use client' 顶层组件, 自管 state, 包含 UI + handlers |
| `app/api/stories/random/route.ts` | GET → 随机一个有 story 的 char (200 / 503) |
| `lib/rare-chars.ts` | +`getRandomStoryChar()` server fn |
| `lib/api-stories.ts` | 客户端 `fetchRandomStory()` wrapper |
| `lib/story-history.ts` | localStorage helpers: getReadChars, addReadChar, clearReadHistory |
| `tests/unit/lib/story-history.test.ts` | localStorage 增删改测试 |
| `tests/integration/api/stories-random.test.ts` | GET /api/stories/random 200/503 |

### 修改

| 文件 | 改动 |
|---|---|
| `components/rare/DailyCharBanner.tsx` | href 从 `/rare-chars/[char]` 改 `/stories/[char]` |
| `README.md` | +一段说明 `/stories` 是隐藏入口 |
| `.env.example` | 不变 (无新 env) |

### 不动

- `lib/tts.ts` — 完整复用
- `lib/design.ts` — 不加新 nav 链接
- `lib/ai-rare-chars.ts` — 不重跑故事生成

---

## 数据流

```
[user clicks 今日一字 banner]
        ↓
[next/navigation to /stories/[c]]
        ↓
[RSC: getChar(c) from DB]
        ↓
[render <StoryClient initialChar={...} />]
        ↓
[useEffect: addReadChar(initialChar.char)]
        ↓
[user clicks "下一个"]
        ↓
[fetchRandomStory() → /api/stories/random]
        ↓
[setState({ current: new, history: [...prev, old], loading: false })]
        ↓
[addReadChar(new.char)]
        ↓
[re-render with new char]
```

---

## API 契约

### `GET /api/stories/random`

**200 OK**:
```json
{
  "ok": true,
  "data": {
    "char": "龘",
    "pinyin": "dá",
    "meaning": "古同'龙'...",
    "story": "很久很久以前...",
    "needsReview": true,
    "generatedBy": "openai:gpt-4o-mini",
    "generatedAt": "2026-05-12T08:30:00Z",
    "createdAt": "2026-05-12T08:00:00Z"
  }
}
```

**503 Service Unavailable** (库为空):
```json
{ "ok": false, "error": { "code": "NO_STORIES" } }
```

**实现**: 复用 `app/api/rare-chars/daily/route.ts` 的 pattern — `force-dynamic`, 复用 `getPool()`.

---

## 组件契约

### `<StoryClient initialChar={...}>`

**Props**: `{ initialChar: RareCharClient }`

**State**:
```ts
interface ReaderState {
  current: RareCharClient;
  history: RareCharClient[];   // stack of previous, no current
  loading: boolean;
  error: string | null;
  speaking: boolean;           // TTS 状态
}
```

**行为**:
- mount 时: `addReadChar(initialChar.char)`
- 点 "下一个": `setLoading(true)` → `fetchRandomStory()` → 成功 `setState` + `addReadChar`, 失败 `setError(msg)` 保留 current
- 点 "上一个": 弹出 history 末项, 替换 current; 空时按钮 disabled
- 键盘: `window.addEventListener('keydown', handler)`, 卸载 remove
- TTS: 朗读 current.story, onEnd → setSpeaking(false)
- 切 char 时: `stopSpeaking()` + `setSpeaking(false)`

**导出**: `default export function StoryClient({ initialChar }: Props)`.

### `lib/story-history.ts`

```ts
const STORAGE_KEY = 'pinyin-character:read-stories';
const MAX_HISTORY = 500;

export function getReadChars(): string[]           // 返回去重 array
export function addReadChar(char: string): void    // 写入 localStorage
export function clearReadHistory(): void            // 清空 (测试用)

// 内部: read JSON.parse / JSON.stringify, 防 SSR (typeof window === 'undefined' 时返回 [])
```

降级: 若 `localStorage` 抛错 (隐私模式) → catch + 静默返回空数组, 进度徽章不显示数字.

---

## 测试计划

### 单元测试 (vitest + happy-dom)

**`tests/unit/lib/story-history.test.ts`**:
- `getReadChars` 空 localStorage → `[]`
- `addReadChar` 写入后再读 → 包含
- 重复 add → 不重复 (Set 语义)
- 添加 501 个 char → 修剪到 500 (FIFO)
- localStorage 抛错 → 返回 `[]` 不抛

**`tests/unit/components/StoryClient.test.tsx`** (新):
- happy-dom, mock `fetchRandomStory`, mock `speak`
- 渲染 initialChar (char text 出现在文档)
- 点 "下一个" → `fetchRandomStory` 被调一次, current 替换
- 失败 → error state 设置, current 不变
- 点 "上一个" → history 弹出, 不调 API
- history 空 → "上一个" button `disabled`
- 键盘 ArrowRight → 调下一个
- 键盘 ArrowLeft → 调上一个
- 点 TTS → mock speak 被调
- TTS 切换 char → mock stopSpeaking 被调
- 加字帖 link href 包含 `prefill=<encoded char>`

### 集成测试

**`tests/integration/api/stories-random.test.ts`**:
- 跳过若 DB 不可达 (跟 `/api/rare-chars/daily` 一样)
- 200 + 含 story 字段
- 503 模拟: mock `getRandomStoryChar` 返回 null

---

## 错误处理

| 场景 | 行为 |
|---|---|
| API 503 NO_STORIES | `<EmptyState>` + "返回字库" 链接, 隐藏操作栏 |
| fetch 抛错 | 顶部红条 + "重试" 按钮, current 保留 |
| localStorage 不可用 | 静默降级, 进度徽章隐藏数字显示 "?" |
| Web Speech 不可用 | TTS 按钮 disabled, tooltip "当前浏览器不支持" |
| 同 char 重复 | 允许, 进度不去重 |
| 不存在的 char 进 `/stories/[c]` | 404 (next/navigation `notFound()`) |

---

## 不在范围 (YAGNI)

- 用户登录后保存 "想再读" 收藏 (server 表, 复杂)
- 多字串故事 (AI 串起 3-5 字) — 留作 Plan J?
- 故事搜索 / 筛选 (按部首/字数)
- 故事评论 / 评分
- 朗读时高亮当前字 (需 onBoundary + 切分)
- Service Worker 离线缓存
- 故事分享 (生成图片卡片)
- 顶部 nav 加 `/stories` 链接 (本 Plan 决定不显式入口)

---

## 手动冒烟 (我跑)

- [ ] 访问 /rare-chars, 看到 今日一字 banner
- [ ] 点击 banner, 进入 /stories/[c]
- [ ] 看到 char + 故事
- [ ] 点 朗读, 按钮变 停止, 听到声音
- [ ] 点 停止, 朗读停
- [ ] 点 下一个, 看到不同 char
- [ ] 点 5 次, 进度显示 "已读 6"
- [ ] 键盘 → 下一个, ← 上一个
- [ ] 键盘 L 朗读, Esc 停止
- [ ] 点 加字帖, 跳 /worksheet?prefill=<c>
- [ ] 移动端 375px, 按钮不重叠
- [ ] 刷新页面, 进度保留, history 丢
- [ ] tsc --noEmit, vitest, pnpm build 全绿

---

## 验收标准

1. `/stories` 路由可访问, 从 /rare-chars 今日一字 banner 进入
2. 单屏显示: char / pinyin / meaning / story / 4 个操作按钮 / 进度
3. 随机下一个工作, 上一个栈工作
4. TTS 朗读 / 停止工作
5. 键盘快捷键工作
6. localStorage 进度持久化
7. 移动端响应式
8. 所有 vitest 单元/集成/组件测试通过
9. tsc --noEmit 干净
10. pnpm build 成功
