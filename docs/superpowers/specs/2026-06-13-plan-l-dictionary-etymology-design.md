# Plan L — 完整字典页 + 字源/字形演变 设计文档

**目标**: 在 PinYinCharacter 项目中加入一个覆盖 8105 通用规范汉字的全表字典 + 每个汉字的字形演变沉浸页,使任何常用字都能查到完整元数据与字源故事。

**架构**: Option A (RSC + 客户端 toggle) 字典 + Option C (沉浸式时间轴子页) 字源。字典详情页用 4 个 tab (字典/字源/故事/+字帖) 串起三个相关功能。字体渲染 + LLM 故事 渐进生成,无访问等待。

**技术栈**: Next.js 15 (App Router, RSC + 'use client'), TypeScript, MySQL (mysql2), Tailwind v4, zod, Web Speech (复用 lib/tts), Web Fonts for ancient scripts, existing 殷契甲骨文/漢典金文/全字库 fonts.

---

## 1. 背景与目标

### 现状 (现状已存在)
- `data/general-standard-chinese-characters.json` — 8105 字符号数组 (level 1=3500 + level 2=3000 + level 3=1605)
- `data/radicals.json` — 6920 字符号 → 部首 (部首 214, 但 chars 字典有 1185 字不在里面)
- `data/pinyin-hanzi.json` — 398 pinyin 键 → 候选汉字 (来自 pypinyin, 覆盖不全)
- `data/rare-chars-level3.json` — level 3 的 1605 字符串
- `rare_chars` 表 (Plan D/G) — 1605 行 + 部分 AI 生成 story (Plan G 持续生成中)
- `/rare-chars` — 浏览页 (1450 罕见字 grid, 搜索, 每日字)
- `/rare-chars/[char]` — 详情页 (char + pinyin + meaning + story)
- `/stories`, `/stories/[char]` — Plan G 故事翻页
- 字体: 殷契甲骨文 woff/ttf, 漢典金文 ttf, 全字库说文解字/隶定 ttf (开源, 可商用)

### 目标
1. **完整字典页 `/dictionary`** — 覆盖全部 8105 字符,支持 [按拼音 A-Z 锚点] / [按部首 214 侧栏] 两种浏览模式 toggle,显示 pinyin/部首/笔画,搜索 by pinyin/汉字/英文。
2. **字典详情页 `/dictionary/[char]`** — tab 切换 (字典/字源/故事/+字帖),展示 7 字段 (拼音/部首/笔画/释义/英文/Unicode/异体字) + 相关字 (同部首/同拼音)。
3. **字源沉浸页 `/etymology/[char]`** — 大字 + 时间轴 (甲骨/金文/小篆/隶书/楷书) + LLM 生成的故事 + 上一字/下一字。**5 个时代的字形图 = 用专门字体渲染该字**,无图时显示「暂无」。
4. **数据架构** — 1 张 `chars` 表 (8105) + 1 张 `char_etymology` 表 (渐进),保留现有 `rare_chars`。
5. **生成管线** — 启动时一次性导入 8105 硬数据 + 字体覆盖矩阵,LLM story 走 cron + 管理员手动。
6. **Admin 扩展** — `/admin/chars` 看覆盖率, `/admin/chars/generate` 手动批量生成。

### 不做
- 异体字自动补全 (仅做字段,数据靠 import 阶段填)
- 释义/英文的 AI 自动生成 (v1 释义/英文数据靠外部数据集,缺口保留空)
- 字典导出 (PDF/CSV 导出)
- 字源图导出 (无水印 PNG/SVG 下载)
- 多个字体同屏对比 (用户在 5 个时代之间跳转)
- 字源详情页之间的中文同义词/反义词链接

---

## 2. 架构

### 2.1 页面层次

