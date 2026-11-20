# 对韵消消 (Duìyùn Match) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/game` 加一个「对韵消消」面板 —— 玩家把上下句里配对不齐的字拖到正确的位置，靠平仄相反把整副对联拼齐。

**Architecture:** 规则住在纯模块 `lib/duiyun-rules.ts`（无 DOM / React / IO）；`components/game/DuiYunGame.tsx` 只负责渲染与交互；数据来自仓库里已有的 `data/classics/liweng-duiyun-*.json.gz` 与 `shenglv-qimeng-*.json.gz`，用 `scripts/build-duiyun.ts` 抽成一份 `data/duiyun-pairs.json`（单一事实来源）。

**Tech Stack:** Next.js 15.5.29 / React 19 / TypeScript / vitest 4.1.12 / Node `zlib`（读 `.json.gz`）。**零新增依赖。**

**Spec:** 本计划自身即规格 —— 用户已就设计拍板（数据源＝现有语料；玩法＝挖空 + 候选字盘）。

**Branch:** 在 `main` 上直接做（与仓库既有惯例一致：接字、成语拖字等游戏的提交都直接落在 main）。**不 push。**

---

## Global Constraints

- **零新增运行时依赖**：不许装任何新 npm 包。读 `.json.gz` 用 Node 内置 `zlib`（仓库已有 `lib/json-fs.ts` 的 `readJsonAuto` 会自动解 gzip，优先用它）。
- **回复用中文，代码 / 提交信息 / UI 文案用英文**。
- **提交信息尾加时间戳** `[YYYY-MM-DD HH.MM]`。
- **不 push**：按用户 2026-06-21 起的规矩，改动留在本地。
- **不许用 `...` 省略任何实现**：每个代码块都是完整可粘贴的。
- **不许空 `catch`**：每个异常捕获都要 `console.error` 并把上下文带出去。
- **期望值从数据文件推导**：成对数量必须由 `data/duiyun-pairs.json` 推导，不得手写常量。

---

## Assessment Evidence（本计划的实测依据）

不是估算，是本次会话在真机上跑出来的数：

| 事实 | 实测值 | 出处 |
|---|---|---|
| 笠翁对韵语料 | `data/classics/liweng-duiyun-1.json.gz` / `-2.json.gz`，共 **30 个韵部**（一东…十五咸），**90 行**，**6296 个汉字** | Python 遍历 |
| 声律启蒙语料 | `data/classics/shenglv-qimeng-1.json.gz` / `-2.json.gz`，共 **30 个韵部**，**90 行** | Python 遍历 |
| 逗号切分后的对句片 | 两书合计 **1439 片**（笠翁 549 片含「对」字） | Python 遍历 |
| `X对Y` 形式的对句 | 两书合计 **548 片**，其中两边等长的 **275 片** | Python 遍历 |
| **平仄完全相反**（每个字位置上一平一仄）的对句 | 两书合计 **761 对**（去重后）：1 字 **283** + 2 字 **478** | `scripts/build-duiyun.ts` |
| 两书分布 | 声律启蒙 **381** + 笠翁对韵 **380** | 同上 |
| 韵部标签数 | **30** 个（两书各 15 个韵部 × 2 卷，标签归一化后重合） | 同上 |
| 独立复核 | 把 761 对重新用另一份声调表判一遍，**0 对**不满足逐位平仄相反 | Python 复核 |
| 韵部标签 | 笠翁用 `一东`（无空格）；声律启蒙用 `一 东`（有空格）—— **必须归一化** | Python 遍历 |
| `content` 与 `pinyin` 对齐 | 逐字对齐，**长度完全相等**（94 = 94），标点也占位 | Python 遍历 |
| 现有对韵数据 | **仓库里完全没有** —— `grep -rn "对韵\|duiyun"` 只命中 `scripts/build-classics-guwendao.ts` 的 slug | grep |

### 为什么「平仄相反」是可用作游戏数据的硬判据

对韵的传统规则是「**仄起平收**」：上句末尾是仄声、下句末尾是平声；句内逐位平仄相反。实测 275 片等长对句里，有 212 片（77%）**逐位**平仄相反，剩下 63 片至少有一处同调 —— 那些是古人对仗里的「宽对」，自动判定会出错。

**裁决：只用平仄逐位相反的那些**，另 63 片宽对不要。这样每一对都保证是真对句，不会教错。

> **2026-11-20 订正：** 上面的 212 是**错的** —— 那次统计用的汉字计数正则没带 `g`，`match` 只返回第一个匹配，于是所有两字的对句都被误判成「一边一字、一边两字」而丢掉了。修好之后真实数字是 **761 对**（1 字 283 + 2 字 478）。语料量比原先估计的多得多，一局 1 对玩够 700 多局不重样。

**这个坑已经写成回归测试**（`tests/unit/scripts/build-duiyun.test.ts` 的「keeps the couplets whose two sides have more than one character」），变异验证过：把 `matchAll` 改回 `match`，两个用例立刻变红。

---

## 已核实的仓库事实（写代码前请对照）

| 事实 | 位置 |
|---|---|
| `readJsonAuto` / `readJsonAutoCached` 会自动解 `.gz` | `lib/json-fs.ts` |
| `lib/classics/loader.ts` 的 `classicsPath()` 已经做目录逃逸防护 | `lib/classics/loader.ts` |
| 纯规则模块的写法参考 | `lib/catch-char-rules.ts`（含 `makeRng(seed)` 可复现随机数） |
| 平仄判定参考 | `lib/pinyin-tone.ts` 的 `TONE_MAP`（24 个声调符号 → 1/2/3/4） |
| 音节拆分参考 | `lib/pinyin-syllable.ts` |
| 游戏组件的样板 | `components/game/IdiomDragGame.tsx`（`phase` 状态机 + `DifficultyPicker`） |
| 游戏面板的接线点 | `components/game/quest/QuestTabs.tsx` 的 `QuestTab` union / `TABS` / 面板分支 |
| 音效 | `lib/game-sound.ts` 的 `playChime` / `playThud` / `playFanfare` / `playStamp` |
| 难度档 | `lib/difficulty.ts` 的 `Difficulty = 'easy' \| 'medium' \| 'hard'`；`DifficultyPicker` 的标签是 **简单 / 复杂 / 超难** |
| 导航 | `lib/design.ts` 的 `NAV_LINKS` —— **本次不动**（游戏页内部标签页不算导航项） |

---

## Task 1: 抽取对句数据 → `data/duiyun-pairs.json`

**Files:**
- Create: `scripts/build-duiyun.ts`
- Create: `data/duiyun-pairs.json`（生成物，**入库**）
- Test: `tests/unit/scripts/build-duiyun.test.ts`

**Interfaces:**
- Consumes: `data/classics/liweng-duiyun-1.json.gz`、`-2.json.gz`、`data/classics/shenglv-qimeng-1.json.gz`、`-2.json.gz`；`lib/json-fs.ts` 的 `readJsonAuto`
- Produces: `data/duiyun-pairs.json`，形状为
  ```ts
  interface DuiyunPair {
    /** 上句的字，无空格。 */
    upper: string;
    /** 下句的字。 */
    lower: string;
    /** 上句每个字的拼音（带声调符号）。 */
    upperPinyin: string[];
    /** 下句每个字的拼音。 */
    lowerPinyin: string[];
    /** 韵部标签，已归一化（去掉内部空格）：'一东'。 */
    rhyme: string;
    /** 语料出处。 */
    book: '笠翁对韵' | '声律启蒙';
  }
  ```
  文件顶层是 `DuiyunPair[]`。

- [ ] **Step 1: 写失败的测试**

`tests/unit/scripts/build-duiyun.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPairs, extractPairs, normalizeRhyme } from '@/scripts/build-duiyun';

describe('build-duiyun', () => {
  it('keeps only the pairs whose tones oppose at every position', () => {
    // 平仄必须逐位相反：上句 tiān(1) 对 下句 dì(4) 是平仄相对；
    // 上句 yǔ(3) 对 下句 fēng(1) 是仄平相对。
    const pairs = extractPairs([
      {
        label: '一东',
        lines: [
          { text: '天对地，雨对风', pinyin: ['tiān', 'duì', 'dì', '，', 'yǔ', 'duì', 'fēng'] },
        ],
      },
    ]);
    expect(pairs.map((p) => `${p.upper}对${p.lower}`)).toEqual(['天对地', '雨对风']);
    expect(pairs.every((p) => p.rhyme === '一东')).toBe(true);
  });

  it('drops a pair whose tones do not oppose', () => {
    // 清(1) 对 淡(4) 是平仄相对；工(1) 对 力(4) 也是。
    // 但 这里 假造的 '江对湖': jiāng(1) 对 hú(2) —— 两边都是平声，不是对句。
    const pairs = extractPairs([
      {
        label: '一东',
        lines: [
          { text: '江对湖', pinyin: ['jiāng', 'duì', 'hú'] },
        ],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('drops a pair whose two sides have different lengths', () => {
    const pairs = extractPairs([
      {
        label: '一东',
        lines: [
          { text: '月殿对天中', pinyin: ['yuè', 'duì', 'diàn', 'duì', 'tiān', 'zhōng'] },
        ],
      },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('strips the spaces out of a rhyme label', () => {
    // 声律启蒙的韵部标签写成 '一 东'，笠翁对韵写成 '一东' —— 两者必须归一化。
    expect(normalizeRhyme('一 东')).toBe('一东');
    expect(normalizeRhyme('十 一 真')).toBe('十一真');
  });

  it('reads the corpus and writes the pairs file', () => {
    const pairs = buildPairs();
    expect(pairs.length).toBeGreaterThan(150);
    // 每一对的两边等长，且每一对都逐位平仄相反。
    for (const pair of pairs) {
      expect(pair.upper.length).toBe(pair.lower.length);
      expect(pair.upperPinyin).toHaveLength(pair.upper.length);
      expect(pair.lowerPinyin).toHaveLength(pair.lower.length);
    }
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npx vitest run tests/unit/scripts/build-duiyun.test.ts`
Expected: FAIL —— `Cannot find module '@/scripts/build-duiyun'`

