# Char Content Per-File — 字典内容一字一文件 设计文档

**目标**: 把分散在「217 个 char-meaning 批次 + 48 个 story 批次 + DB 已存 meaning_zh」三处的字内容,统一到「每字一个 `data/content/<char>.json`」+ 1 个 manifest 的扁平形态,从零开始按轮推进 8105 字。

**架构**: 双源读取 (data/content/ 优先 + DB 回退) + 增量 import (每轮 30 字写盘 → manifest → upsert) + 新 `char_story` 表承载 `hanzi_story` 字段。

**技术栈**: Next.js 15 (App Router, RSC), TypeScript, Node `fs` 读写 JSON, MySQL (mysql2), zod (manifest 校验)。无新前端依赖。

---

## 1. 背景与目标

### 现状 (2026-06-15)

**文件层**:
- `data/char-meaning-batch-0001..0217.json` — 217 个批次,30 字/批,共 6510 条,内容 `{char, pinyin, meaning_zh}`。**已 100% 入库 (6498/6498)**,批次元数据是历史产物。
- `data/story-batch-0000..0047.json` — 48 个批次,30 字/批 (0000 含 3 字),共 1413 唯一字,内容 `{char, pinyin, meaning, story}`。**未入库**,在 DB 里没有对应表。1413 字全部在 CJK Ext A (U+3400–U+4DBF),即 level 3 罕用字。
- `data/etymology-batch-0001..0003.json` — memory 记录 90 字,**磁盘不存在** (data/etymology/ 是空目录)。内容 `{char, pinyin, story}`。
- `data/content/` — 刚建好的空目录,本次设计的目标落点。

**DB 层**:
- `chars.meaning_zh` — 6498/6498 level 1+2 字,1.0 满。
- `char_etymology.story` — 0/6498 (90 字源内容丢失)。
- `char_story` — **表不存在**。

**生成节奏** (来自 bulk-content-generation-pattern memory):
- 30 字/轮 → 写 JSON → 用户 `/compact` → 继续。
- 入库放在所有批次写完后。

### 目标

1. **统一文件形态** — 全部 8105 字用 `data/content/<char>.json` 一个文件 + 一个 key 表达。字段按需存在,不强求统一 schema。
2. **从零启动** — 删 217 + 48 个旧批次文件,不再做迁移,所有字段从 0 开始推。DB 已有 6498 meaning_zh 保留 (运行时不挂),但 data/content/ 初始为空。
3. **进度可视化** — 1 个 `data/content-manifest.json` 记录各字段覆盖率,每轮重算。
4. **增量入库** — 修订原 memory 的「写完再 import」:每轮 30 字写盘后立即 import,这样能在写 ~30 字时就能在站点看到效果。
5. **新表 `char_story`** — 承载 `hanzi_story` 字段,跟 `char_etymology` 同结构 (除 era_*_has)。

### 不做 (YAGNI)

- 不做迁移脚本 (从零开始,旧批次直接 git rm)。
- 不做 per-char 写入的原子性 (git commit 失败回滚) — JSON 文件是中间产物,失败就重跑。
- 不做 LLM 生成 (本设计是手写节奏,跟之前一致)。
- 不重做 meaning_zh — DB 已有 6498/6498,运行时读路径回退即可。
- 不做 char_etymology 字段扩展 (era_*_has, generated_by 等) — 沿用现有 DDL。
- 不做 git-lfs 或 sparse-checkout — 先按 8000+ 文件正常提交观察。

---

## 2. 架构

### 2.1 文件布局

```
data/
├── content/                          [NEW] 每字一文件,8105 个
│   ├── 一.json
│   ├── 丁.json
│   ├── 㐀.json                       (Ext A 罕用字,同目录)
│   └── ...
├── content-manifest.json             [NEW] 字段覆盖率跟踪
├── general-standard-chinese-characters.json   [已有] 8105 字符号源
└── _archive/                         [可选] 旧批次不进 git,直接 git rm
```

### 2.2 读路径

```
UI 请求 getContent('一')
    │
    ▼
lib/content.ts::getContent(char)
    │
    ├── 1. 读 data/content/<char>.json
    │     - 存在 → 解析返回 { char, pinyin, meaning_zh?, etymology_story?, hanzi_story? }
    │
    └── 2. 不存在 → 读 DB 三表
          - chars         WHERE char=?     → pinyin, meaning_zh
          - char_etymology WHERE char=?    → story (映射到 etymology_story)
          - char_story    WHERE char=?     → story (映射到 hanzi_story)
          - 全部空 → null
```

`getContentList(filter)` 批量接口:先扫 `data/content/` 建索引,缺失的回退到 DB (单条 SQL `WHERE char IN (...)`)。

### 2.3 写路径 (每轮)

```
Round N (30 chars):
  1. 选 30 字 (按 §3.2 选题顺序)
  2. 对每个 char:
     a. 读 data/content/<char>.json (可能不存在)
     b. 写新内容到对应字段
     c. 已存在字段保留,新字段 merge
     d. 写回 data/content/<char>.json
  3. 跑 scripts/update-content-manifest.ts → 重算 byField
  4. 跑 scripts/import-content.ts → 增量 upsert 到 DB
  5. console 输出「本轮: N 字, 字段: meaning_zh x/hanzi_story y/etymology_story z」+「可 /compact」
```