```
/dictionary              [RSC] 字典浏览页 (toggle 拼音/部首 + 搜索)
/dictionary/[char]       [RSC] 字典详情页 (tab 字典/字源/故事/+字帖)
/etymology/[char]        [RSC] 字源沉浸页 (大字 + 时间轴 + 故事 + 翻页)
/admin/chars             [RSC] Admin 覆盖率 (8105 中 N 字有字源)
/admin/chars/generate    [RSC] Admin 批量触发生成
```

### 2.2 客户端组件

- `<DictionaryClient>` — 'use client', state: viewMode ('pinyin' | 'radical') | selectedLetter | selectedRadical | searchQuery. URL `?view=pinyin&letter=A&q=ni`
- `<PinyinAnchor>` — 顶部 A-Z 锚点条,点击跳到对应字母 anchor (`#A`)
- `<RadicalSidebar>` — 左 214 部首网格,点击切换右侧 grid 数据
- `<DictionaryCharGrid>` — 主体字符网格,7-8 列,每格: char + pinyin
- `<DictionaryDetailTabs>` — 'use client', state: activeTab. "字典" tab 显示 7 字段 + 相关字;"字源"/"故事"/"+字帖" 三个 tab 是 a-link 跳子页 (以 `→` 后缀示意跳转)
- `<EtymologyTimeline>` — 'use client', state: activeEra (0=甲骨,1=金文,2=小篆,3=隶书,4=楷书), 5 个 dot + 自动播放 (3s 切换) + 键盘 ←/→ 切换
- `<EtymologyPrevNext>` — 上一字/下一字 按钮,顺序: 当前筛选顺序 (若无筛选则按 unicode 顺序)

### 2.3 数据流

**字典列表页**
```
RSC /dictionary
  → listChars({ level?, letter?, radical?, q?, page })
    → SQL: SELECT * FROM chars WHERE [letter|pinyin LIKE|radical=?|...] LIMIT/OFFSET
  → render <DictionaryClient>
    → 内部 toggle 切换 URL 参数,浏览器 history.pushState
    → 不需要二次 server fetch (数据已在 RSC 阶段预取)
```

**字典详情页**
```
RSC /dictionary/[char]
  → getCharDetail(char) 返回 { 7 字段 + 同部首 N 字 + 同拼音 N 字 }
  → render <DictionaryDetailTabs>
    → 字典 tab: 渲染 7 字段 + 相关字
    → 字源 tab: <Link href={`/etymology/${char}`}> → 跳转
    → 故事 tab: <Link href={`/stories/${char}`}> → 跳转 (Plan G 路径)
    → +字帖 tab: <Link href={`/worksheet?text=${char}`}> → 跳转
```

**字源页**
```
RSC /etymology/[char]
  → getEtymology(char) 返回 { story, eraGlyphs: { era, font_class, has_glyph, fallback? } }
  → getAdjacentChars(char, currentFilter) 返回 { prev, next }
  → render <EtymologyTimeline> + <EtymologyPrevNext>
    → 5 个 era 的字形 <span className="font-{era-font}">{char}</span>
    → has_glyph=false 时显示「暂无」灰色块
```

**管理员手动生成**
```
Admin POST /api/admin/chars/generate { char[]: string[] }
  → for each char:
    - if char_etymology exists, skip
    - else: call LLM with char + era context, parse JSON, insert into char_etymology
  → withAiLogging wrapper records: model, tokens, latency
  → return { generated: N, skipped: M, errors: K }
```

### 2.4 与现有系统的关系

- **Plan G `/stories`** 保留;字典详情页"故事" tab 链接到 `/stories/[char]` (已有路由,无需修改)
- **Plan G `/stories/random`** 保留;Plan G `rare_chars.story` 是 1605 罕见字的 AI 故事 (内容关于"这个字怎么用、有什么典故"),与 Plan L `char_etymology.story` 是不同内容 (字形演变故事)。v1 决策: 两表数据**不互用**,各管各的。1605 罕见字在 Plan L 字源页的字源 story 仍需单独 LLM 生成 (cron + 手动);Plan G 的故事继续在 `/stories/[char]` 显示。
- **Plan D `/worksheet`** 保留;字典详情页"+字帖" tab 复用现有 `?text=...` 入口
- **Admin `/admin/*`** 扩展,新增 `/admin/chars` 和 `/admin/chars/generate`

