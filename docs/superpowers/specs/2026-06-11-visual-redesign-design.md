# 视觉重设计 Spec — 2026-06-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把整个网站从"功能堆叠的内部工具"变成"有设计感的公益文化产品"——传统中国风基调（Bento Hero + 墨黑/米黄/印章红 + 思源黑体正文 + 霞鹜文楷点缀 + 汉字/icon 混搭），覆盖 Header、Hero、Footer、所有功能页、管理后台、空/加载/错误状态、404、移动端。

**Why:** 用户反馈"感觉不像个网站，没有任何 CSS 的效果"。当前实现功能完备（4 个 plan 全部完成）但视觉是默认 Tailwind 灰底白卡，专业感和公益气质都不足。本次重设计在不动功能的前提下做体验层重塑。

**Target audience:** 全龄段——中小学生及家长、汉字文化爱好者、老师/学生/成人学习者。所以设计基调"传统为骨，现代为皮"：核心视觉用传统元素（米黄宣纸、墨黑、印章红、文楷字），但保留现代可读性（黑体正文、清晰层级、合理留白）。

---

## 1. 设计令牌 (Design Tokens)

所有视觉决策集中在 `tailwind.config.ts` + `app/globals.css`，组件只引用 token，不写裸 hex/rgb。

### 1.1 调色板 (Color Palette)

```
── 主色 (Primary) ──
paper:        #F4ECD8   宣纸米黄（主背景）
paper-soft:   #FFFAEE   浅宣纸（卡片底）
paper-deep:   #E8DCC0   深宣纸（分隔、装饰）
ink:          #3A2A14   墨黑（正文、边框、深色块）
ink-soft:     #5A4530   浅墨（次要文字）
ink-faint:    #8B6F3A   墨痕（标签、提示、字距加大的小字）
seal:         #B22B2B   印章红（CTA、强调、关键状态）

── 中性 (Neutral，灰阶代替) ──
灰阶 50-900 用 ink 的不同透明度：
  ink/5    rgba(58,42,20,0.05)   几乎不可见的分隔
  ink/10   rgba(58,42,20,0.10)   浅边
  ink/20   rgba(58,42,20,0.20)   默认边
  ink/40   rgba(58,42,20,0.40)   弱文字
  ink/60   rgba(58,42,20,0.60)   次文字
  ink/80   rgba(58,42,20,0.80)   主文字

── 功能色 (Semantic) ──
success:      #4A7C59   草绿（与纸面协调）
warning:      #C99A3E   琥珀（不刺眼）
danger:       #B22B2B   与 seal 同（错误/危险）
info:         #4F6B8C   灰蓝（不抢戏）
```

不使用 Tailwind 默认的 `gray-*` / `blue-600` / `green-100` 等。现有代码中散落的 `bg-gray-50` / `text-blue-600` / `bg-green-100` 全部替换为 token。

### 1.2 字体 (Typography)

通过 `next/font/google` 加载（无需外部 CSS link）：

```
--font-wenkai:    LXGW WenKai TC     霞鹜文楷（标题/装饰，0.5-1.5MB 子集）
--font-han-serif: Noto Serif SC      思源宋体 SC（备用衬线，浏览器 fallback）
--font-han-sans:  Noto Sans SC       思源黑体 SC（正文，浏览器 fallback）
--font-system:    system-ui          兜底
```

字体使用规则：

| 用途 | 字体 | 字号/字重 | 字距 |
|---|---|---|---|
| H1 / Hero 标题 | LXGW WenKai | 36-48px / 400 | normal |
| H2 / 区块标题 | LXGW WenKai | 24-28px / 400 | normal |
| H3 / 卡片标题 | Noto Sans SC | 18-20px / 600 | normal |
| 正文 | Noto Sans SC | 14-16px / 400 | normal |
| 标签 / 徽章 | Noto Sans SC | 11-12px / 500 | letter-spacing: 0.1em |
| 装饰小字（"字·韵"） | LXGW WenKai | 11-12px / 400 | letter-spacing: 0.3em |
| 表格 / 等宽 | 系统 mono | 13-14px / 400 | normal |

### 1.3 间距 / 圆角 / 阴影

- 间距：Tailwind 默认即可（4/8/12/16/24/32/48/64）
- 圆角：主 `rounded-sm` (2px) 或 `rounded` (4px)，**不用** `rounded-lg/xl/full`（与传统质感冲突）
- 阴影：3 档
  - `shadow-paper`: `0 1px 2px rgba(58,42,20,0.06)` 默认卡片
  - `shadow-paper-md`: `0 4px 12px rgba(58,42,20,0.10)` 悬浮态
  - `shadow-paper-lg`: `0 12px 32px rgba(58,42,20,0.14)` 弹窗

