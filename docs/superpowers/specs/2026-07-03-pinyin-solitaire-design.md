# 拼音接龙 Mini-Game — Design Spec

**Date:** 2026-07-03
**Status:** Draft, awaiting self-review
**Origin:** User feedback "增加一些汉字小游戏" + style preference "偏 calligraphy/aesthetic, 项目调性" + "类似于汉字接拼音的游戏"

## Context

Project 字·韵 已有 2 款 mini-game (声调·部首, 拼音·字) 在 `/game` 页面,玩法都是 drag-match 静态配对。用户反馈"太单调",希望增加更多汉字游戏。

参考内容列出 6 款 (找茬/解谜/字理/水墨/成语/街机),用户风格倾向"偏书法/文字美学/传统文化",并明确点出"汉字接拼音"类型。

本 spec 设计**拼音接龙**: 玩家看前一字的拼音末字母,选一个以该字母开头的字接上,死字即输。

复用现有 chars 表 (8105 字 + pinyin/meaning/radical/usage_rank) 和 game 页面基础设施,不改后端 schema。

## Goal

1. `/game` 页面新增第 3 个 tab 「拼音接龙」
2. 玩家从系统给的常用字起头,逐字接龙,挑战最长记录
3. 整体认读音节通配 + 「换一条」按钮消除死字挫败感
4. 调性: 纸卷横展,纸/墨/书卷风,跟项目视觉一致

## Non-Goals (YAGNI)

- 排行榜 / server-side 计分 (本期仅本地最高分, localStorage)
- 计时模式 / 关卡模式 / 难度切换 (本期固定生存模式)
- 4 字成语接龙 (单独游戏, 字面接龙, 不混)
- 成就 / 分享图片 / 双人 PK
- 拼音手写输入 (选字用 modal, 不考拼写)
- 自定义 starter / HSK 词库分级
- 任何 server-side 游戏状态

## Locked Design Decisions (from brainstorming)

| # | 决策 | 详情 |
|---|------|------|
| 1 | 规则 | 末字母 = 首字母 (前字拼音末字母 = 后字拼音首字母) |
| 2 | 模式 | 生存接龙 (无时限, 死字即停) |
| 3 | 选字 | 字库 modal (列所有可接字, 带拼音+部首+声调+释义) |
| 4 | 展示 | 纸卷横展 (左→右, 旧字微淡) |
| 5 | 起始 | 系统给随机常用字 (从 usage_rank top 100 抽) |
| 6 | 结束 | 死字即停, 展示长度 + [再来一局] / [分享] |
| 7 | 集成 | /game 第 3 tab (复用 layout + GameModeTabs) |
| 8 | 死字边界 | 整体认读音节通配 (yi/wu/yu 算 i/u/v 开头) + 「换一条」按钮 (回退 1 步重选) |
| 9 | 词库 | 全 chars 表 (有带声调拼音) + starter 池 = top 100 |
| 10 | 死字 starter 预过滤 | 抽 starter 时 validNext ≥ 3, 否则重抽, 最多 5 次后从全词库降级 |
| 11 | 架构 | 纯客户端 (启动时一次拉全 chars, 缓存 1h) |

## Architecture

### 核心思路

启动时一次拉全 chars (有带声调拼音的 ~6000+ 字, ~500KB JSON), client 端维护 chain 状态。死字判定/换一条/整体认读音节通配 全部 client 计算, 无 server round-trip。

### 关键模块 (4 个新 lib, 4 个新 component, 1 个新 endpoint)

```
lib/pinyin-syllable.ts                    # 拼音拆解 (声母/韵母/末字母 + 通配)
lib/chain-rules.ts                        # 纯规则 (匹配/可接字/starter 选择)
lib/chain-types.ts                        # CharInfo interface
lib/api-chain.ts                          # 客户端 fetch + 1h 内存缓存
app/api/chain/chars/route.ts              # server endpoint, 返回 chars
components/game/ChainGame.tsx             # 主游戏, 状态机
components/game/ChainScroll.tsx           # 纸卷横展
components/game/ChainPickerModal.tsx      # 选字 modal
components/game/ChainSummary.tsx          # 结束屏
components/game/GameModeTabs.tsx          # 改: 加 'pinyin-chain' tab
```

### 复用现有

- `lib/pinyin-tone.ts:ALL_TONES` (声调常量)
- `lib/rare-chars.ts:listChars` (server 端 chars 查询, 给 API endpoint 用)
- `lib/radical.ts:getRadical` (部首查询, ChainPickerModal 渲染用)
- `components/common/DifficultyPicker.tsx` (本期不用, 留接口给后续难度扩展)