### 2.4 删文件 (一次性)

```
git rm data/char-meaning-batch-*.json  (217 个)
git rm data/story-batch-*.json         (48 个)
git commit -m "chore(data): remove legacy batch files (migrated to per-char content)"
```

无归档,无备份。后续如果需要,可以从 git log 找回。

---

## 3. 数据模型

### 3.1 JSON Schema

每个 `data/content/<char>.json` 是单个对象,字段按需存在:

```typescript
// scripts/schemas/content.ts (新,仅供 zod 校验)
const CharContentSchema = z.object({
  char:           z.string().length(1),
  pinyin:         z.string().min(1),
  meaning_zh:     z.string().min(1).optional(),
  etymology_story:z.string().min(140).max(220).optional(),   // 仅基本字,140-180 汉字
  hanzi_story:    z.string().min(15).max(80).optional(),     // 异体字,30-50 汉字
});
```

**字段填法约定**:
| 字段 | 适用字符 | 长度 | 来源 |
|---|---|---|---|
| `char` | 全部 | 1 字符 | 必有 |
| `pinyin` | 全部 | 拼音字符串 | 必有 |
| `meaning_zh` | 全部 8105 | ~30-50 字 | 跟 char-meaning 旧批次一致 (《说文》+ 引申) |
| `etymology_story` | 仅基本字 6498 | 140-180 字 | 跟 etymology 旧批次一致 (甲骨文→楷书演变) |
| `hanzi_story` | 仅异体字 1413 | 30-50 字 | 跟 story 旧批次一致 (出处 + 用途) |

字段不写 = 没生成。**禁止存 `null` 噪声字段**。

### 3.2 Manifest Schema

`data/content-manifest.json`:

```typescript
const ContentManifestSchema = z.object({
  version:     z.literal(1),
  totalChars:  z.literal(8105),
  byField: z.object({
    meaning_zh:      z.number().int().min(0).max(8105),
    etymology_story: z.number().int().min(0).max(6498),
    hanzi_story:     z.number().int().min(0).max(1607),
  }),
  generatedAt: z.string().datetime(),
});
```

`update-content-manifest.ts` 流程:
1. 扫 `data/content/*.json` (一次 `fs.readdir`)
2. 对每个文件解析,按字段存在性计数
3. 写回 manifest,`generatedAt = new Date().toISOString()`

### 3.3 选题顺序

每轮 30 字,从缺口最大的字段开始:

```
1. meaning_zh 缺口 = 8105 - (data/content/ 有 meaning_zh 的数 + DB 已有 meaning_zh 的数)
2. hanzi_story 缺口 = 1607 - (data/content/ 有 hanzi_story 的数)   [仅异体字范围]
3. etymology_story 缺口 = 6498 - (data/content/ 有 etymology_story 的数) [仅基本字范围]
```

**同字段内**:
- 优先 level 1 (3500) > level 2 (3000) > level 3 (1605)
- 优先没在任何已写批次的字
- 跳过 8105 字符号源外的字

**辅助脚本** `scripts/select-next-chars.ts` 输出下一轮 30 字,人工/Claude 据此生成。

### 3.4 DB 表

#### `chars` (已有,不动)
- `meaning_zh` 列已 100% 满,本设计不再写入新值
- 运行时读路径回退到该列

#### `char_etymology` (已有,不动)
- 沿用现有 DDL (5 个 era_*_has + story + generated_by/at)
- import 时新行 `era_*_has` 全部默认 0,story 来自 data/content/

#### `char_story` (新)
```sql
CREATE TABLE char_story (
  char         CHAR(1)     NOT NULL,
  story        TEXT        NOT NULL,
  generated_by VARCHAR(32) DEFAULT 'claude-handwritten',
  generated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (char)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

跟 `char_etymology` 对称,但不需要 era 字段。

---

## 4. 组件与代码

### 4.1 新文件清单

```
lib/content.ts                              # getContent / getContentList (双源)
scripts/schemas/content.ts                  # zod schemas
scripts/select-next-chars.ts                # 输出下一轮 30 字选题
scripts/update-content-manifest.ts          # 重算 manifest
scripts/import-content.ts                   # 扫 data/content/ upsert 到 DB
scripts/migrate-ddl-char-story.ts           # 创建 char_story 表 (一次性)
data/content/<char>.json × 8105             # 用户手写
data/content-manifest.json                  # 脚本维护
```

### 4.2 读路径 (lib/content.ts)

```typescript
// 伪代码,实际写时再细化
export async function getContent(char: string): Promise<CharContent | null> {
  // 1. data/content/
  const filePath = path.join('data/content', `${char}.json`);
  if (fs.existsSync(filePath)) {
    return CharContentSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }
  // 2. DB 回退
  return await getContentFromDb(char);
}