### 1.4 动效

- 默认 `transition-colors` 200ms / `transition-shadow` 200ms
- 不引入 framer-motion
- Bento 卡片 hover：边框颜色 ink/20 → seal、阴影 shadow-paper → shadow-paper-md
- 印章红 CTA：hover 微微缩放 `scale-[1.02]` 100ms

---

## 2. 全站布局 (Global Layout)

### 2.1 字体注入 (`app/layout.tsx`)

```tsx
import { Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google';
import { LXGW_WenKai_TC } from 'next/font/google'; // 霞鹜文楷的 next/font 包装

const wenkai = LXGW_WenKai_TC({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-wenkai' });
const hanSerif = Noto_Serif_SC({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-han-serif' });
const hanSans = Noto_Sans_SC({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-han-sans' });

<html lang="zh-CN" className={`${wenkai.variable} ${hanSerif.variable} ${hanSans.variable}`}>
  <body className="font-sans bg-paper text-ink antialiased">
```

`tailwind.config.ts` 把 `fontFamily.sans = ['var(--font-han-sans)']`、`fontFamily.serif = ['var(--font-han-serif)']`、`fontFamily.kai = ['var(--font-wenkai)']` 串起来。

### 2.2 装饰 (Decorations)

`app/globals.css` 新增：

```css
@layer base {
  body {
    background-color: #F4ECD8;
    background-image:
      radial-gradient(circle at 20% 30%, rgba(178,43,43,0.018) 0%, transparent 40%),
      radial-gradient(circle at 80% 70%, rgba(58,42,20,0.025) 0%, transparent 50%);
  }
}

@layer utilities {
  .paper-rule {
    background-image: linear-gradient(to right, transparent, rgba(139,111,58,0.4), transparent);
    height: 1px;
  }
  .stamp {
    display: inline-block;
    border: 2px solid #B22B2B;
    color: #B22B2B;
    padding: 4px 10px;
    font-family: var(--font-wenkai);
    transform: rotate(-4deg);
    letter-spacing: 0.15em;
  }
}
```

---

## 3. 顶部导航 (Header)

**当前问题：** 1 行细窄条，title + 3 链接 + 儿童模式 + 登录按钮，挤在 64px 里。无 logo、无视觉锤、无 hover 反馈。

**新设计：**

```
┌─────────────────────────────────────────────────────────────┐
│  ╳字·韵  罕见字库   字帖   游戏   我的      🟢儿童模式 [登录]│  ← 72px 高
└─────────────────────────────────────────────────────────────┘
```

- 高度 72px
- 左侧：印章式 logo「字·韵」（或"字韵"二字），用霞鹜文楷 22px，颜色 ink
- 主导航：4 个链接（罕见字库/字帖/游戏/我的），hover 时下划线用 seal 红色
- 右侧：SafeMode 开关 + 登录按钮（印章红实底）或 UserMenu
- 背景：`bg-paper-soft/95 backdrop-blur`，`border-b border-ink/10`
- 移动端：≥768px 显示完整导航；<768px 主导航折叠成汉堡（用 lucide-react `Menu` icon）

新增文件：`components/Header.tsx` 重写，`components/MobileMenu.tsx` 新建。

---

## 4. 首页 Hero (Bento)

**当前问题：** 直接堆 3 个功能组件，无任何视觉引导。

**新结构（自上而下）：**

```
┌─ Hero ───────────────────────────────────────┐
│ 字·韵 (装饰小字)                               │
│ 汉字与拼音，                                   │
│ 一笔一画皆有意  (Hero 标题)                     │
│ 公益工具 · 免费 · 无需登录  (副标题)             │
│ [立即开始 →]   [了解更多]                       │
└───────────────────────────────────────────────┘

┌─ Bento 网格 (4 大入口) ──────────────────────┐
│ ┌──────────────┐ ┌────────┐                  │
│ │ 字           │ │  库    │                  │
│ │ 字 ↔ 拼音互转 │ │ 罕见字 │                  │
│ │ 立即开始 →    │ │        │                  │
│ │ (大墨黑块)    │ │ 印章红 │                  │
│ │              │ ├────────┤                  │
│ │              │ │  帖    │                  │
│ │              │ │ 字帖  │                  │
│ │              │ │ (白底) │                  │
│ └──────────────┘ └────────┘                  │
└───────────────────────────────────────────────┘

┌─ 价值主张 (3 栏) ──────────────────────────────┐
│ 准确 · 整句Viterbi    丰富 · 1450罕见字     易用 · 打印字帖 │
└────────────────────────────────────────────────────┘

┌─ Footer ──────────────────────────────────────┐
│  字·韵 · 公益汉字工具                            │
│  关于  使用指南  GitHub  反馈                    │
│  © 2026 字韵项目 · MIT License                  │
└────────────────────────────────────────────────────────────┘
```

