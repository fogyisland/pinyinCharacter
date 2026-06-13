# 第二款小游戏 — 拼音声调 + 部首匹配 (combo) Design

**Date:** 2026-06-13
**Status:** Draft (awaiting user review)
**Plan name:** Plan I
**Estimated tasks:** 10–12

## Context

`/game` 目前只有一个游戏：拖动拼音到对应汉字 (DragMatchGame, Plan D Task 22)。它考验的是字↔拼音映射，但有两个教学盲区：

1. **声调** — 拼音中真正影响发音/语义的不仅是音节，还有声调 (1-5)。DragMatchGame 用了 diacritics 形态 (hǎo)，但玩家没被要求区分 `mā/má/mǎ/mà`。
2. **部首** — 汉字的结构线索 (部首) 是另一条独立的查字路径。DragMatchGame 完全没涉及。

Plan I 加第二款小游戏：组合挑战「声调」+「部首」。预期一个 6-8 岁孩子玩 2-3 分钟，巩固对声调符号的辨认和「看字猜部首」的能力。

## Goal

在 `/game` 页加第二个 tab「声调·部首」，提供组合小游戏，让玩家：
- Round 1 把声调 (1/2/3/4/5) 拖到对应的汉字
- Round 2 把部首拖到对应的汉字

完成两轮后展示总用时和正确率。

## Data

**声调** — 解析 diacritics。`rare_chars.pinyin` 字段本身就是带声调的 ("hǎo" ā á ǎ à → 1 2 3 4，无 mark → 5)。在客户端用一个小函数解析，零额外数据。

**部首** — 缺失。需要外部数据。两个选项：

| 选项 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **A. Bundled JSON** | `data/radicals.json` (~10k CJK chars × 1-2 byte radical) | 零依赖，纯静态 | 增加 ~30-50KB 到 client bundle (在 `lazy load` 范围内) |
| **B. DB column** | 加 `radical` 列到 `rare_chars` + 一次迁移脚本 | 简单查询 | 只覆盖 rare_chars；其他 char 没数据 |

**采用 A**。理由：游戏可选加载 (`dynamic import`)，30KB 不影响首屏；保持 DB schema 稳定；未来其他特性 (PinyinInputMethod 提示部首) 可复用同一份 JSON。

具体数据源：用 cihai/cjk-radical-info (Unihan-derived) 预生成 `data/radicals.json`，一次性 commit。脚本 `scripts/build-radicals.ts` 从 npm `cjk-radicals` 包导出 JSON。

**退化**：如果 char 不在 JSON 里 (`getRadical` 返回 `null`)，game API 在生成轮次时自动过滤掉，保证 round 不会出现无解情况。

## Game API

`GET /api/game/round?count=4&seed=<int>?`

返回 4 个稀有汉字 + 4 个声调 (1-5 范围去重) + 4 个部首。

**Round 生成算法** (server-side, deterministic via seed)：
1. 从 `rare_chars` WHERE `meaning <> ''` AND `pinyin <> ''` 随机抽 8 个
2. 对每个 char 调 `getRadical` — 丢回无 radical 的
3. 4 chars 进入 round；剩下 4 个作为「错配干扰项」候选
4. 声调：从 4 chars 中提取去重的 tone 列表；不足 4 个时随机补 (但要避免重复 5/5/5/5)
5. 部首：从 4 chars + 干扰项中提取去重的 radical 列表
6. **不返回正确答案** — 客户端在 `RoundPayload` 里只拿到 chars + 选项；正确性检查在服务端做 (避免泄漏)

实际简单一点：API 同时返回 `charToAnswer: { char: { tone: 1, radical: '氵' } }`，客户端用来对答案 (单次请求，无回合进度可泄漏)。这就是 Plan D DragMatchGame 的设计。

## UI/UX

`/game` 页加顶部 tab 切换 (使用现有 lucide-react icon)：
- 「声调·部首」— 新 ToneRadicalGame (default)
- 「拼音·字」— 现有 DragMatchGame

**ToneRadicalGame 单局流程**：
1. **加载** — 调 API 拿 4 chars
2. **Round 1: 声调** (countdown 3-2-1)
   - 顶部：4 chars 排成一行 (大字，每字下方有 pinyin 无声调数字)
   - 下方：拖动 4 个声调数字 (1-4 圆角按钮) 到对应 char 的 tone slot
   - 全配对 → 1s 后进 Round 2
3. **Round 2: 部首**
   - 同样 4 chars
   - 下方：4 个部首字符 (氵/扌/艹 等) 拖到 char 旁的 radical slot
   - 全配对 → 1s 后进 finished
4. **结束页** — 总用时 + 两轮错误数 + 正确率 + 「再来一局」

视觉风格：与 DragMatchGame 保持一致 (paper-deep background, 楷书大字体汉字, 卡纸色卡槽)。Round 之间用 `motion-safe` fade-in (`@keyframes` in globals.css)。