---

## 3. 数据模型

### 3.1 `chars` 表 (新)

```sql
CREATE TABLE chars (
  `char`        VARCHAR(4)   NOT NULL,
  level         TINYINT      NOT NULL,        -- 1 / 2 / 3
  pinyin        VARCHAR(64)  NOT NULL DEFAULT '',  -- 主读音,空格分隔多音字
  pinyin_alt    TEXT         NULL,            -- JSON 数组,所有读音 ["yī","yī"]
  radical       VARCHAR(8)   NOT NULL DEFAULT '',  -- 部首字
  stroke_count  SMALLINT     NOT NULL DEFAULT 0,   -- 总笔画
  meaning_zh    TEXT         NULL,            -- 中文释义 (多行)
  meaning_en    TEXT         NULL,            -- 英文释义 (逗号分隔)
  unicode_codepoint VARCHAR(8) NOT NULL,      -- U+4E00 等
  variants      TEXT         NULL,            -- JSON 数组 ["壹"]
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`char`),
  KEY idx_level (level),
  KEY idx_radical (radical),
  KEY idx_pinyin (pinyin),
  KEY idx_stroke (stroke_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

字段填写来源 (v1):
- `char`/`level`: 从 `data/general-standard-chinese-characters.json` 导入(1-3500=level 1, 3501-6500=level 2, 6501-8105=level 3)
- `pinyin`/`pinyin_alt`: 从 pypinyin 字典补,辅以 CC-CEDICT 兜底
- `radical`: 从 `data/radicals.json` 导入(覆盖 6920 字,缺 1185 字留空,后续手动补)
- `stroke_count`: 从 hanzi-writer-data 导入(覆盖 ~9000 字,预计基本全)
- `meaning_zh`/`meaning_en`: 从 萌典 / CC-CEDICT 导入,缺口留空
- `unicode_codepoint`: 计算 `char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')` 导出
- `variants`: 从 Unihan kVariants 字段导入,缺口留空

### 3.2 `char_etymology` 表 (新)

```sql
CREATE TABLE char_etymology (
  `char`        VARCHAR(4)  NOT NULL,
  -- 5 个 era 的字形: 字体 class 名 + 是否有 glyph
  era_jiaguwen_font     VARCHAR(32) NOT NULL DEFAULT 'YinQiJiaGuWen',
  era_jiaguwen_has      BOOLEAN     NOT NULL DEFAULT FALSE,
  era_jinwen_font       VARCHAR(32) NOT NULL DEFAULT 'HanDianJinWen',
  era_jinwen_has        BOOLEAN     NOT NULL DEFAULT FALSE,
  era_xiaozhuan_font    VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuShuoWen',
  era_xiaozhuan_has     BOOLEAN     NOT NULL DEFAULT FALSE,
  era_lishu_font        VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuLiDing',
  era_lishu_has         BOOLEAN     NOT NULL DEFAULT FALSE,
  era_kaishu_font       VARCHAR(32) NOT NULL DEFAULT 'KaiTi',
  era_kaishu_has        BOOLEAN     NOT NULL DEFAULT TRUE,  -- 楷书默认有
  -- 故事 (LLM 生成, 渐进)
  story         TEXT         NULL,
  -- 元数据
  generated_by  VARCHAR(64)  NULL,        -- LLM 模型名
  generated_at  TIMESTAMP    NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`char`),
  KEY idx_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

字段语义:
- `{era}_font`: 字体 CSS class 名 (与 `app/globals.css` 中的 `@font-face` 名称对应)
- `{era}_has`: 该 char 在该字体中是否有 glyph (启动时一次性检测, charcode 是否在 font 范围内)。`FALSE` 的字在 UI 显示「暂无」
- `story`: LLM 生成的字源演变故事 (与 Plan G `rare_chars.story` 不同)
- `generated_by`/`generated_at`: withAiLogging 自动填

**字体覆盖检测** (启动时一次性):
```ts
// scripts/detect-font-coverage.ts
async function detectCoverage(char: string, fontBuffer: ArrayBuffer): Promise<boolean> {
  await document.fonts.load(`16px "${fontFamily}"`, char);
  return document.fonts.check(`16px "${fontFamily}"`, char);
}
```
无浏览器时 (build script) 用 `fontkit` 包读取 cmap 表检查。

### 3.3 `rare_chars` 表 (现有, Plan G)
- 不动。Plan G 故事继续走这表。
- 字典详情页"故事" tab 链接到 `/stories/[char]`,`/stories/[char]` 走 Plan G 的逻辑(读 `rare_chars.story`)。

---

## 4. 字体集成

### 4.1 字体文件位置

```
public/fonts/
  yinqi-jiaguwen.woff2          (~2MB, 殷契甲骨文, ~1500 字)
  handian-jinwen.woff2          (~1.5MB, 漢典金文, ~3000 字)
  quanziku-shuowen.woff2        (~2MB, 全字库说文解字, ~9000 字)
  quanziku-liding.woff2         (~1.5MB, 全字库隶定, ~9000 字)
  kaiti-existing.woff2          (现有 kai 字体, 楷书)
