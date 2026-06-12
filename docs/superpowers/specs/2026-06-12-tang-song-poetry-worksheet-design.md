# 唐诗宋词字帖 Feature — Design Spec

> 状态: 设计完成,等待 user review

## 1. 目标

在「字·韵」网站加一个**唐诗 / 宋词**板块,把精选的 ~620 首经典诗词按**字帖 (米字格)**方式呈现,既能浏览阅读 (有拼音),也能直接打印练字,还能"保存到我的字帖"复用现有 /worksheet 体系。

**目标用户:** 学生 / 书法爱好者 / 家长, 需要在电脑上浏览经典诗词并打印字帖练字。

## 2. 用户故事

- **学生小王**: "我想看看《静夜思》怎么写,每个字什么拼音"
  → 打开 /poetry,搜索"静夜思" / 翻列表找到,点进去看到米字格 + 拼音,点"打印"或"保存到字帖"
- **妈妈李姐**: "我想给孩子练字,找几首简单的唐诗"
  → 打开 /poetry → 切到"唐诗" tab,看到 320 首,选《静夜思》《咏鹅》,点"保存到我的字帖",登录后 /worksheet/history 看到
- **书法老师张**: "我想要多种体裁的诗"
  → 打开 /poetry,搜索"李白",看到他所有诗;点详情看米字格字帖

## 3. 范围

**In scope:**
- /poetry 列表页 (搜索 + 唐/宋 tab + 分页)
- /poetry/[id] 详情页 (米字格 + 拼音 + 可选赏析)
- DB 存储 ~620 首精选诗
- initDb 时自动从 chinese-poetry GitHub 拉取 (若 poems 表空)
- 三个 API: list, get, random
- Header 加"诗词"导航
- 首页 BentoGrid 加"今日一诗"卡片
- "保存到我的字帖" 复用现有 /worksheet 体系

**Out of scope:**
- 用户收藏 / 喜欢 / 评论
- 诗词创作 / 编辑 / 上传
- 全文翻译 (i18n) — 仅中文
- 拼音以外的多语言注释
- 词牌 / 平仄 / 押韵的精细分析

## 4. 架构

### 4.1 新增页面

| 路径 | 类型 | 渲染 | 鉴权 |
|---|---|---|---|
| `/poetry` | 列表 | CSR (useEffect fetch) | 公开 |
| `/poetry/[id]` | 详情 | SSR (getPoem 直查 DB) | 公开 |
| `/` (首页) | 现有 + 加卡片 | SSR | 公开 |

### 4.2 新增 API

| Method | Path | 行为 | 鉴权 |
|---|---|---|---|
| GET | `/api/poetry` | 列表 + 搜索 + 分页 | 公开 |
| GET | `/api/poetry/[id]` | 详情 (含 pinyin) | 公开 |
| GET | `/api/poetry/random` | 随机一首 | 公开 |

**列表 query params:**
- `dynasty` (tang \| song) — 必填, 默认 tang
- `q` — 可选, 模糊搜索 title/author/title 的首字 (三字段任一 LIKE 命中即返回)
- `page` — 可选, 默认 1
- `pageSize` — 可选, 默认 24

**列表响应:**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 1, "title": "静夜思", "author": "李白", "dynasty": "tang", "form": "五言绝句" }
    ],
    "total": 320,
    "page": 1,
    "pageSize": 24
  }
}
```

**详情响应:**
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "title": "静夜思",
    "author": "李白",
    "dynasty": "tang",
    "form": "五言绝句",
    "content": ["床前明月光", "疑是地上霜", "举头望明月", "低头思故乡"],
    "pinyin": [["chuáng", "qián", "míng", "yuè", "guāng"], ...],
    "appreciation": "此诗写于秋夜..."
  }
}
```

### 4.3 复用现有

- `WorksheetCell` (SVG 米字格) — 详情页直接复用
- `WorksheetPreview` (部分) — 仅参考 layout 模式
- `/api/worksheets` POST — "保存到字帖" 直接调用
- `/worksheet/[id]` 页面 — 保存后跳转
- `pinyin-pro` — build 脚本中预先算每字拼音
- `api-handler`, `requireUserOrNull` — lib 基础设施
- `card-paper`, `font-kai`, `btn-seal`, `paper-rule` — Plan E 设计 token

## 5. 数据模型

### 5.1 DDL (新增于 initDb)

