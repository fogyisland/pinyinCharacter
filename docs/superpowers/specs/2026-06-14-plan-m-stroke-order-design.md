# Plan M — 笔画顺序 / 动画 设计文档

**目标**: 在 `/dictionary/[char]` 字典详情卡的下方嵌入一个"笔画顺序"小组件,展示当前汉字的笔顺动画、田字格背景、笔数显示、循环播放 / 重播控制,与字·韵 古典水墨主题一致。

**架构**: 'use client' 组件 + 静态笔画数据 (build script 预打包到 `public/strokes/{char}.json`)。HanziWriter lib (~80KB) 通过 dynamic import 懒加载,不入主 bundle。无新 API 路由,无新数据库表。

**技术栈**: Next.js 15 (App Router, RSC + 'use client'), TypeScript, Tailwind v4, HanziWriter 3.x (MIT), `hanzi-writer-data` 2.x (CDN fallback 链下载), vitest + @testing-library/react + jsdom, p-limit (并发 fetch)。

---

## 1. 背景与目标

### 现状
- `chars` 表已存 8105 字 (Plan L 已 import),含 `stroke_count` 字段
- `DictionaryDetailTabs` 在 字典 tab 内展示 8 字段 grid + 相关字
- `app/dictionary/[char]/page.tsx` 已是 RSC,接受 `params.char`
- `app/globals.css` 已有字·韵 设计 token (paper #f5e8c8, ink #1a1a1a, seal #168F4F)
- 现有 build scripts 模板: `scripts/build-radicals.ts` (cnchar-radical → `data/radicals.json`)

### 目标
1. 在 `/dictionary/[char]` 详情卡下方加 "笔画顺序" 卡片
2. 田字格 (280×280) + 浓墨 #1a1a1a 笔触,与字·韵主题一致
3. 加载后自动循环播放笔画动画
4. ⟲ 重播 + ♻ 循环开关 + 笔数显示 "N / M 画"
5. 覆盖 8105 字典字 (缺失的字 graceful hide)
6. 不引入新外部 CDN 运行时依赖 (build 阶段拉取一次)

### 不做 (Plan M v1)
- 速度控制 / 单步控制
- 米字格 variant
- 繁体字 / 罕见字 (Plan B+)
- 字帖 tab 集成 (从笔画 widget 跳转)
- SVG/PNG 笔顺图导出
- 多字串笔顺 (如 "我们" 整词)

---

## 2. 架构

### 2.1 页面层次
```
/dictionary/[char]   [RSC] 字典详情页
   └─ DictionaryDetailTabs ('use client')
      └─ 字典 tab
         ├─ DetailGrid (8 字段,现有)
         ├─ RelatedChars (现有)
         └─ StrokeOrderCard (新, 'use client', char.length === 1 才渲染)
              ├─ SVG 田字格 overlay
              ├─ HanziWriter target div (dynamic import)
              ├─ 控件: ⟲ ♻
              └─ 笔数: N / M 画
```

### 2.2 数据流
```
pnpm strokes:build
   └─ scripts/build-strokes.ts
      ├─ 读 data/general-standard-chinese-characters.json (8105)
      ├─ 并发 8x fetch hanzi-writer-data CDN (3 个 fallback)
      ├─ 写 public/strokes/{char}.json
      └─ 写 data/strokes-manifest.json (supported/missing)

浏览器访问 /dictionary/一
   └─ DictionaryDetailTabs 渲染
      └─ <StrokeOrderCard char="一" />
         ├─ useEffect: dynamic import('hanzi-writer')
         ├─ fetch /strokes/一.json
         │   ├─ 200 → parse JSON → HanziWriter.create(...)
         │   └─ 404 → setError → 隐藏卡片
         ├─ getNumStrokes() → setTotalStrokes
         └─ loopCharacterAnimation() (loop 默认 on)
```

### 2.3 不引入新表 / API
- 笔画数据静态文件,不走 API
- 不入库,无需 DDL 改动
- 仅 `data/strokes-manifest.json` 一个 build 产物供 build 自身验证

---

## 3. 组件设计

### 3.1 `StrokeOrderCard` ('use client')

```typescript
type Props = {
  char: string;          // 单字 (caller 过滤)
  className?: string;
};
```

**状态**:
```typescript
const [isLoading, setIsLoading] = useState(true);
const [isReady, setIsReady] = useState(false);
const [currentStroke, setCurrentStroke] = useState(0);  // 0 = 闲置
const [totalStrokes, setTotalStrokes] = useState(0);
const [loopEnabled, setLoopEnabled] = useState(true);   // 默认 on
const [error, setError] = useState<string | null>(null);

const writerRef = useRef<HanziWriter | null>(null);
const containerRef = useRef<HTMLDivElement | null>(null);
```

**生命周期 (单 useEffect, char 改变时 cleanup)**:
```
1. cancelled = false
2. dynamic import('hanzi-writer')                          // 首次 ~80KB
3. HEAD /strokes/{char}.json
   ├─ 200 → fetch full JSON
   └─ 404 → setError, cleanup, return
4. writer = HanziWriter.create(el, {
     width: 280, height: 280, padding: 8,
     showOutline: true,
     strokeAnimationSpeed: 1,
     delayBetweenStrokes: 400,
     strokeColor: '#1a1a1a',
     radicalColor: '#168F4F',
     outlineColor: '#ddd',
     charDataLoader: (cb) => cb(jsonData),
     onLoadCharDataError: setError,
     onCompleteStroke: ({ strokeNum }) => setCurrentStroke(strokeNum),
   })
5. writerRef.current = writer
6. setTotalStrokes(writer.getNumStrokes())
7. setIsReady(true); setIsLoading(false)
8. if (loopEnabled) writer.loopCharacterAnimation()
   else writer.animateCharacter()
9. cleanup: cancelled = true; writer.cancelAnimation();
   writerRef.current = null; containerRef.current.innerHTML = '';
```

**loopEnabled 切换 effect** (依赖变化时):
```
if (loopEnabled) writer.loopCharacterAnimation()    // 重新开始
else: writer.cancelAnimation(); setCurrentStroke(0)
```

### 3.2 JSX 结构
```tsx
<article className={cn('card', className)}>
  <header className="flex items-center justify-between">
    <h3>笔画顺序</h3>
    <span className="badge">新功能</span>
  </header>

  {isLoading && <LoadingSpinner />}
  {error && <ErrorState message="暂无该字笔画数据" />}
  {isReady && (
    <div className="flex flex-col md:flex-row gap-6 items-center">
      {/* 280×280 canvas wrap, position: relative */}
      <div className="relative w-[280px] h-[280px] border-2 border-ink">
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox="0 0 100 100" preserveAspectRatio="none"
        >
          {/* 田字格: 1 vertical + 1 horizontal line */}
          <line x1="50" y1="0" x2="50" y2="100" stroke="#666" strokeWidth="0.4" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="#666" strokeWidth="0.4" />
        </svg>
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            onClick={replay}
            disabled={!isReady}
            aria-label="重新播放笔画动画"
            className="btn"
          >⟲</button>
          <button
            onClick={toggleLoop}
            aria-pressed={loopEnabled}
            aria-label="循环播放"
            className="btn"
          >♻</button>
        </div>
        <span aria-live="polite" className="text-sm text-ink/70">
          {currentStroke || totalStrokes} / {totalStrokes} 画
        </span>
      </div>
    </div>
  )}
</article>
```

### 3.3 Replay 行为
```typescript
function replay() {
  const w = writerRef.current;
  if (!w) return;
  w.cancelAnimation();
  setCurrentStroke(0);
  if (loopEnabled) w.loopCharacterAnimation();
  else w.animateCharacter();
}
```

### 3.4 设计常量
```typescript
const SIZE = 280;                  // 田字格边长 (px)
const STROKE_ANIMATION_SPEED = 1;  // 1x 正常速度
const DELAY_BETWEEN_STROKES = 400; // ms
const STROKE_COLOR = '#1a1a1a';    // 浓墨 (与 globals.css --color-ink 一致)
const RADICAL_COLOR = '#168F4F';   // 印泥绿 (部首高亮)
const OUTLINE_COLOR = '#ddd';      // 灰色提示字
```

---

## 4. 构建脚本 + 数据流

### 4.1 `scripts/build-strokes.ts`

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import pLimit from 'p-limit';

const CHARS: string[] = JSON.parse(
  await fs.readFile('data/general-standard-chinese-characters.json', 'utf-8')
);

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/',
  'https://unpkg.com/hanzi-writer-data@latest/',
  'https://raw.githubusercontent.com/chanind/hanzi-writer-data/master/data/',
];