```

### 4.2 `app/globals.css` 添加

```css
@font-face {
  font-family: 'YinQiJiaGuWen';
  src: url('/fonts/yinqi-jiaguwen.woff2') format('woff2');
  font-display: swap;
}
/* ... 其余 4 个字体类似 */
```

### 4.3 字体使用

```tsx
<span className="font-jiaguwen text-9xl">{char}</span>
```

Tailwind config (在 `tailwind.config.ts` 中扩展) 把这些字体名加到 `fontFamily`:
```ts
fontFamily: {
  jiaguwen: ['YinQiJiaGuWen', 'serif'],
  jinwen: ['HanDianJinWen', 'serif'],
  xiaozhuan: ['QuanZiKuShuoWen', 'serif'],
  lishu: ['QuanZiKuLiDing', 'serif'],
  kai: ['KaiTi', 'serif'],
}
```

### 4.4 字体加载性能

- 5 个 woff2 总计约 8MB
- 启用 `font-display: swap`,首屏用 fallback,字体加载完切换
- 关键 CSS 异步加载 (`<link rel="preload" as="font">` for kaishu only, 其余懒加载)

---

## 5. 字源 LLM 生成 prompt

```
你是一位汉语言文字学家,擅长汉字字源研究。

请为汉字「{char}」(拼音: {pinyin}, 释义: {meaning_zh}) 写一段 150-250 字的字源演变故事。
要求:
1. 涵盖该字在甲骨文/金文/小篆/隶书/楷书 5 个时代的字形演变
2. 说明字形演变的动因 (如简化、讹变、规范化等)
3. 简洁生动,适合普通读者
4. 不用 Markdown 格式,纯文本

直接输出故事正文,不要前缀。
```

LLM 返回纯文本,直接存 `char_etymology.story`。

---

## 6. API 路由

| 路由 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/chars` | GET | 字典列表 (支持 level/letter/radical/q/page 参数) | 公开 |
| `/api/chars/[char]` | GET | 字典详情 (7 字段 + 相关字) | 公开 |
| `/api/etymology/[char]` | GET | 字源 (5 era 字形 + story + prev/next) | 公开 |
| `/api/admin/chars/coverage` | GET | 覆盖率统计 (level/grouped) | admin |
| `/api/admin/chars/generate` | POST | 批量触发 story 生成 | admin |
| `/api/admin/chars/cron-config` | GET/PUT | cron 频率/启停 | admin |