```sql
CREATE TABLE IF NOT EXISTS poems (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dynasty ENUM('tang','song') NOT NULL,
  title VARCHAR(80) NOT NULL,
  author VARCHAR(40) NOT NULL,
  form VARCHAR(20),
  content JSON NOT NULL,                 -- ["床前明月光", "疑是地上霜", ...]
  pinyin JSON NOT NULL,                  -- [["chuáng", "qián", ...], ...]
  appreciation TEXT,                     -- 可空
  source VARCHAR(120),                   -- "chinese-poetry/chinese-poetry@<sha>"
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_poem (dynasty, title, author),
  KEY idx_author (author),
  KEY idx_dynasty_author (dynasty, author)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- **content** 是 JSON 数组,每行一句
- **pinyin** 与 content 1:1 对应 (每句一个数组,元素是单字拼音)
- **appreciation** 可空 (有就显示,没有就不显示)
- **UNIQUE KEY** 防止 build 脚本重复灌入

### 5.2 数据源

**GitHub:** `https://github.com/chinese-poetry/chinese-poetry` (MIT License)

**具体拉取路径:**
- 唐诗三百首: `json/唐诗三百首.json` (≈ 320 首)
- 宋词三百首: `json/宋词三百首.json` (≈ 300 首)

**JSON 格式 (chinese-poetry 标准):**
```json
[
  {
    "title": "静夜思",
    "author": "李白",
    "paragraphs": ["床前明月光", "疑是地上霜", "举头望明月", "低头思故乡"],
    "rhythmic": "五言绝句"
  },
  ...
]
```

**Build 脚本处理:**
1. 拉两个 JSON 文件
2. 解析每条记录:
   - `dynasty` = "tang" / "song"
   - `title` = 原 title
   - `author` = 原 author
   - `form` = rhythmic (若有)
   - `content` = paragraphs
   - `pinyin` = paragraphs.map(line → line.split('').map(char → pinyin-pro pinyin(char, { toneType: 'symbol' })))
   - `appreciation` = 若 JSON 里有 `translation` / `appreciation` 字段则取, 否则 null
   - `source` = `chinese-poetry/chinese-poetry@<commit-sha>`
3. UPSERT INTO poems

**重要:** build 脚本不破坏现有 initDb 流程。它作为**可选步骤**: 检测到 poems 表为空时才执行,且失败时不让 initDb 整体失败 (只 warn)。

## 6. 组件设计

### 6.1 服务端 lib

