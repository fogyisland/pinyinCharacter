# Char Content Per-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 8105 字的字典内容 (meaning_zh / etymology_story / hanzi_story) 统一到 `data/content/<char>.json` 单字文件 + 1 个 manifest,双源读取 (data/content/ 优先 + DB 回退),每轮 30 字增量 import。

**Architecture:** 一字一文件 (字段按需存在) + 内容清单 manifest + 双源读路径 (lib/content.ts) + 增量 import 脚本 (data/content/ → DB 三表) + 新表 `char_story` 承载 hanzi_story。

**Tech Stack:** Next.js 15, TypeScript, Node `fs/promises`, MySQL (mysql2/promise), zod 4, vitest.

---

## File Structure

**Create**:
- `lib/content.ts` — 双源读: getContent(char) → file-or-DB
- `lib/content-types.ts` — CharContent interface
- `scripts/schemas/content.ts` — zod schemas
- `scripts/select-next-chars.ts` — 选题 30 字 CLI
- `scripts/update-content-manifest.ts` — 扫 data/content/ 重算 manifest
- `scripts/import-content.ts` — 扫 data/content/ upsert 到 DB
- `data/content-manifest.json` — 覆盖率清单 (脚本生成)
- `data/content/<char>.json` × 30 — Round 1 30 字
- `tests/unit/lib/content.test.ts` — getContent 单元测试
- `tests/unit/scripts/schemas/content.test.ts` — zod 测试
- `tests/unit/scripts/select-next-chars.test.ts` — 选题测试
- `tests/unit/scripts/update-content-manifest.test.ts` — manifest 测试
- `tests/integration/scripts/import-content.test.ts` — import 集成测试
- `scripts/import-content.test.ts` — import 解析逻辑 (mock DB) 测试

**Modify**:
- `scripts/init-db.ts` — 加 char_story DDL (idempotent)

**Delete**:
- `data/char-meaning-batch-0001..0217.json` (217 个)
- `data/story-batch-0000..0047.json` (48 个)
- `data/etymology/` (空目录)

---

## Phase 1: 删除旧批次

### Task 1: git rm 217 + 48 旧批次 + 1 个空目录

**Files:**
- Delete: `data/char-meaning-batch-*.json` (217 个)
- Delete: `data/story-batch-*.json` (48 个)
- Delete: `data/etymology/` (空目录)