## File-by-File Specification

### `lib/pinyin-syllable.ts` (新, ~40 行)

```ts
/**
 * Pinyin syllable parsing for the chain game.
 * 处理两套声调格式: 'dēng' (字母带调) 和 'deng1' (数字标调)
 * 整体认读音节通配在 expandLastLetter 处理 (i/u/ü 接 y/w 等)
 */

/** 取拼音末字母 (剥离声调) */
export function getLastLetter(pinyin: string): string {
  // 1. 数字声调 'deng1' → 'deng'
  const stripped = pinyin.replace(/[1-5]$/, '');
  // 2. 字母声调 'dēng' → 'deng' (NFD 拆声调符 + diaeresis)
  const ascii = stripped.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!ascii) return '';
  // 3. 末字母就是 spelling 末字母 (yu→u, lǜ→u, 雨→u 等, 由 expandLastLetter 处理 /ü/ 通配)
  return ascii[ascii.length - 1] ?? '';
}

/** 末字母 → 合法 first letters (通配 i/u/ü) */
export function expandLastLetter(letter: string): string[] {
  if (letter === 'i') return ['i', 'y'];
  if (letter === 'u') return ['u', 'w', 'y', 'j', 'q', 'x', 'l', 'n'];
  if (letter === 'v' || letter === 'ü') return ['v', 'ü', 'y', 'j', 'q', 'x', 'l', 'n'];
  return [letter];
}
```

### `lib/chain-rules.ts` (新, ~50 行)

```ts
import type { CharInfo } from './chain-types';
import { getLastLetter, expandLastLetter } from './pinyin-syllable';

/** 检查 prev → next 是否符合末字母 = 首字母 规则 (含整体认读音节通配) */
export function matchesChainRule(
  prevPinyin: string,
  nextPinyin: string,
): boolean {
  const last = getLastLetter(prevPinyin);
  if (!last) return false;
  const expanded = expandLastLetter(last);
  const nextFirst = nextPinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()[0] ?? '';
  return expanded.includes(nextFirst);
}

/** 给定 chain 末字, 列出所有可接的字 (排除已用) */
export function getValidNextChars(
  chars: readonly CharInfo[],
  prevChar: string,
  excludeChars: ReadonlySet<string>,
): CharInfo[] {
  const prevInfo = chars.find((c) => c.char === prevChar);
  if (!prevInfo) return [];
  const last = getLastLetter(prevInfo.pinyin);
  if (!last) return [];
  const expanded = expandLastLetter(last);
  return chars.filter((c) => {
    if (excludeChars.has(c.char)) return false;
    const ascii = c.pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!ascii) return false;
    return expanded.includes(ascii[0] ?? '');
  });
}

/** 从 top 池中抽 starter, 要求 validNext ≥ minValid (默认 3) */
export function pickStarter(
  allChars: readonly CharInfo[],
  topPool: readonly CharInfo[],
  minValid = 3,
  maxTries = 5,
): CharInfo | null {
  for (let i = 0; i < maxTries; i++) {
    const candidate = topPool[Math.floor(Math.random() * topPool.length)];
    if (!candidate) continue;
    const valid = getValidNextChars(allChars, candidate.char, new Set());
    if (valid.length >= minValid) return candidate;
  }
  // 降级: 从全词库抽
  return allChars[Math.floor(Math.random() * allChars.length)] ?? null;
}
```

### `lib/chain-types.ts` (新, ~20 行)

```ts
/** 接龙游戏使用的字符信息 */
export interface CharInfo {
  char: string;
  pinyin: string;        // 带声调字母: 'dēng'
  meaning: string;       // 中文释义
  radical: string;       // 部首
  tone: 1 | 2 | 3 | 4;   // 声调
  usage_rank: number;    // 常用度排名
}
```

### `lib/api-chain.ts` (新, ~30 行)

```ts
import type { CharInfo } from './chain-types';

interface CacheEntry { data: CharInfo[]; ts: number }
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

/** SWR-lite: 1h 内重复调用直接返回缓存 */
export async function fetchChainChars(): Promise<CharInfo[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return cache.data;
  }
  const res = await fetch('/api/chain/chars');
  if (!res.ok) throw new Error(`fetch /api/chain/chars failed: ${res.status}`);
  const data = (await res.json()) as CharInfo[];
  cache = { data, ts: Date.now() };
  return data;
}
```

### `app/api/chain/chars/route.ts` (新, ~25 行)