async function tryFetch(char: string): Promise<string | null> {
  for (const base of SOURCES) {
    try {
      const r = await fetch(`${base}${char}.json`);
      if (r.ok) return await r.text();
    } catch { /* try next */ }
  }
  return null;
}

const limit = pLimit(8);
const supported: string[] = [];
const missing: string[] = [];

await fs.mkdir('public/strokes', { recursive: true });

await Promise.all(
  CHARS.map((c) =>
    limit(async () => {
      const txt = await tryFetch(c);
      if (txt) {
        await fs.writeFile(`public/strokes/${c}.json`, txt, 'utf-8');
        supported.push(c);
      } else {
        missing.push(c);
      }
    })
  )
);

await fs.writeFile(
  'data/strokes-manifest.json',
  JSON.stringify(
    { version: '1', source: 'hanzi-writer-data', totalChars: CHARS.length, supported, missing },
    null,
    2
  )
);

console.log(`✓ ${supported.length} stroke files, ✗ ${missing.length} missing`);
process.exit(missing.length > CHARS.length * 0.05 ? 1 : 0);  // >5% missing = fail
```

### 4.2 新增依赖
```json
{
  "dependencies": {
    "hanzi-writer": "^3.7.0"
  },
  "devDependencies": {
    "p-limit": "^6.0.0"
  }
}
```
**注意**: 不安装 `hanzi-writer-data` 包本身,因为我们 build 时直接 fetch CDN (避免 npm 包不包含数据文件的不确定性)。

### 4.3 `package.json` scripts
```json
{
  "scripts": {
    "strokes:build": "tsx scripts/build-strokes.ts"
  }
}
```

### 4.4 Runtime charDataLoader
```typescript
async function loadStrokeData(char: string): Promise<unknown> {
  const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
  if (!r.ok) throw new Error('404');
  return r.json();
}