- [ ] **Step 1: 用 git rm 删除批次文件**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
git rm data/char-meaning-batch-*.json
git rm data/story-batch-*.json
rmdir data/etymology
```

- [ ] **Step 2: 验证 data/ 目录干净**

```bash
ls data/*.json data/content-manifest.json 2>&1 | head -20
```

预期: 仅剩 `bad-words.json` / `bigrams.json` / `general-standard-chinese-characters.json` / `pinyin-hanzi.json` / `radicals.json` / `rare-chars-level3.json` / `strokes-manifest.json` 这几个基础文件,**没有** char-meaning-batch / story-batch 文件。

- [ ] **Step 3: 提交删除**

```bash
git add -u
git status --short  # 应该看到 ~265 个 D 行
git commit -m "chore(data): remove legacy batch files (per-char content takes over)"
```

预期: commit 成功,工作区干净。

---

## Phase 2: DDL (新增 char_story 表)

### Task 2: 给 scripts/init-db.ts 加 char_story 表

**Files:**
- Modify: `scripts/init-db.ts:48` (在 char_etymology 之后插入新表 DDL)

- [ ] **Step 1: 写测试 — initDb 应创建 char_story 表**

新增文件 `tests/integration/scripts/init-db-char-story.test.ts`:

```typescript
import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

integrationDescribe('initDb char_story', () => {
  it('creates char_story table with expected columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'char_story'
       ORDER BY ORDINAL_POSITION`
    );
    const cols = rows.map(r => r.COLUMN_NAME);
    expect(cols).toContain('char');
    expect(cols).toContain('story');
    expect(cols).toContain('generated_by');
    expect(cols).toContain('generated_at');
  });
});
```

- [ ] **Step 2: 跑测试,看到 skip (无 DB 是预期)**

```bash
pnpm test tests/integration/scripts/init-db-char-story.test.ts
```

预期: `it.skip` 通过(没有 DATABASE_URL_TEST),或 `it` 通过(有 DB 但表不存在 → FAIL)。本步骤目的是确认测试文件能加载。

- [ ] **Step 3: 在 scripts/init-db.ts DDL 数组中加 char_story**

打开 `scripts/init-db.ts`,在 `char_etymology` DDL 之后 (第 47 行后) 插入:

```sql
`CREATE TABLE IF NOT EXISTS char_story (
   \`char\` VARCHAR(4) NOT NULL,
   story TEXT NOT NULL,
   generated_by VARCHAR(64) NULL DEFAULT 'claude-handwritten',
   generated_at TIMESTAMP NULL,
   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   PRIMARY KEY (\`char\`)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
```

完整 DDL 数组,跟现有 `char_etymology` 对称,但**不**需要 era 字段。

- [ ] **Step 4: 跑 init-db 验证表已建 (有 DB 时)**

```bash
node --env-file=.env -e "import('./scripts/init-db.ts').then(m => m.initDb()).then(() => process.exit(0))"
```

或 (无 ESM 包装时):

```bash
tsx --env-file=.env -e "import('./scripts/init-db').then(m => m.initDb())"
```

预期: 没有报错。验证:
```bash
node --env-file=.env -e "
  import('mysql2/promise').then(async ({default: mysql}) => {
    const c = await mysql.createConnection(process.env.DATABASE_URL);
    const [r] = await c.query(\"SHOW TABLES LIKE 'char_story'\");
    console.log(r);
    await c.end();
  })
"
```

预期输出: `[ { 'Tables in ... (char_story)': 'char_story' } ]` (有 DB) 或 `TypeError: Cannot read properties of undefined` (无 DB 跳过)。

- [ ] **Step 5: 跑测试,验证 PASS (有 DB 时)**

```bash
pnpm test tests/integration/scripts/init-db-char-story.test.ts
```

预期: `it` 通过 (有 DB) 或 `it.skip` (无 DB,正常跳过)。

- [ ] **Step 6: 提交**

```bash
git add scripts/init-db.ts tests/integration/scripts/init-db-char-story.test.ts
git commit -m "feat(db): add char_story table for per-char content (DDL only, no data)"
```

---

## Phase 3: lib + scripts 基础设施

### Task 3: zod schemas (scripts/schemas/content.ts)

**Files:**
- Create: `scripts/schemas/content.ts`
- Create: `tests/unit/scripts/schemas/content.test.ts`

- [ ] **Step 1: 写测试**

`tests/unit/scripts/schemas/content.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CharContentSchema, ContentManifestSchema } from '@/scripts/schemas/content';

describe('CharContentSchema', () => {
  it('accepts minimal valid (char + pinyin only)', () => {
    const r = CharContentSchema.parse({ char: '一', pinyin: 'yī' });
    expect(r.char).toBe('一');
    expect(r.pinyin).toBe('yī');
    expect(r.meaning_zh).toBeUndefined();
  });

  it('accepts full char with all fields', () => {
    const r = CharContentSchema.parse({
      char: '一',
      pinyin: 'yī',
      meaning_zh: '一,数之始也',
      etymology_story: '甲骨文作一,象形。横画也,至楷书定形。'.repeat(3), // ~140 字
      hanzi_story: '《说文》载,一,数之始。',
    });
    expect(r.meaning_zh).toContain('数之始');
  });

  it('rejects multi-char char field', () => {
    expect(() => CharContentSchema.parse({ char: '丁七', pinyin: 'dīng' })).toThrow();
  });

  it('rejects etymology_story too short', () => {
    expect(() => CharContentSchema.parse({
      char: '一', pinyin: 'yī', etymology_story: '短'
    })).toThrow();
  });

  it('rejects hanzi_story too long', () => {
    expect(() => CharContentSchema.parse({
      char: '一', pinyin: 'yī', hanzi_story: 'x'.repeat(81)
    })).toThrow();
  });
});

describe('ContentManifestSchema', () => {
  it('accepts initial all-zero manifest', () => {
    const r = ContentManifestSchema.parse({
      version: 1, totalChars: 8105,
      byField: { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 },
      generatedAt: '2026-06-15T10:00:00.000Z',
    });
    expect(r.totalChars).toBe(8105);
  });

  it('rejects wrong version', () => {
    expect(() => ContentManifestSchema.parse({
      version: 2, totalChars: 8105,
      byField: { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 },
      generatedAt: '2026-06-15T10:00:00.000Z',
    })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试,看到 FAIL**

```bash
pnpm test tests/unit/scripts/schemas/content.test.ts
```

预期: FAIL with "Cannot find module '@/scripts/schemas/content'"

- [ ] **Step 3: 写实现**

`scripts/schemas/content.ts`:

```typescript
import { z } from 'zod';

export const CharContentSchema = z.object({
  char: z.string().length(1),
  pinyin: z.string().min(1),
  meaning_zh: z.string().min(1).optional(),
  etymology_story: z.string().min(140).max(220).optional(),
  hanzi_story: z.string().min(15).max(80).optional(),
});

export type CharContent = z.infer<typeof CharContentSchema>;

export const ContentManifestSchema = z.object({
  version: z.literal(1),
  totalChars: z.literal(8105),
  byField: z.object({
    meaning_zh: z.number().int().min(0).max(8105),
    etymology_story: z.number().int().min(0).max(6498),
    hanzi_story: z.number().int().min(0).max(1607),
  }),
  generatedAt: z.string().datetime(),
});

export type ContentManifest = z.infer<typeof ContentManifestSchema>;
```

- [ ] **Step 4: 跑测试,验证 PASS**

```bash
pnpm test tests/unit/scripts/schemas/content.test.ts
```

预期: 7/7 PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/schemas/content.ts tests/unit/scripts/schemas/content.test.ts
git commit -m "feat(content): zod schemas for CharContent + ContentManifest"
```

---

### Task 4: lib/content.ts getContent (双源读路径)

**Files:**
- Create: `lib/content-types.ts`
- Create: `lib/content.ts`
- Create: `tests/unit/lib/content.test.ts`

- [ ] **Step 1: 写 types**

`lib/content-types.ts`:

```typescript
export interface CharContentFile {
  char: string;
  pinyin: string;
  meaning_zh?: string;
  etymology_story?: string;
  hanzi_story?: string;
}

export interface GetContentOptions {
  /** 强制跳过文件层,只读 DB (用于测试 + admin) */
  dbOnly?: boolean;
}
```

- [ ] **Step 2: 写测试 (mocked DB + mock fs)**

`tests/unit/lib/content.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { getContent } from '@/lib/content';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery });

describe('getContent', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    mockedQuery.mockReset();
  });

  it('returns from file when data/content/<char>.json exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始也。',
    }));

    const result = await getContent('一');
    expect(result).toEqual({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始也。',
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('falls back to DB when file missing, returns merged 3-table data', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery
      .mockResolvedValueOnce([[{ pinyin: 'yī', meaning_zh: '一,数之始。' }]]) // chars
      .mockResolvedValueOnce([[{ story: '甲骨文作一...' }]])                  // char_etymology
      .mockResolvedValueOnce([[]])                                            // char_story (no row)

    const result = await getContent('一');
    expect(result?.char).toBe('一');
    expect(result?.pinyin).toBe('yī');
    expect(result?.meaning_zh).toBe('一,数之始。');
    expect(result?.etymology_story).toBe('甲骨文作一...');
    expect(result?.hanzi_story).toBeUndefined();
  });

  it('returns null when no file + DB has no chars row', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery.mockResolvedValueOnce([[]]);  // chars miss

    const result = await getContent('䨺');
    expect(result).toBeNull();
  });

  it('handles null meaning_zh from DB (preserve as undefined)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockedQuery
      .mockResolvedValueOnce([[{ pinyin: 'yī', meaning_zh: null }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])

    const result = await getContent('一');
    expect(result?.meaning_zh).toBeUndefined();
  });
});
```

- [ ] **Step 3: 跑测试,看到 FAIL**

```bash
pnpm test tests/unit/lib/content.test.ts
```

预期: FAIL with "Cannot find module '@/lib/content'"

- [ ] **Step 4: 写实现**

`lib/content.ts`:

```typescript
import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';
import { CharContentSchema } from '@/scripts/schemas/content';
import type { CharContentFile, GetContentOptions } from './content-types';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

export async function getContent(
  char: string,
  opts: GetContentOptions = {}
): Promise<CharContentFile | null> {
  // 1. 读文件 (除非 dbOnly)
  if (!opts.dbOnly) {
    const filePath = join(CONTENT_DIR, `${char}.json`);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return CharContentSchema.parse(raw);
    }
  }

  // 2. DB 回退: 三表合并
  const pool = getPool();
  const [charRows] = await pool.query<any[]>(
    `SELECT pinyin, meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (charRows.length === 0) return null;

  const [etymRows] = await pool.query<any[]>(
    `SELECT story FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  const [storyRows] = await pool.query<any[]>(
    `SELECT story FROM char_story WHERE \`char\` = ? LIMIT 1`,
    [char]
  );

  const c = charRows[0];
  return {
    char,
    pinyin: c.pinyin ?? '',
    meaning_zh: c.meaning_zh ?? undefined,
    etymology_story: etymRows[0]?.story ?? undefined,
    hanzi_story: storyRows[0]?.story ?? undefined,
  };
}
```

- [ ] **Step 5: 跑测试,验证 PASS**

```bash
pnpm test tests/unit/lib/content.test.ts
```

预期: 4/4 PASS

- [ ] **Step 6: 提交**

```bash
git add lib/content.ts lib/content-types.ts tests/unit/lib/content.test.ts
git commit -m "feat(content): getContent with file-first + DB-fallback read path"
```

---

### Task 5: scripts/select-next-chars.ts (选题 30 字)

**Files:**
- Create: `scripts/select-next-chars.ts`
- Create: `scripts/select-next-chars.test.ts`

- [ ] **Step 1: 写测试 (mock fs readFileSync + mock DB)**

`scripts/select-next-chars.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

vi.mock('@/lib/db', () => ({ getPool: vi.fn() }));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { selectNextChars } from './select-next-chars';

const mockedQuery = vi.fn();
(getPool as any).mockReturnValue({ query: mockedQuery });