**`lib/poetry-types.ts`** (共享,client + server 都 import)
```ts
export type Dynasty = 'tang' | 'song';
export interface PoemListItem {
  id: number;
  title: string;
  author: string;
  dynasty: Dynasty;
  form: string | null;
}
export interface PoemDetail extends PoemListItem {
  content: string[];
  pinyin: string[][];   // content 1:1 对应
  appreciation: string | null;
}
export interface PoemListResult {
  items: PoemListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

**`lib/poetry.ts`** (server-only)
```ts
export async function listPoems(args: { dynasty: Dynasty; q?: string; page?: number; pageSize?: number }): Promise<PoemListResult>;
export async function getPoem(id: number): Promise<PoemDetail | null>;
export async function getRandomPoem(): Promise<PoemDetail | null>;
```

### 6.2 客户端 lib

**`lib/api-poetry.ts`**
```ts
export async function listPoemsRequest(args: { dynasty: Dynasty; q?: string; page?: number }): Promise<PoemListResult>;
export async function getPoemRequest(id: number): Promise<PoemDetail>;
export async function getRandomPoemRequest(): Promise<PoemDetail>;
```

### 6.3 页面

**`app/poetry/page.tsx`**
- 客户端组件, useEffect 拉列表
- state: `dynasty`, `q`, `page`, `items`, `total`, `loading`
- 顶部: `PoemSearch` (搜索框 + 唐/宋 tab)
- 中部: `PoemCard` grid (2-3 列响应式)
- 底部: `PoemPagination` (上一页/下一页 + 当前/总数)
- 无结果 → EmptyState
- 加载中 → LoadingSpinner
- 错误 → ErrorState + 重试

**`app/poetry/[id]/page.tsx`**
- server component: `const poem = await getPoem(id); if (!poem) notFound();`
- 渲染: `PoemMeta` (标题 + 作者 + 朝代) + `PoemWorksheet` (米字格 + 拼音) + `AppreciationBlock` (有则显示) + `SaveAsWorksheetButton`
- 打印时: 隐藏 nav/button, 只显示字帖

**`app/poetry/[id]/SaveAsWorksheetButton.tsx`**
- 'use client'
- 按钮: "保存到我的字帖"
- onClick:
  1. `setSaving(true)`
  2. fetch POST /api/worksheets `{ title: '《'+title+'》'+author, content: poem.content.join('').split(''), cellStyle: 'brush' }`
  3. 若 401 → `router.push('/login?next=/poetry/'+id)`
  4. 若成功 → `router.push('/worksheet/'+data.data.id)`
  5. 若其他错误 → alert
- 文案反馈: saving / 保存到字帖 / 已保存 (短暂)

### 6.4 组件

**`components/poetry/PoemSearch.tsx`**
- props: `{ dynasty, q, onDynastyChange, onQChange }`
- 输入框 + 两个 tab (唐诗 / 宋词), 选中态用 seal 颜色

**`components/poetry/PoemCard.tsx`**
- props: `{ poem: PoemListItem }`
- 卡片: 标题 (kai, 中号) + 作者 + 朝代印章
- hover: 边框变 seal
- 整卡可点击 → /poetry/[id]

**`components/poetry/PoemPagination.tsx`**
- props: `{ page, pageSize, total, onPageChange }`
- 上一页 / 下一页 / "第 X/Y 页"

**`components/poetry/PoemWorksheet.tsx`**
- props: `{ content: string[], pinyin: string[][], cellStyle?: 'brush' | 'square' }`
- 渲染: 每个 char 一个 `WorksheetCell`, char 下方小字拼音
- 行内空格: 每行 5/7 字, 用 flex 排
- 行间距: mb-4
- 字号: 80px (跟现有 WorksheetCell 一致)

**`components/poetry/PoemMeta.tsx`**
- props: `{ title, author, dynasty, form? }`
- 标题 (kai, 36px) 居中
- 作者 (居中, ink-soft)
- 朝代 + 体裁 (居中, 小字, ink-faint)
- 装饰: 上下 paper-rule

**`components/poetry/AppreciationBlock.tsx`**
- props: `{ text: string }`
- 有内容才渲染
- 标题: "赏析" (kai, 小)
- 内容: text (max-w-2xl, leading-relaxed)
- 边框: border-l-4 border-seal

### 6.5 首页卡片

**`components/HomePoemCard.tsx`** (新)
- 服务端: `const poem = await getRandomPoem()`
- 显示: 「今日一诗」+ 标题 + 作者 + 第一行 (2 字截断)
- 点击 → /poetry/[id]
- 放在 BentoGrid

修改 **`app/page.tsx`** 加 import 和 `<HomePoemCard />`

## 7. 数据流

### 7.1 首次部署 / 启动

```
[server start] → instrumentation.ts → initDb()
  ↓
  CREATE TABLE poems (IF NOT EXISTS)
  ↓
  SELECT COUNT(*) FROM poems
  ↓
  if count == 0:
    ↓
    fetch chinese-poetry 唐诗三百首 + 宋词三百首
    parse → INSERT (UPSERT)
    log "inserted N poems"
  else:
    log "poems table already has N rows, skip"
```

### 7.2 用户浏览

```
/poetry page load (CSR)
  ↓
  useEffect: fetch /api/poetry?dynasty=tang&page=1
  ↓
  render PoemCard grid + pagination

点击 PoemCard
  ↓
  navigate /poetry/[id]
  ↓
  server: getPoem(id) → SSR render PoemWorksheet
  ↓
  click "保存到我的字帖"
  ↓
  POST /api/worksheets
  ↓
  成功 → navigate /worksheet/[id]  (复用现有页)