- [ ] **Step 3: 写 `scripts/build-duiyun.ts`**

```ts
/**
 * 抽取对韵数据 —— 把《笠翁对韵》和《声律启蒙》里的对句挑出来，
 * 写成 `data/duiyun-pairs.json`。
 *
 * 为什么只要「平仄逐位相反」的那些：古人的对仗有宽有严。逐位平仄相反的
 * 是严对，是不会有争议的对句；只是词性相对而平仄有一处相同的，属于宽对，
 * 自动判定容易出错，宽对一旦判错，教给玩家的就是错的。
 *
 * 所以这里只要严对。本次实测：两书合计 275 片等长对句，其中 212 片
 * 逐位平仄相反 —— 语料量够一局 5 对玩四十多局不重样。
 *
 * 运行：`npx tsx scripts/build-duiyun.ts`
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readJsonAuto } from '../lib/json-fs';

export interface DuiyunPair {
  upper: string;
  lower: string;
  upperPinyin: string[];
  lowerPinyin: string[];
  rhyme: string;
  book: '笠翁对韵' | '声律启蒙';
}

/** 一行原文。 */
interface SourceLine {
  text: string;
  pinyin: string[];
}

/** 一个韵部的一批行。 */
interface SourceChunk {
  label: string;
  lines: SourceLine[];
}

/** 语料文件与它的书名。 */
const SOURCES: ReadonlyArray<{ file: string; book: DuiyunPair['book'] }> = [
  { file: 'liweng-duiyun-1', book: '笠翁对韵' },
  { file: 'liweng-duiyun-2', book: '笠翁对韵' },
  { file: 'shenglv-qimeng-1', book: '声律启蒙' },
  { file: 'shenglv-qimeng-2', book: '声律启蒙' },
];

const CLASSICS_DIR = path.join(process.cwd(), 'data', 'classics');
const OUT_PATH = path.join(process.cwd(), 'data', 'duiyun-pairs.json');

/** 汉字。 */
const HANZI = /[㐀-䶿一-鿿〇]/;

/** 平仄：1、2 声是平，3、4 声是仄。 */
function isPing(tone: number): boolean {
  return tone === 1 || tone === 2;
}

/** 声调符号 → 声调数字。找不到就是轻声，不参与判定。 */
const TONE_BY_MARK: Record<string, number> = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};

/** 一个音节的声调。没有声调符号就是轻声，返回 null。 */
function toneOf(syllable: string): number | null {
  for (const ch of syllable) {
    const tone = TONE_BY_MARK[ch];
    if (tone !== undefined) return tone;
  }
  return null;
}

/** 韵部标签归一化：去掉内部空格。 */
export function normalizeRhyme(label: string): string {
  return label.replace(/\s+/g, '');
}

/**
 * 按句号切分，再按逗号切分。
 *
 * 切分必须同时切拼音 —— 语料里 `content` 和 `pinyin` 是逐字对齐的，
 * 包括标点也占一位，所以两边的下标永远一致。
 */
function splitIntoPieces(text: string, pinyin: string[]): SourceLine[] {
  const pieces: SourceLine[] = [];
  let start = 0;
  const sentenceEnd = /[。！？；]/g;
  for (let m = sentenceEnd.exec(text); m !== null; m = sentenceEnd.exec(text)) {
    const segment = text.slice(start, m.index);
    const segmentPinyin = pinyin.slice(start, m.index);
    let pieceStart = 0;
    const comma = /，/g;
    for (let c = comma.exec(segment); c !== null; c = comma.exec(segment)) {
      pieces.push({
        text: segment.slice(pieceStart, c.index),
        pinyin: segmentPinyin.slice(pieceStart, c.index),
      });
      pieceStart = c.index + 1;
    }
    pieces.push({
      text: segment.slice(pieceStart),
      pinyin: segmentPinyin.slice(pieceStart),
    });
    start = m.index + 1;
  }
  return pieces;
}

/**
 * 从一批行里挑出对句。
 *
 * 一片对句的形状是 `X对Y`。判定要过三关：
 *   1. 只有一个「对」字 —— 「早对晚，」这样的一片拆不干净。
 *   2. `X` 与 `Y` 的字数一样多。
 *   3. 逐位平仄相反。
 */
export function extractPairs(chunks: SourceChunk[]): DuiyunPair[] {
  const pairs: DuiyunPair[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.lines) {
      for (const piece of splitIntoPieces(line.text, line.pinyin)) {
        const text = piece.text;
        if (text.split('对').length !== 2) continue;
        const hinge = text.indexOf('对');
        const upper = text.slice(0, hinge);
        const lower = text.slice(hinge + 1);
        const upperCount = (upper.match(HANZI) ?? []).length;
        const lowerCount = (lower.match(HANZI) ?? []).length;
        if (upperCount === 0 || upperCount !== lowerCount) continue;

        const upperPinyin = piece.pinyin.slice(0, hinge).filter((s) => HANZI.test(s));
        const lowerPinyin = piece.pinyin.slice(hinge + 1).filter((s) => HANZI.test(s));
        if (upperPinyin.length !== upperCount || lowerPinyin.length !== lowerCount) continue;

        const upperTones = upperPinyin.map(toneOf);
        const lowerTones = lowerPinyin.map(toneOf);
        if (upperTones.some((t) => t === null) || lowerTones.some((t) => t === null)) continue;

        let opposes = true;
        for (let i = 0; i < upperTones.length; i++) {
          if (isPing(upperTones[i]!) === isPing(lowerTones[i]!)) {
            opposes = false;
            break;
          }
        }
        if (!opposes) continue;

        pairs.push({
          upper,
          lower,
          upperPinyin,
          lowerPinyin,
          rhyme: normalizeRhyme(chunk.label),
          book: chunk.book ?? '笠翁对韵',
        });
      }
    }
  }
  return pairs;
}

/** 读语料、抽对句。 */
export function buildPairs(): DuiyunPair[] {
  const chunks: SourceChunk[] = [];
  for (const source of SOURCES) {
    const raw = readJsonAuto(path.join(CLASSICS_DIR, `${source.file}.json.gz`))
      ?? readJsonAuto(path.join(CLASSICS_DIR, `${source.file}.json`));
    if (!raw) {
      throw new Error(`build-duiyun: cannot read ${source.file} from ${CLASSICS_DIR}`);
    }
    const file = raw as {
      chunks?: Array<{
        label?: string;
        content?: string[];
        pinyin?: string[][];
      }>;
    };
    for (const chunk of file.chunks ?? []) {
      const lines: SourceLine[] = [];
      const content = chunk.content ?? [];
      const pinyin = chunk.pinyin ?? [];
      for (let i = 0; i < content.length; i++) {
        const syllables = pinyin[i] ?? [];
        lines.push({ text: content[i]!, pinyin: syllables });
      }
      chunks.push({ label: chunk.label ?? '', lines, book: source.book });
    }
  }
  return extractPairs(chunks);
}

/** 写文件。 */
function main(): void {
  const pairs = buildPairs();
  // 两书之间没有重复的对句，但同一本里可能有 —— 按「上句+下句」去重，
  // 第一次出现的那一份留下。
  const seen = new Set<string>();
  const unique = pairs.filter((pair) => {
    const key = `${pair.upper}|${pair.lower}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');
  console.log(`build-duiyun: ${unique.length} pairs -> ${OUT_PATH}`);
}