```ts
import { NextResponse } from 'next/server';
import { listChars } from '@/lib/rare-chars';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // 拉所有有带声调拼音的 chars, 按 usage_rank 升序
  const page = await listChars({ page: 1, pageSize: 8000 });
  const chars = page.chars
    .filter((c) => /[āēīōūǔǎěǐǒùǜàèìòù]/.test(c.pinyin))
    .map((c) => ({
      char: c.char,
      pinyin: c.pinyin,
      meaning: c.meaning_zh ?? '',
      radical: c.radical ?? '',
      tone: c.tone ?? 1,
      usage_rank: c.usage_rank ?? 9999,
    }));
  return NextResponse.json(chars, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
```

### `components/game/ChainGame.tsx` (新, ~120 行)

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { fetchChainChars } from '@/lib/api-chain';
import { getValidNextChars, pickStarter } from '@/lib/chain-rules';
import type { CharInfo } from '@/lib/chain-types';
import { ChainScroll } from './ChainScroll';
import { ChainPickerModal } from './ChainPickerModal';
import { ChainSummary } from './ChainSummary';

type Phase = 'loading' | 'playing' | 'finished' | 'error';

export function ChainGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [charsList, setCharsList] = useState<CharInfo[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [starter, setStarter] = useState<string>('');

  useEffect(() => { void startGame(); }, []);

  async function startGame() {
    setPhase('loading');
    try {
      const chars = await fetchChainChars();
      const top = [...chars].sort((a, b) => a.usage_rank - b.usage_rank).slice(0, 100);
      const s = pickStarter(chars, top);
      if (!s) throw new Error('no valid starter');
      setCharsList(chars);
      setStarter(s.char);
      setChain([s.char]);
      setPhase('playing');
    } catch (e) {
      console.error('startGame failed', e);
      setPhase('error');
    }
  }

  const usedChars = useMemo(() => new Set(chain), [chain]);
  const validNext = useMemo(
    () => (chain.length === 0 ? [] : getValidNextChars(charsList, chain.at(-1)!, usedChars)),
    [charsList, chain, usedChars],
  );

  useEffect(() => {
    if (phase === 'playing' && validNext.length === 0) {
      setPhase('finished');
    }
  }, [phase, validNext.length]);

  if (phase === 'loading') return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  if (phase === 'error') return (
    <div className="py-12 text-center">
      <p className="text-seal">字库加载失败</p>
      <button onClick={() => void startGame()} className="mt-4 rounded-md bg-seal px-4 py-2 text-white">
        重试
      </button>
    </div>
  );
  if (phase === 'finished') return <ChainSummary chain={chain} onRestart={() => { setChain([starter]); setPhase('playing'); }} />;

  const currentLast = charsList.find((c) => c.char === chain.at(-1))!;
  return (
    <div className="space-y-6">
      <ChainScroll chain={chain} charsList={charsList} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-soft">接龙长度: {chain.length}</div>
        <button
          type="button"
          disabled={chain.length < 2}
          onClick={() => setChain((prev) => prev.slice(0, -1))}
          className="text-sm text-ink-faint hover:underline disabled:opacity-30"
        >
          换一条
        </button>
      </div>
      <div className="text-center text-xs text-ink-faint">
        上一个字: {currentLast.char} {currentLast.pinyin}
      </div>
      <ChainPickerModal
        validChars={validNext}
        onSelect={(c) => setChain((prev) => [...prev, c])}
      />
    </div>
  );
}
```

### `components/game/ChainScroll.tsx` (新, ~40 行)

纸卷横展, 每个 char 是方块带 pinyin, 旧字微淡:

```tsx
'use client';
import type { CharInfo } from '@/lib/chain-types';