// in HanziWriter.create:
charDataLoader: (cb) => loadStrokeData(char).then(cb).catch((e) => {
  onLoadCharDataError(e.message);
}),
```

---

## 5. 集成点

### 5.1 `DictionaryDetailTabs` 修改

```tsx
// 在 字典 tab 内,RelatedChars 之后追加:
{char.length === 1 && <StrokeOrderCard char={char} />}
```

`char` prop 已经在 tabs 间通过,无需新增 prop 链。

### 5.2 集成到 README
新增段落:
```
## 笔画顺序 (Stroke Order)
字典详情页下方展示 280×280 田字格 + 浓墨笔顺动画。
- 自动循环播放 (可关闭)
- ⟲ 重播按钮
- 笔数显示 (N / M 画)
- 覆盖 8105 通用规范汉字 (缺失的字 graceful hide)
- 数据: `public/strokes/{char}.json` (build 阶段从 hanzi-writer-data 拉取)

### 数据初始化
\`\`\`bash
pnpm strokes:build
\`\`\`
```

---

## 6. 测试

### 6.1 单元测试 (`tests/unit/components/dictionary/stroke-order-card.test.tsx`)

7 个用例 (vitest + jsdom + @testing-library/react):

| # | 用例 | 断言 |
|---|------|------|
| 1 | 初始渲染 | LoadingSpinner 显示 |
| 2 | fetch 404 | ErrorState "暂无" 显示,无 canvas |
| 3 | fetch 200 | canvas + ⟲ + ♻ + 笔数 显示 |
| 4 | 点击 ⟲ | writer.animateCharacter / loopCharacterAnimation 被调用 |
| 5 | 点击 ♻ | aria-pressed 翻转,writer.cancelAnimation + loopCharacterAnimation 调用 |
| 6 | 卸载 | writer.cancelAnimation 被调用,ref 清空 |
| 7 | char prop 变 | 旧 writer cleanup, 新 writer 初始化 |

### 6.2 Mock 策略
```typescript
vi.mock('hanzi-writer', () => ({
  default: {
    create: vi.fn(() => ({
      loopCharacterAnimation: vi.fn(),
      animateCharacter: vi.fn(),
      cancelAnimation: vi.fn(),
      getNumStrokes: vi.fn(() => 1),
    })),
  },
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ strokes: [], medians: [] }),
} as any);
```

### 6.3 Build 脚本冒烟测试 (`scripts/build-strokes.test.ts`)
1 用例: mock global.fetch 返回有效 JSON,运行 build 函数,断言 `public/strokes/{testChar}.json` 存在 + 内容匹配 + manifest 写入。