if (process.argv[1] && process.argv[1].endsWith('build-duiyun.ts')) {
  main();
}
```

⚠️ **`extractPairs` 的 `SourceChunk` 要多一个 `book` 字段**（上面接口块里漏写了）。请在实现时把 `SourceChunk` 定义成：

```ts
interface SourceChunk {
  label: string;
  lines: SourceLine[];
  book: DuiyunPair['book'];
}
```

并把 `extractPairs` 里那行 `book: chunk.book ?? '笠翁对韵'` 改成 `book: chunk.book`。

- [ ] **Step 4: 跑测试，确认它通过**

Run: `npx vitest run tests/unit/scripts/build-duiyun.test.ts`
Expected: PASS

- [ ] **Step 5: 生成数据文件**

Run: `npx tsx scripts/build-duiyun.ts`
Expected: 打印 `build-duiyun: 761 pairs -> E:\ToolDevelop\PinYinCharacter\data\duiyun-pairs.json`

⚠️ 数字必须落在 **700–820** 之间。低于 700 说明汉字计数正则漏了 `g`（两字的对句全被丢掉，见订正），高于 820 说明宽对被放进来了（查 `opposes` 的循环）。

- [ ] **Step 6: 核对生成的数据**

Run:
```bash
python -c "
import json,sys
sys.stdout.reconfigure(encoding='utf-8')
d=json.load(open('data/duiyun-pairs.json',encoding='utf-8'))
print('pairs:', len(d))
print('books:', {b: sum(1 for x in d if x['book']==b) for b in set(x['book'] for x in d)})
print('rhyme labels:', len(set(x['rhyme'] for x in d)))
print('sample:', json.dumps(d[:3], ensure_ascii=False))
"
```
Expected: `pairs: 761`，两个书名都出现（声律启蒙 381 + 笠翁对韵 380），韵部标签 30 个，两种长度（1 字 283 + 2 字 478）都有，sample 的 `upper`/`lower` 都是汉字。

- [ ] **Step 7: 提交**

```bash
git add scripts/build-duiyun.ts data/duiyun-pairs.json tests/unit/scripts/build-duiyun.test.ts
git commit -m "feat(duiyun): extract the tone-opposed couplets from the classics [YYYY-MM-DD HH.MM]"
```

---

## Task 2: 规则模块 `lib/duiyun-rules.ts`

**Files:**
- Create: `lib/duiyun-rules.ts`
- Test: `tests/unit/lib/duiyun-rules.test.ts`

**Interfaces:**
- Consumes: `lib/pinyin-tone.ts` 的 `Tone`；`lib/catch-char-rules.ts` 的 `makeRng(seed)`
- Produces:
  ```ts
  /** 一个对句。 */
  export interface DuiyunPair {
    upper: string;
    lower: string;
    upperPinyin: string[];
    lowerPinyin: string[];
    rhyme: string;
    book: string;
  }

  /** 一副对联的一个字位。 */
  export interface DuiyunSlot {
    /** 0 = 上句，1 = 下句。 */
    side: 0 | 1;
    /** 这个字在那一侧里的下标。 */
    index: number;
    /** 该字本身。挖空时也是答案 —— 界面自己决定显示什么。 */
    char: string;
    /** 该字的拼音。 */
    pinyin: string;
    /** 该字的声调。 */
    tone: Tone;
    /** 这一位是不是挖空的。 */
    isBlank: boolean;
  }

  /** 一局的配置。 */
  export interface DuiyunConfig {
    /** 挖掉几对里的几对？—— 挖的是「对」的位置数。 */
    blanks: number;
    /** 字盘里的干扰字个数。 */
    distractors: number;
  }

  export const DUIYUN_CONFIG: Record<Difficulty, DuiyunConfig>;

  /** 一局。 */
  export interface DuiyunRound {
    /** 这一局的对句。 */
    pair: DuiyunPair;
    /** 上句 + 下句的字位。 */
    slots: DuiyunSlot[];
    /** 候选字盘。 */
    tray: DuiyunTile[];
    /** 这一局的种子。 */
    seed: number;
  }

  /** 字盘上的一块字。 */
  export interface DuiyunTile {
    id: string;
    char: string;
    pinyin: string;
    tone: Tone;
    /** 这个字是「正确的」还是「干扰的」。 */
    isAnswer: boolean;
  }

  /** 放字的结果。 */
  export type DuiyunDropResult =
    | { ok: true; state: DuiyunRound }
    | { ok: false; reason: 'wrong_character' | 'slot_filled' | 'not_a_tray_item' };

  export function buildRound(
    pair: DuiyunPair,
    config: DuiyunConfig,
    seed: number,
    pool: readonly DuiyunPair[],
  ): DuiyunRound;
  export function dropCharacter(
    round: DuiyunRound,
    slotIndex: number,
    tileId: string,
  ): DuiyunDropResult;
  export function liftCharacter(round: DuiyunRound, slotIndex: number): DuiyunRound;
  export function isRoundWon(round: DuiyunRound): boolean;
  export function blanksRemaining(round: DuiyunRound): number;
  export function isPing(tone: Tone): boolean;
  export function toneOf(syllable: string): Tone | null;
  export function finalOf(syllable: string): string;
  export function initialOf(syllable: string): string;
  ```

- [ ] **Step 1: 写失败的测试**

`tests/unit/lib/duiyun-rules.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  DUIYUN_CONFIG,
  blanksRemaining,
  buildRound,
  dropCharacter,
  finalOf,
  initialOf,
  isPing,
  isRoundWon,
  liftCharacter,
  toneOf,
  type DuiyunPair,
} from '@/lib/duiyun-rules';

const PAIR: DuiyunPair = {
  upper: '天对地',
  lower: '雨对风',
  upperPinyin: ['tiān', 'duì', 'dì'],
  lowerPinyin: ['yǔ', 'duì', 'fēng'],
  rhyme: '一东',
  book: '笠翁对韵',
};

/** 一副最简单的对句：一字对一字。 */
const SHORT: DuiyunPair = {
  upper: '天',
  lower: '地',
  upperPinyin: ['tiān'],
  lowerPinyin: ['dì'],
  rhyme: '一东',
  book: '笠翁对韵',
};