export function ChainScroll({ chain, charsList }: { chain: string[]; charsList: CharInfo[] }) {
  const lookup = new Map(charsList.map((c) => [c.char, c]));
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-paper-deep/50 p-4">
      <div className="flex items-center gap-3 whitespace-nowrap">
        {chain.map((c, i) => {
          const info = lookup.get(c);
          const isLast = i === chain.length - 1;
          const opacity = isLast ? 1 : Math.max(0.5, 1 - (chain.length - 1 - i) * 0.05);
          return (
            <div key={`${i}-${c}`} className="flex flex-col items-center" style={{ opacity }}>
              <div className="text-3xl font-kai">{c}</div>
              {info && <div className="text-xs text-ink-soft">{info.pinyin}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### `components/game/ChainPickerModal.tsx` (新, ~50 行)

```tsx
'use client';
import type { CharInfo } from '@/lib/chain-types';

export function ChainPickerModal({
  validChars,
  onSelect,
}: {
  validChars: CharInfo[];
  onSelect: (char: string) => void;
}) {
  if (validChars.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-4">
      <div className="mb-3 text-sm text-ink-soft">可选字 ({validChars.length})</div>
      <div className="grid max-h-96 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {validChars.map((c) => (
          <button
            key={c.char}
            type="button"
            onClick={() => onSelect(c.char)}
            className="flex flex-col items-center rounded border border-ink/10 bg-paper-deep p-2 hover:bg-seal/10"
          >
            <div className="text-2xl font-kai">{c.char}</div>
            <div className="text-xs text-ink-soft">{c.pinyin}</div>
            <div className="text-[10px] text-ink-faint">{c.radical}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### `components/game/ChainSummary.tsx` (新, ~40 行)

```tsx
'use client';
export function ChainSummary({ chain, onRestart }: { chain: string[]; onRestart: () => void }) {
  const text = chain.join(' → ');
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (e) {
      console.error('share failed', e);
    }
  };
  return (
    <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
      <h2 className="text-2xl font-bold">接龙结束</h2>
      <p className="mt-2 text-ink-soft">接龙长度: <span className="text-3xl text-seal">{chain.length}</span> 字</p>
      <div className="mt-4 max-h-32 overflow-y-auto rounded bg-paper-deep p-2 text-sm font-kai">
        {text}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={onRestart} className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80">
          再来一局
        </button>
        <button type="button" onClick={handleShare} className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep">
          分享
        </button>
      </div>
    </div>
  );
}
```

### `components/game/GameModeTabs.tsx` (改, ~10 行新增)

```tsx
// Tab union 加 'pinyin-chain'
type TabKey = 'tone-radical' | 'pinyin-char' | 'pinyin-chain';

// tabs 数组加第 3 项
const TABS: { key: TabKey; label: string }[] = [
  { key: 'tone-radical', label: '声调·部首' },
  { key: 'pinyin-char', label: '拼音·字' },
  { key: 'pinyin-chain', label: '拼音接龙' },
];

// 渲染处: tab === 'pinyin-chain' → <ChainGame />
```

## Data Flow

### 启动 (mount)
1. `ChainGame` `useEffect` → `fetchChainChars()` (1h 缓存命中跳过)
2. `loading` 阶段显示居中 spinner
3. 拉完按 `usage_rank` 排序取 top 100 → `pickStarter(chars, top)` 抽 starter (要求 validNext ≥ 3, 5 次重抽, 降级到全词库)
4. `setChain([starter])` → `phase = 'playing'`

### 走法 (每步)
1. `useMemo` 派生 `validNextChars`:
   - `chain.at(-1)` → `pinyin` → `getLastLetter()` → 末字母 L
   - `expandLastLetter(L)`: L ∈ {i,u,v} 时展开为 {i/u/v, y/w}
   - 过滤 chars: `pinyin[0] ∈ expanded` ∩ `char ∉ chain` (不重用)
2. `useEffect` 监听 `validNext.length === 0` → `phase = 'finished'`
3. modal 默认开 (validNext.length > 0)

### 选字
- modal click → `setChain(prev => [...prev, picked])` → 关 modal → useMemo 重算 → validNext.length === 0 触发 finished

### 换一条
- 右上角按钮, `chain.length >= 2` 时启用
- `setChain(prev => prev.slice(0, -1))` → 重开 modal

### 结束屏
- 显示长度 + 全链横展 (去掉渐隐)
- [再来一局] → `setChain([starter])` + `phase = 'playing'`, 复用 charsList
- [分享] → `navigator.clipboard.writeText(chain.join(' → '))`

## State Machine

```
        ┌──────────┐
        │ loading  │
        └────┬─────┘
             │ fetch ok + pickStarter ok
             ▼
        ┌──────────┐  validNext=0   ┌──────────┐
        │ playing  │ ─────────────▶ │ finished │
        └────┬─────┘                └────┬─────┘
             │ [再来一局]                │
             └────────────────────────────┘
                            (复用 charsList + starter)

        任意 fetch 失败 → ┌──────────┐
                         │  error   │ → [重试] 按钮
                         └──────────┘
```

## Error Handling

| 场景 | 行为 |
|------|------|
| `fetchChainChars` 失败 | `phase = 'error'`, 居中 [重试] 按钮 |
| charsList 返回 0 条 | 友好提示"字库为空,请联系管理员" |
| starter 5 次预过滤失败 | 降级: 从全词库抽任意 char |
| 拼音为空 / 无声调 | server endpoint 阶段 WHERE 过滤掉 |
| 声调格式混用 (dēng vs deng1) | `getLastLetter` 两种都支持 |
| 客户端缓存 > 1h | 自动 refetch (timestamp 校验) |
| navigator.clipboard 不可用 (无 https) | share 按钮 catch + console.warn |

## Testing Strategy

新增 ~35 用例 (现有 204 → 239):

### `tests/unit/lib/pinyin-syllable.test.ts` (~10 用例)

- `getLastLetter` 标准: dēng→g, shuāng→g, yī→i, lüè→u (NFD strip diaeresis→lu), hǎo→o, ān→n, é→e
- `getLastLetter` 含 y- 音节: ye→e, yue→e, yuan→n, yun→n, yin→n, ying→g (spelling 末字母)
- `getLastLetter` 数字声调: 'deng1'→g, 'nv4'→v
- `getLastLetter` 空串 → ''
- `expandLastLetter`: 'i'→['i','y'], 'u'→['u','w','y','j','q','x','l','n'], 'v'→['v','ü','y','j','q','x','l','n']
- `expandLastLetter`: 'a'→['a'], 'b'→['b'] (单字母不变)
- `expandLastLetter`: 未知字母 → [letter] (兜底)

### `tests/unit/lib/chain-rules.test.ts` (~15 用例)

- `matchesChainRule`: 安(ān)→那(nà) ✓, 安→包(bāo) ✗
- `matchesChainRule`: 爱(ài)→一(yī) ✓ (i 通配 y), 爱→二(èr) ✗
- `matchesChainRule`: 完(wán)→呢(ne) ✓ (n 单字母)
- `getValidNextChars`: 排除已用字 (Set 验证)
- `getValidNextChars`: 死字场景 → []
- `getValidNextChars`: 整词库空 → []
- `pickStarter`: top 池返回 validNext ≥ 3
- `pickStarter`: 5 次重抽
- `pickStarter`: 降级到全词库

### `tests/unit/components/game/ChainPickerModal.test.tsx` (~5 用例)

- 渲染所有 validChars (data attr 验证 count)
- 点击字 → onSelect(char) 触发
- 空列表 → 返回 null
- 显示 pinyin + radical

### `tests/unit/components/game/ChainGame.test.tsx` (~5 用例, mock fetch)

- Mount → loading → playing (with starter)
- 选字 → chain 增长 → 新 modal 打开
- 触发死字 → finished 屏显示长度
- 「换一条」 → chain 缩短
- 「再来一局」 → chain 重置到 starter (不重 fetch)

## Files Touched Summary

新增 (12):
- `lib/pinyin-syllable.ts`
- `lib/chain-rules.ts`
- `lib/chain-types.ts`
- `lib/api-chain.ts`
- `app/api/chain/chars/route.ts`
- `components/game/ChainGame.tsx`
- `components/game/ChainScroll.tsx`
- `components/game/ChainPickerModal.tsx`
- `components/game/ChainSummary.tsx`
- `tests/unit/lib/pinyin-syllable.test.ts`
- `tests/unit/lib/chain-rules.test.ts`
- `tests/unit/components/game/ChainPickerModal.test.tsx`
- `tests/unit/components/game/ChainGame.test.tsx`

修改 (1):
- `components/game/GameModeTabs.tsx` (加 'pinyin-chain' tab)

合计: 13 新文件 + 1 改文件 = 14 文件

## Open Risks / Notes

- **ListChars server 性能**: `listChars({page:1, pageSize:8000})` 一次性拉 8000 行,需要 DB 索引覆盖。已存在的 `lib/rare-chars.ts:listChars` 应该 OK,沿用。
- **声调字母 vs 数字格式混用**: chars 表中 pinyin 格式未统一 (有 dēng 也有 deng1)。 `getLastLetter` 两种都支持, 测试覆盖。
- **末字母 i/u/v 通配**: 用 expandLastLetter 集中处理。`i` → `{i, y}` (yi/yin/ying 可接);`u` → `{u, w, y, j, q, x, l, n}` (覆盖 /u/ 的 w + /ü/ 的撮口呼声母 j/q/x/n/l/零声母 y);`ü/v` → `{v, ü, y, j, q, x, l, n}`。其他字母不扩展。
- **多音字**: chars 表中 pinyin 字段是首选读音,接龙按首选读音走。后续可扩展"多音字切换"功能, 不在本期。
- **大词库 modal 滚动**: 6000+ 字中 validNext 可能 100+ 字, modal 已有 max-h-96 overflow-y-auto。极端情况 (z/c/s 末字母) 可能 200+ 字, 滚动可接受。

## Next: write implementation plan

按 brainstorming 流程, 本 spec 经用户审阅后, 进入 writing-plans skill 生成实施计划。