describe('selectNextChars', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(existsSync).mockReset();
    mockedQuery.mockReset();
  });

  it('returns 30 chars from chars table when nothing in data/content/', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    // First: count meaning_zh in DB → 6498 (all done)
    mockedQuery.mockResolvedValueOnce([[{ n: 6498 }]]);
    // Then: list 30 chars (any) for hanzi_story gap
    mockedQuery.mockResolvedValueOnce([[
      { char: '龘' }, { char: '䨺' }, { char: '䨻' },
    ].concat(Array.from({ length: 27 }, (_, i) => ({ char: String.fromCodePoint(0x3400 + i) })))]);

    const result = await selectNextChars(30);
    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({ char: '龘', fieldsToFill: ['hanzi_story'] });
  });

  it('excludes chars already with full data in data/content/', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue(['一.json', '丁.json'] as any);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī', meaning_zh: 'x', etymology_story: 'y'.repeat(150), hanzi_story: 'z'.repeat(20) });
      if (String(p).endsWith('丁.json')) return JSON.stringify({ char: '丁', pinyin: 'dīng', meaning_zh: 'x' });
      return '{}';
    });
    // meaning_zh: DB has 6498, files have 2 → gap = 0 → skip to next field
    mockedQuery
      .mockResolvedValueOnce([[{ n: 6498 }]])           // meaning_zh count
      .mockResolvedValueOnce([[]])                       // hanzi_story chars (none)
      .mockResolvedValueOnce([[                          // etymology_story chars (skip 一 which has it)
        { char: '七' }, { char: '万' },
      ].concat(Array.from({ length: 28 }, (_, i) => ({ char: String.fromCodePoint(0x3400 + i) })))]);

    const result = await selectNextChars(30);
    expect(result.length).toBeLessThanOrEqual(30);
    // 一 should NOT appear (has etymology_story)
    expect(result.find(r => r.char === '一')).toBeUndefined();
  });

  it('returns empty array when all 3 fields fully covered', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
    mockedQuery
      .mockResolvedValueOnce([[{ n: 8105 }]])  // meaning_zh all
      .mockResolvedValueOnce([[]])             // hanzi_story all
      .mockResolvedValueOnce([[]]);            // etymology_story all

    const result = await selectNextChars(30);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试,看到 FAIL**

```bash
pnpm test scripts/select-next-chars.test.ts
```

预期: FAIL "Cannot find module"

- [ ] **Step 3: 写实现**

`scripts/select-next-chars.ts`:

```typescript
/**
 * 选题: 输出下一轮 30 字 + 每字该填的字段。
 * 选题顺序: meaning_zh 缺口 → hanzi_story 缺口 → etymology_story 缺口
 * 同字段内: 优先 level 1 → 2 → 3, 优先 data/content/ 没有该字段的
 *
 * Run: pnpm tsx scripts/select-next-chars.ts
 * 输出: 30 行 JSON, 例: {"char": "严", "fieldsToFill": ["meaning_zh"]}
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { CharContentSchema } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const ROUND_SIZE = 30;

export interface CharToFill {
  char: string;
  fieldsToFill: Array<'meaning_zh' | 'etymology_story' | 'hanzi_story'>;
}

interface ExistingFile {
  meaning_zh: boolean;
  etymology_story: boolean;
  hanzi_story: boolean;
}

function scanContentDir(): Map<string, ExistingFile> {
  const result = new Map<string, ExistingFile>();
  if (!existsSync(CONTENT_DIR)) return result;
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const char = f.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      result.set(char, {
        meaning_zh: parsed.meaning_zh !== undefined,
        etymology_story: parsed.etymology_story !== undefined,
        hanzi_story: parsed.hanzi_story !== undefined,
      });
    } catch {
      // skip invalid files
    }
  }
  return result;
}

async function listCharsMissing(
  pool: any,
  field: 'meaning_zh' | 'etymology_story' | 'hanzi_story',
  limit: number,
  existing: Map<string, ExistingFile>
): Promise<string[]> {
  const chars: string[] = [];
  // 按 level 1 → 2 → 3 顺序查
  for (const level of [1, 2, 3] as const) {
    if (chars.length >= limit) break;
    let sql: string;
    let params: any[];
    if (field === 'meaning_zh') {
      // meaning_zh: DB 列 + 文件层 OR
      sql = `SELECT \`char\` FROM chars
             WHERE level = ? AND (meaning_zh IS NULL OR meaning_zh = '')
             ORDER BY \`char\` LIMIT ?`;
      params = [level, limit - chars.length];
    } else {
      // etymology_story / hanzi_story: chars 表里没字段, 用 char 集合
      // level 1+2 = 6498 chars; level 3 = 1607
      sql = `SELECT \`char\` FROM chars WHERE level = ? ORDER BY \`char\` LIMIT ?`;
      params = [level, limit - chars.length];
    }
    const [rows] = await pool.query<any[]>(sql, params);
    for (const r of rows) {
      const c: string = r.char;
      if (chars.includes(c)) continue;
      // 跳过已有该字段的
      if (existing.get(c)?.[field]) continue;
      chars.push(c);
      if (chars.length >= limit) break;
    }
  }
  return chars;
}

export async function selectNextChars(roundSize: number = ROUND_SIZE): Promise<CharToFill[]> {
  const pool = getPool();
  const existing = scanContentDir();
  const result: CharToFill[] = [];
  const seen = new Set<string>();

  // 1. meaning_zh 缺口
  const [[{ n: meaningInDb }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars WHERE meaning_zh IS NOT NULL AND meaning_zh != ''`
  );
  const meaningInFiles = [...existing.values()].filter(v => v.meaning_zh).length;
  const meaningGap = 8105 - Number(meaningInDb) - meaningInFiles;

  if (meaningGap > 0) {
    const chars = await listCharsMissing(pool, 'meaning_zh', roundSize, existing);
    for (const c of chars) {
      if (seen.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['meaning_zh'] });
      if (result.length >= roundSize) return result;
    }
  }

  // 2. hanzi_story 缺口 (仅 level 3, 1607)
  const hanziTarget = 1607;
  const hanziInFiles = [...existing.values()].filter(v => v.hanzi_story).length;
  const hanziGap = hanziTarget - hanziInFiles;

  if (hanziGap > 0) {
    const remain = roundSize - result.length;
    const chars = await listCharsMissing(pool, 'hanzi_story', remain, existing)
      .then(chars => chars.filter(c => !seen.has(c)));
    // 限制到 level 3
    const level3 = await pool.query<any[]>(
      `SELECT \`char\` FROM chars WHERE level = 3 ORDER BY \`char\` LIMIT ${hanziGap}`
    );
    const level3Set = new Set<string>((level3[0] as any[]).map(r => r.char));
    for (const c of chars) {
      if (!level3Set.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['hanzi_story'] });
      if (result.length >= roundSize) return result;
    }
  }

  // 3. etymology_story 缺口 (仅 level 1+2, 6498)
  const etymTarget = 6498;
  const etymInFiles = [...existing.values()].filter(v => v.etymology_story).length;
  const etymGap = etymTarget - etymInFiles;

  if (etymGap > 0) {
    const remain = roundSize - result.length;
    const chars = await listCharsMissing(pool, 'etymology_story', remain, existing);
    for (const c of chars) {
      if (seen.has(c)) continue;
      seen.add(c);
      result.push({ char: c, fieldsToFill: ['etymology_story'] });
      if (result.length >= roundSize) return result;
    }
  }

  return result;
}

