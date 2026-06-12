# 唐诗宋词字帖 Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「字·韵」网站添加唐诗三百首 (~320) + 宋词三百首 (~300) 字帖板块,米字格 + 拼音小注,DB 走现有架构,initDb 时自动从 chinese-poetry 拉取灌库,首页 BentoGrid 加「今日一诗」卡片,详情页可"保存到我的字帖"复用 /worksheet 体系。

**Architecture:**
- 服务端: 新增 `poems` 表, `lib/poetry.ts` 三个查询函数 (list/get/random), 3 个 GET API
- 客户端: `lib/api-poetry.ts` 包装 fetch, 6 个 React 组件, 2 个页面
- 数据灌入: `scripts/build-poems.ts` 拉 chinese-poetry GitHub, 用 pinyin-pro 算拼音, UPSERT
- 现有复用: `WorksheetCell` SVG 米字格, `/api/worksheets` POST, `/worksheet/[id]` 渲染, `card-paper` / `font-kai` / `btn-seal` Plan E token

**Tech Stack:** Next.js 15 + React 19, MySQL (mysql2), zod 验证, pinyin-pro (已有), lucide-react, Vitest + happy-dom 测试

---

## File Structure

**New files (20):**
- `lib/poetry-types.ts` — 共享类型 (PoemListItem, PoemDetail, PoemListResult, Dynasty)
- `lib/poetry.ts` — server-only CRUD (listPoems, getPoem, getRandomPoem)
- `lib/api-poetry.ts` — client fetch wrappers
- `scripts/build-poems.ts` — chinese-poetry 拉取 + pinyin + UPSERT
- `app/api/poetry/route.ts` — GET list
- `app/api/poetry/[id]/route.ts` — GET detail
- `app/api/poetry/random/route.ts` — GET random
- `app/poetry/page.tsx` — 列表页
- `app/poetry/[id]/page.tsx` — 详情页
- `app/poetry/[id]/SaveAsWorksheetButton.tsx` — 保存按钮
- `components/poetry/PoemMeta.tsx` — 标题/作者/朝代
- `components/poetry/PoemCard.tsx` — 列表项
- `components/poetry/PoemSearch.tsx` — 搜索框 + tab
- `components/poetry/PoemPagination.tsx` — 分页
- `components/poetry/PoemWorksheet.tsx` — 米字格 + 拼音
- `components/poetry/AppreciationBlock.tsx` — 赏析块
- `components/HomePoemCard.tsx` — 首页「今日一诗」卡片
- `tests/unit/lib/poetry.test.ts` — 三个函数的纯逻辑测试 (mock DB)
- `tests/unit/components/poetry/PoemCard.test.tsx` — 渲染测试
- `tests/unit/components/poetry/PoemWorksheet.test.tsx` — 渲染测试
- `tests/integration/api/poetry-list.test.ts` — 列表 API
- `tests/integration/api/poetry-detail.test.ts` — 详情 API
- `tests/integration/api/poetry-random.test.ts` — random API

**Modified files (3):**
- `scripts/init-db.ts` — 加 poems 表 DDL + 自动灌库
- `lib/validators.ts` — 加 poemQuerySchema, poemIdParamSchema
- `lib/design.ts` — NAV_LINKS 加「诗词」
- `app/page.tsx` — 加 HomePoemCard
- `tests/integration/setup.ts` — truncateAll 加 poems 表

---

## Phase 1: Foundation

### Task 1: DDL — add poems table to init-db.ts

**Files:**
- Modify: `scripts/init-db.ts:62` (在 rare_chars DDL 之后插入新 DDL)
- Modify: `tests/integration/setup.ts:26` (TRUNCATE 加 poems)
- Modify: `package.json:12` (加 `poetry:build` 脚本)

- [ ] **Step 1: Add poems DDL to init-db.ts**

打开 `scripts/init-db.ts`,在 `rare_chars` 那段 DDL 后(在 `worksheets` 前)插入:

```sql
  `CREATE TABLE IF NOT EXISTS poems (
     id          INT             NOT NULL AUTO_INCREMENT,
     dynasty     ENUM('tang','song') NOT NULL,
     title       VARCHAR(80)     NOT NULL,
     author      VARCHAR(40)     NOT NULL,
     form        VARCHAR(20)     NULL,
     content     JSON            NOT NULL,
     pinyin      JSON            NOT NULL,
     appreciation TEXT           NULL,
     source      VARCHAR(120)    NULL,
     created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_poem (dynasty, title, author),
     KEY idx_author (author),
     KEY idx_dynasty_author (dynasty, author)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
```

- [ ] **Step 2: Update tests/integration/setup.ts truncateAll**

打开 `tests/integration/setup.ts`,在 `TRUNCATE TABLE worksheets` 后加:

```ts
  await pool.query('TRUNCATE TABLE poems');
```

- [ ] **Step 3: Add poetry:build script to package.json**

修改 `package.json` 的 `scripts` 块,加:

```json
"poetry:build": "tsx scripts/build-poems.ts"
```

- [ ] **Step 4: Verify initDb runs without error**

跑:
```bash
pnpm exec tsc --noEmit
```

期望: exit 0,无 TS 错误。

- [ ] **Step 5: Commit**

```bash
git add scripts/init-db.ts tests/integration/setup.ts package.json
git commit -m "feat(db): add poems table DDL + poetry:build script"
```

---

## Phase 2: Types + Data Layer

### Task 2: lib/poetry-types.ts (shared types, no test)

**Files:**
- Create: `lib/poetry-types.ts`

- [ ] **Step 1: Create the file**

写 `lib/poetry-types.ts`:

```ts
export type Dynasty = 'tang' | 'song';

export interface PoemListItem {
  id: number;
  title: string;
  author: string;
  dynasty: Dynasty;
  form: string | null;
}

export interface PoemDetail extends PoemListItem {
  content: string[];
  pinyin: string[][];
  appreciation: string | null;
}

export interface PoemListResult {
  items: PoemListItem[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Verify typecheck**

跑:
```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add lib/poetry-types.ts
git commit -m "feat(types): add poetry shared types"
```

---

### Task 3: lib/poetry.ts — listPoems + test

**Files:**
- Create: `lib/poetry.ts`
- Create: `tests/unit/lib/poetry.test.ts`

- [ ] **Step 1: Write the failing test for listPoems (with search and pagination)**

写 `tests/unit/lib/poetry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '@/lib/db';
import { listPoems, buildSearchWhere } from '@/lib/poetry';

const fakePool = {
  query: vi.fn(),
  execute: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (getPool as any).mockReturnValue(fakePool);
});

describe('poetry pure helpers', () => {
  describe('buildSearchWhere', () => {
    it('returns empty for empty query', () => {
      expect(buildSearchWhere('')).toEqual({ where: '', params: [] });
    });

    it('LIKE-matches title, author, or title-first-char with %q%', () => {
      const r = buildSearchWhere('李白');
      expect(r.where).toBe('WHERE (title LIKE ? OR author LIKE ? OR title LIKE ?)');
      expect(r.params).toEqual(['%李白%', '%李白%', '%李%']);
    });

    it('trims whitespace', () => {
      expect(buildSearchWhere('  ')).toEqual({ where: '', params: [] });
    });
  });
});

describe('poetry listPoems', () => {
  it('returns items, total, page, pageSize', async () => {
    fakePool.query.mockResolvedValueOnce([
      [{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }],
    ]);
    fakePool.query.mockResolvedValueOnce([[{ total: 1 }]]);

    const r = await listPoems({ dynasty: 'tang' });

    expect(r).toEqual({
      items: [{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }],
      total: 1,
      page: 1,
      pageSize: 24,
    });
  });

  it('clamps page and pageSize', async () => {
    fakePool.query.mockResolvedValueOnce([[]]);
    fakePool.query.mockResolvedValueOnce([[{ total: 0 }]]);

    const r = await listPoems({ dynasty: 'tang', page: 0, pageSize: 9999 });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(24);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

跑:
```bash
pnpm test -- tests/unit/lib/poetry.test.ts
```

期望: FAIL (lib/poetry.ts 不存在)。

- [ ] **Step 3: Implement listPoems + buildSearchWhere**

写 `lib/poetry.ts`:

```ts
import { getPool } from './db';
import type { Dynasty, PoemListItem, PoemListResult } from './poetry-types';

const PAGE_SIZE = 24;

export interface ListPoemsArgs {
  dynasty: Dynasty;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function buildSearchWhere(q: string): { where: string; params: string[] } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { where: '', params: [] };
  const firstChar = Array.from(trimmed)[0] ?? '';
  return {
    where: 'WHERE (title LIKE ? OR author LIKE ? OR title LIKE ?)',
    params: [`%${trimmed}%`, `%${trimmed}%`, `${firstChar}%`],
  };
}

function mapRow(r: any): PoemListItem {
  return {
    id: Number(r.id),
    title: r.title,
    author: r.author,
    dynasty: r.dynasty,
    form: r.form ?? null,
  };
}

export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const { where, params } = buildSearchWhere(args.q ?? '');

  const sql = `SELECT id, title, author, dynasty, form FROM poems
               WHERE dynasty = ? ${where ? 'AND ' + where.replace(/^WHERE\s+/, '') : ''}
               ORDER BY id ASC
               LIMIT ? OFFSET ?`;

  const [rows] = await pool.query<any[]>(sql, [args.dynasty, ...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM poems
     WHERE dynasty = ? ${where ? 'AND ' + where.replace(/^WHERE\s+/, '') : ''}`,
    [args.dynasty, ...params]
  );

  return {
    items: (rows as any[]).map(mapRow),
    total: Number(total),
    page,
    pageSize,
  };
}
```

- [ ] **Step 4: Run test, expect pass**

跑:
```bash
pnpm test -- tests/unit/lib/poetry.test.ts
```

期望: PASS (5 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/poetry.ts tests/unit/lib/poetry.test.ts
git commit -m "feat(poetry): listPoems + buildSearchWhere with tests"
```

---

### Task 4: lib/poetry.ts — getPoem + getRandomPoem + tests

**Files:**
- Modify: `lib/poetry.ts`
- Modify: `tests/unit/lib/poetry.test.ts`

- [ ] **Step 1: Append failing tests for getPoem and getRandomPoem**

编辑 `tests/unit/lib/poetry.test.ts`,在文件末尾加:

```ts
import { getPoem, getRandomPoem } from '@/lib/poetry';

describe('getPoem', () => {
  it('returns null when no row', async () => {
    fakePool.execute.mockResolvedValueOnce([[]]);
    const r = await getPoem(999);
    expect(r).toBeNull();
  });

  it('parses JSON content + pinyin', async () => {
    fakePool.execute.mockResolvedValueOnce([
      [{
        id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句',
        content: JSON.stringify(['床前明月光', '疑是地上霜']),
        pinyin: JSON.stringify([['chuáng', 'qián'], ['yí', 'shì']]),
        appreciation: '好诗',
      }],
    ]);
    const r = await getPoem(1);
    expect(r).toEqual({
      id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句',
      content: ['床前明月光', '疑是地上霜'],
      pinyin: [['chuáng', 'qián'], ['yí', 'shì']],
      appreciation: '好诗',
    });
  });
});

describe('getRandomPoem', () => {
  it('returns null when empty', async () => {
    fakePool.query.mockResolvedValueOnce([[]]);
    const r = await getRandomPoem();
    expect(r).toBeNull();
  });

  it('returns a parsed poem', async () => {
    fakePool.query.mockResolvedValueOnce([
      [{
        id: 5, title: '春晓', author: '孟浩然', dynasty: 'tang', form: '五言绝句',
        content: JSON.stringify(['春眠不觉晓']),
        pinyin: JSON.stringify([['chūn', 'mián']]),
        appreciation: null,
      }],
    ]);
    const r = await getRandomPoem();
    expect(r?.id).toBe(5);
    expect(r?.appreciation).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

跑:
```bash
pnpm test -- tests/unit/lib/poetry.test.ts
```

期望: FAIL (getPoem/getRandomPoem 未导出)。

- [ ] **Step 3: Implement getPoem + getRandomPoem**

在 `lib/poetry.ts` 末尾追加:

```ts
import type { PoemDetail } from './poetry-types';

function parseJsonArray<T>(s: any, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function mapDetailRow(r: any): PoemDetail {
  return {
    ...mapRow(r),
    content: parseJsonArray<string[]>(r.content, []),
    pinyin: parseJsonArray<string[][]>(r.pinyin, []),
    appreciation: r.appreciation ?? null,
  };
}

export async function getPoem(id: number): Promise<PoemDetail | null> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, author, dynasty, form, content, pinyin, appreciation
     FROM poems WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}

export async function getRandomPoem(): Promise<PoemDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, author, dynasty, form, content, pinyin, appreciation
     FROM poems ORDER BY RAND() LIMIT 1`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}
```

- [ ] **Step 4: Run, expect pass**

跑:
```bash
pnpm test -- tests/unit/lib/poetry.test.ts
```

期望: PASS (5 + 4 = 9 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/poetry.ts tests/unit/lib/poetry.test.ts
git commit -m "feat(poetry): getPoem + getRandomPoem with tests"
```

---

## Phase 3: Validators + API

### Task 5: lib/validators.ts — add poem schemas + test

**Files:**
- Modify: `lib/validators.ts`
- Modify: `tests/unit/lib/validators.test.ts` (在末尾追加)

- [ ] **Step 1: Read existing validators test to match pattern**

跑:
```bash
ls tests/unit/lib/validators.test.ts
```

读 `tests/unit/lib/validators.test.ts` 前 5 行,看测试结构。

- [ ] **Step 2: Add schemas to validators.ts**

在 `lib/validators.ts` 文件末尾加:

```ts
export const poemListQuerySchema = z.object({
  dynasty: z.enum(['tang', 'song']).default('tang'),
  q: z.string().max(64).transform((s) => s.trim()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const poemIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
```

- [ ] **Step 3: Append failing tests to validators.test.ts**

在 `tests/unit/lib/validators.test.ts` 末尾追加:

```ts
import { poemListQuerySchema, poemIdParamSchema } from '@/lib/validators';

describe('poemListQuerySchema', () => {
  it('defaults dynasty to tang', () => {
    expect(poemListQuerySchema.parse({}).dynasty).toBe('tang');
  });

  it('rejects unknown dynasty', () => {
    expect(() => poemListQuerySchema.parse({ dynasty: 'yuan' })).toThrow();
  });

  it('trims q', () => {
    const r = poemListQuerySchema.parse({ q: '  李白  ' });
    expect(r.q).toBe('李白');
  });

  it('coerces page and pageSize', () => {
    const r = poemListQuerySchema.parse({ page: '3', pageSize: '50' });
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(50);
  });
});

describe('poemIdParamSchema', () => {
  it('accepts positive int', () => {
    expect(poemIdParamSchema.parse({ id: '5' }).id).toBe(5);
  });
  it('rejects non-positive', () => {
    expect(() => poemIdParamSchema.parse({ id: '0' })).toThrow();
  });
});
```

- [ ] **Step 4: Run validators test**

跑:
```bash
pnpm test -- tests/unit/lib/validators.test.ts
```

期望: PASS (新测试 6 个 + 原有测试)。

- [ ] **Step 5: Commit**

```bash
git add lib/validators.ts tests/unit/lib/validators.test.ts
git commit -m "feat(validators): poem list + id param schemas"
```

---

### Task 6: GET /api/poetry + integration test

**Files:**
- Create: `app/api/poetry/route.ts`
- Create: `tests/integration/api/poetry-list.test.ts`

- [ ] **Step 1: Write integration test**

写 `tests/integration/api/poetry-list.test.ts`:

```ts
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry (integration)', () => {
  it('returns empty list when no poems', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=tang') as any);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.items).toEqual([]);
    expect(j.data.total).toBe(0);
  });

  it('filters by dynasty', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY('床前明月光'), JSON_ARRAY(JSON_ARRAY('chuáng'))),
       ('tang','春晓','孟浩然', JSON_ARRAY('春眠不觉晓'), JSON_ARRAY(JSON_ARRAY('chūn'))),
       ('song','如梦令','李清照', JSON_ARRAY('昨夜雨疏风骤'), JSON_ARRAY(JSON_ARRAY('zuó')))`
    );
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=song') as any);
    const j = await r.json();
    expect(j.data.items).toHaveLength(1);
    expect(j.data.items[0].author).toBe('李清照');
  });

  it('searches by title', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY(), JSON_ARRAY()),
       ('tang','春晓','孟浩然', JSON_ARRAY(), JSON_ARRAY())`
    );
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=tang&q=静夜') as any);
    const j = await r.json();
    expect(j.data.total).toBe(1);
    expect(j.data.items[0].title).toBe('静夜思');
  });

  it('rejects unknown dynasty', async () => {
    const { GET } = await import('@/app/api/poetry/route');
    const r = await GET(new Request('http://x/api/poetry?dynasty=yuan') as any);
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

跑:
```bash
pnpm test -- tests/integration/api/poetry-list.test.ts
```

期望: FAIL (route 不存在) 或 skip (无 DB)。

- [ ] **Step 3: Implement route**

写 `app/api/poetry/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listPoems } from '@/lib/poetry';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { poemListQuerySchema } from '@/lib/validators';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = poemListQuerySchema.safeParse({
      dynasty: sp.get('dynasty') ?? undefined,
      q: sp.get('q') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listPoems(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run, expect pass (or skip if no DB)**

跑:
```bash
pnpm test -- tests/integration/api/poetry-list.test.ts
```

期望: 4 PASS,或 4 skip (无 `DATABASE_URL_TEST`)。

- [ ] **Step 5: Commit**

```bash
git add app/api/poetry/route.ts tests/integration/api/poetry-list.test.ts
git commit -m "feat(api): GET /api/poetry list endpoint"
```

---

### Task 7: GET /api/poetry/[id] + integration test

**Files:**
- Create: `app/api/poetry/[id]/route.ts`
- Create: `tests/integration/api/poetry-detail.test.ts`

- [ ] **Step 1: Write integration test**

写 `tests/integration/api/poetry-detail.test.ts`:

```ts
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry/[id] (integration)', () => {
  it('returns 404 for missing id', async () => {
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(new Request('http://x/api/poetry/99999') as any, { params: Promise.resolve({ id: '99999' }) });
    expect(r.status).toBe(404);
  });

  it('returns parsed detail for existing id', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, form, content, pinyin, appreciation) VALUES
       ('tang','静夜思','李白','五言绝句',
        JSON_ARRAY('床前明月光','疑是地上霜'),
        JSON_ARRAY(JSON_ARRAY('chuáng','qián'), JSON_ARRAY('yí','shì')),
        '此诗写秋夜')`
    );
    const [rows] = await pool.execute<any[]>(`SELECT id FROM poems LIMIT 1`);
    const id = (rows as any[])[0].id;
    const { GET } = await import('@/app/api/poetry/[id]/route');
    const r = await GET(new Request(`http://x/api/poetry/${id}`) as any, { params: Promise.resolve({ id: String(id) }) });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('静夜思');
    expect(j.data.content).toEqual(['床前明月光', '疑是地上霜']);
    expect(j.data.pinyin).toEqual([['chuáng', 'qián'], ['yí', 'shì']]);
    expect(j.data.appreciation).toBe('此诗写秋夜');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test -- tests/integration/api/poetry-detail.test.ts
```

期望: FAIL。

- [ ] **Step 3: Implement route**

写 `app/api/poetry/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getPoem } from '@/lib/poetry';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { poemIdParamSchema } from '@/lib/validators';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: idStr } = await ctx.params;
    const parsed = poemIdParamSchema.safeParse({ id: idStr });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const poem = await getPoem(parsed.data.id);
    if (!poem) return notFound();
    return NextResponse.json({ ok: true, data: poem });
  });
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test -- tests/integration/api/poetry-detail.test.ts
```

期望: 2 PASS 或 skip。

- [ ] **Step 5: Commit**

```bash
git add app/api/poetry/[id]/route.ts tests/integration/api/poetry-detail.test.ts
git commit -m "feat(api): GET /api/poetry/[id] detail endpoint"
```

---

### Task 8: GET /api/poetry/random + integration test

**Files:**
- Create: `app/api/poetry/random/route.ts`
- Create: `tests/integration/api/poetry-random.test.ts`

- [ ] **Step 1: Write integration test**

写 `tests/integration/api/poetry-random.test.ts`:

```ts
import { integrationDescribe, installTestEnv } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/poetry/random (integration)', () => {
  it('returns 404 when empty', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it('returns a poem when present', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const pool = getPool();
    await pool.execute('TRUNCATE TABLE poems');
    await pool.execute(
      `INSERT INTO poems (dynasty, title, author, content, pinyin) VALUES
       ('tang','静夜思','李白', JSON_ARRAY(), JSON_ARRAY())`
    );
    const { GET } = await import('@/app/api/poetry/random/route');
    const r = await GET();
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.data.title).toBe('静夜思');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test -- tests/integration/api/poetry-random.test.ts
```

期望: FAIL。

- [ ] **Step 3: Implement route**

写 `app/api/poetry/random/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRandomPoem } from '@/lib/poetry';
import { withErrorHandling, notFound } from '@/lib/api-handler';

export async function GET() {
  return withErrorHandling(async () => {
    const poem = await getRandomPoem();
    if (!poem) return notFound('no_poems', 'no poems in database yet');
    return NextResponse.json({ ok: true, data: poem });
  });
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test -- tests/integration/api/poetry-random.test.ts
```

期望: 2 PASS 或 skip。

- [ ] **Step 5: Commit**

```bash
git add app/api/poetry/random/route.ts tests/integration/api/poetry-random.test.ts
git commit -m "feat(api): GET /api/poetry/random endpoint"
```

---

## Phase 4: Build Script + initDb Auto-Populate

### Task 9: scripts/build-poems.ts

**Files:**
- Create: `scripts/build-poems.ts`

- [ ] **Step 1: Create build script**

写 `scripts/build-poems.ts`:

```ts
/**
 * Pull 唐诗三百首 + 宋词三百首 from chinese-poetry/chinese-poetry GitHub repo,
 * generate pinyin for each char with pinyin-pro, UPSERT into the `poems` table.
 *
 * Idempotent: safe to re-run. Existing rows are updated, new rows are inserted.
 * Fails soft: network errors / parse errors throw, caller decides whether to fail.
 */
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

const SOURCE_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const FILES: Array<{ dynasty: 'tang' | 'song'; path: string }> = [
  { dynasty: 'tang', path: '/json/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json' },
  { dynasty: 'song', path: '/json/%E5%AE%8B%E8%AF%8D%E4%B8%89%E7%99%BE%E9%A6%96.json' },
];
const SOURCE_TAG = 'chinese-poetry/chinese-poetry@master';

interface RawPoem {
  title: string;
  author: string;
  paragraphs?: string[];
  rhythmic?: string;
  // 宋词 赏析字段 (可选)
  translation?: string;
  appreciation?: string;
}

function charPinyin(ch: string): string {
  if (!ch.trim()) return '';
  try {
    const result = pinyin(ch, { toneType: 'symbol', type: 'array' });
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
      return result[0]!;
    }
  } catch {
    // fall through
  }
  return '';
}

function linePinyin(line: string): string[] {
  return Array.from(line).map(charPinyin);
}

async function fetchFile(path: string): Promise<RawPoem[]> {
  const url = SOURCE_BASE + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`unexpected JSON shape from ${url}`);
  return data as RawPoem[];
}

export async function buildPoems(): Promise<number> {
  const pool = getPool();
  let inserted = 0;

  for (const file of FILES) {
    const poems = await fetchFile(file.path);
    for (const p of poems) {
      const content = Array.isArray(p.paragraphs) ? p.paragraphs.filter((s) => typeof s === 'string') : [];
      if (content.length === 0) continue;
      const pinyinArr = content.map(linePinyin);
      const appreciation = (p.translation ?? p.appreciation ?? null) || null;
      const title = String(p.title ?? '').trim();
      const author = String(p.author ?? '').trim();
      if (!title || !author) continue;
      const form = p.rhythmic ? String(p.rhythmic) : null;

      await pool.execute(
        `INSERT INTO poems (dynasty, title, author, form, content, pinyin, appreciation, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           form = VALUES(form),
           content = VALUES(content),
           pinyin = VALUES(pinyin),
           appreciation = VALUES(appreciation),
           source = VALUES(source)`,
        [
          file.dynasty,
          title,
          author,
          form,
          JSON.stringify(content),
          JSON.stringify(pinyinArr),
          appreciation,
          SOURCE_TAG,
        ]
      );
      inserted++;
    }
  }
  return inserted;
}

if (require.main === module) {
  buildPoems()
    .then((n) => {
      console.log(`[build-poems] inserted/updated ${n} poems`);
      return closePool();
    })
    .catch((err) => {
      console.error('[build-poems] failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add scripts/build-poems.ts
git commit -m "feat(scripts): build-poems from chinese-poetry with pinyin-pro"
```

---

### Task 10: Wire build-poems into init-db (auto-populate if empty)

**Files:**
- Modify: `scripts/init-db.ts` (in `initDb` 函数, DDL 跑完后)

- [ ] **Step 1: Modify initDb to call buildPoems when table empty**

替换 `scripts/init-db.ts` 末尾的 `initDb` 函数:

```ts
export async function initDb(): Promise<void> {
  const pool = getPool();
  for (const sql of DDL) {
    await pool.query(sql);
  }
  // Auto-populate poems table if empty (fail-soft)
  try {
    const [[{ count }]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM poems`);
    if (Number(count) === 0) {
      const { buildPoems } = await import('./build-poems');
      const n = await buildPoems();
      console.log(`[initDb] inserted ${n} poems (auto-populate)`);
    } else {
      console.log(`[initDb] poems table has ${count} rows, skip auto-populate`);
    }
  } catch (err) {
    console.warn('[initDb] poems auto-populate failed (continuing):', (err as Error).message);
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add scripts/init-db.ts
git commit -m "feat(init-db): auto-populate poems on first start (fail-soft)"
```

---

## Phase 5: Client Wrappers + Components

### Task 11: lib/api-poetry.ts (client fetch wrappers)

**Files:**
- Create: `lib/api-poetry.ts`

- [ ] **Step 1: Create file**

写 `lib/api-poetry.ts`:

```ts
import type { Dynasty, PoemListResult, PoemDetail } from './poetry-types';

export async function listPoemsRequest(args: { dynasty: Dynasty; q?: string; page?: number }): Promise<PoemListResult> {
  const sp = new URLSearchParams();
  sp.set('dynasty', args.dynasty);
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/poetry?${sp.toString()}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listPoems failed');
  return j.data;
}

export async function getPoemRequest(id: number): Promise<PoemDetail> {
  const res = await fetch(`/api/poetry/${id}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getPoem failed');
  return j.data;
}

export async function getRandomPoemRequest(): Promise<PoemDetail | null> {
  const res = await fetch('/api/poetry/random');
  if (res.status === 404) return null;
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getRandomPoem failed');
  return j.data;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add lib/api-poetry.ts
git commit -m "feat(api-client): poetry fetch wrappers"
```

---

### Task 12: components/poetry/PoemMeta + AppreciationBlock

**Files:**
- Create: `components/poetry/PoemMeta.tsx`
- Create: `components/poetry/AppreciationBlock.tsx`

- [ ] **Step 1: Create PoemMeta**

写 `components/poetry/PoemMeta.tsx`:

```tsx
import type { Dynasty } from '@/lib/poetry-types';

interface Props {
  title: string;
  author: string;
  dynasty: Dynasty;
  form?: string | null;
}

const DYNASTY_LABEL: Record<Dynasty, string> = { tang: '唐', song: '宋' };

export function PoemMeta({ title, author, dynasty, form }: Props) {
  return (
    <header className="text-center mb-6">
      <div className="paper-rule w-16 mx-auto mb-4" />
      <h1 className="font-kai text-3xl sm:text-4xl text-ink leading-tight">《{title}》</h1>
      <p className="mt-3 text-ink-soft text-base">
        <span className="inline-block px-2 py-0.5 mr-2 bg-seal/10 text-seal text-xs font-medium rounded">
          {DYNASTY_LABEL[dynasty]}
        </span>
        {author}
        {form && <span className="text-ink-faint text-sm ml-2">· {form}</span>}
      </p>
      <div className="paper-rule w-16 mx-auto mt-4" />
    </header>
  );
}
```

- [ ] **Step 2: Create AppreciationBlock**

写 `components/poetry/AppreciationBlock.tsx`:

```tsx
interface Props {
  text: string;
}

export function AppreciationBlock({ text }: Props) {
  return (
    <section className="card-paper p-5 mt-6 border-l-4 border-seal">
      <h3 className="font-kai text-lg text-ink mb-2">赏析</h3>
      <p className="text-ink-soft leading-relaxed whitespace-pre-line text-sm">{text}</p>
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 4: Commit**

```bash
git add components/poetry/PoemMeta.tsx components/poetry/AppreciationBlock.tsx
git commit -m "feat(components): PoemMeta + AppreciationBlock"
```

---

### Task 13: components/poetry/PoemCard + test

**Files:**
- Create: `components/poetry/PoemCard.tsx`
- Create: `tests/unit/components/poetry/PoemCard.test.tsx`

- [ ] **Step 1: Write failing test**

写 `tests/unit/components/poetry/PoemCard.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoemCard } from '@/components/poetry/PoemCard';

describe('PoemCard', () => {
  it('renders title, author, and dynasty tag', () => {
    render(<PoemCard poem={{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', form: '五言绝句' }} />);
    expect(screen.getByText('《静夜思》')).toBeInTheDocument();
    expect(screen.getByText('李白')).toBeInTheDocument();
    expect(screen.getByText('唐')).toBeInTheDocument();
    expect(screen.getByText('五言绝句')).toBeInTheDocument();
  });

  it('renders 宋 tag for song dynasty', () => {
    render(<PoemCard poem={{ id: 2, title: '如梦令', author: '李清照', dynasty: 'song', form: null }} />);
    expect(screen.getByText('宋')).toBeInTheDocument();
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('links to /poetry/[id]', () => {
    render(<PoemCard poem={{ id: 7, title: '春晓', author: '孟浩然', dynasty: 'tang', form: null }} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/poetry/7');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test -- tests/unit/components/poetry/PoemCard.test.tsx
```

期望: FAIL (PoemCard 不存在)。

- [ ] **Step 3: Implement PoemCard**

写 `components/poetry/PoemCard.tsx`:

```tsx
import Link from 'next/link';
import type { PoemListItem } from '@/lib/poetry-types';

const DYNASTY_LABEL = { tang: '唐', song: '宋' } as const;

export function PoemCard({ poem }: { poem: PoemListItem }) {
  return (
    <Link
      href={`/poetry/${poem.id}`}
      className="card-paper p-4 flex flex-col gap-2 hover:border-seal transition-colors group"
    >
      <h3 className="font-kai text-lg text-ink leading-tight group-hover:text-seal transition-colors">
        《{poem.title}》
      </h3>
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {DYNASTY_LABEL[poem.dynasty]}
        </span>
        <span>{poem.author}</span>
        {poem.form && <span className="text-ink-faint text-xs">· {poem.form}</span>}
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test -- tests/unit/components/poetry/PoemCard.test.tsx
```

期望: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add components/poetry/PoemCard.tsx tests/unit/components/poetry/PoemCard.test.tsx
git commit -m "feat(components): PoemCard with link + paper style"
```

---

### Task 14: components/poetry/PoemSearch + PoemPagination

**Files:**
- Create: `components/poetry/PoemSearch.tsx`
- Create: `components/poetry/PoemPagination.tsx`

- [ ] **Step 1: Create PoemSearch**

写 `components/poetry/PoemSearch.tsx`:

```tsx
'use client';

import type { Dynasty } from '@/lib/poetry-types';

interface Props {
  dynasty: Dynasty;
  q: string;
  onDynastyChange: (d: Dynasty) => void;
  onQChange: (q: string) => void;
}

const TABS: Array<{ key: Dynasty; label: string }> = [
  { key: 'tang', label: '唐诗' },
  { key: 'song', label: '宋词' },
];

export function PoemSearch({ dynasty, q, onDynastyChange, onQChange }: Props) {
  return (
    <div className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="搜索标题或作者..."
        className="w-full rounded-md border border-ink/20 bg-paper-soft px-3 py-2 text-base focus:border-seal focus:outline-none"
      />
      <div className="flex items-center gap-1 border-b border-ink/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onDynastyChange(t.key)}
            className={`px-4 py-2 text-base transition-colors ${
              dynasty === t.key
                ? 'border-b-2 border-seal text-seal font-medium'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create PoemPagination**

写 `components/poetry/PoemPagination.tsx`:

```tsx
'use client';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PoemPagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-center gap-2 mt-6 text-sm">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={!canPrev}
        className="px-3 py-1 rounded border border-ink/20 hover:bg-paper-deep disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ← 上一页
      </button>
      <span className="text-ink-soft">
        第 {page} / {totalPages} 页 · 共 {total} 首
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!canNext}
        className="px-3 py-1 rounded border border-ink/20 hover:bg-paper-deep disabled:opacity-30 disabled:cursor-not-allowed"
      >
        下一页 →
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 4: Commit**

```bash
git add components/poetry/PoemSearch.tsx components/poetry/PoemPagination.tsx
git commit -m "feat(components): PoemSearch tabs + PoemPagination"
```

---

### Task 15: components/poetry/PoemWorksheet + test

**Files:**
- Create: `components/poetry/PoemWorksheet.tsx`
- Create: `tests/unit/components/poetry/PoemWorksheet.test.tsx`

- [ ] **Step 1: Write failing test**

写 `tests/unit/components/poetry/PoemWorksheet.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoemWorksheet } from '@/components/poetry/PoemWorksheet';

describe('PoemWorksheet', () => {
  it('renders one line per content entry', () => {
    const { container } = render(
      <PoemWorksheet
        content={['床前明月光', '疑是地上霜']}
        pinyin={[['chuáng', 'qián', 'míng', 'yuè', 'guāng'], ['yí', 'shì', 'dì', 'shàng', 'shuāng']]}
      />
    );
    // 2 lines, each with 5 chars
    expect(container.querySelectorAll('.poem-line')).toHaveLength(2);
  });

  it('shows pinyin under each char', () => {
    render(
      <PoemWorksheet
        content={['静夜思']}
        pinyin={[['jìng', 'yè', 'sī']]}
      />
    );
    expect(screen.getByText('jìng')).toBeInTheDocument();
    expect(screen.getByText('yè')).toBeInTheDocument();
    expect(screen.getByText('sī')).toBeInTheDocument();
  });
});
```

(注意: 第一个测试用 `床前明月光` 但里面用 `chuáng` 的 pinyin;我先简化让测试只关注行数和 pinyin 元素)

修正第一个测试:

```tsx
it('renders one line per content entry', () => {
  const { container } = render(
    <PoemWorksheet
      content={['床前明月光', '疑是地上霜']}
      pinyin={[['chuáng', 'qián', 'míng', 'yuè', 'guāng'], ['yí', 'shì', 'dì', 'shàng', 'shuāng']]}
    />
  );
  expect(container.querySelectorAll('.poem-line')).toHaveLength(2);
  expect(container.querySelectorAll('.poem-char')).toHaveLength(10);
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test -- tests/unit/components/poetry/PoemWorksheet.test.tsx
```

期望: FAIL (PoemWorksheet 不存在)。

- [ ] **Step 3: Implement PoemWorksheet**

写 `components/poetry/PoemWorksheet.tsx`:

```tsx
import { WorksheetCell } from '@/components/worksheet/WorksheetCell';

interface Props {
  content: string[];
  pinyin: string[][];
}

export function PoemWorksheet({ content, pinyin }: Props) {
  return (
    <div className="space-y-6 print:space-y-4">
      {content.map((line, lineIdx) => (
        <div key={lineIdx} className="poem-line flex flex-wrap items-end gap-3 justify-center">
          {Array.from(line).map((char, charIdx) => (
            <div key={charIdx} className="poem-char flex flex-col items-center">
              <WorksheetCell char={char} style="brush" size={70} />
              {pinyin[lineIdx]?.[charIdx] && (
                <span className="text-[10px] text-ink-faint mt-1 leading-none">
                  {pinyin[lineIdx][charIdx]}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test -- tests/unit/components/poetry/PoemWorksheet.test.tsx
```

期望: 2 PASS。

- [ ] **Step 5: Commit**

```bash
git add components/poetry/PoemWorksheet.tsx tests/unit/components/poetry/PoemWorksheet.test.tsx
git commit -m "feat(components): PoemWorksheet (米字格 + 拼音小注)"
```

---

## Phase 6: Pages

### Task 16: app/poetry/page.tsx (list page)

**Files:**
- Create: `app/poetry/page.tsx`

- [ ] **Step 1: Create the list page**

写 `app/poetry/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PoemSearch } from '@/components/poetry/PoemSearch';
import { PoemCard } from '@/components/poetry/PoemCard';
import { PoemPagination } from '@/components/poetry/PoemPagination';
import { listPoemsRequest } from '@/lib/api-poetry';
import type { Dynasty, PoemListItem } from '@/lib/poetry-types';

export default function PoetryListPage() {
  const [dynasty, setDynasty] = useState<Dynasty>('tang');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PoemListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const r = await listPoemsRequest({ dynasty, q: q || undefined, page });
        if (!cancelled) {
          setItems(r.items);
          setTotal(r.total);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [dynasty, q, page]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="诗三百首 · 词三百首 · 打印字帖">古诗词</SectionTitle>
        <PoemSearch
          dynasty={dynasty}
          q={q}
          onDynastyChange={(d) => { setDynasty(d); setPage(1); }}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        {error ? (
          <ErrorState message={error} onRetry={() => setPage((p) => p)} />
        ) : loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState message="无匹配诗作" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {items.map((p) => (
                <PoemCard key={p.id} poem={p} />
              ))}
            </div>
            <PoemPagination
              page={page}
              pageSize={24}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add app/poetry/page.tsx
git commit -m "feat(pages): /poetry list page"
```

---

### Task 17: app/poetry/[id]/page.tsx (detail page)

**Files:**
- Create: `app/poetry/[id]/page.tsx`

- [ ] **Step 1: Create detail page**

写 `app/poetry/[id]/page.tsx`:

```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPoem } from '@/lib/poetry';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { PoemMeta } from '@/components/poetry/PoemMeta';
import { PoemWorksheet } from '@/components/poetry/PoemWorksheet';
import { AppreciationBlock } from '@/components/poetry/AppreciationBlock';
import { SaveAsWorksheetButton } from './SaveAsWorksheetButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PoemDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const poem = await getPoem(id);
  if (!poem) notFound();

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="worksheet-no-print font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <div className="worksheet-no-print">
          <PoemMeta title={poem.title} author={poem.author} dynasty={poem.dynasty} form={poem.form} />
        </div>
        <div className="card-paper p-5 sm:p-8">
          <PoemWorksheet content={poem.content} pinyin={poem.pinyin} />
        </div>
        {poem.appreciation && (
          <div className="worksheet-no-print">
            <AppreciationBlock text={poem.appreciation} />
          </div>
        )}
        <div className="worksheet-no-print flex flex-wrap items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-ink/30 px-5 py-2 text-ink hover:bg-paper-deep"
          >
            打印本页
          </button>
          <SaveAsWorksheetButton id={poem.id} title={poem.title} author={poem.author} content={poem.content} />
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Create stub SaveAsWorksheetButton (full impl next task)**

写 `app/poetry/[id]/SaveAsWorksheetButton.tsx`:

```tsx
'use client';

interface Props {
  id: number;
  title: string;
  author: string;
  content: string[];
}

export function SaveAsWorksheetButton({ id, title, author, content }: Props) {
  return (
    <button
      type="button"
      disabled
      className="rounded-md bg-seal/60 px-5 py-2 text-white cursor-not-allowed"
    >
      保存到字帖 (TODO)
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 4: Commit**

```bash
git add app/poetry/[id]/page.tsx app/poetry/[id]/SaveAsWorksheetButton.tsx
git commit -m "feat(pages): /poetry/[id] detail page (save button stub)"
```

---

### Task 18: SaveAsWorksheetButton — full implementation

**Files:**
- Modify: `app/poetry/[id]/SaveAsWorksheetButton.tsx`

- [ ] **Step 1: Replace stub with real implementation**

替换 `app/poetry/[id]/SaveAsWorksheetButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: number;
  title: string;
  author: string;
  content: string[];
}

export function SaveAsWorksheetButton({ id, title, author, content }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const chars = content.join('').split('');
      const res = await fetch('/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `《${title}》${author}`,
          content: chars,
          cellStyle: 'brush',
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=/poetry/${id}`);
        return;
      }
      if (!data.ok) {
        alert('保存失败: ' + (data.error?.message ?? '未知错误'));
        return;
      }
      router.push(`/worksheet/${data.data.id}`);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className="rounded-md bg-seal px-5 py-2 text-white hover:bg-seal/80 disabled:bg-seal/40 disabled:cursor-not-allowed"
    >
      {saving ? '保存中…' : '保存到字帖'}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0。

- [ ] **Step 3: Commit**

```bash
git add app/poetry/[id]/SaveAsWorksheetButton.tsx
git commit -m "feat(pages): SaveAsWorksheetButton with login redirect"
```

---

## Phase 7: Homepage + Nav Integration

### Task 19: components/HomePoemCard + app/page.tsx integration

**Files:**
- Create: `components/HomePoemCard.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create HomePoemCard**

写 `components/HomePoemCard.tsx`:

```tsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getRandomPoem } from '@/lib/poetry';

export async function HomePoemCard() {
  const poem = await getRandomPoem();
  if (!poem) {
    return (
      <Link
        href="/poetry"
        className="card-paper p-5 flex flex-col gap-2 group"
      >
        <div className="font-kai text-3xl">诗</div>
        <div className="font-semibold">古诗词</div>
        <div className="text-xs text-ink-soft">唐诗三百首 · 宋词三百首</div>
      </Link>
    );
  }
  const firstLine = poem.content[0] ?? '';
  const displayLine = firstLine.length > 5 ? firstLine.slice(0, 5) + '…' : firstLine;

  return (
    <Link
      href={`/poetry/${poem.id}`}
      className="card-paper p-5 flex flex-col gap-2 group hover:border-seal transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="font-kai text-3xl">诗</div>
        <span className="inline-block px-1.5 py-0.5 bg-seal/10 text-seal text-xs rounded">
          {poem.dynasty === 'tang' ? '唐' : '宋'}
        </span>
      </div>
      <div className="font-semibold">《{poem.title}》</div>
      <div className="font-kai text-base text-ink-soft truncate">{displayLine}</div>
      <div className="text-xs text-ink-faint">{poem.author}</div>
      <div className="flex items-center gap-1 text-sm font-kai text-ink-soft group-hover:text-seal transition-colors mt-1">
        展开字帖 <ArrowRight size={14} />
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Update BentoGrid to render 4 ITEMS + HomePoemCard**

打开 `components/BentoGrid.tsx`, 把整个 `export function BentoGrid()` 替换为 (保持 ITEMS 不变, 在 grid 末尾追加 `<HomePoemCard />`):

```tsx
export function BentoGrid() {
  return (
    <section id="features" className="py-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          href={ITEMS[0]!.href}
          className={`card-paper ${variantClass[ITEMS[0]!.variant]} sm:row-span-2 p-6 flex flex-col justify-between min-h-[200px] group`}
        >
          <div className="font-kai text-6xl leading-none">{ITEMS[0]!.char}</div>
          <div>
            <div className="font-semibold text-lg mb-1">{ITEMS[0]!.title}</div>
            <div className="text-sm opacity-75 mb-2">{ITEMS[0]!.description}</div>
            <div className="flex items-center gap-1 text-sm font-kai">
              立即开始 <ArrowRight size={14} />
            </div>
          </div>
        </Link>
        {ITEMS.slice(1).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`card-paper ${variantClass[item.variant]} p-5 flex items-center gap-4 group`}
          >
            <div className="font-kai text-3xl">{item.char}</div>
            <div>
              <div className="font-semibold">{item.title}</div>
              <div className="text-xs opacity-75">{item.description}</div>
            </div>
          </Link>
        ))}
        <HomePoemCard />
      </div>
    </section>
  );
}
```

说明: ITEMS 保持 4 项不变 (字/库/帖/戏), HomePoemCard 作为第 5 个 grid 卡片(诗)。Grid 变成: primary 占 2 行 1 列(左侧), 右侧 5 个 1×1 卡片 = 3 (row 1) + 2 (row 2) = 5 个。

- [ ] **Step 3: Add HomePoemCard import**

在 `components/BentoGrid.tsx` 顶部加 import:

```ts
import { HomePoemCard } from './HomePoemCard';
```

- [ ] **Step 4: Typecheck + visual smoke**

```bash
pnpm exec tsc --noEmit
pnpm dev
```

打开 `http://localhost:4444` 看首页 BentoGrid, 确认 4 个 ITEMS 卡片 + 1 个 HomePoemCard 都在, primary 跨 2 行。

- [ ] **Step 5: Commit**

```bash
git add components/BentoGrid.tsx components/HomePoemCard.tsx
git commit -m "feat(home): add HomePoemCard to BentoGrid"
```

---

### Task 20: lib/design.ts — add 诗词 to NAV_LINKS

**Files:**
- Modify: `lib/design.ts:9`

- [ ] **Step 1: Add 诗词 link**

修改 `lib/design.ts` 的 `NAV_LINKS`:

```ts
export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/worksheet', label: '字帖' },
  { href: '/poetry', label: '诗词' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
] as const;
```

- [ ] **Step 2: Verify Header renders new link**

```bash
pnpm exec tsc --noEmit
pnpm dev
```

打开 `http://localhost:4444` 任意页, Header 导航看到「诗词」。

- [ ] **Step 3: Commit**

```bash
git add lib/design.ts
git commit -m "feat(nav): add 诗词 link to header"
```

---

## Phase 8: Final Verification

### Task 21: Run tsc + vitest + build

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

```bash
pnpm exec tsc --noEmit
```

期望: exit 0, no errors.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

期望: 所有原有测试 PASS + 新增 poetry 测试 PASS (无回归)。如果 `DATABASE_URL_TEST` 未设置,integration tests skip。

- [ ] **Step 3: Production build**

```bash
pnpm build
```

期望: exit 0, 列出所有路由 (新路由: `/poetry`, `/poetry/[id]`, `/api/poetry`, `/api/poetry/[id]`, `/api/poetry/random`)。

- [ ] **Step 4: Commit any pending lockfile changes**

```bash
git status
```

如果有未提交的 lockfile 变化,commit:
```bash
git add pnpm-lock.yaml
git commit -m "chore: update lockfile"
```

---

### Task 22: Manual smoke test (human)

**Files:** none (browser smoke)

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

打开 `http://localhost:4444`。

- [ ] **Step 2: Verify poems table auto-populated**

```bash
pnpm exec tsx -e "import('./lib/db').then(async ({getPool, closePool}) => { const p = getPool(); const [r] = await p.query('SELECT dynasty, COUNT(*) c FROM poems GROUP BY dynasty'); console.log(r); await closePool(); })"
```

期望: 输出 `[{ dynasty: 'tang', c: 320 }, { dynasty: 'song', c: 300 }]` (近似值)。

- [ ] **Step 3: Smoke test checklist**

- [ ] 首页加载看到「今日一诗」卡片 (来自 getRandomPoem)
- [ ] Header 导航看到「诗词」链接
- [ ] 点 Header 诗词 → 跳 /poetry, 看到唐诗列表
- [ ] 切到"宋词" tab → 看到 ~300 首宋词
- [ ] 搜索"李白" → 看到他的诗
- [ ] 点开《静夜思》详情页: 米字格 + 拼音 + 标题 + 作者 + 朝代
- [ ] 详情页有"打印本页" 和 "保存到字帖" 按钮
- [ ] 点 "保存到字帖" 未登录 → 跳 /login → 登录后跳 /worksheet/[id]
- [ ] /worksheet/[id] 看到诗的字帖
- [ ] 详情页输入 /poetry/99999 → 404
- [ ] 移动端 (375px) 列表页响应式正常
- [ ] 浏览器打印预览: 详情页只显示字帖, 不显示按钮/导航

- [ ] **Step 4: Document any issues**

如果发现 bug, 创建 follow-up task 修复 (不在本 plan 范围)。

---

## Self-Review Checklist (controller-only, before handoff)

- [x] **Spec coverage:**
  - §3 In scope: /poetry list, /poetry/[id] detail, DB ~620 poems, initDb auto, 3 APIs, Header 诗词, HomePoemCard, save to /worksheet → all covered
  - §4.1 Pages, §4.2 APIs → all in tasks
  - §4.3 Reuse WorksheetCell/api-handler/pinyin-pro/card-paper etc. → noted in task steps
  - §5.1 DDL → Task 1
  - §6 Components → Tasks 12-15
  - §7.1 Build flow → Tasks 9-10
  - §7.2 Browse + save flow → Tasks 16-18
  - §8 Error handling → validator (Tasks 5-8), 404 in Task 7, empty state in Task 16
  - §9.1 Unit tests → Tasks 3, 4, 5, 13, 15
  - §9.2 Integration tests → Tasks 6, 7, 8
  - §9.3 Manual smoke → Task 22
  - §13 Acceptance → Task 22 checklist
- [x] **Placeholder scan:** no TBD/TODO left in code blocks (only `// TODO` removed, replaced with real impl)
- [x] **Type consistency:** `PoemListItem`, `PoemDetail`, `PoemListResult`, `Dynasty` all referenced consistently; `listPoemsRequest`/`getPoemRequest`/`getRandomPoemRequest` names match between tasks
- [x] **One task = self-contained change** (mostly), frequent commits

## Out-of-Scope Reminders

- 用户收藏/喜欢/评论 — 不做
- 词牌/平仄/押韵分析 — 不做
- AI 生成赏析 — 不做
- 诗词音频朗读 — 不做
- 移动端原生 App — 不做
- 修改 /worksheet 支持分行 — 已知风险 (flatten 丢失行结构), v2 任务