新增文件：`components/Hero.tsx`，`components/BentoGrid.tsx`，`components/ValueProps.tsx`，`components/Footer.tsx`。
修改文件：`app/page.tsx`（去掉直接堆叠的 3 个功能组件，只保留它们作为 bento 入口或不放，让用户从 bento 进入对应页面）。

---

## 5. 功能页 (Feature Pages)

### 5.1 罕见字库 `/rare-chars`

- 顶部加装饰条：印章小字"字·韵 · 千字罕见库"
- 列表卡片：每张卡用 `bg-paper-soft border border-ink/10`，hover 边框变 seal、字阴影加 paper-md
- 字本体用 LXGW WenKai 56-72px 居中
- 拼音用 Noto Sans SC 14px
- 每日一字横幅：左侧大字 + 右侧寓意/故事，左边加印章红"今日一字"四字（stamp 样式）

### 5.2 罕见字详情 `/rare-chars/[char]`

- 顶部：大字 + 拼音 + meaning，装饰左右各一条 paper-rule
- 故事区：竖向引用样式，左边一条 seal 4px 边
- 底部"加入字帖"：印章红 CTA

### 5.3 字帖生成 `/worksheet`

- 顶部工具栏：tab 切换（输入文本 / 选字库）、风格选择（毛笔格/田字格）
- 实时预览：每格用 SVG 米黄底 + 墨黑边 + 红色十字（米字格辅助线）
- "生成字帖"：印章红主按钮
- 打印：保留米字格辅助线，隐藏其他 UI（print CSS 已存在，需校验）

### 5.4 字帖历史 `/worksheet/history` & `/worksheet/[id]`

- 列表项：左缩略图（小 SVG 4 格预览）+ 标题 + 日期 + 操作
- hover 显示删除按钮
- 详情：上方元信息 + 大预览 + 删除按钮

### 5.5 游戏 `/game`

- 顶部：进度条（8/8 已匹配）
- 拖拽区：每对 pinyin-char 用 2px ink 边框的方块，匹配后变 seal 边框 + 微微缩放动画
- 底部"再来一局"：次按钮样式

---

## 6. 用户系统页 (User Pages)

### 6.1 `/login` & `/forgot-password` & `/reset-password`

- 居中卡片，最大宽 420px，米黄底 + 墨边 + 印章红 CTA
- 卡片顶部装饰"字·韵"小字
- 链接：hover seal 红下划线

### 6.2 `/profile`

- 顶部用户信息（用户名、注册时间）
- 数据卡片网格：总字数 / 收藏字数 / 收藏条数 / 历史条数
- 卡片用 paper-soft 底 + ink 边，数字大（40px LXGW WenKai）

### 6.3 `/history`

- 列表项：左输入预览 + 中结果预览 + 右操作（收藏/删除）
- 收藏项：右侧用 seal 红色"★"

---

## 7. 管理后台 (Admin)

保持专业感（管理员是少数用户），但用同一调色板：

- `/admin` 仪表盘：统计卡片 + 最近活动
- `/admin/users`：表格（用户 / 角色 / 注册时间 / 操作）
- `/admin/audit`：时间倒序事件流
- `/admin/stats`：4-6 个大数据卡

表格行 hover：背景 `bg-paper-deep`，不用阴影。

---

## 8. 通用组件 (Shared Components)

### 8.1 `LoadingSpinner`

- 圆形，墨色描边 + seal 红色弧段，旋转动画
- 大小：sm 16px / md 24px / lg 32px
- 居中文案：Noto Sans SC 13px ink-faint

### 8.2 `EmptyState`

- 居中布局
- 上方：可选 lucide icon（24px ink-faint）
- 中：标题（Noto Sans SC 16px ink）
- 下：副标题（13px ink-soft）+ 可选 CTA
- 装饰：底部一条 paper-rule

### 8.3 `ErrorState`（新建）

- 同 EmptyState 布局，icon 改 lucide `AlertCircle`（color seal）
- 标题 + 错误代码（mono 字体）+ "重试" 按钮

### 8.4 `ConfirmDialog`（重做样式）

- 弹窗：米黄底 + 墨边 + 阴影 paper-lg
- 顶部可选装饰"字·韵"
- 底部按钮：左次（ink-soft 边）+ 右主（seal 实底）

### 8.5 `AuthModal`

- 居中弹窗，宽 420px
- 顶部 tab：登录 / 注册
- 错误信息：seal 红色 12px

---