## File Structure

新建：
- `data/radicals.json` — char → radical 静态映射 (build script 生成，commit 进 git)
- `scripts/build-radicals.ts` — 从 npm `cjk-radicals` 生成 JSON
- `lib/radical.ts` — `getRadical(char): string | null`，懒加载 JSON
- `lib/pinyin-tone.ts` — `toneFromPinyin(py: string): 1|2|3|4|5` 纯函数
- `app/api/game/round/route.ts` — GET 路由
- `components/game/ToneRadicalGame.tsx` — 主组件 (state machine)
- `components/game/GameModeTabs.tsx` — tab 切换 (复用 existing tab 样式)
- `components/game/ToneToken.tsx` — 可拖动声调按钮
- `components/game/RadicalToken.tsx` — 可拖动部首字符
- `components/game/ToneRadicalChar.tsx` — 接受 tone + radical drop zones
- `tests/unit/lib/pinyin-tone.test.ts` — tone 解析测试
- `tests/unit/lib/radical.test.ts` — getRadical 测试 (mock JSON)
- `tests/unit/server/api-game-round.test.ts` — round 路由测试

修改：
- `app/game/page.tsx` — 改成 tab 容器
- `lib/validators.ts` — 加 `gameRoundQuerySchema` (count: 1-8, seed: optional int)
- `package.json` — 加 `radicals:build` script
- `lib/design.ts` — 不动 (复用现有 style token)

## Implementation Notes

**Lazy load JSON** — `lib/radical.ts` 用 `import radicals from '@/data/radicals.json'` (Next.js 会自动 tree-shake) 或 `fs.readFile` (server-only)。游戏只在 client 端需要，client 用 `fetch('/api/radicals')` 拉 (server route 返回 JSON)。**采用 fetch**：避免把 30KB bundle 进 client，game tab 不打开就不下载。

**`/api/radicals` route** — GET 返回整个 JSON 一次。带 ETag + `Cache-Control: public, max-age=86400` (24h 客户端缓存)。

**tone 解析 regex** — `/([āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ])/` 找第一个带 diacritic 的元音。silent (无声调) → 5。ü 也覆盖。

**打字兼容性** — JSON 文件用 LF 换行 (与 .gitattributes 一致)；build script 输出 UTF-8。

**可访问性** — drop zones 是 `<button>` 元素 + keyboard 操作 (tab 选 zone，方向键选 token)。DragMatchGame 当前是 mouse-only，Plan I 同样不实现 keyboard drag (一致即可)，但确保按钮可被屏幕阅读器识别 (aria-label)。

## Out of Scope

- 多难度 (3x3 / 4x4 / 5x5 grid) — v1 固定 4 chars
- 计时排行榜 — 没有用户系统
- 自定义部首范围 — 全 214 部首可选，算法保证
- 复习错题 — v1 简单随机抽
- 移动端 touch drag — 用 HTML5 drag-and-drop，移动端兼容性次要 (DragMatchGame 也未做)

## Verification

完成时：
- `pnpm test` — 新增 3 个测试文件全过；现有 116+ 测试无回归
- `pnpm tsc --noEmit` — 无错
- `pnpm build` — 通过
- 浏览器手测：
  1. /game 默认 tab 是 声调·部首，可玩
  2. 切到「声调·部首」tab，加载 4 chars
  3. Round 1 拖错声调 → 错误数 +1
  4. Round 1 全对 → 1s 后进 Round 2
  5. Round 2 拖对部首 → 进入结束页
  6. 结束页数据正确 (用时/错误数/正确率)
  7. 「再来一局」刷出新 4 chars
  8. 移动端 viewport (375px) — tab 可点，char 不溢出

## Estimated Tasks

| # | Task | 估时 |
|---|---|---|
| 1 | `scripts/build-radicals.ts` + 生成 `data/radicals.json` commit | 0.5h |
| 2 | `lib/pinyin-tone.ts` + tests | 0.3h |
| 3 | `lib/radical.ts` + tests (mock JSON) | 0.3h |
| 4 | `/api/radicals` route (cache headers) | 0.3h |
| 5 | validators — `gameRoundQuerySchema` | 0.2h |
| 6 | `/api/game/round` route + tests | 0.5h |
| 7 | `ToneToken` + `RadicalToken` + `ToneRadicalChar` 组件 | 0.5h |
| 8 | `ToneRadicalGame` 主组件 (state machine) | 0.8h |
| 9 | `GameModeTabs` + `app/game/page.tsx` 改造 | 0.3h |
| 10 | `radicals:build` script + README 更新 | 0.2h |
| 11 | 手动浏览器冒烟 | human |

**Total:** ~4h impl + smoke

## Open Questions (for user)

1. **数据源** — ✅ npm `cjk-radicals` 包，bundled JSON
2. **Round 数量** — ✅ 4 chars
3. **Tab 默认顺序** — ✅ 声调·部首 作为默认 tab