### 6.4 浏览器手动冒烟 (Human, 6 步)
1. `pnpm strokes:build` (一次性,~5-10 分钟,~50-150MB 输出)
2. `pnpm dev` → `/dictionary/一`
3. 滚动到 "相关字" 下方 → 看到 "笔画顺序" 卡片
4. 加载后 → 笔画自动循环动画开始 (1 画,快速过)
5. 点击 ⟲ 重播,点击 ♻ 切换循环
6. `/dictionary/爱` (10 画) → 笔数显示 10,10 笔依次动画
7. `/dictionary/𠮷` (罕见字,无数据) → 卡片不渲染,无 console error

---

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| `/strokes/{char}.json` 404 | 隐藏整个 `<article>`,无 console error |
| `hanzi-writer` dynamic import 失败 | ErrorState "笔画组件加载失败" + 重试按钮 |
| `char.length !== 1` | caller 过滤,不渲染 widget |
| 浏览器无 SVG 支持 | ErrorState |
| build script 失败 > 5% missing | `process.exit(1)`,CI 失败 |
| `hanzi-writer-data` 全部 CDN 不可达 | build 失败 + 友好错误信息 ("请检查网络或手动下载") |

---

## 8. 文件结构

### 新建
```
scripts/build-strokes.ts                                    # 构建脚本
scripts/build-strokes.test.ts                               # 脚本冒烟
public/strokes/{char}.json                                  # 8105 个笔画数据 (build 产物)
data/strokes-manifest.json                                  # supported/missing 清单
components/dictionary/StrokeOrderCard.tsx                   # 'use client' 主组件
tests/unit/components/dictionary/stroke-order-card.test.tsx # 7 个单测
```

### 修改
```
components/dictionary/DictionaryDetailTabs.tsx              # 嵌入 StrokeOrderCard
package.json                                                # +hanzi-writer, +p-limit, +strokes:build
README.md                                                   # 笔画顺序 feature 段落
```

---

## 9. 验证清单 (Definition of Done)

- [ ] `pnpm strokes:build` 成功 (≥ 95% char 数据)
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全过 (含新增 7 个 unit tests + 1 build smoke)
- [ ] `pnpm build` 成功 (verify `hanzi-writer` 仅出现在 dynamic chunk)
- [ ] 7 步 visual smoke 全过
- [ ] README + .env.example 更新
- [ ] 1 commit on main

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| hanzi-writer-data CDN 全部不可达 (Plan F 历史) | 3 个 fallback URL,全部失败则 build 退出 1 + 提示手动下载 |
| `public/strokes/` ~50-150MB 拖慢 `git clone` | 写入 `.gitignore`,README 注明 `pnpm strokes:build` 必须运行 |
| HanziWriter lib 体积 ~80KB 影响首屏 | dynamic import + 条件渲染,仅在 `/dictionary/[char]` 加载 |
| char 数据 JSON 体积大 | ~5-20KB/char,fetch 一次 + 浏览器 HTTP cache |
| 田字格 SVG 与 HanziWriter 内部 SVG 重叠 | grid 容器 `pointer-events: none`,HanziWriter SVG 绝对定位在上层 |
| build 脚本 fetch 慢 (8105 × 3 个 fallback) | 8x 并发 p-limit,任一成功即停,预计 5-10 分钟 |
| HanziWriter API 变更 | pin 到 `^3.7.0`,package.json `lockfileVersion` 锁版本 |

---

## 11. 范围外 (未来 Plan 候选)

- 字帖 tab 集成 (从笔画 widget 跳转写帖)
- 速度控制 (慢 / 常 / 快)
- 单步控制 (上一笔 / 下一笔)
- 米字格 variant
- 繁体字 / 罕见字 (Plan B+)
- SVG/PNG 笔顺图下载
- 多字串笔顺 (整词 "我们")
- 笔顺数据服务端 API (统一从 `/api/strokes/[char]`)
- AI 教学 (生成口诀、解释笔画含义)

---

## 12. 实施任务列表 (大纲)

Plan M 预计 10-12 个任务,3 个阶段:
- **Phase A 构建脚本 (Tasks 1-3)**: 安装 hanzi-writer + p-limit → `scripts/build-strokes.ts` (TDD) → `pnpm strokes:build` 验证 + manifest 检查
- **Phase B 组件 (Tasks 4-7)**: `StrokeOrderCard` 骨架 + state/refs → lifecycle effect + dynamic import → 田字格 SVG overlay + 控件 → 笔数同步 + a11y
- **Phase C 集成 + 收尾 (Tasks 8-10)**: `DictionaryDetailTabs` 嵌入 → 7 个 unit tests + 1 build smoke → README 更新 + final review + 6 步 visual smoke