async function getContentFromDb(char: string): Promise<CharContent | null> {
  const [charRow] = await db.query('SELECT pinyin, meaning_zh FROM chars WHERE char = ?', [char]);
  if (!charRow) return null;
  const [etym] = await db.query('SELECT story FROM char_etymology WHERE char = ?', [char]);
  const [story] = await db.query('SELECT story FROM char_story WHERE char = ?', [char]);
  return {
    char,
    pinyin: charRow.pinyin,
    meaning_zh: charRow.meaning_zh ?? undefined,
    etymology_story: etym?.story ?? undefined,
    hanzi_story: story?.story ?? undefined,
  };
}
```

### 4.3 import 脚本 (scripts/import-content.ts)

```
对 data/content/<char>.json:
  - 读文件 → 解析
  - 如果有 meaning_zh:
    UPDATE chars SET meaning_zh=? WHERE char=? AND meaning_zh IS NULL
    (不覆盖已有值,避免清空 6498 个已写好的)
  - 如果有 etymology_story:
    INSERT INTO char_etymology (char, story, era_jiaguwen_has, ...) VALUES (...)
    ON DUPLICATE KEY UPDATE story=VALUES(story)
  - 如果有 hanzi_story:
    INSERT INTO char_story (char, story) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE story=VALUES(story)
```

**幂等**: 重跑 import 不会产生副作用。

### 4.4 错误处理

- 写 JSON 时 fs 失败 → 抛错中断本轮 (人工重跑)
- import 时 DB 失败 → console.error,继续下一个 char,不中断
- manifest 字段不匹配 zod → console.error 并跳过该文件 (不阻断 manifest 重算)
- `<char>` 含 Windows 保留字符 (`< > : " | ? * \ /`) → 写文件前 zod 校验,失败抛错

### 4.5 测试

#### Unit (`tests/unit/lib/content.test.ts`)
- `getContent('一')` 在有文件时返回文件内容
- `getContent('一')` 在无文件 + DB 有 chars 行时回退
- `getContent('一')` 在无文件 + DB 无 chars 行时返回 null
- `getContentList({level: 1})` 优先返回文件列表,缺失回退 DB

#### Integration (`tests/integration/scripts/import-content.test.ts`)
- 写 5 个测试 JSON 到 `data/content/`
- 跑 import 脚本 (spawn)
- 验证 DB 三表对应行落库
- 验证 manifest 计数 = 5

#### Smoke (人工)
- 浏览器访问 `/dictionary/一` 显示 meaning_zh (DB 回退)
- 访问 `/dictionary/严` (刚生成) 显示新 meaning_zh (data/content/)
- 访问 `/etymology/严` (刚生成) 显示 etymology_story
- 访问 `/story/㐀` (刚生成) 显示 hanzi_story (前提是路由存在;否则先不验证)

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 8000+ 文件 git status 慢 | 先按原样跑,接受慢;真不可接受再上 git-lfs |
| Windows 中文文件名 git 乱码 | 第一轮 commit 1-2 个测试文件,验证 `git log` / `git status` 正常 |
| mysql2 supp-plane 乱码 (memory 已知) | 8105 都在 BMP,不涉及;但 scripts/import-content.ts 仍按 BMP-only 写,只导入 BMP 字 |
| 数据回退不一致 (data/content/ 有 hanzi_story, DB char_etymology 有 etymology_story) | getContent 三表都查,合并返回;UI 端按字段显示 |
| 旧批次删后找不回 | git log 即可,本设计 §2.4 直接 git rm 不备份 |
| 90 字源丢失无法恢复 | 已知,按 §3.3 选题顺序在后续轮次自然补回 |

---

## 6. 执行顺序 (Phase)

| Phase | 内容 | 验证 |
|---|---|---|
| **P1: 删旧文件** | git rm 217 + 48 批次 | `ls data/*.json` 仅剩通用/部首/pinyin-hanzi/manifest 等基础文件 |
| **P2: 写 DDL** | `scripts/migrate-ddl-char-story.ts` 跑一次 | `SHOW TABLES LIKE 'char_story'` 存在 |
| **P3: 写 lib + scripts** | lib/content.ts + 4 个 scripts + zod schemas | `pnpm tsc` 通过;unit tests pass |
| **P4: 跑迁移脚本** | 首次跑 `update-content-manifest.ts` 写空 manifest | `data/content-manifest.json` 存在,byField 全 0 |
| **P5: Round 1** | 选 30 字手写 30 个 .json + manifest + import | 浏览器看站点可见 |
| **P6+: 持续** | 每轮 30 字,直到 8105 × 3 字段全满 | manifest byField 全达 max |

---

## 7. 关键代码引用

- 旧批次位置: `data/char-meaning-batch-*.json` (217), `data/story-batch-*.json` (48) — 本设计删除
- 8105 字符号源: `data/general-standard-chinese-characters.json`
- DB schema: `lib/etymology.ts::getEtymology` (char_etymology 读路径参照)
- Manifest 模式参照: `data/strokes-manifest.json` (Plan M 笔画进度)
- 批量节奏 memory: `bulk-content-generation-pattern.md` (本设计修订 import 节奏为「每轮 import」)