```

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| /poetry/[id] id 不存在 | `notFound()` → 404 页面 |
| /poetry 列表空 (搜索无结果) | EmptyState "无匹配诗作" |
| /poetry 列表 API 失败 | ErrorState + "重试" 按钮 |
| 详情页 data 加载失败 | notFound() (DB 不可达也走这) |
| 保存到字帖 401 | redirect /login?next=/poetry/[id] |
| 保存到字帖 5xx | alert 错误 + button 恢复 |
| Build 脚本 GitHub 不可达 | warn + 跳过 (initDb 整体不 fail) |
| pinyin-pro 算不出拼音 (生僻字) | 降级: 用 `pinyin(char, { toneType: 'none' })` 再降级到 `''` |

## 9. 测试策略

### 9.1 单元测试
- `lib/poetry.ts` 三个函数 (mock DB)
- `lib/poetry-types.ts` (类型检查为主,无运行测试)
- `components/poetry/PoemCard` 渲染 (Vitest + happy-dom)
- `components/poetry/PoemWorksheet` 渲染 (props → DOM)

### 9.2 集成测试
- `GET /api/poetry` (正常/分页/搜索/空 q)
- `GET /api/poetry/[id]` (正常/不存在)
- `GET /api/poetry/random` (正常)

### 9.3 手工冒烟 (人 review)
1. 首页加载看到"今日一诗"卡片
2. 点击 Header 诗词链接
3. 列表页: 切唐/宋 tab, 搜索"李白", 分页
4. 点进《静夜思》: 米字格 + 拼音 + 赏析 (若有)
5. 点 "打印" → 浏览器打印预览
6. 点 "保存到字帖" → (未登录) 跳登录 → 登录后跳 /worksheet/[id]
7. /worksheet/[id] 看到诗的内容
8. /poetry/[id] 直接输入不存在 id → 404

## 10. 实现任务清单 (高层)

> 详细 task breakdown 会在 spec 确认后由 writing-plans skill 生成。

1. DDL: initDb 加 poems 表
2. lib/poetry-types.ts
3. lib/poetry.ts (listPoems, getPoem, getRandomPoem) + 单元测试
4. API: /api/poetry/route.ts, /api/poetry/[id]/route.ts, /api/poetry/random/route.ts + 集成测试
5. lib/api-poetry.ts (客户端包装)
6. scripts/build-poems.ts (拉 chinese-poetry + UPSERT) + 接入 initDb
7. components/poetry/PoemSearch, PoemCard, PoemPagination, PoemWorksheet, PoemMeta, AppreciationBlock + 单元测试
8. app/poetry/page.tsx (列表页)
9. app/poetry/[id]/page.tsx (详情页)
10. app/poetry/[id]/SaveAsWorksheetButton.tsx
11. components/HomePoemCard.tsx + 修改 app/page.tsx
12. 修改 lib/design.ts (NAV_LINKS 加 诗词)
13. 全套: tsc, vitest, build, 启动 dev 手工冒烟

## 11. 已知风险 / 注意点

- **chinese-poetry 字段名不统一**: 唐诗三百首 vs 宋词三百首 的 JSON 字段可能不同 (`rhythmic` vs `cipai` 等), build 脚本要兼容
- **pinyin-pro 对极生僻字支持**: 一些字 pinyin-pro 返回空数组, build 脚本要降级处理
- **JSON 字段大小**: pinyin 数组 + content 数组, 600 行 × 平均 2KB = ~1.2MB 数据, 单表没问题
- **保存到字帖 flatten 丢失行结构**: 拍平到 char 数组后, /worksheet/[id] 渲染时是 8 列一行的 grid, 不再分诗行。这是有损的——但已经走的是"已保存的字帖"工作流, 用户预期是统一的 grid。如果要保留分行, 需要扩展 /worksheet 支持 "lines" 字段, 这是 v2 任务
- **赏析数据稀疏**: chinese-poetry 库里三百首有赏析的可能 ~60%, 详情页有则显无则隐

## 12. 不在范围 (Out of Scope)

- 用户收藏 / 喜欢
- 词牌 / 平仄 / 押韵分析
- 多语言翻译
- AI 生成赏析
- 诗词音频朗读
- 移动端原生 App
- 离线 PWA

## 13. 验收标准

- [ ] `pnpm tsc --noEmit` 通过
- [ ] `pnpm test` 所有单元 + 集成测试通过 (无回归)
- [ ] `pnpm build` 通过
- [ ] 首次启动时, 若 poems 表空则自动灌入 (DB log: "inserted N poems")
- [ ] 访问 /poetry 看到唐诗 320 首 (默认 tab)
- [ ] 切到"宋词" tab 看到 ~300 首
- [ ] 搜索"李白" 返回他的所有诗
- [ ] 点开《静夜思》详情页: 米字格 + 拼音正确, 标题作者格式正确
- [ ] "保存到我的字帖" 未登录时跳登录, 登录后保存到 /worksheet/[id]
- [ ] 首页 BentoGrid 看到「今日一诗」卡片
- [ ] Header 导航有「诗词」链接
- [ ] 移动端 (375px) 列表页响应式正常
- [ ] 打印预览: 详情页只显示字帖内容, 不显示按钮/导航
