# Admin 字形数据覆盖率 — 设计文档

**目标**: 后台新增"字形数据"页面 (`/admin/glyphs`),对照 `chars` 表与 `public/strokes/*.json` 两端的字形数据,展示覆盖率 + 两端差异(DB 多出 / 字形孤儿),供管理员监控字典页 `StrokeOrderCard` 实际能成功加载的字数。

**架构**: Server Component + Node `fs.readdir` + MySQL 一次 SELECT。所有计算在服务端完成,客户端零 JS。`fs.readdir` 用 `unstable_cache` 以文件 mtime 为 key 缓存 30s,避免每次请求扫盘。

**技术栈**: Next.js 15 (App Router, RSC), TypeScript, `node:fs/promises`, `mysql2`, Tailwind v4, vitest。

---

## 1. 背景与目标

### 现状

- `public/strokes/` 共 **6866** 个 JSON 文件 (HanziWriter `{strokes, medians}` 格式) — 由 `scripts/build-strokes.ts` (Plan M) 一次性 build 出来
- `chars` 表共 **8105** 行 (Plan L 已 import)
- 两端数量差异:DB 比字形文件多 ≈ 1239 字
- `components/dictionary/StrokeOrderCard.tsx:48` 与 `components/LiveStrokeDemo.tsx:42` 都用 `fetch('/strokes/{char}.json')` 拉数据,缺失时显示 "暂无该字笔画数据"
- `app/admin/chars/page.tsx` 只看 dictionary + etymology 覆盖率,**没有**覆盖字形数据维度的差异
- `components/admin/AdminSidebar.tsx` 当前 7 项,无 "字形数据" 入口

### 目标

1. 后台侧边栏加 **"字形数据"** 入口 → `/admin/glyphs`
2. 页面顶部 4 个统计卡片:
   - **DB 总字符数** (来自 `chars`)
   - **字形文件数** (来自 `public/strokes/`)
   - **一致数** (intersect)
   - **DB 多出 / 字形多出** (两个差异计数)
3. 顶部筛选行 + 分页:可切换视图 (`DB 缺少字形` / `字形孤儿` / `全部`),可改每页大小 (50/100/200)
4. 左右两栏对照表:
   - 左:DB 缺少字形 (按 `level ASC, char ASC` 排序)
   - 右:字形孤儿 (按文件名升序)
   - 每条展示字符 + level chip,缺失的标 "无字形" / 孤儿标 "无 DB"
5. 复用现有 `app/admin/...` RSC + GET searchParams 模式,无新 API route

### 不做 (v1 YAGNI)

- ❌ 自动生成缺失字形 — 需要额外的 HanziWriter 数据源,且与 `build-strokes.ts` 已有 build 流程冲突
- ❌ 批量删除孤儿 — 风险大,需要先在外部确认
- ❌ CSV / JSON 导出 — 监控用,直接读页面够用,导出需要再说
- ❌ 写操作 / 审计事件 — 纯只读视图
- ❌ 字形 SVG 预览 — 视图只对账,不渲染

---

## 2. 数据模型

**不新增表**。读两个源:

| 源 | 字段 | 量级 |
|---|---|---|
| `chars` | `id, char, level, stroke_count, ...` | 8105 行 |
| `public/strokes/{char}.json` | `{strokes: string[], medians: number[][][]}` | 6866 个文件 |

**新模块** `lib/glyph-coverage.ts` (服务端专用):

```ts
export type GlyphFilter = 'missing' | 'orphan' | 'all';

export interface GlyphDiffRow {
  char: string;       // 文件名也用 char 字段存
  level: number | null; // 孤儿文件没有 level
}

export interface GlyphCoverage {
  dbTotal: number;       // SELECT COUNT(*) FROM chars
  fileTotal: number;     // fs.readdir 计数
  matched: number;       // |DB ∩ files|
  missingInFiles: number; // DB - files
  orphans: number;        // files - DB
  // 分页 + 当前 filter 切片:
  missingRows: GlyphDiffRow[];
  orphanRows: GlyphDiffRow[];
  totalMissing: number;   // unfiltered
  totalOrphans: number;
  page: number;
  pageSize: number;
  filter: GlyphFilter;
}

export async function getGlyphCoverage(opts: {
  filter: GlyphFilter;
  page: number;
  pageSize: number;
}): Promise<GlyphCoverage>;
```

**计算步骤** (单次请求内顺序执行,无并发):

1. `getPool().query('SELECT char, level FROM chars')` — 一次性取 8105 行 (~250KB)
2. `fs.readdir('public/strokes')` — 通过 `unstable_cache` 缓存,以目录 mtime 为 key (30s 复用)
3. 把两个 Set 算出来:`dbSet`, `fileSet`
4. `missing = [...dbSet].filter(c => !fileSet.has(c))`
5. `orphans = [...fileSet].filter(c => !dbSet.has(c))`
6. `missing` 按 `level ASC, char ASC` 排序;`orphans` 按字符代码点排序
7. 按 `page, pageSize` 切片 `missingRows` / `orphanRows`

**性能预算**: 首次未缓存 ~50ms (DB 30ms + readdir 10ms + JS 10ms),缓存命中 <5ms。内存峰值 ~5MB (两个 Set)。