async function main() {
  const result = await selectNextChars(ROUND_SIZE);
  for (const c of result) {
    console.log(JSON.stringify(c));
  }
  console.error(`Selected ${result.length} chars for next round.`);
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 4: 跑测试,验证 PASS**

```bash
pnpm test scripts/select-next-chars.test.ts
```

预期: 3/3 PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/select-next-chars.ts scripts/select-next-chars.test.ts
git commit -m "feat(content): selectNextChars CLI for round-by-round char selection"
```

---

### Task 6: scripts/update-content-manifest.ts

**Files:**
- Create: `scripts/update-content-manifest.ts`
- Create: `scripts/update-content-manifest.test.ts`

- [ ] **Step 1: 写测试 (mock fs)**

`scripts/update-content-manifest.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { updateContentManifest } from './update-content-manifest';

describe('updateContentManifest', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  it('writes all-zero manifest when content dir is empty', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();

    expect(manifest.byField.meaning_zh).toBe(0);
    expect(manifest.byField.etymology_story).toBe(0);
    expect(manifest.byField.hanzi_story).toBe(0);
    expect(manifest.totalChars).toBe(8105);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('content-manifest.json'),
      expect.stringContaining('"version": 1'),
      'utf8'
    );
  });

  it('counts fields across multiple files', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['一.json', '丁.json', '㐀.json'] as any);
    vi.mocked(readFileSync).mockImplementation(((p: any) => {
      const path = String(p);
      if (path.endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī', meaning_zh: 'm', etymology_story: 'e'.repeat(150) });
      if (path.endsWith('丁.json')) return JSON.stringify({ char: '丁', pinyin: 'dīng', meaning_zh: 'm' });
      if (path.endsWith('㐀.json')) return JSON.stringify({ char: '㐀', pinyin: 'x', hanzi_story: 'h'.repeat(20) });
      return '{}';
    }) as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();
    expect(manifest.byField.meaning_zh).toBe(2);
    expect(manifest.byField.etymology_story).toBe(1);
    expect(manifest.byField.hanzi_story).toBe(1);
  });

  it('skips files that fail zod parse (logs but does not throw)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['一.json', 'bad.json'] as any);
    vi.mocked(readFileSync).mockImplementation(((p: any) => {
      const path = String(p);
      if (path.endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī' });
      if (path.endsWith('bad.json')) return 'not json';
      return '{}';
    }) as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();
    expect(manifest.byField.meaning_zh).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试,看到 FAIL**

```bash
pnpm test scripts/update-content-manifest.test.ts
```

预期: FAIL

- [ ] **Step 3: 写实现**

`scripts/update-content-manifest.ts`:

```typescript
/**
 * 扫 data/content/*.json 重算 byField, 写 data/content-manifest.json。
 * Run: pnpm tsx scripts/update-content-manifest.ts
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CharContentSchema, ContentManifestSchema, type ContentManifest } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');
const MANIFEST_PATH = join(process.cwd(), 'data', 'content-manifest.json');

export async function updateContentManifest(): Promise<ContentManifest> {
  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const byField = { meaning_zh: 0, etymology_story: 0, hanzi_story: 0 };
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));

  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      if (parsed.meaning_zh) byField.meaning_zh++;
      if (parsed.etymology_story) byField.etymology_story++;
      if (parsed.hanzi_story) byField.hanzi_story++;
    } catch (err) {
      console.error(`[manifest] skip ${f}: ${(err as Error).message}`);
    }
  }

  const manifest: ContentManifest = {
    version: 1,
    totalChars: 8105,
    byField,
    generatedAt: new Date().toISOString(),
  };

  ContentManifestSchema.parse(manifest);  // sanity check
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.error(`[manifest] byField: ${JSON.stringify(byField)} → ${MANIFEST_PATH}`);

  return manifest;
}

async function main() {
  await updateContentManifest();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 4: 跑测试,验证 PASS**

```bash
pnpm test scripts/update-content-manifest.test.ts
```

预期: 3/3 PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/update-content-manifest.ts scripts/update-content-manifest.test.ts
git commit -m "feat(content): updateContentManifest scans files + writes byField counts"
```

---

### Task 7: scripts/import-content.ts (DB 增量 import)

**Files:**
- Create: `scripts/import-content.ts`
- Create: `tests/integration/scripts/import-content.test.ts`

- [ ] **Step 1: 写集成测试**

`tests/integration/scripts/import-content.test.ts`:

```typescript
import { beforeAll } from 'vitest';
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

integrationDescribe('importContent', () => {
  it('upserts meaning_zh / etymology_story / hanzi_story for given chars', async () => {
    const pool = getPool();

    // Seed chars rows (FK target)
    await pool.execute(`INSERT IGNORE INTO chars (\`char\`, level, unicode_codepoint) VALUES
      ('一', 1, 'U+4E00'), ('丁', 1, 'U+4E01'), ('㐀', 3, 'U+3400')`);

    // Write 3 test JSONs
    if (!existsSync(CONTENT_DIR)) mkdirSync(CONTENT_DIR, { recursive: true });
    writeFileSync(join(CONTENT_DIR, '一.json'), JSON.stringify({
      char: '一', pinyin: 'yī', meaning_zh: '一,数之始。',
    }));
    writeFileSync(join(CONTENT_DIR, '丁.json'), JSON.stringify({
      char: '丁', pinyin: 'dīng', etymology_story: '甲骨文作丁,象形。'.repeat(5),
    }));
    writeFileSync(join(CONTENT_DIR, '㐀.json'), JSON.stringify({
      char: '㐀', pinyin: 'x', hanzi_story: '《说文》载㐀,罕用字。',
    }));

    const { importContent } = await import('@/scripts/import-content');
    const result = await importContent();

    expect(result.scanned).toBe(3);
    expect(result.imported.meaning_zh).toContain('一');
    expect(result.imported.etymology_story).toContain('丁');
    expect(result.imported.hanzi_story).toContain('㐀');

    // Verify DB state
    const [charRows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = '一'`);
    expect(charRows[0].meaning_zh).toBe('一,数之始。');

    const [etymRows] = await pool.query<any[]>(`SELECT story FROM char_etymology WHERE \`char\` = '丁'`);
    expect(etymRows[0].story.length).toBeGreaterThan(140);

    const [storyRows] = await pool.query<any[]>(`SELECT story FROM char_story WHERE \`char\` = '㐀'`);
    expect(storyRows[0].story).toBe('《说文》载㐀,罕用字。');

    // Cleanup test files
    require('node:fs').unlinkSync(join(CONTENT_DIR, '一.json'));
    require('node:fs').unlinkSync(join(CONTENT_DIR, '丁.json'));
    require('node:fs').unlinkSync(join(CONTENT_DIR, '㐀.json'));
  });

  it('does not overwrite existing meaning_zh (DB column is sacred)', async () => {
    const pool = getPool();
    await pool.execute(`INSERT INTO chars (\`char\`, level, unicode_codepoint, meaning_zh) VALUES
      ('䲢', 3, 'U+4CA2', 'EXISTING_MEANING')
      ON DUPLICATE KEY UPDATE meaning_zh = VALUES(meaning_zh)`);

    writeFileSync(join(CONTENT_DIR, '䲢.json'), JSON.stringify({
      char: '䲢', pinyin: 'téng', meaning_zh: 'OVERWRITE_ATTEMPT',
    }));

    const { importContent } = await import('@/scripts/import-content');
    await importContent();

    const [rows] = await pool.query<any[]>(`SELECT meaning_zh FROM chars WHERE \`char\` = '䲢'`);
    expect(rows[0].meaning_zh).toBe('EXISTING_MEANING');

    require('node:fs').unlinkSync(join(CONTENT_DIR, '䲢.json'));
  });
});
```

- [ ] **Step 2: 跑测试,看到 FAIL**

```bash
pnpm test tests/integration/scripts/import-content.test.ts
```

预期: FAIL "Cannot find module"

- [ ] **Step 3: 写实现**

`scripts/import-content.ts`:

```typescript
/**
 * 扫 data/content/*.json → upsert 到 chars / char_etymology / char_story
 * 幂等; 不覆盖 chars.meaning_zh 已有值 (DB 列有 6498 个手写值, 是历史产物)
 *
 * Run: pnpm tsx scripts/import-content.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { CharContentSchema } from './schemas/content';

const CONTENT_DIR = join(process.cwd(), 'data', 'content');

export interface ImportResult {
  scanned: number;
  imported: {
    meaning_zh: string[];
    etymology_story: string[];
    hanzi_story: string[];
  };
  errors: Array<{ char: string; error: string }>;
}

export async function importContent(): Promise<ImportResult> {
  const pool = getPool();
  const result: ImportResult = {
    scanned: 0,
    imported: { meaning_zh: [], etymology_story: [], hanzi_story: [] },
    errors: [],
  };

  if (!existsSync(CONTENT_DIR)) {
    console.error(`[import] ${CONTENT_DIR} does not exist, nothing to do`);
    return result;
  }

  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));

  for (const f of files) {
    result.scanned++;
    try {
      const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf8'));
      const parsed = CharContentSchema.parse(raw);
      const char = parsed.char;

      // meaning_zh: 不覆盖已有值
      if (parsed.meaning_zh !== undefined) {
        const [r] = await pool.query<any>(
          `UPDATE chars SET meaning_zh = ?
           WHERE \`char\` = ? AND (meaning_zh IS NULL OR meaning_zh = '')`,
          [parsed.meaning_zh, char]
        );
        if (r.affectedRows > 0) result.imported.meaning_zh.push(char);
      }

      // etymology_story: 整行 upsert, era_*_has 默认 0
      if (parsed.etymology_story !== undefined) {
        await pool.query(
          `INSERT INTO char_etymology
             (\`char\`, story, era_jiaguwen_has, era_jinwen_has,
              era_xiaozhuan_has, era_lishu_has, era_kaishu_has, generated_by, generated_at)
           VALUES (?, ?, 0, 0, 0, 0, 1, 'claude-handwritten', NOW())
           ON DUPLICATE KEY UPDATE
             story = VALUES(story),
             generated_by = VALUES(generated_by),
             generated_at = VALUES(generated_at)`,
          [char, parsed.etymology_story]
        );
        result.imported.etymology_story.push(char);
      }

      // hanzi_story: 整行 upsert
      if (parsed.hanzi_story !== undefined) {
        await pool.query(
          `INSERT INTO char_story (\`char\`, story, generated_by, generated_at)
           VALUES (?, ?, 'claude-handwritten', NOW())
           ON DUPLICATE KEY UPDATE
             story = VALUES(story),
             generated_by = VALUES(generated_by),
             generated_at = VALUES(generated_at)`,
          [char, parsed.hanzi_story]
        );
        result.imported.hanzi_story.push(char);
      }
    } catch (err) {
      const msg = (err as Error).message;
      const charMatch = f.match(/^(.+)\.json$/);
      result.errors.push({ char: charMatch?.[1] ?? f, error: msg });
      console.error(`[import] skip ${f}: ${msg}`);
    }
  }

  console.error(`[import] scanned=${result.scanned} ` +
    `meaning_zh=${result.imported.meaning_zh.length} ` +
    `etymology_story=${result.imported.etymology_story.length} ` +
    `hanzi_story=${result.imported.hanzi_story.length} ` +
    `errors=${result.errors.length}`);

  return result;
}

async function main() {
  await importContent();
  await closePool();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 4: 跑测试,验证 PASS (有 DB 时)**

```bash
pnpm test tests/integration/scripts/import-content.test.ts
```

预期: 2/2 PASS (有 DB) 或 skip (无 DB)

- [ ] **Step 5: 跑 tsc 全量检查**

```bash
pnpm tsc --noEmit
```

预期: 0 错 (lib/content.ts + 4 个新 scripts + 1 个新 lib/types + 4 个新 test)

- [ ] **Step 6: 提交**

```bash
git add scripts/import-content.ts tests/integration/scripts/import-content.test.ts
git commit -m "feat(content): importContent upserts file content to DB (3 tables, idempotent)"
```

---

## Phase 4: 启动 manifest (空基线)

### Task 8: 跑 update-content-manifest 写空 manifest

**Files:**
- Create: `data/content-manifest.json`

- [ ] **Step 1: 创建 data/content/ 目录 (空)**

```bash
mkdir -p "E:/ToolDevelop/PinYinCharacter/data/content"
ls "E:/ToolDevelop/PinYinCharacter/data/content/"  # 应为空
```

- [ ] **Step 2: 跑 update-content-manifest**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
pnpm tsx scripts/update-content-manifest.ts
```

预期输出 (stderr):
```
[manifest] byField: {"meaning_zh":0,"etymology_story":0,"hanzi_story":0} → E:\...\data\content-manifest.json
```

- [ ] **Step 3: 验证 manifest 文件**

```bash
cat "E:/ToolDevelop/PinYinCharacter/data/content-manifest.json"
```

预期:
```json
{
  "version": 1,
  "totalChars": 8105,
  "byField": {
    "meaning_zh": 0,
    "etymology_story": 0,
    "hanzi_story": 0
  },
  "generatedAt": "2026-06-15T..."
}
```

- [ ] **Step 4: 提交**

```bash
git add data/content/.gitkeep data/content-manifest.json
git commit -m "chore(content): empty manifest baseline (all fields 0/8105)"
```

(若 `data/content/` 是空目录无法 add,先 `touch data/content/.gitkeep`)

---

## Phase 5: Round 1 (30 字)

### Task 9: 选 Round 1 的 30 字

- [ ] **Step 1: 跑 select-next-chars**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
pnpm tsx scripts/select-next-chars.ts
```

预期输出 (stdout): 30 行 JSON,例:
```json
{"char":"严","fieldsToFill":["meaning_zh"]}
{"char":"丟","fieldsToFill":["meaning_zh"]}
...
```

预期输出 (stderr):
```
Selected 30 chars for next round.
```

- [ ] **Step 2: 保存到临时文件供 Round 1 参考**

```bash
pnpm tsx scripts/select-next-chars.ts > /tmp/round-1-picks.json
cat /tmp/round-1-picks.json | head -5
```

预期: 30 行,每行一个 JSON,字段 `char` + `fieldsToFill` 数组。

(注意: 本步无 commit。selection 是临时数据,Round 1 真正 commit 的是手写 30 个 JSON 文件。)

---

### Task 10: 写 30 个 data/content/<char>.json

**Files:**
- Create: `data/content/<char>.json` × 30 (实际字符由 Task 9 决定)

- [ ] **Step 1: 读出 Round 1 选中的 30 字**

```bash
cat /tmp/round-1-picks.json
```

记下 30 个字符和每字的 `fieldsToFill` 列表。

- [ ] **Step 2: 为每个 char 手写 JSON**

**写盘示例** (Windows / Git Bash):
```bash
# 对于选中 "{char: '严', fieldsToFill: ['meaning_zh']}" 的字
cat > "E:/ToolDevelop/PinYinCharacter/data/content/严.json" <<'EOF'
{
  "char": "严",
  "pinyin": "yán",
  "meaning_zh": "严,意指教命急也。 《说文》载,严,教命急也。从吅,𠆢。"
}
EOF
```

**字段写法约定**:
- `meaning_zh` (~30-50 字): `一字,意指XX也。 《说文》载,XX,...`
- `etymology_story` (140-180 字): `甲骨文作X,... 金文作X,... 小篆作X,... 隶书作X,... 楷书定形为X,XX也。`
- `hanzi_story` (30-50 字): `《XX》载,X... 古方书偶记其XX。`

**对每个 char**:
1. 查其 pinyin (pypinyin 或手敲)
2. 查其在 general-standard-chinese-characters.json 中的位置确定 level
3. 按 `fieldsToFill` 写对应字段
4. 写入 `data/content/<char>.json` (UTF-8, no BOM)

**注意**:
- 字符文件名: Windows / Git Bash 都接受 CJK, 直接 `data/content/严.json` 即可
- 不要写 `null` 字段, 字段没填就 omit
- 字段串里不要带真实换行, 用 `,` `。` `;` 句读

- [ ] **Step 3: 验证 30 个文件已写**

```bash
ls "E:/ToolDevelop/PinYinCharacter/data/content/" | wc -l  # 应该是 30 + 1 (.gitkeep)
```

预期: 31 (30 个 .json + .gitkeep)

- [ ] **Step 4: 跑 update-content-manifest 验证计数**

```bash
pnpm tsx scripts/update-content-manifest.ts
cat data/content-manifest.json
```

预期 `byField` 反映本轮填入的字段分布。例: 全是 meaning_zh → `meaning_zh: 30, etymology_story: 0, hanzi_story: 0`。

- [ ] **Step 5: 跑 import-content 落库**

```bash
pnpm tsx scripts/import-content.ts
```

预期输出 (stderr):
```
[import] scanned=30 meaning_zh=30 etymology_story=0 hanzi_story=0 errors=0
```

(具体数字依 Round 1 选题)

- [ ] **Step 6: 验证 DB 落库 (有 DB 时)**

```bash
node --env-file=.env -e "
  import('mysql2/promise').then(async ({default: mysql}) => {
    const c = await mysql.createConnection(process.env.DATABASE_URL);
    const [r] = await c.query(\"SELECT \`char\`, meaning_zh FROM chars WHERE \`char\` IN ('严', '丟', '丧') AND meaning_zh IS NOT NULL\");
    console.log(r);
    await c.end();
  })
"
```

预期: 选中的 30 字 meaning_zh 在 DB 里。

- [ ] **Step 7: 提交 (单次 commit 30 文件)**

```bash
git add data/content/
git add data/content-manifest.json
git status --short  # 应该看到 30 个 A (data/content/) + 1 个 M (manifest)
git commit -m "feat(content): Round 1 — 30 chars (meaning_zh)"
```

(commit message 末尾字段名按本轮实际填的字段调整)

---

## Phase 6: Loop recipe (后续轮次)

### Task 11: 写 memory 文档 loop recipe

**Files:**
- Modify: `C:\Users\徐鹏\.claude\projects\E--ToolDevelop-PinYinCharacter\memory\MEMORY.md`
- Modify or Create: `C:\Users\徐鹏\.claude\projects\E--ToolDevelop-PinYinCharacter\memory\bulk-content-generation-pattern.md` (修订)

- [ ] **Step 1: 修订 bulk-content-generation-pattern.md**

在原 memory 末尾加:

```markdown
## Round 流程 (per-char 模式, 2026-06-15+)

每轮 30 字 (去重后, 一字可填多字段), 文件形态 `data/content/<char>.json`:

```
1. 选题: pnpm tsx scripts/select-next-chars.ts > /tmp/round-N-picks.json
2. 查 pinyin: pypinyin 或手敲 (不写代码生成)
3. 手写 30 个 JSON, 按 fieldsToFill 写对应字段
4. 跑 manifest: pnpm tsx scripts/update-content-manifest.ts
5. 跑 import: pnpm tsx scripts/import-content.ts
6. console 报「可 /compact」
```

**字段优先级** (由 select-next-chars 自动处理):
- meaning_zh (DB 已 6498/6498, 缺口在 level 3 ~194 字)
- hanzi_story (level 3 1607 字, 缺口 ~1407)
- etymology_story (level 1+2 6498 字, 缺口 ~6498)

**重启接续**:
- 读 `data/content-manifest.json` 的 byField 数字 → 当前覆盖
- 跑 `select-next-chars` 自然跳过已填的

**Checkpoints**:
- 每 50 字: 浏览器看 /dictionary/<char> 验证显示
- 每 200 字: 跑 `pnpm test` 全量, tsc 检查
- 每 1000 字: 重读 manifest, 评估进度
```

- [ ] **Step 2: 提交 memory 修订**

```bash
# memory 不在 git 仓库, 直接编辑即可, 不需 commit
```

(注: memory 是用户级配置, 不在项目 git 仓库里。Edit 文件后用户重启会话来读。)

---

### Task 12: 跑全量验证

- [ ] **Step 1: 跑 vitest 全量**

```bash
cd "E:/ToolDevelop/PinYinCharacter"
pnpm test
```

预期: 之前所有 PASS 的测试仍 PASS;新增 6 个 (3 schemas + 1 content + 1 manifest + 1 select + 2 integration) 全 PASS / skip。

- [ ] **Step 2: 跑 tsc 全量**

```bash
pnpm tsc --noEmit
```

预期: 0 错

- [ ] **Step 3: 跑 build 验证 production build**

```bash
pnpm build
```

预期: 成功 build,无 type / lint 错。

- [ ] **Step 4: 浏览器 smoke**

启动 dev server,访问:
- `/dictionary/严` — 应显示 meaning_zh (Round 1 选中的字)
- `/etymology/严` — 如果 Round 1 没填 etymology_story, 应显示「暂无」(已有回退逻辑)
- `/dictionary/一` — 应显示 meaning_zh (DB 回退)

- [ ] **Step 5: 输出 Phase 6+ 的循环说明**

向用户报告:
- Phase 1-5 完成,所有 infrastructure 就绪
- Round 1 (30 字) 落库, manifest byField 反映状态
- 后续轮次用户只需说「继续」,会自动: 选 30 字 → 列字段缺口 → 等手写 JSON → 跑 manifest + import

---

## 关键约束

1. **TS 严格**: `pnpm tsc --noEmit` 必须 0 错。`server-only` 包仅服务端 import, lib/content.ts 用了没问题。
2. **幂等性**: 任何脚本重跑都不破坏数据。import 的 meaning_zh 故意不覆盖 DB 已有。
3. **错误隔离**: 单个文件 zod 失败 → console.error + skip, 不阻断 manifest 重算 / import 整体跑。
4. **commit 节奏**: 每 Phase 一个或多个 commit, commit message 跟文件类型一致 (chore / feat / fix / docs)。
5. **memory 优先**: 用户说「继续」时, 先读 manifest byField + bulk-content-generation-pattern 再选题。

---

## 关键文件引用

- Spec: `docs/superpowers/specs/2026-06-15-char-content-per-file-design.md`
- 8105 字符号源: `data/general-standard-chinese-characters.json`
- Manifest 参照: `data/strokes-manifest.json`
- DB schema 参照: `lib/etymology.ts` (char_etymology 读)
- Script 模式: `scripts/check-char-meaning-progress.ts` (单文件 CLI 模式)
- Test 模式: `tests/unit/lib/etymology.test.ts` (vi.mock DB)
- Integration 模式: `tests/integration/rare-chars-list.test.ts` (integrationDescribe + installTestEnv)