---

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| `/dictionary` 0 结果 (不可能,8105 字都有) | 仍显示 EmptyState |
| `/dictionary/[char]` 不存在 | 404 |
| `/etymology/[char]` 不存在 | 404 |
| `/etymology/[char]` 无字源 (row 不存在) | 显示「字源即将生成」+ 上一字/下一字 |
| `/etymology/[char]` 某 era 无 glyph | 该 era 显示「暂无」灰色块,不阻塞其他 era |
| Admin generate LLM 失败 | 记录到 `ai_calls` 表,返回错误列表 |
| 字体加载失败 | fallback 到 system serif, console.warn |

---

## 8. 测试

### 单元测试 (Vitest)
- `lib/chars.ts` — 6 fns: listChars / getChar / getCharDetail / searchChars (each TDD)
- `lib/etymology.ts` — 3 fns: getEtymology / getAdjacentChars / detectFontCoverage (TDD)
- `lib/char-ai.ts` — 1 fn: generateEtymologyStory (mocked LLM)
- `lib/validators.ts` — `charsListQuery`, `charParam`, `etymologyCharParam` (zod)

### 集成测试 (Vitest + MySQL)
- 7 个 API 路由 (3 public + 4 admin), 用 `integrationDescribe` 自动 skip 无 DB
- DDL smoke test (`initDb` 启动后表存在)

### 组件测试 (Vitest + happy-dom)
- `<DictionaryClient>` — toggle 切换, 搜索输入, 字母锚点滚动
- `<DictionaryDetailTabs>` — 4 tab 渲染, link href 正确
- `<EtymologyTimeline>` — 5 era dot, 切换 active, 键盘 ←/→
- `<EtymologyPrevNext>` — 按钮 disabled 边界, 跳转 href

### 浏览器手动冒烟 (Human, Plan L Task 24)
- 12 步: 字典 toggle, 搜索, 详情 tab, 字源时间轴, 字体显示, 上一字/下一字, Admin 生成
- pnpm dev + 打开浏览器, 12 步全过

---

## 9. 文件结构 (新增/修改)

```
新文件:
  app/dictionary/page.tsx                              RSC 字典浏览
  app/dictionary/[char]/page.tsx                       RSC 字典详情
  app/etymology/[char]/page.tsx                        RSC 字源页
  app/admin/chars/page.tsx                             RSC 覆盖率
  app/admin/chars/generate/page.tsx                    RSC 批量生成
  app/api/chars/route.ts                               GET list
  app/api/chars/[char]/route.ts                        GET detail
  app/api/etymology/[char]/route.ts                    GET etymology
  app/api/admin/chars/coverage/route.ts                GET
  app/api/admin/chars/generate/route.ts                POST
  app/api/admin/chars/cron-config/route.ts             GET/PUT
  components/dictionary/DictionaryClient.tsx           'use client'
  components/dictionary/DictionaryCharGrid.tsx
  components/dictionary/PinyinAnchor.tsx
  components/dictionary/RadicalSidebar.tsx
  components/dictionary/DictionarySearch.tsx
  components/dictionary/DictionaryDetailTabs.tsx       'use client'
  components/etymology/EtymologyTimeline.tsx           'use client'
  components/etymology/EtymologyPrevNext.tsx
  components/etymology/EraGlyph.tsx
  lib/chars.ts                                         6 fns
  lib/chars-types.ts                                   共享类型
  lib/etymology.ts                                     3 fns
  lib/etymology-types.ts
  lib/char-ai.ts                                       LLM wrapper
  lib/font-coverage.ts                                 字体检测
  scripts/import-chars-data.ts                         启动时导入
  scripts/detect-font-coverage.ts                      字体覆盖
  public/fonts/yinqi-jiaguwen.woff2                    甲骨
  public/fonts/handian-jinwen.woff2                    金文
  public/fonts/quanziku-shuowen.woff2                  小篆
  public/fonts/quanziku-liding.woff2                   隶书

修改:
  app/globals.css                                      +5 @font-face
  tailwind.config.ts                                   +5 font-family
  components/Header.tsx                                +字典 nav link
  app/admin/layout.tsx                                 +chars sub-nav
  lib/api-handler.ts                                   无变化
  README.md                                            +字典 + 字源 docs
```