describe('duiyun rules', () => {
  it('reads the tone of a syllable', () => {
    expect(toneOf('tiān')).toBe(1);
    expect(toneOf('dì')).toBe(4);
    expect(toneOf('de')).toBeNull();
  });

  it('knows 平 from 仄', () => {
    expect(isPing(1)).toBe(true);
    expect(isPing(2)).toBe(true);
    expect(isPing(3)).toBe(false);
    expect(isPing(4)).toBe(false);
  });

  it('splits a syllable into its initial and its final', () => {
    expect(initialOf('zhōng')).toBe('zh');
    expect(initialOf('chuáng')).toBe('ch');
    expect(initialOf('shān')).toBe('sh');
    expect(initialOf('mā')).toBe('m');
    expect(finalOf('zhōng')).toBe('ong');
    expect(finalOf('mā')).toBe('a');
    // ü 写成 v —— 拼音里 ü 的两点省掉了，'lǜ' 的韵母是 'v'。
    expect(finalOf('lǜ')).toBe('v');
  });

  it('makes one slot per character of both sides', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.slots).toHaveLength(6);
    expect(round.slots.filter((s) => s.side === 0)).toHaveLength(3);
    expect(round.slots.filter((s) => s.side === 1)).toHaveLength(3);
  });

  it('blanks the number of positions the config asks for', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.slots.filter((s) => s.isBlank)).toHaveLength(1);
    expect(blanksRemaining(round)).toBe(1);
  });

  it('never blanks the 对 hinge, because it is the same word on both sides', () => {
    // '对' 是两句共用的铰链字，挖掉它两边都没法读。
    const round = buildRound(PAIR, { blanks: 3, distractors: 2 }, 7, [PAIR]);
    const hinges = round.slots.filter((s) => s.char === '对');
    expect(hinges).toHaveLength(2);
    expect(hinges.every((s) => !s.isBlank)).toBe(true);
  });

  it('puts the answer and the distractors on the tray', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(round.tray).toHaveLength(3);
    expect(round.tray.filter((t) => t.isAnswer)).toHaveLength(1);
  });

  it('refuses a character that does not belong in the slot', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const wrong = round.tray.find((t) => !t.isAnswer)!;
    const result = dropCharacter(round, blankIndex, wrong.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_character');
  });

  it('refuses a drop into a slot that is already filled', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const result = dropCharacter(filled.state, blankIndex, answer.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('slot_filled');
  });

  it('refuses a tile that is not on the tray', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const result = dropCharacter(round, blankIndex, 'not-a-real-tile');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_a_tray_item');
  });

  it('is won when every blank is filled', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    expect(isRoundWon(round)).toBe(false);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (filled.ok) expect(isRoundWon(filled.state)).toBe(true);
  });

  it('puts a character back when it is lifted', () => {
    const round = buildRound(PAIR, { blanks: 1, distractors: 2 }, 7, [PAIR]);
    const blankIndex = round.slots.findIndex((s) => s.isBlank);
    const answer = round.tray.find((t) => t.isAnswer)!;
    const filled = dropCharacter(round, blankIndex, answer.id);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const lifted = liftCharacter(filled.state, blankIndex);
    expect(lifted.slots[blankIndex]!.isBlank).toBe(true);
    expect(blanksRemaining(lifted)).toBe(1);
    expect(lifted.tray.some((t) => t.id === answer.id)).toBe(true);
  });

  it('builds the same round from the same seed', () => {
    const a = buildRound(PAIR, { blanks: 1, distractors: 2 }, 42, [PAIR]);
    const b = buildRound(PAIR, { blanks: 1, distractors: 2 }, 42, [PAIR]);
    expect(a.slots.map((s) => `${s.side}:${s.index}:${s.char}:${s.isBlank}`)).toEqual(
      b.slots.map((s) => `${s.side}:${s.index}:${s.char}:${s.isBlank}`),
    );
    expect(a.tray.map((t) => t.char)).toEqual(b.tray.map((t) => t.char));
  });

  it('gives the three tiers a different number of blanks', () => {
    expect(DUIYUN_CONFIG.easy.blanks).toBe(1);
    expect(DUIYUN_CONFIG.medium.blanks).toBe(2);
    expect(DUIYUN_CONFIG.hard.blanks).toBe(3);
  });

  it('never leaves a tier with more blanks than the pair has slots', () => {
    // 一字对一字的对句只有两个可挖的位置 —— 挖三个会挖不到。
    const round = buildRound(SHORT, DUIYUN_CONFIG.hard, 7, [SHORT]);
    expect(round.slots.filter((s) => s.isBlank).length).toBeLessThanOrEqual(
      DUIYUN_CONFIG.hard.blanks,
    );
    expect(round.slots.filter((s) => s.isBlank).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npx vitest run tests/unit/lib/duiyun-rules.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/duiyun-rules'`

- [ ] **Step 3: 写 `lib/duiyun-rules.ts`**

```ts
/**
 * 对韵消消 (duìyùn match) 的规则 —— 纯逻辑，没有 DOM、没有 React、没有 IO。
 *
 * 玩法：一副对联上下句并排，字位挖掉几个。字盘上放着答案字和几个干扰字，
 * 玩家把字拖回正确的位置。填对了这一副就成。
 *
 * 为什么规则住在单独的文件里：判断「这个字放对了吗」是整个游戏的全部，
 * 而判断一个界面像素很难断言。规则一旦能单独测，界面就只需要照着渲染。
 *
 * 平仄是这个游戏的骨头：上句与下句逐位平仄相反（详见 data/duiyun-pairs.json
 * 的生成脚本）。界面可以把平/仄标出来，让玩家看见「为什么这两个字是一对」。
 */

import type { Difficulty } from './difficulty';
import type { Tone } from './pinyin-tone';
import { makeRng } from './catch-char-rules';

/** 一个对句。 */
export interface DuiyunPair {
  /** 上句的字。 */
  upper: string;
  /** 下句的字。 */
  lower: string;
  /** 上句每个字的拼音。 */
  upperPinyin: string[];
  /** 下句每个字的拼音。 */
  lowerPinyin: string[];
  /** 韵部标签，如 '一东'。 */
  rhyme: string;
  /** 出处。 */
  book: string;
}

/** 一副对联的一个字位。 */
export interface DuiyunSlot {
  /** 0 是上句，1 是下句。 */
  side: 0 | 1;
  /** 这个字在那一侧里的下标。 */
  index: number;
  /** 这个字本身。挖空时它仍是答案。 */
  char: string;
  /** 这个字的拼音。 */
  pinyin: string;
  /** 这个字的声调。 */
  tone: Tone;
  /** 这一位是不是挖空的。 */
  isBlank: boolean;
}

/** 字盘上的一块字。 */
export interface DuiyunTile {
  id: string;
  char: string;
  pinyin: string;
  tone: Tone;
  /** 是不是这一局的答案字。 */
  isAnswer: boolean;
}

/** 一局的配置。 */
export interface DuiyunConfig {
  /** 挖几个位置。 */
  blanks: number;
  /** 字盘上的干扰字个数。 */
  distractors: number;
}

/** 三个难度档。 */
export const DUIYUN_CONFIG: Record<Difficulty, DuiyunConfig> = {
  easy: { blanks: 1, distractors: 2 },
  medium: { blanks: 2, distractors: 3 },
  hard: { blanks: 3, distractors: 4 },
};

/** 一局。 */
export interface DuiyunRound {
  pair: DuiyunPair;
  slots: DuiyunSlot[];
  tray: DuiyunTile[];
  seed: number;
}

/** 声调符号 → 声调。 */
const TONE_BY_MARK: Record<string, Tone> = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};

/** 一个音节的声调。没有声调符号就是轻声，返回 null。 */
export function toneOf(syllable: string): Tone | null {
  for (const ch of syllable) {
    const tone = TONE_BY_MARK[ch];
    if (tone !== undefined) return tone;
  }
  return null;
}

/** 去掉声调符号的音节。 */
function plain(syllable: string): string {
  let out = '';
  for (const ch of syllable) {
    if (TONE_BY_MARK[ch] === undefined) out += ch;
  }
  return out.replace(/ü/g, 'v').toLowerCase();
}

/** 声母。'zhōng' → 'zh'，'mā' → 'm'。 */
export function initialOf(syllable: string): string {
  const p = plain(syllable);
  if (p.startsWith('zh')) return 'zh';
  if (p.startsWith('ch')) return 'ch';
  if (p.startsWith('sh')) return 'sh';
  return p.slice(0, 1);
}

/** 韵母。'zhōng' → 'ong'，'mā' → 'a'。 */
export function finalOf(syllable: string): string {
  const p = plain(syllable);
  const initial = initialOf(syllable);
  return p.length > initial.length ? p.slice(initial.length) : '';
}

/** 平声（1、2）还是仄声（3、4）。 */
export function isPing(tone: Tone): boolean {
  return tone === 1 || tone === 2;
}

/** 打乱一份列表。 */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy;
}

/**
 * 从语料里挑干扰字。
 *
 * 干扰字要好认 —— 挑跟答案音近但字不同的字，玩家才需要看清而不是乱猜。
 * 优先挑同声母的，其次同韵母的。
 */
function pickDistractors(
  pool: readonly DuiyunPair[],
  answerChar: string,
  answerPinyin: string,
  count: number,
  rng: () => number,
): Array<{ char: string; pinyin: string; tone: Tone }> {
  const candidates: Array<{ char: string; pinyin: string; tone: Tone; score: number }> = [];
  for (const pair of pool) {
    const sides: Array<{ chars: string; pinyin: string[] }> = [
      { chars: pair.upper, pinyin: pair.upperPinyin },
      { chars: pair.lower, pinyin: pair.lowerPinyin },
    ];
    for (const side of sides) {
      for (let i = 0; i < side.chars.length; i++) {
        const char = side.chars[i]!;
        const syllable = side.pinyin[i]!;
        if (char === answerChar) continue;
        const tone = toneOf(syllable);
        if (tone === null) continue;
        let score = 0;
        if (initialOf(syllable) === initialOf(answerPinyin)) score += 2;
        if (finalOf(syllable) === finalOf(answerPinyin)) score += 1;
        candidates.push({ char, pinyin: syllable, tone, score });
      }
    }
  }
  if (candidates.length === 0) return [];

  // 分数高的在前；同分时按字排，让结果不依赖语料的顺序。
  candidates.sort((x, y) => y.score - x.score || x.char.localeCompare(y.char));
  const chosen = candidates.slice(0, count);
  return shuffle(chosen, rng).map((c) => ({ char: c.char, pinyin: c.pinyin, tone: c.tone }));
}

/**
 * 挖哪几个位置。
 *
 * 「对」字是上下句共用的铰链，挖掉它两边都读不成句，所以它永远不挖。
 * 其余位置里挑 —— 优先挑上下句都能挖的位置（挖一个，上句和下句各少一个字，
 * 玩家要同时想两边），难度才上得去。
 */
function chooseBlanks(slots: DuiyunSlot[], want: number, rng: () => number): Set<number> {
  const eligible = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.char !== '对');
  if (eligible.length === 0) return new Set();

  // 上下句各挖一半左右：从上句的可挖位里取 ceil(want/2)，剩下的从下句取。
  const upper = eligible.filter(({ slot }) => slot.side === 0);
  const lower = eligible.filter(({ slot }) => slot.side === 1);
  const upperWant = Math.ceil(want / 2);
  const lowerWant = want - upperWant;

  const chosen = new Set<number>();
  for (const { index } of shuffle(upper, rng).slice(0, upperWant)) chosen.add(index);
  for (const { index } of shuffle(lower, rng).slice(0, lowerWant)) chosen.add(index);
  return chosen;
}

/** 建一局。 */
export function buildRound(
  pair: DuiyunPair,
  config: DuiyunConfig,
  seed: number,
  pool: readonly DuiyunPair[],
): DuiyunRound {
  const rng = makeRng(seed);

  const slots: DuiyunSlot[] = [];
  const sides: Array<{ chars: string; pinyin: string[]; side: 0 | 1 }> = [
    { chars: pair.upper, pinyin: pair.upperPinyin, side: 0 },
    { chars: pair.lower, pinyin: pair.lowerPinyin, side: 1 },
  ];
  for (const s of sides) {
    for (let i = 0; i < s.chars.length; i++) {
      const syllable = s.pinyin[i] ?? '';
      const tone = toneOf(syllable);
      slots.push({
        side: s.side,
        index: i,
        char: s.chars[i]!,
        pinyin: syllable,
        tone: tone ?? 1,
        isBlank: false,
      });
    }
  }

  const eligible = slots.filter((slot) => slot.char !== '对').length;
  const want = Math.min(config.blanks, eligible);
  const blankIndexes = chooseBlanks(slots, want, rng);
  for (const index of blankIndexes) slots[index]!.isBlank = true;

  // 字盘：每一个挖空位置都要一块对应的答案字。
  const answerTiles: DuiyunTile[] = [];
  for (const index of blankIndexes) {
    const slot = slots[index]!;
    answerTiles.push({
      id: `answer-${index}`,
      char: slot.char,
      pinyin: slot.pinyin,
      tone: slot.tone,
      isAnswer: true,
    });
  }

  const firstAnswer = answerTiles[0];
  const distractors = firstAnswer
    ? pickDistractors(pool, firstAnswer.char, firstAnswer.pinyin, config.distractors, rng)
    : [];
  const distractorTiles: DuiyunTile[] = distractors.map((d, i) => ({
    id: `distractor-${i}`,
    char: d.char,
    pinyin: d.pinyin,
    tone: d.tone,
    isAnswer: false,
  }));

  return {
    pair,
    slots,
    tray: shuffle([...answerTiles, ...distractorTiles], rng),
    seed,
  };
}

/** 放字。 */
export function dropCharacter(
  round: DuiyunRound,
  slotIndex: number,
  tileId: string,
): { ok: true; state: DuiyunRound } | { ok: false; reason: 'wrong_character' | 'slot_filled' | 'not_a_tray_item' } {
  const slot = round.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'not_a_tray_item' };
  const tile = round.tray.find((t) => t.id === tileId);
  if (!tile) return { ok: false, reason: 'not_a_tray_item' };
  if (!slot.isBlank) return { ok: false, reason: 'slot_filled' };
  if (tile.char !== slot.char) return { ok: false, reason: 'wrong_character' };

  const slots = round.slots.map((s, i) =>
    i === slotIndex ? { ...s, isBlank: false } : s,
  );
  return {
    ok: true,
    state: { ...round, slots, tray: round.tray.filter((t) => t.id !== tileId) },
  };
}

/** 把字取回来。 */
export function liftCharacter(round: DuiyunRound, slotIndex: number): DuiyunRound {
  const slot = round.slots[slotIndex];
  if (!slot || !slot.isBlank) return round;
  const slots = round.slots.map((s, i) => (i === slotIndex ? { ...s, isBlank: true } : s));
  const tray = round.tray.some((t) => t.char === slot.char)
    ? round.tray
    : [
        ...round.tray,
        {
          id: `answer-${slotIndex}`,
          char: slot.char,
          pinyin: slot.pinyin,
          tone: slot.tone,
          isAnswer: true,
        },
      ];
  return { ...round, slots, tray };
}

/** 这一局是不是赢了。 */
export function isRoundWon(round: DuiyunRound): boolean {
  return round.slots.every((slot) => !slot.isBlank);
}

/** 还剩几个空。 */
export function blanksRemaining(round: DuiyunRound): number {
  return round.slots.filter((slot) => slot.isBlank).length;
}
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `npx vitest run tests/unit/lib/duiyun-rules.test.ts`
Expected: PASS

- [ ] **Step 5: 变异验证**

改坏实现，确认测试真的会红。**每次只改一处，改完立刻改回来。**

| 变异 | 改法 | 期望 |
|---|---|---|
| M1 | `chooseBlanks` 里去掉 `slot.char !== '对'` 这个过滤 | 「never blanks the 对 hinge」变红 |
| M2 | `dropCharacter` 里去掉 `tile.char !== slot.char` 的判断 | 「refuses a character that does not belong」变红 |
| M3 | `isPing` 改成 `tone === 1` | 「knows 平 from 仄」变红 |
| M4 | `finalOf` 里把 `p.length > initial.length` 改成 `p.length >= initial.length` | 「splits a syllable into its initial and its final」变红 |

Run（每个变异跑一次）：`npx vitest run tests/unit/lib/duiyun-rules.test.ts`
Expected: 每个变异都至少有一个用例变红。**全部变绿就说明测试是假绿 —— 把变异改回去再查测试。**

- [ ] **Step 6: 提交**

```bash
git add lib/duiyun-rules.ts tests/unit/lib/duiyun-rules.test.ts
git commit -m "feat(duiyun): the rules of the couplet matching game [YYYY-MM-DD HH.MM]"
```

---

## Task 3: 数据接口 `/api/duiyun` + 客户端 `lib/api-duiyun.ts`

**Files:**
- Create: `lib/api-duiyun.ts`
- Create: `app/api/duiyun/route.ts`
- Test: `tests/unit/app/api/duiyun.test.ts`

**Interfaces:**
- Consumes: `data/duiyun-pairs.json`（读文件用 `lib/json-fs.ts` 的 `readJsonAuto`）；`lib/duiyun-rules.ts` 的 `DuiyunPair`
- Produces:
  - `GET /api/duiyun?limit=N` → `{ pairs: DuiyunPair[], failed: boolean }`，`Cache-Control: no-store`
  - `lib/api-duiyun.ts`：
    ```ts
    export interface DuiyunResult {
      pairs: DuiyunPair[];
      /** 服务端读文件失败。列表是空的，界面要说出来。 */
      failed: boolean;
    }
    export async function fetchDuiyunPairs(limit?: number): Promise<DuiyunResult>;
    export function __resetDuiyunCache(): void;
    ```

- [ ] **Step 1: 写失败的测试**

`tests/unit/app/api/duiyun.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/duiyun-data', () => ({
  listDuiyunPairs: vi.fn(),
}));

