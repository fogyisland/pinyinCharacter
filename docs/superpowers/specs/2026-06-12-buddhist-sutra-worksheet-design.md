# 抄佛经 Feature — Design Spec

> 状态: 设计完成,等待 user review

## 1. 目标

在「字·韵」网站加一个**佛经选读**板块,把 ~12 部常见佛教典籍按**字帖 (米字格)**方式呈现,既能浏览抄写 (有拼音),也能直接打印练字,还能"保存到我的字帖"复用现有 /worksheet 体系。

承接现有 `/poetry` (唐诗宋词) 的整套设计,实现模式基本一致。差异在于:
- 佛经是匿名集体作品,**无作者 / 无朝代**,元数据只有经名
- 佛经篇幅长 (金刚经 ~5000 字),所以需要**品/段落分块**才能在字帖页合理呈现
- 风格采用**中性文化视角** (不强调宗教 / 功德 / 福报),与现有站点定位一致

**目标用户:** 想要抄写古文、练字,或对佛经 / 古典文本感兴趣的学生 / 书法爱好者 / 家长。

## 2. 用户故事

- **书法爱好者老陈**: "我想抄《心经》,练静心"
  → 打开 /sutra, 看到心经在列表,点进详情,看到 260 字米字格 + 拼音,点"打印"或"保存到字帖"
- **学生小林**: "语文老师让抄《金刚经》第一品"
  → 打开 /sutra, 找到《金刚经》,点进详情,选"法会因由分第一"这个品,保存到字帖
- **妈妈李姐**: "我想让孩子抄简单的佛经段落"
  → 打开 /sutra, 看到列表 (含心经 / 阿弥陀经 / 普门品),点进任一部开始

## 3. 范围

**In scope:**
- /sutra 列表页 (搜索 + 分页)
- /sutra/[id] 详情页 (元数据 + 品块选择器 + 米字格 + 拼音)
- DB 存储 ~12 部经
- initDb 时自动从 chinese-poetry GitHub `佛经/` 子目录拉取 (若 sutras 表空)
- 两个 API: list, get
- Header 加"佛经"导航
- 首页 BentoGrid 加"佛经" tile (与"唐诗宋词" tile 并列)
- "保存到我的字帖" 复用现有 /worksheet 体系
- 按品/段落分块 (chunk model)

**Out of scope:**
- 佛教背景介绍 / 白话翻译 (决策: 完全不要背景文字)
- 功德 / 福报 / 宗教性 framing (决策: 中性文化语言)
- 拼音开关 (始终显示,跟 /poetry 一致)
- 竖排文字渲染 (保持横排,匹配 worksheet 体系)
- 收藏 / 喜欢 / 评论
- TTS 朗读经文 (用户可用现有 TTS,不做经文特化)
- 多经对照 / 跨经搜索

## 4. 架构

### 4.1 新增页面

| 路径 | 类型 | 渲染 | 鉴权 |
|---|---|---|---|
| `/sutra` | 列表 | CSR (useEffect fetch) | 公开 |
| `/sutra/[id]` | 详情 | SSR (getSutra 直查 DB) | 公开 |
| `/` (首页) | 现有 + 加 tile | SSR | 公开 |

### 4.2 新增 API

| Method | Path | 行为 | 鉴权 |
|---|---|---|---|
| GET | `/api/sutras` | 列表 + 搜索 + 分页 | 公开 |
| GET | `/api/sutras/[id]` | 详情 (含 chunks) | 公开 |

**列表 query params:**
- `q` — 可选,模糊搜索 title
- `page` — 可选,默认 1
- `pageSize` — 可选,默认 12 (经数量少,不需要大页)

**列表响应:**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": 1, "title": "心经", "slug": "xinjing", "chunkCount": 1, "charCount": 260 }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 12
  }
}
```

**详情响应:**
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "title": "心经",
    "slug": "xinjing",
    "chunks": [
      { "id": 0, "label": "全文", "content": ["观自在菩萨", "行深般若波罗蜜多时", ...], "pinyin": [["guān","zì","zài","pú","sà"], ...] }
    ]
  }
}
```