---

## 3. API 与 UI

### API

**不新增 API route**。页面是 RSC,直接调 `getGlyphCoverage()`,URL 用 searchParams 传状态:

```
/admin/glyphs?filter=missing&page=1&pageSize=50
/admin/glyphs?filter=orphan&page=2&pageSize=100
/admin/glyphs                            # 默认: filter=missing, page=1, pageSize=50
```

### UI 结构 (`app/admin/glyphs/page.tsx`)

```
<AdminShell>
  <h1>字形数据</h1>
  <p>... 监控 chars 表与 public/strokes/ 的一致性</p>

  {/* 4 个统计卡片 */}
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <Stat label="DB 总字符" value={cov.dbTotal} />
    <Stat label="字形文件" value={cov.fileTotal} />
    <Stat label="一致" value={cov.matched} />
    <Stat label="DB 多出 / 字形多出" value={`${cov.missingInFiles} / ${cov.orphans}`} />
  </div>

  {/* 筛选 + 分页 */}
  <form class="...">
    <select name="filter"> missing / orphan / all </select>
    <select name="pageSize"> 50 / 100 / 200 </select>
    <button>应用</button>
  </form>

  {/* 左右对照表 */}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <Panel title={`DB 缺少字形 (${cov.totalMissing})`} rows={cov.missingRows} kind="missing" />
    <Panel title={`字形孤儿 (${cov.totalOrphans})`} rows={cov.orphanRows} kind="orphan" />
  </div>

  {/* 分页器 */}
  <Pagination page={cov.page} totalPages={...} basePath="/admin/glyphs" />
</AdminShell>
```

每个 row:

```
{missing row}  汉  [1 级]  <span>无字形</span>
{orphan row}   㬎  <span>无 DB</span>
```

纯文本 + Tailwind,不用图标。

### 侧边栏入口 (`components/admin/AdminSidebar.tsx`)

```ts
const ITEMS = [
  { href: '/admin', label: '仪表盘', exact: true },
  { href: '/admin/users', label: '用户' },
  { href: '/admin/chars', label: '字典 / 字源' },
  { href: '/admin/glyphs', label: '字形数据' },     // ← 新增
  { href: '/admin/logs', label: '日志' },
  { href: '/admin/downloads', label: '下载' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/tts', label: '语音设置' },
];
```

放在 "字典 / 字源" 之后 — 逻辑相邻(都跟字相关),视觉上是同级。

---

## 4. 错误处理

| 情况 | 处理 |
|---|---|
| `fs.readdir` 失败 (路径不存在/权限) | 抛错 → Next error boundary;典型情况下路径总存在,失败说明部署坏了 |
| `chars` 表 SELECT 失败 | 抛错 → error boundary (统一行为) |
| `pageSize` 不是合法值 | 用 zod parse,失败回退默认 50 |
| `filter` 不是合法值 | zod 校验,回退 `missing` |
| `page < 1` | clamp 到 1 |
| `page > totalPages` | clamp 到 `totalPages` (若无数据则停在 1) |
| 字符不在 BMP (U+10000+) | `encodeURIComponent` 在 `StrokeOrderCard` 里已处理;admin 页面用 `encodeURIComponent` 后再 `decodeURIComponent` 显示 |

---

## 5. 测试

**单元** (`tests/unit/glyph-coverage.test.ts`):
- 4 个 mock 场景:全匹配 / 全 missing / 全 orphan / 部分匹配
- 边界:空 DB、空目录、单字 BMP / 扩展 A
- 排序:`missing` 按 level ASC 排序正确;`orphans` 按 codepoint 排序正确
- 分页:切片准确,`pageSize=50, page=2` 返回 50-99

**集成** (可选,`tests/integration/admin-glyphs.test.ts`):
- 登录 admin → GET `/admin/glyphs` 200,返回的 `matched + missingInFiles === dbTotal`
- GET `/admin/glyphs?filter=orphan&pageSize=10` 200,`orphanRows.length <= 10`
- 未登录 → 302 redirect to login

---

## 6. 迁移 / 部署

**无迁移**。无 schema 变更。部署步骤:

1. `pnpm tsc --noEmit` + `pnpm test` 通过
2. commit + push
3. 无需重启 db / 跑 migration

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| `fs.readdir('public/strokes')` 慢 (目录很大) | 6866 个文件对 ext4 几乎是瞬时;加 `unstable_cache` 兜底 |
| 字符集 (BMP / 扩展 A) URL 编码 | 复用 `encodeURIComponent` 规则;admin 表格直接显示字符,不嵌 URL |
| Sidebar 顺序调整破坏现有快照测试 | 暂无快照测试;若有,需要同步更新 |
| `getGlyphCoverage` 在 RSC 中调用 = 每个用户访问都跑 | admin-only,流量极低;缓存后实际开销 <5ms |

---

## 8. 不在范围 (延期)

- 集成 `build-strokes.ts` 自动补齐缺失字形
- 在用户前端显示 "N / 8105 字有笔顺动画" 之类的覆盖率徽章
- 字形孤儿清理工具