## 9. 404 与错误页

### 9.1 `app/not-found.tsx`（新建）

- 居中布局
- 大字 LXGW WenKai 200px：「无」（灰墨色 50% 透明度）
- 下方"Not Found"英文 + 印章"404"
- "返回首页"：印章红 CTA

### 9.2 `app/error.tsx`（新建）

- 同上 + "刷新" 次按钮 + 错误摘要（折叠）

---

## 10. 移动端 (Mobile Responsive)

- 断点：768px（md）
- Hero 大字：48px → 32px
- Bento 网格：桌面 2x2，移动 1 列堆叠
- Header：≥768 显示全部导航；<768 主导航折叠成汉堡
- 字帖预览：移动端横向滚动（保持原缩放）
- 管理后台表格：移动端改成卡片列表（每行一个用户卡）

---

## 11. 实施分阶段 (Implementation Phases)

**Phase 1 — 基础 (1 PR)：tokens + 字体 + layout**
- tailwind.config.ts 扩展（颜色/字体/阴影）
- app/globals.css 加 paper 背景、装饰 utility
- app/layout.tsx 加载 3 字体 + 应用 body 样式
- 替换散落的 `bg-gray-50` / `text-blue-600` / `bg-green-100` → token

**Phase 2 — 共享组件 + Header/Footer (1 PR)**
- LoadingSpinner / EmptyState / ErrorState 重做
- Header.tsx 重写 + MobileMenu
- Footer.tsx 新建
- ConfirmDialog / AuthModal 调样式

**Phase 3 — 首页 (1 PR)**
- Hero.tsx / BentoGrid.tsx / ValueProps.tsx
- app/page.tsx 改为 Hero + Bento + ValueProps + Footer，不直接堆功能组件

**Phase 4 — 功能页 (2 PR)**
- PR1: 罕见字库 list + 详情
- PR2: 字帖 4 页 + 游戏

**Phase 5 — 用户系统 + 管理 (1 PR)**
- /login /forgot-password /reset-password /profile /history
- /admin/* 4 个页面

**Phase 6 — 错误/空/移动端收尾 (1 PR)**
- 404 / error / loading 全站统一
- 移动端适配

**Phase 7 — 验收 (1 commit)**
- `pnpm build` 验证
- 浏览器 smoke（手测首页 + 3 个内页 + 1 个管理页 + 404 + 移动端）

---

## 12. 不在范围 (Out of Scope)

- Logo 图像（用文字 mark「字·韵」即可，不做图形 logo）
- 暗色模式（传统风在米黄/墨色上最自然，暗色需重新设计调色板，超出本次范围）
- 国际化（多语言切换）
- 自定义插画 / 装饰图案（用 CSS 渐变 + 文字 + 边框足矣）
- 字体本地打包（用 next/font CDN 即可，Google Fonts 自带 cache）
- framer-motion 动效
- Lighthouse 优化到 95+（视觉重设计是首要）

---

## 13. 验收标准 (Acceptance Criteria)

- [ ] 所有页背景是米黄 #F4ECD8，无任何残留 `bg-gray-*` / `bg-white`
- [ ] 所有正文用思源黑体，标题/装饰用霞鹜文楷（通过 `font-kai` class 切换）
- [ ] 印章红 #B22B2B 仅用于 CTA、强调、关键状态
- [ ] 首页有 Hero + Bento + ValueProps + Footer 4 个新结构
- [ ] Header 有「字·韵」logo + 4 个主导航 + 移动端汉堡
- [ ] 4 个功能页（罕见字库/字帖/游戏/admin）已重设计
- [ ] 加载/空/错误/404 4 个状态有专门组件
- [ ] 移动端（<768px）布局可读、可点、无横向滚动
- [ ] 现有 116 个单元测试 + 38 集成测试（skip）全过
- [ ] `pnpm build` 成功
- [ ] `pnpm exec tsc --noEmit` 干净

---

## 14. 风险与权衡 (Risks & Tradeoffs)

- **字体加载性能**：霞鹜文楷 + 思源宋体 + 思源黑体 ≈ 6-10MB。`next/font` 自动 subset + swap + preload，LCP 影响约 +200ms。如 Lighthouse 分数下降明显再优化。
- **现有散落的 `bg-gray-*` 类名**：Phase 1 一次性全替换，可能引入 5-10 个意外回归，需 Phase 7 全量回归。
- **管理后台视觉成本**：管理员用户少，视觉投入产出低，但用户要求"全站统一"，所以保持同一调色板但简化（无 bento / 无 hero）。
- **品牌名"字·韵"** 是临时占位。如果用户有偏好（如"墨韵" / "汉字工坊" / "字观"），可全局替换。