> 1 经 1 chunk: `{ chunks: [{ id: 0, label: "全文", content, pinyin }] }`
> 多 chunk (如金刚经 32 品): `{ chunks: [{ id: 0, label: "法会因由分第一", content, pinyin }, ...] }`

### 4.3 复用现有

- `WorksheetCell` (SVG 米字格) — 详情页直接复用
- `/api/worksheets` POST — "保存到字帖" 直接调用
- `/worksheet/[id]` 页面 — 保存后跳转
- `pinyin-pro` — build 脚本中预先算每字拼音
- `api-handler`, `requireUserOrNull` — lib 基础设施
- `card-paper`, `font-kai`, `btn-seal`, `paper-rule` — Plan E 设计 token
- `EmptyState`, `LoadingSpinner`, `ErrorState`, `PageContainer` — Plan E common 组件

## 5. 数据模型

### 5.1 DDL (新增于 initDb)

```sql
CREATE TABLE IF NOT EXISTS sutras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  chunks JSON NOT NULL,                  -- [{ id, label, content, pinyin }, ...]
  source VARCHAR(120),                   -- "chinese-poetry/chinese-poetry@<sha>"
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sutra (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- **chunks** 是 JSON 数组,每经 1+ 个 chunk
- 每个 chunk 内部:`content` 是 `string[]` (每元素一行),`pinyin` 与 content 1:1 对应
- **UNIQUE KEY** 用 slug 防止 build 脚本重复灌入
- 经无作者/朝代,不需要这些列

### 5.2 数据源

**GitHub:** `https://github.com/chinese-poetry/chinese-poetry` (MIT License)

**具体拉取路径:** `佛经/<slug>.json`

**12 部经 (slug → 经名):**
1. `xinjing` — 心经
2. `jingang` — 金刚经 (32 品)
3. `yaoshi` — 药师经
4. `amituo` — 阿弥陀经
5. `pumen` — 观音菩萨普门品
6. `puxian` — 普贤行愿品
7. `lengyan` — 楞严经 (节选)
8. `miaofa` — 妙法莲华经 (节选)
9. `weimo` — 维摩诘经 (节选)
10. `liuzu` — 六祖坛经
11. `dabei` — 大悲咒
12. `shishan` — 十善业道经

> **注意**: 如果 chinese-poetry 仓库 佛经/ 子目录没有某经,build 脚本跳过该经 (warn),不让 initDb 整体失败。具体经名以仓库实际为准 — `scripts/build-sutras.ts` 跑一次打印实际可用列表。

**JSON 格式 (chinese-poetry 标准,典型):**
```json
{
  "title": "心经",
  "content": "观自在菩萨,行深般若波罗蜜多时,照见五蕴皆空,度一切苦厄..."
}
```

或者带 `paragraphs` 数组 (跟唐诗一致):
```json
{
  "title": "金刚经",
  "paragraphs": ["如是我闻:一时,佛在舍卫国祇树给孤独园...", ...]
}
```

### 5.3 Chunk 切分算法 (`lib/sutras.ts` 内部函数,不在 DB 层)

```ts
function splitIntoChunks(title: string, paragraphs: string[]): SutraChunk[] {
  // 1. 检测品标记: 每段开头是 "第X品..." 或 "X品..." 的,从该处断开
  const pinMarkerRe = /^第[一二三四五六七八九十百千零〇]+品/;
  const chunks: SutraChunk[] = [];
  let current: { label: string; content: string[] } | null = null;

  for (const para of paragraphs) {
    const pinMatch = para.match(pinMarkerRe);
    if (pinMatch) {
      // 新 chunk 开始
      if (current) chunks.push({ id: chunks.length, ...current });
      current = { label: para.slice(0, 32), content: [para] };
    } else {
      if (!current) current = { label: "全文", content: [para] };
      else current.content.push(para);
    }
  }
  if (current) chunks.push({ id: chunks.length, ...current });

  // 2. 若只有 1 chunk 且 label == "全文",保持单 chunk
  // 3. 若无品标记,整部经是 1 个 chunk,label 用经名
  if (chunks.length === 0) {
    chunks.push({ id: 0, label: title, content: paragraphs });
  }
  return chunks;
}
```