---

## 10. 实施任务列表 (大纲)

Plan L 预计 24 个任务,7 个阶段:
- **Phase A 数据层 (Tasks 1-6)**: DDL chars + char_etymology → chars.ts (6 fns) → etymology.ts (3 fns) → font-coverage.ts → import-chars-data 脚本 → detect-font-coverage 脚本
- **Phase B API 层 (Tasks 7-10)**: validators → /api/chars (list+search) → /api/chars/[char] → /api/etymology/[char]
- **Phase C 字典前端 (Tasks 11-15)**: PinyinAnchor + RadicalSidebar + DictionaryCharGrid → DictionaryClient → /dictionary 页面 → /dictionary/[char] 详情 → DictionaryDetailTabs
- **Phase D 字源前端 (Tasks 16-19)**: EraGlyph → EtymologyTimeline → EtymologyPrevNext → /etymology/[char] 页面
- **Phase E 字体集成 (Tasks 20-22)**: 下载 5 字体 → globals.css + tailwind config → header nav link
- **Phase F Admin (Tasks 23-26)**: /api/admin/chars/coverage → /generate → /cron-config → 2 个 admin 页面
- **Phase G 收尾 (Tasks 27-28)**: README + .env.example → 最终 review + 手动冒烟

---

## 11. 验证清单 (Human 冒烟)

1. `/dictionary` 页面加载, 显示 8105 字统计
2. toggle 切到「按部首」, 选「水部」, 右侧只显示水部字
3. 搜索框输入 "ni", 显示所有拼音含 ni 的字
4. 点 "一" → /dictionary/一, 7 字段齐全
5. 点 "字源" tab → 跳到 /etymology/一
6. 时间轴 5 个 dot, 默认楷书 active
7. 点 "甲骨" dot, 显示「暂无」(因为「一」在甲骨文里有,需手动验证覆盖检测)
8. 键盘 ←/→ 切换 era
9. 点 "上一字" → /etymology/丁
10. /admin/chars 显示覆盖率统计,例如 "字源: 1453/8105 (17.9%), 其中甲骨文覆盖 1480/8105 (18.2%)"
11. /admin/chars/generate 选 5 个字, 点生成, 5-15s 后 DB 写入
12. 重复步骤 5, 现在 /etymology/{任选} 显示完整 story + 5 era 字形

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 8105 字符号数据从公开数据集导入失败 | 备选: hanzicraft/Unicode Unihan CSV, 任一能 import 即可 |
| 字体 woff2 文件获取受阻 (GitHub raw 限流/CORS) | 下载脚本带 retry, 同时 fallback 到 npm 包 (hanzi-writer) |
| 字体覆盖检测在 happy-dom 不可用 | build script 用 fontkit 直接读 cmap, 不依赖浏览器 |
| LLM 生成 story 失败率高 | retry 3 次 + 失败计入 ai_calls 表供 admin 重试 |
| 8MB 字体拖慢首屏 | 楷书 woff2 放 inline <link rel="preload">, 其余 4 个懒加载 |
| 5 个 era 字体不覆盖所有 8105 字 | "暂无" 灰色块, 不阻塞其他 era 显示;覆盖率显示在 admin |
| 字典页 8105 字 grid 滚动卡 | 服务端 LIMIT/OFFSET, 每页 80 字, 复用现有分页组件 |
| `/admin/chars` 慢查询 | 加 `idx_radical` / `idx_pinyin` 索引 |

---

## 13. 范围外 (未来 Plan 候选)

- 字源图导出 (PNG/SVG)
- 字源图横向对比 (5 字并排选哪个字形最像)
- 异体字 AI 自动识别
- 汉字多音字口音 (方言发音)
- 汉字组词 (组词大全)
- 字典导出 (PDF / CSV)
- 实时协同编辑 (admin 多用户)
- 笔画顺序动画 (hanzi-writer 集成)