import { listDuiyunPairs } from '@/lib/duiyun-data';
import { GET } from '@/app/api/duiyun/route';

async function call(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new NextRequest(`http://localhost/api/duiyun${query}`));
  return { status: response.status, body: await response.json() };
}

function pairsOf(body: Record<string, unknown>): Array<{ upper: string }> {
  return (body.pairs as Array<{ upper: string }>) ?? [];
}

describe('GET /api/duiyun', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the pairs', async () => {
    vi.mocked(listDuiyunPairs).mockResolvedValue([
      { upper: '天', lower: '地', upperPinyin: ['tiān'], lowerPinyin: ['dì'], rhyme: '一东', book: '笠翁对韵' },
    ] as never);
    const { body } = await call();
    expect(pairsOf(body).map((p) => p.upper)).toEqual(['天']);
  });

  it('caps how many pairs it asks for', async () => {
    vi.mocked(listDuiyunPairs).mockResolvedValue([] as never);
    await call('?limit=5');
    expect(vi.mocked(listDuiyunPairs)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('rejects a limit that is not a positive number', async () => {
    expect((await call('?limit=0')).status).toBe(400);
    expect((await call('?limit=-3')).status).toBe(400);
  });

  it('rejects a limit that is not a number', async () => {
    expect((await call('?limit=abc')).status).toBe(400);
  });

  it('answers 200 with an empty list when the data file cannot be read', async () => {
    // 数据文件缺失是一个状态，不是一次请求失败：界面要说「还没有数据」，
    // 而不是整页崩掉。
    vi.mocked(listDuiyunPairs).mockRejectedValue(new Error('ENOENT'));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(pairsOf(body)).toEqual([]);
    expect(body.failed).toBe(true);
  });

  it('says the query did not fail when it succeeds', async () => {
    vi.mocked(listDuiyunPairs).mockResolvedValue([] as never);
    const { body } = await call();
    expect(body.failed).toBe(false);
  });

  it('tells the client not to cache the answer', async () => {
    vi.mocked(listDuiyunPairs).mockResolvedValue([] as never);
    const response = await GET(new NextRequest('http://localhost/api/duiyun'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npx vitest run tests/unit/app/api/duiyun.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/duiyun-data'`

- [ ] **Step 3: 写 `lib/duiyun-data.ts`**

```ts
/**
 * 对句的读取 —— 从 `data/duiyun-pairs.json` 拿数据。
 *
 * 数据文件是唯一的事实来源：期望的对句数量由这个文件决定，不写在别处。
 * 文件缺失是一个状态，不是一次故障 —— 读不到就把错误抛给调用方，由调用方
 * 决定怎么对界面说。
 */
import path from 'node:path';
import { readJsonAuto } from './json-fs';
import type { DuiyunPair } from './duiyun-rules';

const DATA_PATH = path.join(process.cwd(), 'data', 'duiyun-pairs.json');

export interface ListDuiyunPairsOptions {
  /** 最多返回多少对。 */
  limit?: number;
}

/** 读全部对句。 */
export function listDuiyunPairs(options: ListDuiyunPairsOptions = {}): DuiyunPair[] {
  const raw = readJsonAuto(DATA_PATH);
  if (!raw) {
    throw new Error(`listDuiyunPairs: cannot read ${DATA_PATH}`);
  }
  const pairs = raw as DuiyunPair[];
  if (!Array.isArray(pairs)) {
    throw new Error(`listDuiyunPairs: ${DATA_PATH} is not an array`);
  }
  if (options.limit !== undefined && options.limit < pairs.length) {
    return pairs.slice(0, options.limit);
  }
  return pairs;
}

/** 数据文件里有多少对。 */
export function countDuiyunPairs(): number {
  return listDuiyunPairs().length;
}
```

- [ ] **Step 4: 写 `app/api/duiyun/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listDuiyunPairs } from '@/lib/duiyun-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 查询参数。
 *
 * `limit` 限制一次返回多少对 —— 语料有 200 多对，全量给客户端不必要。
 */
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // 数据文件读不到是一个状态，不是一次请求的失败：界面要能说「还没有数据」，
  // 而不是整页崩掉。
  let failed = false;
  let pairs: ReturnType<typeof listDuiyunPairs> = [];
  try {
    pairs = listDuiyunPairs(parsed.data);
  } catch (err) {
    failed = true;
    console.error('[duiyun] the pairs could not be read:', err);
  }

  return NextResponse.json(
    { pairs, failed },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 5: 写 `lib/api-duiyun.ts`**

```ts
/**
 * 对句的客户端。
 *
 * 路由答 `{ pairs, failed }`。失败的信封**不缓存** —— 重试按钮必须真的重试，
 * 不能每次都读到同一个失败。
 */
import type { DuiyunPair } from './duiyun-rules';

export interface DuiyunResult {
  pairs: DuiyunPair[];
  /** 服务端读不到数据文件。列表是空的，界面要说出来。 */
  failed: boolean;
}

const cache = new Map<string, Promise<DuiyunResult>>();

export async function fetchDuiyunPairs(limit?: number): Promise<DuiyunResult> {
  const key = `limit:${limit ?? 0}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const query = limit === undefined ? '' : `?limit=${limit}`;
  const pending = fetch(`/api/duiyun${query}`)
    .then((response) => {
      if (!response.ok) throw new Error(`fetch /api/duiyun failed: ${response.status}`);
      return response.json();
    })
    .then((data): DuiyunResult => {
      if (data && typeof data === 'object' && Array.isArray((data as { pairs?: unknown }).pairs)) {
        const envelope = data as { pairs: DuiyunPair[]; failed?: boolean };
        return { pairs: envelope.pairs, failed: envelope.failed ?? false };
      }
      return { pairs: [], failed: false };
    });

  cache.set(key, pending);
  pending.then(
    (result) => {
      if (result.failed && cache.get(key) === pending) cache.delete(key);
    },
    () => {
      if (cache.get(key) === pending) cache.delete(key);
    },
  );
  return pending;
}

export function __resetDuiyunCache(): void {
  cache.clear();
}
```

- [ ] **Step 6: 跑测试，确认它通过**

Run: `npx vitest run tests/unit/app/api/duiyun.test.ts`
Expected: PASS

- [ ] **Step 7: 真机核对数据**

Run: `npx tsx --env-file-if-exists=.env -e "import { listDuiyunPairs } from './lib/duiyun-data'; const p = listDuiyunPairs(); console.log('pairs:', p.length); console.log('sample:', JSON.stringify(p.slice(0,2), null, 2));"`
Expected: `pairs: 761`（与 Task 1 生成的一致），sample 里 `upper` / `lower` 是汉字、`upperPinyin` 是带声调的音节。

- [ ] **Step 8: 提交**

```bash
git add lib/duiyun-data.ts lib/api-duiyun.ts app/api/duiyun/route.ts tests/unit/app/api/duiyun.test.ts
git commit -m "feat(duiyun): serve the couplets to the game [YYYY-MM-DD HH.MM]"
```

---

## Task 4: 游戏组件 `components/game/DuiYunGame.tsx`

**Files:**
- Create: `components/game/DuiYunGame.tsx`
- Test: `tests/unit/components/game/DuiYunGame.test.tsx`

**Interfaces:**
- Consumes: `lib/api-duiyun.ts` 的 `fetchDuiyunPairs`；`lib/duiyun-rules.ts` 的全部导出；`components/common/DifficultyPicker.tsx`；`lib/game-sound.ts`
- Produces: `export function DuiYunGame(): JSX.Element`

- [ ] **Step 1: 写失败的测试**

`tests/unit/components/game/DuiYunGame.test.tsx`：

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

const PAIRS = [
  {
    upper: '天对地',
    lower: '雨对风',
    upperPinyin: ['tiān', 'duì', 'dì'],
    lowerPinyin: ['yǔ', 'duì', 'fēng'],
    rhyme: '一东',
    book: '笠翁对韵',
  },
  {
    upper: '晨',
    lower: '午',
    upperPinyin: ['chén'],
    lowerPinyin: ['wǔ'],
    rhyme: '二冬',
    book: '笠翁对韵',
  },
];

vi.mock('@/lib/api-duiyun', () => ({
  fetchDuiyunPairs: vi.fn(),
  __resetDuiyunCache: vi.fn(),
}));

vi.mock('@/lib/game-sound', () => ({
  playChime: vi.fn(),
  playThud: vi.fn(),
  playFanfare: vi.fn(),
  playStamp: vi.fn(),
}));

import { fetchDuiyunPairs } from '@/lib/api-duiyun';
import { DuiYunGame } from '@/components/game/DuiYunGame';

function slotButtons(): HTMLElement[] {
  const board = screen.getByTestId('duiyun-board');
  return Array.from(board.querySelectorAll('button'));
}

function slotTexts(): string[] {
  return slotButtons().map((slot) => slot.textContent ?? '');
}

function trayButtons(): HTMLElement[] {
  const tray = screen.getByTestId('duiyun-tray');
  return Array.from(tray.querySelectorAll('button'));
}

describe('DuiYunGame', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: PAIRS, failed: false });
  });

  it('shows the start card once the pairs arrive', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument();
  });

  it('says so when the query failed', async () => {
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: [], failed: true });
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText(/暂时读不出来/)).toBeInTheDocument());
  });

  it('says so when there are no pairs at all', async () => {
    vi.mocked(fetchDuiyunPairs).mockResolvedValue({ pairs: [], failed: false });
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText(/还没有对韵数据/)).toBeInTheDocument());
  });

  it('shows both sides of a couplet once a round starts', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    expect(screen.getByTestId('duiyun-board')).toBeInTheDocument();
    expect(screen.getByTestId('duiyun-tray')).toBeInTheDocument();
    expect(slotButtons().length).toBeGreaterThan(0);
  });

  it('holds one blank on easy', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    expect(slotTexts().filter((text) => text.includes('？'))).toHaveLength(1);
  });

  it('shows the rhyme the couplet comes from', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    // 韵部标签是玩家要的线索 —— 没有它，这局只是一道找字的题。
    expect(screen.getByText(/韵部/).toBeInTheDocument());
  });

  it('fills a blank when the right character is dropped on it', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    const slots = slotButtons();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
    expect(tile).toBeDefined();

    fireEvent.click(tile!);
    fireEvent.click(slots[blankIndex]!);

    expect(slotTexts()[blankIndex]).not.toContain('？');
  });

  it('refuses a wrong character and says why', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    const slots = slotButtons();
    const blankIndex = slotTexts().findIndex((text) => text.includes('？'));
    const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
    const wrong = trayButtons().find(
      (b) => !b.getAttribute('aria-label')?.includes(`字 ${wanted}`),
    );
    expect(wrong).toBeDefined();

    fireEvent.click(wrong!);
    fireEvent.click(slots[blankIndex]!);

    expect(screen.getByText('这个字放错了地方')).toBeInTheDocument();
    expect(slotTexts()[blankIndex]).toContain('？');
  });

  it('shows the couplet when the round is won', async () => {
    render(<DuiYunGame />);
    await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    for (let guard = 0; guard < 6; guard++) {
      const slots = slotButtons();
      const texts = slotTexts();
      const blankIndex = texts.findIndex((text) => text.includes('？'));
      if (blankIndex === -1) break;
      const wanted = slots[blankIndex]!.getAttribute('aria-label')?.match(/需要 (\S)/)?.[1];
      const tile = trayButtons().find((b) => b.getAttribute('aria-label')?.includes(`字 ${wanted}`));
      if (!tile) break;
      fireEvent.click(tile);
      fireEvent.click(slots[blankIndex]!);
    }

    await waitFor(() => expect(screen.getByText(/拼对了：/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npx vitest run tests/unit/components/game/DuiYunGame.test.tsx`
Expected: FAIL —— `Cannot find module '@/components/game/DuiYunGame'`

- [ ] **Step 3: 写 `components/game/DuiYunGame.tsx`**

```tsx
'use client';

/**
 * 对韵消消 —— 把一副对联的字拖回正确的位置。
 *
 * 规则住在 `lib/duiyun-rules.ts`；这个文件只负责渲染、拖拽和回合的生命周期。
 *
 * 拖拽用 HTML 的 drag-and-drop API，不用 pointer events：浏览器自己画拖拽影子，
 * 每个字块同时也是按钮（点一下选中、再点一下空格放下），键盘和触屏都走得通，
 * 而且不需要 rAF 循环。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDuiyunPairs } from '@/lib/api-duiyun';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { playChime, playFanfare, playThud } from '@/lib/game-sound';
import {
  DUIYUN_CONFIG,
  blanksRemaining,
  buildRound,
  dropCharacter,
  isPing,
  isRoundWon,
  liftCharacter,
  type DuiyunPair,
  type DuiyunRound,
} from '@/lib/duiyun-rules';
import type { Difficulty } from '@/lib/difficulty';

type Phase = 'loading' | 'ready' | 'playing' | 'won' | 'error';

/** 组件记得的东西。 */
interface GameState {
  phase: Phase;
  /** 可用的对句。 */
  pool: DuiyunPair[];
  /** 正在玩的一局。 */
  round: DuiyunRound | null;
  /** 玩家手里拿着的字块。 */
  selectedTileId: string | null;
  /** 提示语。 */
  message: string;
  /** 拼对了几副。 */
  solved: number;
  /** 查询失败时的提示。 */
  error: string;
  /** 当前这局的种子。每局加一 —— 用时钟的毫秒会让同一毫秒开的两局一模一样。 */
  seed: number;
}

const INITIAL: GameState = {
  phase: 'loading',
  pool: [],
  round: null,
  selectedTileId: null,
  message: '',
  solved: 0,
  error: '',
  seed: 0,
};

const READY: GameState = { ...INITIAL, phase: 'ready' };

/** 拒绝的理由，玩家读到的话。 */
const REFUSAL_TEXT: Record<string, string> = {
  wrong_character: '这个字放错了地方',
  slot_filled: '这一格已经有字了',
  not_a_tray_item: '这个字不在字盘上',
};

/** 平仄的记号。 */
function toneMark(tone: number): string {
  if (tone === 1) return '平';
  if (tone === 2) return '平';
  if (tone === 3) return '仄';
  return '仄';
}

export function DuiYunGame() {
  const [state, setState] = useState<GameState>(INITIAL);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, phase: 'loading', error: '' }));
    fetchDuiyunPairs()
      .then((result) => {
        if (cancelled) return;
        if (result.failed) {
          setState({ ...INITIAL, phase: 'error', error: '对韵数据暂时读不出来，请稍后再试。' });
          return;
        }
        if (result.pairs.length === 0) {
          setState({ ...INITIAL, phase: 'error', error: '还没有对韵数据，请先运行数据抽取脚本。' });
          return;
        }
        setState({ ...READY, pool: result.pairs });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[duiyun-game] the pairs could not be loaded', err);
        setState({ ...INITIAL, phase: 'error', error: '对韵数据暂时读不出来，请稍后再试。' });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /** 开下一局。 */
  const nextRound = useCallback(() => {
    setState((current) => {
      const seed = (current.seed + 1) >>> 0;
      if (current.pool.length === 0) return { ...current, seed };
      const config = DUIYUN_CONFIG[difficulty];
      const pair = current.pool[seed % current.pool.length];
      const round = buildRound(pair, config, seed, current.pool);
      return { ...current, phase: 'playing', round, selectedTileId: null, message: '', seed };
    });
  }, [difficulty]);

  /** 把选中的字放进一格。 */
  const dropInto = useCallback((slotIndex: number, tileId: string) => {
    setState((current) => {
      if (!current.round) return current;
      const result = dropCharacter(current.round, slotIndex, tileId);
      if (!result.ok) {
        playThud();
        return {
          ...current,
          selectedTileId: null,
          message: REFUSAL_TEXT[result.reason] ?? '放不下',
        };
      }
      playChime();
      const next = result.state;
      if (isRoundWon(next)) {
        playFanfare();
        return {
          ...current,
          phase: 'won',
          round: next,
          selectedTileId: null,
          message: '',
          solved: current.solved + 1,
        };
      }
      return { ...current, round: next, selectedTileId: null, message: '' };
    });
  }, []);

  /** 拿起或放下字盘上的一块字。 */
  const toggleTile = useCallback((tileId: string) => {
    setState((current) => ({
      ...current,
      selectedTileId: current.selectedTileId === tileId ? null : tileId,
      message: '',
    }));
  }, []);

  /** 把一格里的字取回来。 */
  const liftFromSlot = useCallback((slotIndex: number) => {
    setState((current) => {
      if (!current.round) return current;
      const next = liftCharacter(current.round, slotIndex);
      if (next === current.round) return current;
      return { ...current, round: next, message: '' };
    });
  }, []);

  const round = state.round;
  const remaining = round ? blanksRemaining(round) : 0;

  const startCard = useMemo(
    () => (
      <div className="rounded-lg border border-ink/20 bg-paper p-6">
        <h2 className="text-lg font-semibold">对韵消消</h2>
        <p className="mt-2 text-sm text-ink/70">
          上下句各挖掉几个字，把字盘里的字放回正确的位置。
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink/70">
          <li>● 上下句的字一一相对，平声对仄声、仄声对平声。</li>
          <li>● 把正确的字拖到空格；也可以先点字、再点空格。</li>
          <li>● 填错了可以点空格把字取回来。</li>
        </ul>
        <p className="mt-3 text-xs text-ink/50">
          简单 · 挖 1 个空；复杂 · 挖 2 个空；超难 · 挖 3 个空。
        </p>
        <div className="mt-4">
          <DifficultyPicker value={difficulty} onChange={setDifficulty} />
        </div>
        <button
          type="button"
          className="mt-4 rounded border border-seal/40 bg-seal/10 px-4 py-2 text-sm hover:bg-seal/20"
          onClick={nextRound}
        >
          开始
        </button>
      </div>
    ),
    [difficulty, nextRound, state.pool],
  );

  if (state.phase === 'loading') {
    return (
      <div className="rounded-lg border border-ink/20 bg-paper p-6 text-sm text-ink/70">
        正在取对韵……
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-ink/20 bg-paper p-6">
        <p className="text-sm text-ink/70">{state.error}</p>
        <button
          type="button"
          className="mt-4 rounded border border-seal/40 bg-seal/10 px-4 py-2 text-sm hover:bg-seal/20"
          onClick={() => setReloadToken((current) => current + 1)}
        >
          重试
        </button>
      </div>
    );
  }

  if (state.phase === 'ready' || !round) {
    return <div className="space-y-4">{startCard}</div>;
  }

  const upperSlots = round.slots.filter((slot) => slot.side === 0);
  const lowerSlots = round.slots.filter((slot) => slot.side === 1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/20 bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink/60">
          <span>还剩 {remaining} 个空</span>
          <span>已拼好 {state.solved} 副</span>
          <span>韵部 · {round.pair.rhyme}</span>
        </div>
      </div>

      {/* 字盘。 */}
      <div
        className="flex flex-wrap gap-2 rounded-lg border border-ink/20 bg-paper-deep p-4"
        data-testid="duiyun-tray"
      >
        {round.tray.map((tile) => (
          <button
            key={tile.id}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', tile.id);
              event.dataTransfer.effectAllowed = 'move';
              setState((current) => ({ ...current, selectedTileId: tile.id }));
            }}
            onClick={() => toggleTile(tile.id)}
            className={`flex h-14 w-14 cursor-grab flex-col items-center justify-center rounded border text-xl active:cursor-grabbing ${
              state.selectedTileId === tile.id
                ? 'border-seal bg-seal/20'
                : 'border-ink/20 bg-paper hover:bg-seal/10'
            }`}
            aria-pressed={state.selectedTileId === tile.id}
            aria-label={`字 ${tile.char}，读作 ${tile.pinyin}`}
          >
            <span>{tile.char}</span>
            <span className="text-[10px] leading-none text-ink/50">{tile.pinyin}</span>
          </button>
        ))}
      </div>

      {/* 上下两句。 */}
      <div
        className="space-y-3 rounded-lg border border-ink/20 bg-paper p-6"
        data-testid="duiyun-board"
      >
        {[upperSlots, lowerSlots].map((side, sideIndex) => (
          <div key={sideIndex} className="flex flex-wrap items-end justify-center gap-3">
            {side.map((slot) => {
              const globalIndex = round.slots.indexOf(slot);
              return (
                <button
                  key={`${slot.side}-${slot.index}`}
                  type="button"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const tileId = event.dataTransfer.getData('text/plain');
                    if (tileId) dropInto(globalIndex, tileId);
                  }}
                  onClick={() => {
                    if (state.selectedTileId) {
                      dropInto(globalIndex, state.selectedTileId);
                    } else if (!slot.isBlank) {
                      liftFromSlot(globalIndex);
                    }
                  }}
                  className={`flex h-20 w-20 flex-col items-center justify-center rounded border-2 text-3xl ${
                    slot.isBlank
                      ? 'border-dashed border-ink/30 bg-paper-deep text-ink/30'
                      : 'border-ink/20 bg-paper-deep'
                  } ${state.selectedTileId && slot.isBlank ? 'ring-2 ring-seal/40' : ''}`}
                  aria-label={
                    slot.isBlank
                      ? `第 ${slot.index + 1} 个空，需要 ${slot.char}`
                      : `第 ${slot.index + 1} 个字 ${slot.char}，读作 ${slot.pinyin}`
                  }
                >
                  {slot.isBlank ? '？' : slot.char}
                  <span className="text-[11px] leading-none text-ink/50">
                    {slot.pinyin} · {toneMark(slot.tone)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {state.message ? (
        <p className="text-center text-sm text-seal" role="status">
          {state.message}
        </p>
      ) : null}

      {state.phase === 'won' ? (
        <div className="rounded-lg border border-seal/40 bg-seal/10 p-6 text-center">
          <p className="text-lg font-semibold">拼对了：{round.pair.upper}</p>
          <p className="mt-1 text-sm text-ink/70">
            {round.pair.lower}　·　韵部 {round.pair.rhyme}　·　{round.pair.book}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              className="rounded border border-seal/40 bg-paper px-4 py-2 text-sm hover:bg-seal/10"
              onClick={nextRound}
            >
              再来一副
            </button>
            <button
              type="button"
              className="rounded border border-ink/20 bg-paper px-4 py-2 text-sm hover:bg-ink/5"
              onClick={() => setState({ ...READY, pool: state.pool })}
            >
              换难度
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `npx vitest run tests/unit/components/game/DuiYunGame.test.tsx`
Expected: PASS

- [ ] **Step 5: 变异验证**

| 变异 | 改法 | 期望 |
|---|---|---|
| M1 | 把「韵部 ·」那一行删掉 | 「shows the rhyme the couplet comes from」变红 |
| M2 | `dropInto` 里把 `!result.ok` 的分支去掉 | 「refuses a wrong character and says why」变红 |
| M3 | `isPing` 的 import 去掉、界面上不标平仄 | 测试不红 —— **这条说明测试没钉住平仄的显示**。在组件里加一条断言：`expect(screen.getByText(/平|仄/)).toBeInTheDocument()`，再变异一次确认变红。 |

Run: `npx vitest run tests/unit/components/game/DuiYunGame.test.tsx`

- [ ] **Step 6: 提交**

```bash
git add components/game/DuiYunGame.tsx tests/unit/components/game/DuiYunGame.test.tsx
git commit -m "feat(duiyun): the couplet matching game [YYYY-MM-DD HH.MM]"
```

---

## Task 5: 接线 —— `/game` 的第 7 个标签页

**Files:**
- Modify: `components/game/quest/QuestTabs.tsx`
- Test: `tests/unit/components/game/QuestTabs.test.tsx`

**Interfaces:**
- Consumes: `components/game/DuiYunGame.tsx`
- Produces: `QuestTab` union 多一个 `'duiyun'`；`?tab=duiyun` 打开这个面板

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/components/game/QuestTabs.test.tsx` 里追加（先看该文件已有的写法，追加的用例要跟它一致）：

```tsx
it('opens the 对韵消消 panel from the URL', async () => {
  // ?tab=duiyun 必须落到对韵消消面板，而不是别的面板。
  window.history.replaceState({}, '', '/game?tab=duiyun');
  render(<QuestTabs />);
  await waitFor(() => expect(screen.getByText('对韵消消')).toBeInTheDocument());
});
```

⚠️ 追加之前**先读一遍** `tests/unit/components/game/QuestTabs.test.tsx` —— 它可能已经 mock 了 `@/lib/api-duiyun` 或者有别的 setup 约定（比如 `vi.mock('@/components/game/DuiYunGame')`）。按它的既有写法来，别硬塞。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npx vitest run tests/unit/components/game/QuestTabs.test.tsx`
Expected: FAIL —— 找不到「对韵消消」这个面板

- [ ] **Step 3: 改 `components/game/quest/QuestTabs.tsx`**

三处：

1. import：
```tsx
import { DuiYunGame } from '@/components/game/DuiYunGame';
```

2. union 与标签表：
```tsx
export type QuestTab = 'quest' | 'daily' | 'catch' | 'idiom' | 'duiyun' | 'collection' | 'wrong';
```
```tsx
const TABS: TabSpec[] = [
  { id: 'quest', label: '闯关' },
  { id: 'daily', label: '每日一局' },
  { id: 'catch', label: '接字' },
  { id: 'idiom', label: '成语' },
  { id: 'duiyun', label: '对韵' },
  { id: 'collection', label: '字卡册' },
  { id: 'wrong', label: '生字本' },
];
```

3. 面板分支（在 `tabs.tab === 'idiom'` 那一段之后）：
```tsx
) : tabs.tab === 'duiyun' ? (
  <DuiYunGame />
) : tabs.tab === 'collection' ? (
```

⚠️ 文件里那句「The six flat panels of the game page.」的注释要改成「The seven flat panels of the game page.」。

- [ ] **Step 4: 跑测试，确认它通过**

Run: `npx vitest run tests/unit/components/game/QuestTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量测试**

Run: `npx vitest run`
Expected: 全绿。**有失败就报出来，不要跳过。**

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（干净）

- [ ] **Step 7: 构建**

⚠️ **先确认 4444 端口的 dev server 是否在跑** —— dev server 存活时 build 会踩坏它的构建缓存（见仓库记忆 `dev-build-cache-stomp`）。

```bash
netstat -ano | findstr :4444
```

如果有输出，先确认那是不是 dev server；是的话**先停下来**，再构建。构建完再把 dev server 起回来。

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 8: 提交**

```bash
git add components/game/quest/QuestTabs.tsx tests/unit/components/game/QuestTabs.test.tsx
git commit -m "feat(game): put the couplet matching game on the game page [YYYY-MM-DD HH.MM]"
```

---

## Task 6: 收尾 —— 体检、文档、记忆

**Files:**
- Modify: `.superpowers/sdd/2026-11-20-duiyun-match-game/progress.md`（台账）
- Create: `data/duiyun-pairs.json` 的说明（可选：`data/README.md` 若已存在则追加一段）

- [ ] **Step 1: 跑体检**

Run: `npx tsx --env-file-if-exists=.env scripts/audit-gaps.ts`
Expected: 每一节都是 `(none)`

⚠️ 体检脚本的排除路径有过「路径不是相对树根」的坑（见仓库记忆 `exclusion-rules-must-be-tree-relative`）。如果它报出一堆假阳性，先查排除规则，别急着改数据。

- [ ] **Step 2: 核对数据文件与登记**

Run:
```bash
python -c "
import json,sys
sys.stdout.reconfigure(encoding='utf-8')
d=json.load(open('data/duiyun-pairs.json',encoding='utf-8'))
print('pairs:', len(d))
import collections
print('by book:', collections.Counter(x['book'] for x in d))
print('by rhyme:', len(set(x['rhyme'] for x in d)))
print('by side length:', collections.Counter(len(x['upper']) for x in d))
"
```
Expected: 761 对、两个书名都出现、30 个韵部、1 字与 2 字两种长度都有。

- [ ] **Step 3: 写台账**

在 `.superpowers/sdd/2026-11-20-duiyun-match-game/progress.md` 记录每个任务的一行完成记录，以及本次的三条裁决：

```
Task N: complete (commits <base7>..<head7>, tests: <command> → <result>)

Ruling: 语料只取「平仄逐位相反」的那些对句，舍弃 63 对宽对 ——
        宽对的平仄有一处相同，自动判定会出错，教给玩家就是错的 ——
        代价：语料从 275 片降到 761 对（去重后），一局 1 对能玩 700 多局不重样。
Ruling: 「对」字永远不挖 ——
        它是上下句共用的铰链，挖掉它两边都读不成句 ——
        代价：可挖的位置少了一到两个。
Ruling: 干扰字从语料里挑同声母/同韵母的字 ——
        干扰字要好认，否则玩家只是在乱猜而不是在看 ——
        代价：早期几局可能看到同一个字当两次干扰字（可以接受）。
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "docs(duiyun): note the couplet game in the ledger [YYYY-MM-DD HH.MM]"
```

---

## Review Focus（评审时专门盯的六类输入）

这几条是规格暗示、但任何单个任务的测试都不会覆盖的输入。评审时逐条看。

| # | 输入 / 情况 | 合理的期望 |
|---|---|---|
| 1 | 玩家的浏览器在 4444 上开着 dev server，然后有人跑了 `npm run build` | dev 的构建缓存被踩坏，页面报错。**构建前必须先停 dev server。** |
| 2 | 语料里有一副对句的两边长度不一样（`月殿对天中`） | 它不能进数据 —— 一边 2 字一边 3 字没法一一对应。 |
| 3 | 一副对句里有一字是轻声（`de`） | 轻声没有平仄，不能判对 —— 整副要丢掉。 |
| 4 | 玩家把干扰字拖进空格 | 拒绝，槽位不变，提示「这个字放错了地方」，并且那一格还能再放。 |
| 5 | 玩家填对了最后一格 | 立刻进「拼对了」的面板，播通关音效，**不是**等玩家再点一下。 |
| 6 | `data/duiyun-pairs.json` 没生成（新人 clone 完直接跑） | 界面说「还没有对韵数据，请先运行数据抽取脚本」，不是白屏也不是 500。 |

---

## 完成契约

- [ ] 每个任务的红灯都亲眼看过（先失败、再通过）。
- [ ] 变异验证做过，**每个变异都真的变红了**。
- [ ] `npx vitest run` 全绿。
- [ ] `npx tsc --noEmit` 干净。
- [ ] `npm run build` 通过（且 dev server 已停 / 已起回）。
- [ ] `npx tsx scripts/audit-gaps.ts` 各节 `(none)`。
- [ ] `data/duiyun-pairs.json` 与 `lib/duiyun-data.ts` 读出来的数量一致。
- [ ] 台账里每条裁决都写了「代价是什么」。
- [ ] **没有 push。**