**算法边界:**
- 心经 / 阿弥陀经: 无品标记 → 1 chunk, label = 经名
- 金刚经: 32 个品标记 → 32 chunks
- 法华经 (节选): 视具体段落而定

## 6. 组件设计

### 6.1 服务端 lib

**`lib/sutra-types.ts`** (共享,client + server 都 import)
```ts
export interface SutraListItem {
  id: number;
  title: string;
  slug: string;
  chunkCount: number;
  charCount: number;
}
export interface SutraChunk {
  id: number;
  label: string;
  content: string[];
  pinyin: string[][];
}
export interface SutraDetail {
  id: number;
  title: string;
  slug: string;
  chunks: SutraChunk[];
}
export interface SutraListResult {
  items: SutraListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

**`lib/sutras.ts`** (server-only)
```ts
export async function listSutras(args: { q?: string; page?: number; pageSize?: number }): Promise<SutraListResult>;
export async function getSutra(id: number): Promise<SutraDetail | null>;
```

### 6.2 客户端 lib

**`lib/api-sutras.ts`**
```ts
export async function listSutrasRequest(args: { q?: string; page?: number }): Promise<SutraListResult>;
export async function getSutraRequest(id: number): Promise<SutraDetail>;
```

### 6.3 页面

**`app/sutra/page.tsx`**
- 客户端组件, useEffect 拉列表
- state: `q`, `page`, `items`, `total`, `loading`
- 顶部: `SutraSearch` (搜索框)
- 中部: `SutraCard` grid (2-3 列响应式)
- 底部: `SutraPagination` (上一页/下一页 + 当前/总数)
- 无结果 → EmptyState
- 加载中 → LoadingSpinner
- 错误 → ErrorState + 重试

**`app/sutra/[id]/page.tsx`**
- server component: `const sutra = await getSutra(id); if (!sutra) notFound();`
- 默认 `?chunk=0`,若 query 参数越界则用 0
- 渲染: `SutraMeta` (经名) + `SutraChunkPicker` (品块选择) + `SutraWorksheet` (米字格 + 拼音) + `SaveAsWorksheetButton` (用当前 chunk 的 content)
- 打印时: 隐藏 nav/button, 只显示字帖

**`app/sutra/[id]/SaveAsWorksheetButton.tsx`**
- 'use client'
- 接收: `id, title, chunk: SutraChunk`
- onClick: 同 /poetry/[id] 的 SaveAsWorksheetButton
  - fetch POST /api/worksheets `{ title: '《'+title+'》'+chunk.label, content: chunk.content.join('').split(''), cellStyle: 'brush' }`
  - 401 → 打开 AuthModal (在原地,不跳转)
  - 成功 → router.push('/worksheet/'+id)
- 文案反馈: saving / 保存到字帖 / 已保存 (短暂)

### 6.4 组件

**`components/sutra/SutraSearch.tsx`**
- props: `{ q, onQChange }`
- 输入框 (placeholder: "搜索经名...")

**`components/sutra/SutraCard.tsx`**
- props: `{ sutra: SutraListItem }`
- 卡片: 经名 (kai, 中号) + 「X 品」或「全文」标记 + 总字数
- hover: 边框变 seal
- 整卡可点击 → /sutra/[id]

**`components/sutra/SutraPagination.tsx`**
- props: `{ page, pageSize, total, onPageChange }`
- 上一页 / 下一页 / "第 X/Y 页"

**`components/sutra/SutraChunkPicker.tsx`**
- props: `{ chunks: SutraChunk[]; activeId: number; onChange: (id: number) => void }`
- **桌面**: 右侧 sticky 垂直列表,点击切换
- **移动**: 顶部 dropdown (`<select>`) 切换
- 当前 chunk: seal 高亮 + 左边框
- 经只有 1 chunk 时:不渲染

**`components/sutra/SutraWorksheet.tsx`**
- props: `{ chunk: SutraChunk }`
- 渲染: 每行一段, char 一个 `WorksheetCell`, char 下方小字拼音
- 行间距: mb-4
- 字号: 60px (经文长,比诗略小)
- 行宽: max-w-3xl 居中

**`components/sutra/SutraMeta.tsx`**
- props: `{ title, chunkLabel? }`
- 标题 (kai, 36px) 居中
- 副标题: 当前 chunk label (如有,小字,ink-soft)
- 装饰: 上下 paper-rule

### 6.5 首页 tile

修改 **`app/page.tsx`** 的 BentoGrid,在 ITEMS 数组新增一个条目:

```tsx
const ITEMS: BentoItem[] = [
  { char: '字', title: '字 ↔ 拼音互转', ... },
  { char: '库', title: '罕见字库', ... },
  { char: '帖', title: '字帖打印', ... },
  { char: '戏', title: '趣味识字游戏', ... },
  { char: '经', title: '佛经选读', description: '12 部经分品抄写', href: '/sutra', variant: 'outline' },
];
```

> 保持与现有 tile 一致的"单汉字 + 标题 + 描述 + variant"模式, 不引入新视觉。

## 7. 数据流

### 7.1 首次部署 / 启动

```
[server start] → instrumentation.ts → initDb()
  ↓
  CREATE TABLE sutras (IF NOT EXISTS)
  ↓
  SELECT COUNT(*) FROM sutras
  ↓
  if count == 0:
    ↓
    for each of 12 slugs:
      try: fetch chinese-poetry 佛经/<slug>.json
            parse → splitIntoChunks → calcPinyin → INSERT
      catch: warn (don't fail initDb)
    log "inserted N sutras"
  else:
    log "sutras table already has N rows, skip"
```

### 7.2 用户浏览

```
/sutra page load (CSR)
  ↓
  useEffect: fetch /api/sutras?page=1
  ↓
  render SutraCard grid + pagination

点击 SutraCard
  ↓
  navigate /sutra/[id]
  ↓
  server: getSutra(id) → SSR render SutraWorksheet (default chunk 0)
  ↓
  切换 chunk: client-side state, 重新渲染 SutraWorksheet
  ↓
  click "保存到字帖"
  ↓
  POST /api/worksheets  (用当前 chunk)
  ↓
  成功 → navigate /worksheet/[id]  (复用现有页)
```

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| /sutra/[id] id 不存在 | `notFound()` → 404 页面 |
| /sutra 列表空 (搜索无结果) | EmptyState "无匹配经文" |
| /sutra 列表 API 失败 | ErrorState + "重试" 按钮 |
| 详情页 data 加载失败 | notFound() (DB 不可达也走这) |
| ?chunk=N 越界 | 用 0 |
| 保存到字帖 401 | 打开 AuthModal (跟 /poetry 一致的最新模式) |
| 保存到字帖 5xx | inline 错误提示 + button 恢复 |
| Build 脚本某经缺失 | warn + 跳过该经,继续下一个 |
| pinyin-pro 算不出拼音 (生僻字) | 降级: `pinyin(char, { toneType: 'none' })` 再降级到 `''` |

## 9. 测试策略

### 9.1 单元测试
- `lib/sutras.ts` 的 `splitIntoChunks` (心经单 chunk / 金刚经 32 chunk / 边界情况)
- `lib/sutras.ts` 的 `listSutras`, `getSutra` (mock DB)
- `components/sutra/SutraCard` 渲染 (Vitest + happy-dom)
- `components/sutra/SutraWorksheet` 渲染 (props → DOM)

### 9.2 集成测试
- `GET /api/sutras` (正常/分页/搜索/空 q)
- `GET /api/sutras/[id]` (正常/不存在)

### 9.3 Build 脚本冒烟
- 跑 `pnpm sutras:build` 用 mock JSON 验证: 解析 + chunk split + pinyin 计算 + UPSERT 都不报错

### 9.4 手工冒烟 (人 review)
1. 首页 BentoGrid 看到"佛经" tile
2. 点击 Header 佛经链接 → /sutra
3. 列表页: 12 部经显示,搜索"金刚"过滤
4. 点进《心经》: 米字格 + 拼音正确,无品块选择器 (单 chunk)
5. 点进《金刚经》: 看到 32 个品的 picker,选 "法会因由分第一" 切换
6. 点 "打印" → 浏览器打印预览
7. 点 "保存到字帖" → (未登录) 打开 AuthModal → 登录后跳 /worksheet/[id]
8. /worksheet/[id] 看到经文内容
9. /sutra/[id] 直接输入不存在 id → 404
10. 移动端 (375px): chunk picker 变成 dropdown,正常切换

## 10. 实现任务清单 (高层)

> 详细 task breakdown 会在 spec 确认后由 writing-plans skill 生成。

1. DDL: initDb 加 sutras 表
2. lib/sutra-types.ts
3. lib/sutras.ts (splitIntoChunks, listSutras, getSutra) + 单元测试
4. API: /api/sutras/route.ts, /api/sutras/[id]/route.ts + 集成测试
5. lib/api-sutras.ts (客户端包装)
6. scripts/build-sutras.ts (拉 chinese-poetry/佛经/ + UPSERT) + 接入 initDb
7. components/sutra/SutraSearch, SutraCard, SutraPagination, SutraChunkPicker, SutraWorksheet, SutraMeta + 单元测试
8. app/sutra/page.tsx (列表页)
9. app/sutra/[id]/page.tsx (详情页)
10. app/sutra/[id]/SaveAsWorksheetButton.tsx
11. 修改 app/page.tsx (BentoGrid 加 tile)
12. 修改 lib/design.ts (NAV_LINKS 加 佛经)
13. 全套: tsc, vitest, build, 启动 dev 手工冒烟

## 11. 已知风险 / 注意点

- **chinese-poetry 佛经/ 子目录的 JSON 结构可能不统一**: 有的用 `content` 单字符串,有的用 `paragraphs` 数组,build 脚本要兼容
- **pinyin-pro 对极生僻字支持**: 一些字 pinyin-pro 返回空数组,build 脚本要降级处理
- **chunks JSON 体积**: 12 经 × 平均 3KB = ~36KB,单表无问题,但查询时不要 SELECT *,只取需要的列
- **品标记的鲁棒性**: 不同版本的佛经可能用「第X品」或「X品」,正则要兼容
- **保存到字帖 flatten 丢失品结构**: 拍平到 char 数组后, /worksheet/[id] 渲染时是统一 grid。这是有损的,但与 /poetry 行为一致,用户预期相同
- **pinyin 字段是否按 chunk 拆分存储**: 经有 N 个 chunk,每个 chunk 独立 `pinyin` 数组,大经 (金刚经) 算 pinyin 会稍慢,但 build 脚本一次性,不影响运行时

## 12. 不在范围 (Out of Scope)

- 佛教背景介绍
- 白话翻译
- 多语言注释
- 功德/福报 framing
- 用户收藏 / 喜欢
- TTS 经文特化
- 多经对照阅读
- 移动端原生 App
- 离线 PWA

## 13. 验收标准

- [ ] `pnpm tsc --noEmit` 通过
- [ ] `pnpm test` 所有单元 + 集成测试通过 (无回归)
- [ ] `pnpm build` 通过
- [ ] 首次启动时, 若 sutras 表空则自动灌入 (DB log: "inserted N sutras")
- [ ] 访问 /sutra 看到 ~12 部经
- [ ] 搜索"金刚" 过滤出《金刚经》
- [ ] 点开《心经》详情页: 单 chunk, 米字格 + 拼音正确
- [ ] 点开《金刚经》详情页: 32 个品块 picker 可见,切换时 worksheet 重新渲染
- [ ] "保存到字帖" 未登录时打开 AuthModal (不跳转),登录后保存到 /worksheet/[id]
- [ ] /worksheet/[id] 看到经文内容
- [ ] 首页 BentoGrid 看到「佛经」tile
- [ ] Header 导航有「佛经」链接
- [ ] 移动端 (375px): chunk picker 变 dropdown,响应式正常
- [ ] 打印预览: 详情页只显示字帖内容,不显示按钮/导航
- [ ] 中性文化语言: 页面无 "功德/福报/抄经" 等宗教性词汇
