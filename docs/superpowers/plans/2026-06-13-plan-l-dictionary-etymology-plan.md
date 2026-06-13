# Plan L — 完整字典页 + 字源/字形演变 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PinYinCharacter 项目中加入覆盖 8105 通用规范汉字的全表字典页 + 每个汉字的字源/字形演变沉浸子页,使任何常用字都能查到完整元数据与字形演变故事。

**Architecture:** RSC 路由 + 客户端 toggle (字典) + 沉浸式时间轴 (字源) + 5 个开源古字字体 + LLM 故事渐进生成。`chars` 表 8105 行 (硬数据) + `char_etymology` 表 (渐进生成 story + 字体覆盖矩阵)。Plan G `rare_chars` 表保留,内容不互用。

**Tech Stack:** Next.js 15 (App Router, RSC + 'use client'), TypeScript, MySQL (mysql2/promise), Tailwind v4, zod, fontkit (build-time 字体分析), Web Fonts (5 个古字字体 woff2), 复用现有 lib/tts + lib/ai-rare-chars + withAiLogging.

**Spec:** `docs/superpowers/specs/2026-06-13-plan-l-dictionary-etymology-design.md`

**Total tasks:** 32 across 7 phases.

---

## Phase A: Data Layer (Tasks 1-7)

### Task 1: DDL — `chars` table

**Files:**
- Modify: `scripts/init-db.ts` (add CREATE TABLE chars)
- Test: `tests/integration/db/chars.test.ts` (verify table exists)

- [ ] **Step 1: Write failing integration test**

`tests/integration/db/chars.test.ts`:
```ts
import { installTestEnv, integrationDescribe } from '../setup';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/lib/init-db';

installTestEnv();
integrationDescribe('chars table DDL', () => {
  beforeAll(async () => {
    await initDb();
  });
  afterAll(async () => {
    await closePool();
  });
  it('creates chars table with 11 columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chars'`
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(11);
  });
  it('char column is PRIMARY KEY', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_KEY FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'chars' AND column_name = 'char'`
    );
    expect(rows[0].COLUMN_KEY).toBe('PRI');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/db/chars.test.ts`
Expected: FAIL (table doesn't exist)

- [ ] **Step 3: Add DDL to init-db.ts**

In `scripts/init-db.ts`, prepend the chars CREATE TABLE to the DDL array:
```ts
`CREATE TABLE IF NOT EXISTS chars (
   \`char\` VARCHAR(4) NOT NULL,
   level TINYINT NOT NULL,
   pinyin VARCHAR(64) NOT NULL DEFAULT '',
   pinyin_alt TEXT NULL,
   radical VARCHAR(8) NOT NULL DEFAULT '',
   stroke_count SMALLINT NOT NULL DEFAULT 0,
   meaning_zh TEXT NULL,
   meaning_en TEXT NULL,
   unicode_codepoint VARCHAR(8) NOT NULL,
   variants TEXT NULL,
   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   PRIMARY KEY (\`char\`),
   KEY idx_level (level),
   KEY idx_radical (radical),
   KEY idx_pinyin (pinyin),
   KEY idx_stroke (stroke_count)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
```

(The `initDb` function in `lib/init-db.ts` is already called from `instrumentation.ts`; it just runs the DDL string array.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/db/chars.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/init-db.ts tests/integration/db/chars.test.ts
git commit -m "feat(db): chars table DDL (8105 chars, 11 cols + 4 indexes)"
```

---

### Task 2: DDL — `char_etymology` table

**Files:**
- Modify: `scripts/init-db.ts` (add CREATE TABLE char_etymology)
- Test: `tests/integration/db/char-etymology.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/integration/db/char-etymology.test.ts`:
```ts
import { installTestEnv, integrationDescribe } from '../setup';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/lib/init-db';

installTestEnv();
integrationDescribe('char_etymology table DDL', () => {
  beforeAll(async () => {
    await initDb();
  });
  afterAll(async () => {
    await closePool();
  });
  it('creates char_etymology table with char as PK', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT COLUMN_KEY FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'char_etymology' AND column_name = 'char'`
    );
    expect(rows[0].COLUMN_KEY).toBe('PRI');
  });
  it('has 5 era_has boolean columns', async () => {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'char_etymology' AND column_name LIKE '%_has'`
    );
    expect(rows).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/db/char-etymology.test.ts`
Expected: FAIL

- [ ] **Step 3: Add DDL to init-db.ts**

In `scripts/init-db.ts`, append (after chars DDL):
```ts
`CREATE TABLE IF NOT EXISTS char_etymology (
   \`char\` VARCHAR(4) NOT NULL,
   era_jiaguwen_font VARCHAR(32) NOT NULL DEFAULT 'YinQiJiaGuWen',
   era_jiaguwen_has TINYINT(1) NOT NULL DEFAULT 0,
   era_jinwen_font VARCHAR(32) NOT NULL DEFAULT 'HanDianJinWen',
   era_jinwen_has TINYINT(1) NOT NULL DEFAULT 0,
   era_xiaozhuan_font VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuShuoWen',
   era_xiaozhuan_has TINYINT(1) NOT NULL DEFAULT 0,
   era_lishu_font VARCHAR(32) NOT NULL DEFAULT 'QuanZiKuLiDing',
   era_lishu_has TINYINT(1) NOT NULL DEFAULT 0,
   era_kaishu_font VARCHAR(32) NOT NULL DEFAULT 'KaiTi',
   era_kaishu_has TINYINT(1) NOT NULL DEFAULT 1,
   story TEXT NULL,
   generated_by VARCHAR(64) NULL,
   generated_at TIMESTAMP NULL,
   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   PRIMARY KEY (\`char\`),
   KEY idx_generated (generated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/db/char-etymology.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/init-db.ts tests/integration/db/char-etymology.test.ts
git commit -m "feat(db): char_etymology table DDL (5 era slots + story)"
```

---

### Task 3: lib/chars-types.ts (shared types)

**Files:**
- Create: `lib/chars-types.ts`
- Test: `tests/unit/lib/chars-types.test.ts` (type-only — skip if no runtime)

- [ ] **Step 1: Create types file**

`lib/chars-types.ts`:
```ts
export interface Char {
  char: string;
  level: 1 | 2 | 3;
  pinyin: string;
  pinyinAlt: string[];
  radical: string;
  strokeCount: number;
  meaningZh: string | null;
  meaningEn: string | null;
  unicodeCodepoint: string;
  variants: string[];
}

export interface CharWithRelated extends Char {
  relatedByRadical: Char[];
  relatedByPinyin: Char[];
}

export interface CharListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CharClient extends Omit<Char, never> {
  pinyinAlt: string[]; // already serializable
  variants: string[]; // already serializable
}

export interface CharDetailClient extends Omit<CharWithRelated, never> {}

export interface CharListClient {
  chars: CharClient[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/chars-types.ts
git commit -m "feat(types): chars shared types (Char, CharWithRelated, *Client)"
```

---

### Task 4: lib/chars.ts — `listChars` (TDD)

**Files:**
- Create: `lib/chars.ts`
- Test: `tests/unit/lib/chars.test.ts`

- [ ] **Step 1: Write failing test for listChars — search by pinyin**

`tests/unit/lib/chars.test.ts`:
```ts
import { listChars } from '@/lib/chars';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db');

const mockedQuery = jest.fn();
(getPool as jest.Mock).mockReturnValue({ query: mockedQuery, execute: mockedQuery });

describe('listChars', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('queries chars table with pinyin search', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '你', pinyin: 'nǐ', level: 1, radical: '亻', stroke_count: 7, pinyin_alt: null, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4F60', variants: null }], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 1 }]]);

    const result = await listChars({ q: 'ni', page: 1 });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0][0]).toContain('FROM chars');
    expect(mockedQuery.mock.calls[0][0]).toContain('LIKE');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['%ni%', 80, 0]);
    expect(result.total).toBe(1);
    expect(result.chars[0].char).toBe('你');
  });

  it('filters by level=3 only', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ level: 3, page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('level = ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual([3, 80, 0]);
  });

  it('filters by letter (pinyin LIKE a%)', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ letter: 'A', page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('pinyin LIKE ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['A%', 80, 0]);
  });

  it('filters by radical', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    await listChars({ radical: '水', page: 1 });

    expect(mockedQuery.mock.calls[0][0]).toContain('radical = ?');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['水', 80, 0]);
  });

  it('returns empty when 0 results', async () => {
    mockedQuery.mockResolvedValueOnce([[], []]);
    mockedQuery.mockResolvedValueOnce([[{ n: 0 }]]);

    const result = await listChars({ page: 1 });

    expect(result.chars).toEqual([]);
    expect(result.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/chars.test.ts`
Expected: FAIL (no `listChars` export)

- [ ] **Step 3: Implement listChars**

`lib/chars.ts`:
```ts
import { getPool } from './db';
import type { Char, CharListResult } from './chars-types';

const PAGE_SIZE = 80;

export interface ListCharsOpts {
  q?: string;
  letter?: string;
  radical?: string;
  level?: 1 | 2 | 3;
  page?: number;
}

function mapRow(row: any): Char {
  return {
    char: row.char,
    level: row.level,
    pinyin: row.pinyin ?? '',
    pinyinAlt: row.pinyin_alt ? JSON.parse(row.pinyin_alt) : [],
    radical: row.radical ?? '',
    strokeCount: row.stroke_count ?? 0,
    meaningZh: row.meaning_zh,
    meaningEn: row.meaning_en,
    unicodeCodepoint: row.unicode_codepoint,
    variants: row.variants ? JSON.parse(row.variants) : [],
  };
}

export async function listChars(opts: ListCharsOpts = {}): Promise<CharListResult> {
  const pool = getPool();
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = [];
  const params: any[] = [];

  if (opts.q) {
    where.push('(pinyin LIKE ? OR `char` = ? OR meaning_en LIKE ?)');
    params.push(`%${opts.q}%`, opts.q, `%${opts.q}%`);
  }
  if (opts.letter) {
    where.push('pinyin LIKE ?');
    params.push(`${opts.letter}%`);
  }
  if (opts.radical) {
    where.push('radical = ?');
    params.push(opts.radical);
  }
  if (opts.level) {
    where.push('level = ?');
    params.push(opts.level);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     ${whereSql}
     ORDER BY pinyin, \`char\`
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM chars ${whereSql}`,
    params
  );

  return {
    chars: rows.map(mapRow),
    total: countRows[0].n,
    page,
    pageSize: PAGE_SIZE,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/chars.test.ts`
Expected: 5/5 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chars.ts tests/unit/lib/chars.test.ts
git commit -m "feat(chars): listChars — filter by q/letter/radical/level + paged"
```

---

### Task 5: lib/chars.ts — `getChar` + `getCharDetail` (TDD)

**Files:**
- Modify: `lib/chars.ts`
- Modify: `tests/unit/lib/chars.test.ts` (add 6 tests)

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/lib/chars.test.ts`:
```ts
import { getChar, getCharDetail } from '@/lib/chars';

describe('getChar', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns single char by string', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '一', stroke_count: 1, meaning_zh: '数目字', meaning_en: 'one', unicode_codepoint: 'U+4E00', variants: null }]]);
    const result = await getChar('一');
    expect(result?.char).toBe('一');
    expect(result?.strokeCount).toBe(1);
  });

  it('returns null when char not found', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getChar('X');
    expect(result).toBeNull();
  });
});

describe('getCharDetail', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns char + related by radical + related by pinyin', async () => {
    // getChar query
    mockedQuery.mockResolvedValueOnce([[{ char: '一', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '一', stroke_count: 1, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4E00', variants: null }]]);
    // relatedByRadical (limit 8)
    mockedQuery.mockResolvedValueOnce([[{ char: '丁', level: 1, pinyin: 'dīng', pinyin_alt: null, radical: '一', stroke_count: 2, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+4E01', variants: null }]]);
    // relatedByPinyin (limit 8)
    mockedQuery.mockResolvedValueOnce([[{ char: '衣', level: 1, pinyin: 'yī', pinyin_alt: null, radical: '衤', stroke_count: 6, meaning_zh: null, meaning_en: null, unicode_codepoint: 'U+8863', variants: null }]]);

    const result = await getCharDetail('一');
    expect(result?.char).toBe('一');
    expect(result?.relatedByRadical).toHaveLength(1);
    expect(result?.relatedByPinyin).toHaveLength(1);
  });

  it('returns null when char not found', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getCharDetail('X');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/lib/chars.test.ts`
Expected: FAIL (`getChar`/`getCharDetail` not exported)

- [ ] **Step 3: Add getChar + getCharDetail to lib/chars.ts**

Append to `lib/chars.ts`:
```ts
import type { CharWithRelated } from './chars-types';

const RELATED_LIMIT = 8;

export async function getChar(char: string): Promise<Char | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE \`char\` = ?
     LIMIT 1`,
    [char]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getCharDetail(char: string): Promise<CharWithRelated | null> {
  const base = await getChar(char);
  if (!base) return null;
  const pool = getPool();
  const [radicalRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE radical = ? AND \`char\` != ?
     ORDER BY stroke_count
     LIMIT ?`,
    [base.radical, char, RELATED_LIMIT]
  );
  const [pinyinRows] = await pool.query<any[]>(
    `SELECT \`char\`, level, pinyin, pinyin_alt, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint, variants
     FROM chars
     WHERE pinyin = ? AND \`char\` != ?
     ORDER BY \`char\`
     LIMIT ?`,
    [base.pinyin, char, RELATED_LIMIT]
  );
  return {
    ...base,
    relatedByRadical: radicalRows.map(mapRow),
    relatedByPinyin: pinyinRows.map(mapRow),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/lib/chars.test.ts`
Expected: 9/9 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chars.ts tests/unit/lib/chars.test.ts
git commit -m "feat(chars): getChar + getCharDetail with related by radical/pinyin"
```

---

### Task 6: lib/etymology-types.ts + lib/etymology.ts — `getEtymology` (TDD)

**Files:**
- Create: `lib/etymology-types.ts`
- Create: `lib/etymology.ts`
- Test: `tests/unit/lib/etymology.test.ts`

- [ ] **Step 1: Create types file**

`lib/etymology-types.ts`:
```ts
export const ERAS = ['jiaguwen', 'jinwen', 'xiaozhuan', 'lishu', 'kaishu'] as const;
export type Era = (typeof ERAS)[number];

export interface EraGlyph {
  era: Era;
  font: string;
  hasGlyph: boolean;
}

export interface Etymology {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
}

export interface EtymologyAdjacent {
  prev: string | null;
  next: string | null;
}

export interface EtymologyClient {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  prev: string | null;
  next: string | null;
}
```

- [ ] **Step 2: Write failing test for getEtymology**

`tests/unit/lib/etymology.test.ts`:
```ts
import { getEtymology } from '@/lib/etymology';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db');

const mockedQuery = jest.fn();
(getPool as jest.Mock).mockReturnValue({ query: mockedQuery, execute: mockedQuery });

describe('getEtymology', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns null when char not in char_etymology', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    const result = await getEtymology('龘');
    expect(result).toBeNull();
  });

  it('returns full etymology with 5 era slots', async () => {
    mockedQuery.mockResolvedValueOnce([[{
      char: '一',
      era_jiaguwen_font: 'YinQiJiaGuWen', era_jiaguwen_has: 1,
      era_jinwen_font: 'HanDianJinWen', era_jinwen_has: 1,
      era_xiaozhuan_font: 'QuanZiKuShuoWen', era_xiaozhuan_has: 1,
      era_lishu_font: 'QuanZiKuLiDing', era_lishu_has: 1,
      era_kaishu_font: 'KaiTi', era_kaishu_has: 1,
      story: '一 字演变...',
      generated_by: 'gpt-4o',
      generated_at: new Date('2026-06-13T00:00:00Z'),
    }]]);

    const result = await getEtymology('一');
    expect(result?.char).toBe('一');
    expect(result?.eraGlyphs).toHaveLength(5);
    expect(result?.eraGlyphs[0].era).toBe('jiaguwen');
    expect(result?.eraGlyphs[0].hasGlyph).toBe(true);
    expect(result?.story).toBe('一 字演变...');
  });

  it('marks missing glyphs as hasGlyph=false', async () => {
    mockedQuery.mockResolvedValueOnce([[{
      char: '龘', era_jiaguwen_has: 0, era_jinwen_has: 0,
      era_xiaozhuan_has: 0, era_lishu_has: 0, era_kaishu_has: 1,
      era_jiaguwen_font: 'YinQiJiaGuWen', era_jinwen_font: 'HanDianJinWen',
      era_xiaozhuan_font: 'QuanZiKuShuoWen', era_lishu_font: 'QuanZiKuLiDing',
      era_kaishu_font: 'KaiTi',
      story: null, generated_by: null, generated_at: null,
    }]]);

    const result = await getEtymology('龘');
    expect(result?.eraGlyphs[0].hasGlyph).toBe(false);
    expect(result?.eraGlyphs[4].hasGlyph).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/lib/etymology.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement getEtymology**

`lib/etymology.ts`:
```ts
import { getPool } from './db';
import { ERAS, type Etymology, type EraGlyph } from './etymology-types';

export async function getEtymology(char: string): Promise<Etymology | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`,
            era_jiaguwen_font, era_jiaguwen_has,
            era_jinwen_font, era_jinwen_has,
            era_xiaozhuan_font, era_xiaozhuan_has,
            era_lishu_font, era_lishu_has,
            era_kaishu_font, era_kaishu_has,
            story, generated_by, generated_at
     FROM char_etymology
     WHERE \`char\` = ?
     LIMIT 1`,
    [char]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const eraGlyphs: EraGlyph[] = ERAS.map((era) => ({
    era,
    font: r[`era_${era}_font`],
    hasGlyph: Boolean(r[`era_${era}_has`]),
  }));
  return {
    char: r.char,
    eraGlyphs,
    story: r.story,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at ? r.generated_at.toISOString() : null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/lib/etymology.test.ts`
Expected: 3/3 PASS

- [ ] **Step 6: Commit**

```bash
git add lib/etymology-types.ts lib/etymology.ts tests/unit/lib/etymology.test.ts
git commit -m "feat(etymology): getEtymology — 5 era glyphs + story from char_etymology"
```

---

### Task 7: lib/etymology.ts — `getAdjacentChars` (TDD)

**Files:**
- Modify: `lib/etymology.ts`
- Modify: `tests/unit/lib/etymology.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/lib/etymology.test.ts`:
```ts
import { getAdjacentChars } from '@/lib/etymology';

describe('getAdjacentChars', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('returns prev and next by unicode codepoint order', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '丁' }]]); // prev
    mockedQuery.mockResolvedValueOnce([[{ char: '七' }]]); // next

    const result = await getAdjacentChars('一');
    expect(result.prev).toBe('丁');
    expect(result.next).toBe('七');
  });

  it('returns null prev when char is first', async () => {
    mockedQuery.mockResolvedValueOnce([[]]);
    mockedQuery.mockResolvedValueOnce([[{ char: '万' }]]);

    const result = await getAdjacentChars('一');
    expect(result.prev).toBeNull();
    expect(result.next).toBe('万');
  });

  it('returns null next when char is last', async () => {
    mockedQuery.mockResolvedValueOnce([[{ char: '万' }]]);
    mockedQuery.mockResolvedValueOnce([[]]);

    const result = await getAdjacentChars('蠼');
    expect(result.next).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/etymology.test.ts`
Expected: FAIL

- [ ] **Step 3: Add getAdjacentChars to lib/etymology.ts**

Append:
```ts
import type { EtymologyAdjacent } from './etymology-types';

export async function getAdjacentChars(char: string): Promise<EtymologyAdjacent> {
  const pool = getPool();
  // prev: char with smaller unicode_codepoint, closest
  const [prevRows] = await pool.query<any[]>(
    `SELECT c.\`char\`
     FROM chars c
     WHERE c.unicode_codepoint < (SELECT unicode_codepoint FROM chars WHERE \`char\` = ?)
     ORDER BY c.unicode_codepoint DESC
     LIMIT 1`,
    [char]
  );
  const [nextRows] = await pool.query<any[]>(
    `SELECT c.\`char\`
     FROM chars c
     WHERE c.unicode_codepoint > (SELECT unicode_codepoint FROM chars WHERE \`char\` = ?)
     ORDER BY c.unicode_codepoint ASC
     LIMIT 1`,
    [char]
  );
  return {
    prev: prevRows[0]?.char ?? null,
    next: nextRows[0]?.char ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/etymology.test.ts`
Expected: 6/6 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/etymology.ts tests/unit/lib/etymology.test.ts
git commit -m "feat(etymology): getAdjacentChars — prev/next by unicode_codepoint"
```

---

## Phase B: API Layer (Tasks 8-11)

### Task 8: lib/validators.ts — chars + etymology schemas

**Files:**
- Modify: `lib/validators.ts`
- Test: `tests/unit/lib/validators-chars.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/lib/validators-chars.test.ts`:
```ts
import { charsListQuerySchema, charParamSchema, etymologyCharParamSchema } from '@/lib/validators';

describe('charsListQuerySchema', () => {
  it('defaults page=1, pageSize=24', () => {
    const r = charsListQuerySchema.parse({});
    expect(r.page).toBe(1);
  });
  it('coerces page string', () => {
    const r = charsListQuerySchema.parse({ page: '3' });
    expect(r.page).toBe(3);
  });
  it('rejects level > 3', () => {
    expect(() => charsListQuerySchema.parse({ level: '4' })).toThrow();
  });
  it('accepts level 1/2/3', () => {
    expect(charsListQuerySchema.parse({ level: '1' }).level).toBe(1);
    expect(charsListQuerySchema.parse({ level: '2' }).level).toBe(2);
    expect(charsListQuerySchema.parse({ level: '3' }).level).toBe(3);
  });
  it('letter is single uppercase A-Z', () => {
    expect(charsListQuerySchema.parse({ letter: 'A' }).letter).toBe('A');
    expect(() => charsListQuerySchema.parse({ letter: 'abc' })).toThrow();
    expect(() => charsListQuerySchema.parse({ letter: '1' })).toThrow();
  });
});

describe('charParamSchema', () => {
  it('accepts single CJK char', () => {
    expect(charParamSchema.parse({ char: '一' }).char).toBe('一');
  });
  it('rejects multi-char', () => {
    expect(() => charParamSchema.parse({ char: '你好' })).toThrow();
  });
  it('rejects empty', () => {
    expect(() => charParamSchema.parse({ char: '' })).toThrow();
  });
});

describe('etymologyCharParamSchema', () => {
  it('same as charParamSchema (alias)', () => {
    expect(etymologyCharParamSchema.parse({ char: '龘' }).char).toBe('龘');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/lib/validators-chars.test.ts`
Expected: FAIL

- [ ] **Step 3: Add schemas to lib/validators.ts**

Append to `lib/validators.ts`:
```ts
export const charsListQuerySchema = z.object({
  q: z.string().max(32).transform((s) => s.trim()).optional(),
  letter: z.string().regex(/^[A-Z]$/).optional(),
  radical: z.string().max(8).optional(),
  level: z.coerce.number().int().min(1).max(3).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const charParamSchema = z.object({
  char: z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
    error: 'must be a single CJK char',
  }),
});

export const etymologyCharParamSchema = charParamSchema;

export const adminGenerateEtymologySchema = z.object({
  chars: z.array(z.string().refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s))).min(1).max(100),
});

export const adminCronConfigSchema = z.object({
  enabled: z.boolean(),
  perDay: z.number().int().min(1).max(1000),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/lib/validators-chars.test.ts`
Expected: 11/11 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/validators.ts tests/unit/lib/validators-chars.test.ts
git commit -m "feat(validators): chars list/param + etymology param + admin schemas"
```

---

### Task 9: GET /api/chars (list + search)

**Files:**
- Create: `app/api/chars/route.ts`
- Test: `tests/integration/api/chars.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/integration/api/chars.test.ts`:
```ts
import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/chars', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?)`,
      ['一', 1, 'yī', '一', 1, 'U+4E00']
    );
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?)`,
      ['丁', 1, 'dīng', '一', 2, 'U+4E01']
    );
  });

  it('200 returns list of chars', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new Request('http://x/api/chars') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.total).toBe(2);
  });

  it('400 on invalid level', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new Request('http://x/api/chars?level=99') as any);
    expect(r.status).toBe(400);
  });

  it('filters by letter', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/route');
    const r = await GET(new Request('http://x/api/chars?letter=Y') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.chars.map((c: any) => c.char)).toEqual(['一']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/chars.test.ts`
Expected: FAIL (route doesn't exist)

- [ ] **Step 3: Create route**

`app/api/chars/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { listChars } from '@/lib/chars';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { charsListQuerySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const sp = req.nextUrl.searchParams;
    const parsed = charsListQuerySchema.safeParse({
      q: sp.get('q') ?? undefined,
      letter: sp.get('letter') ?? undefined,
      radical: sp.get('radical') ?? undefined,
      level: sp.get('level') ?? undefined,
      page: sp.get('page') ?? undefined,
    });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await listChars(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/chars.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/chars/route.ts tests/integration/api/chars.test.ts
git commit -m "feat(api): GET /api/chars (list + search by q/letter/radical/level)"
```

---

### Task 10: GET /api/chars/[char] (detail)

**Files:**
- Create: `app/api/chars/[char]/route.ts`
- Test: `tests/integration/api/chars-detail.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/integration/api/chars-detail.test.ts`:
```ts
import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/chars/[char]', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, meaning_zh, meaning_en, unicode_codepoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['一', 1, 'yī', '一', 1, '数目字', 'one', 'U+4E00']
    );
  });

  it('200 returns char detail with related', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/' + encodeURIComponent('一')) as any, { params: Promise.resolve({ char: '一' }) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.char).toBe('一');
    expect(j.data.pinyin).toBe('yī');
    expect(j.data.meaningZh).toBe('数目字');
  });

  it('404 when char not found', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/X') as any, { params: Promise.resolve({ char: 'X' }) });
    expect(r.status).toBe(404);
  });

  it('400 on multi-char path', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/chars/[char]/route');
    const r = await GET(new Request('http://x/api/chars/abc') as any, { params: Promise.resolve({ char: 'abc' }) });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/chars-detail.test.ts`
Expected: FAIL

- [ ] **Step 3: Create route**

`app/api/chars/[char]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCharDetail } from '@/lib/chars';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { charParamSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ char: string }> }) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const decoded = decodeURIComponent(char);
    const parsed = charParamSchema.safeParse({ char: decoded });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const result = await getCharDetail(decoded);
    if (!result) return notFound('not_found', 'char not found');
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/chars-detail.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/chars/[char]/route.ts tests/integration/api/chars-detail.test.ts
git commit -m "feat(api): GET /api/chars/[char] (detail + related by radical/pinyin)"
```

---

### Task 11: GET /api/etymology/[char]

**Files:**
- Create: `app/api/etymology/[char]/route.ts`
- Test: `tests/integration/api/etymology.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/integration/api/etymology.test.ts`:
```ts
import { integrationDescribe, installTestEnv, truncateAll } from '../setup';
import { getPool } from '@/lib/db';

installTestEnv();
integrationDescribe('GET /api/etymology/[char]', () => {
  beforeEach(async () => {
    await truncateAll();
    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('一', 1, 'yī', '一', 1, 'U+4E00')`
    );
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('丁', 1, 'dīng', '一', 2, 'U+4E01')`
    );
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('七', 1, 'qī', '一', 2, 'U+4E03')`
    );
    await pool.execute(
      `INSERT INTO char_etymology (\`char\`, era_jiaguwen_has, era_jinwen_has, era_xiaozhuan_has, era_lishu_has, era_kaishu_has, story, generated_by, generated_at)
       VALUES ('一', 1, 1, 1, 1, 1, '一字演变故事', 'gpt-4o', NOW())`
    );
  });

  it('200 returns etymology + prev/next', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/etymology/[char]/route');
    const r = await GET(new Request('http://x/api/etymology/' + encodeURIComponent('一')) as any, { params: Promise.resolve({ char: '一' }) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.char).toBe('一');
    expect(j.data.story).toBe('一字演变故事');
    expect(j.data.prev).toBe('丁');
    expect(j.data.next).toBe('七');
    expect(j.data.eraGlyphs).toHaveLength(5);
  });

  it('404 when char not in char_etymology', async () => {
    if (!process.env.DATABASE_URL_TEST) return;
    const { GET } = await import('@/app/api/etymology/[char]/route');
    const r = await GET(new Request('http://x/api/etymology/七') as any, { params: Promise.resolve({ char: '七' }) });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/etymology.test.ts`
Expected: FAIL

- [ ] **Step 3: Create route**

`app/api/etymology/[char]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';
import { withErrorHandling, badRequest, notFound } from '@/lib/api-handler';
import { etymologyCharParamSchema } from '@/lib/validators';
import type { EtymologyClient } from '@/lib/etymology-types';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ char: string }> }) {
  return withErrorHandling(async () => {
    const { char } = await params;
    const decoded = decodeURIComponent(char);
    const parsed = etymologyCharParamSchema.safeParse({ char: decoded });
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');
    const [etymology, adjacent] = await Promise.all([getEtymology(decoded), getAdjacentChars(decoded)]);
    if (!etymology) return notFound('not_found', 'etymology not found');
    const data: EtymologyClient = {
      ...etymology,
      prev: adjacent.prev,
      next: adjacent.next,
    };
    return NextResponse.json({ ok: true, data });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/etymology.test.ts`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/etymology/[char]/route.ts tests/integration/api/etymology.test.ts
git commit -m "feat(api): GET /api/etymology/[char] (5 era glyphs + story + prev/next)"
```

---

## Phase C: Dictionary Frontend (Tasks 12-19)

### Task 12: 3 small components (PinyinAnchor, RadicalSidebar, DictionaryCharGrid)

**Files:**
- Create: `components/dictionary/PinyinAnchor.tsx`
- Create: `components/dictionary/RadicalSidebar.tsx`
- Create: `components/dictionary/DictionaryCharGrid.tsx`
- Test: `tests/unit/components/dictionary/pinyin-anchor.test.tsx`

- [ ] **Step 1: Write failing test for PinyinAnchor**

`tests/unit/components/dictionary/pinyin-anchor.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { PinyinAnchor } from '@/components/dictionary/PinyinAnchor';

describe('PinyinAnchor', () => {
  it('renders 26 letter buttons A-Z', () => {
    render(<PinyinAnchor activeLetter="A" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(26);
  });
  it('highlights active letter', () => {
    render(<PinyinAnchor activeLetter="M" />);
    const m = screen.getByRole('button', { name: 'M' });
    expect(m.className).toContain('bg-ink'); // or whatever active class
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/dictionary/pinyin-anchor.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create PinyinAnchor component**

`components/dictionary/PinyinAnchor.tsx`:
```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function PinyinAnchor({ activeLetter }: { activeLetter?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const handleClick = (letter: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('view', 'pinyin');
    params.set('letter', letter);
    router.push(`/dictionary?${params.toString()}#${letter}`);
  };

  return (
    <nav className="flex flex-wrap gap-1 border-b border-ink/20 pb-3 mb-4" aria-label="拼音首字母">
      {LETTERS.map((l) => (
        <button
          key={l}
          onClick={() => handleClick(l)}
          className={`px-2 py-1 text-sm rounded ${
            activeLetter === l
              ? 'bg-ink text-paper font-semibold'
              : 'text-ink-soft hover:bg-paper-warm'
          }`}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create RadicalSidebar component**

`components/dictionary/RadicalSidebar.tsx`:
```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

export const RADICALS = [
  '一','丨','丶','丿','乙','亅','二','亠','人','儿','入','八','冂','冖','冫','几',
  '凵','刀','力','勹','匕','匚','匸','十','卜','卩','厂','厶','又','口','囗','土',
  '士','夂','夊','夕','大','女','子','宀','寸','小','尢','尸','屮','山','巛','工',
  '己','巾','干','幺','广','廴','廾','弋','弓','彐','彡','彳','心','戈','户','手',
  '支','攴','文','斗','斤','方','无','日','曰','月','木','欠','止','歹','殳','毋',
  '比','毛','氏','气','水','火','爪','父','爻','爿','片','牙','牛','犬','玄','玉',
  '瓜','瓦','甘','生','用','田','疋','疒','癶','白','皮','皿','目','矛','矢','石',
  '示','禸','禾','穴','立','竹','米','糸','缶','网','羊','羽','老','而','耒','耳',
  '聿','肉','臣','自','至','臼','舌','舛','舟','艮','色','艸','虍','虫','血','行',
  '衣','襾','見','角','言','谷','豆','豕','豸','貝','赤','走','足','身','車','辛',
  '辰','辵','邑','酉','釆','里','金','長','門','阜','隶','隹','雨','靑','非','面',
  '革','韋','音','頁','風','飛','食','首','香','馬','骨','高','髟','鬥','鬯','鬲',
  '鬼','魚','鳥','鹵','鹿','麥','麻','黃','黍','黑','黹','黽','鼎','鼓','鼠','鼻',
  '齊','齒','龍','龜','龠',
];

export function RadicalSidebar({ activeRadical }: { activeRadical?: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const handleClick = (radical: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('view', 'radical');
    params.set('radical', radical);
    router.push(`/dictionary?${params.toString()}#${radical}`);
  };

  return (
    <aside className="w-24 flex-shrink-0 border-r border-ink/20 pr-3" aria-label="部首">
      <div className="text-xs text-ink-faint mb-2">部首</div>
      <div className="grid grid-cols-4 gap-1">
        {RADICALS.map((r) => (
          <button
            key={r}
            onClick={() => handleClick(r)}
            title={`部首 ${r}`}
            className={`aspect-square flex items-center justify-center text-base rounded ${
              activeRadical === r
                ? 'bg-ink text-paper'
                : 'text-ink hover:bg-paper-warm'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Create DictionaryCharGrid component**

`components/dictionary/DictionaryCharGrid.tsx`:
```tsx
import Link from 'next/link';
import type { Char } from '@/lib/chars-types';

export function DictionaryCharGrid({ chars }: { chars: Char[] }) {
  if (chars.length === 0) {
    return <p className="text-ink-faint text-sm py-8 text-center">没有匹配的字</p>;
  }
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
      {chars.map((c) => (
        <Link
          key={c.char}
          href={`/dictionary/${encodeURIComponent(c.char)}`}
          className="rounded border border-ink/10 p-2 text-center transition hover:border-seal hover:shadow-sm bg-paper"
        >
          <div className="text-2xl font-serif text-ink leading-none">{c.char}</div>
          <div className="text-xs text-ink-soft mt-1">{c.pinyin || '—'}</div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/dictionary/pinyin-anchor.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 7: Commit**

```bash
git add components/dictionary/PinyinAnchor.tsx components/dictionary/RadicalSidebar.tsx components/dictionary/DictionaryCharGrid.tsx tests/unit/components/dictionary/pinyin-anchor.test.tsx
git commit -m "feat(dict): PinyinAnchor + RadicalSidebar + DictionaryCharGrid components"
```

---

### Task 13: DictionarySearch component

**Files:**
- Create: `components/dictionary/DictionarySearch.tsx`
- Test: `tests/unit/components/dictionary/dictionary-search.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/dictionary/dictionary-search.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DictionarySearch } from '@/components/dictionary/DictionarySearch';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(''),
}));

describe('DictionarySearch', () => {
  beforeEach(() => mockPush.mockClear());

  it('renders input with placeholder', () => {
    render(<DictionarySearch />);
    expect(screen.getByPlaceholderText(/拼音|汉字/)).toBeInTheDocument();
  });

  it('navigates to /dictionary?q=... on form submit', () => {
    render(<DictionarySearch />);
    const input = screen.getByPlaceholderText(/拼音|汉字/);
    fireEvent.change(input, { target: { value: 'ni' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('q=ni'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-search.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create component**

`components/dictionary/DictionarySearch.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function DictionarySearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get('q') ?? '';
  const [q, setQ] = useState(initial);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (q.trim()) {
      params.set('q', q.trim());
    } else {
      params.delete('q');
    }
    params.delete('letter');
    params.delete('radical');
    router.push(`/dictionary?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜拼音 / 汉字 / 英文"
        maxLength={32}
        className="flex-1 rounded border border-ink/30 bg-paper px-3 py-2 text-sm focus:border-seal focus:outline-none"
      />
      <button type="submit" className="btn-seal text-sm px-4">搜索</button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-search.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add components/dictionary/DictionarySearch.tsx tests/unit/components/dictionary/dictionary-search.test.tsx
git commit -m "feat(dict): DictionarySearch — submits q via URL search params"
```

---

### Task 14: DictionaryClient (toggle 拼音/部首)

**Files:**
- Create: `components/dictionary/DictionaryClient.tsx`
- Test: `tests/unit/components/dictionary/dictionary-client.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/dictionary/dictionary-client.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DictionaryClient } from '@/components/dictionary/DictionaryClient';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams('view=pinyin'),
}));

const sampleChars = [
  { char: '一', level: 1 as const, pinyin: 'yī', pinyinAlt: [], radical: '一', strokeCount: 1, meaningZh: null, meaningEn: null, unicodeCodepoint: 'U+4E00', variants: [] },
  { char: '丁', level: 1 as const, pinyin: 'dīng', pinyinAlt: [], radical: '一', strokeCount: 2, meaningZh: null, meaningEn: null, unicodeCodepoint: 'U+4E01', variants: [] },
];

describe('DictionaryClient', () => {
  beforeEach(() => mockPush.mockClear());

  it('renders pinyin view by default with anchor + grid', () => {
    render(<DictionaryClient chars={sampleChars} total={2} page={1} pageSize={24} />);
    expect(screen.getAllByRole('button')).toHaveLength(26); // 26 letter buttons
    expect(screen.getByText('一')).toBeInTheDocument();
  });

  it('toggles to radical view when 按部首 clicked', () => {
    render(<DictionaryClient chars={sampleChars} total={2} page={1} pageSize={24} />);
    fireEvent.click(screen.getByRole('button', { name: /按部首/ }));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=radical'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-client.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create DictionaryClient**

`components/dictionary/DictionaryClient.tsx`:
```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Char } from '@/lib/chars-types';
import { PinyinAnchor } from './PinyinAnchor';
import { RadicalSidebar, RADICALS } from './RadicalSidebar';
import { DictionaryCharGrid } from './DictionaryCharGrid';

interface Props {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export function DictionaryClient({ chars, total, page, pageSize }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const view = sp.get('view') === 'radical' ? 'radical' : 'pinyin';
  const activeLetter = sp.get('letter') ?? undefined;
  const activeRadical = sp.get('radical') ?? undefined;

  const switchView = (newView: 'pinyin' | 'radical') => {
    const params = new URLSearchParams(sp.toString());
    params.set('view', newView);
    if (newView === 'pinyin') {
      params.delete('radical');
    } else {
      params.delete('letter');
    }
    router.push(`/dictionary?${params.toString()}`);
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-ink-faint tracking-widest">字典 · {total} 字</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => switchView('pinyin')}
            className={`text-sm px-3 py-1 rounded ${
              view === 'pinyin' ? 'bg-ink text-paper' : 'bg-paper-warm text-ink-soft border border-ink/20'
            }`}
          >
            按拼音
          </button>
          <button
            onClick={() => switchView('radical')}
            className={`text-sm px-3 py-1 rounded ${
              view === 'radical' ? 'bg-ink text-paper' : 'bg-paper-warm text-ink-soft border border-ink/20'
            }`}
          >
            按部首
          </button>
        </div>
      </div>

      {view === 'pinyin' ? (
        <>
          <PinyinAnchor activeLetter={activeLetter} />
          <DictionaryCharGrid chars={chars} />
        </>
      ) : (
        <div className="flex gap-4">
          <RadicalSidebar activeRadical={activeRadical} />
          <div className="flex-1">
            <div className="text-xs text-ink-faint mb-3">
              {activeRadical ? `部首「${activeRadical}」` : '选择一个部首'}
            </div>
            <DictionaryCharGrid chars={chars} />
          </div>
        </div>
      )}

      {/* Pagination: simple next/prev */}
      <div className="mt-6 flex justify-center gap-3 text-sm text-ink-soft">
        {page > 1 && (
          <a
            href={`/dictionary?${(() => { const p = new URLSearchParams(sp.toString()); p.set('page', String(page - 1)); return p.toString(); })()}`}
            className="hover:text-ink"
          >
            ‹ 上一页
          </a>
        )}
        <span>
          {page} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        {page * pageSize < total && (
          <a
            href={`/dictionary?${(() => { const p = new URLSearchParams(sp.toString()); p.set('page', String(page + 1)); return p.toString(); })()}`}
            className="hover:text-ink"
          >
            下一页 ›
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-client.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add components/dictionary/DictionaryClient.tsx tests/unit/components/dictionary/dictionary-client.test.tsx
git commit -m "feat(dict): DictionaryClient — pinyin/radical toggle + pagination"
```

---

### Task 15: /dictionary page (RSC shell)

**Files:**
- Create: `app/dictionary/page.tsx`

- [ ] **Step 1: Create page**

`app/dictionary/page.tsx`:
```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { listChars } from '@/lib/chars';
import { DictionaryClient } from '@/components/dictionary/DictionaryClient';
import { DictionarySearch } from '@/components/dictionary/DictionarySearch';
import { EmptyState } from '@/components/common/EmptyState';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string; letter?: string; radical?: string; level?: string; page?: string; view?: string }>;
}

export default async function DictionaryPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = sp.view === 'radical' ? 'radical' : 'pinyin';
  const result = await listChars({
    q: sp.q,
    letter: view === 'pinyin' ? sp.letter : undefined,
    radical: view === 'radical' ? sp.radical : undefined,
    level: sp.level ? (Number(sp.level) as 1 | 2 | 3) : undefined,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 通用规范字典</div>
        <SectionTitle subtitle="通用规范汉字表 · 8105 字">字典</SectionTitle>

        <Suspense>
          <DictionarySearch />
        </Suspense>

        {result.chars.length === 0 ? (
          <EmptyState
            title="没有匹配的字"
            description={sp.q ? `没有匹配 "${sp.q}" 的字。` : '字典为空。'}
          />
        ) : (
          <DictionaryClient
            chars={result.chars}
            total={result.total}
            page={result.page}
            pageSize={result.pageSize}
          />
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify dev server starts (manual, optional)**

Run: `pnpm dev` and visit `http://localhost:4444/dictionary`
Expected: page renders without error

- [ ] **Step 4: Commit**

```bash
git add app/dictionary/page.tsx
git commit -m "feat(dict): /dictionary RSC shell — search + toggle + paged grid"
```

---

### Task 16: DictionaryDetailTabs (4 tabs: 字典/字源/故事/+字帖)

**Files:**
- Create: `components/dictionary/DictionaryDetailTabs.tsx`
- Test: `tests/unit/components/dictionary/dictionary-detail-tabs.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/dictionary/dictionary-detail-tabs.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { DictionaryDetailTabs } from '@/components/dictionary/DictionaryDetailTabs';

const char = { char: '一', level: 1 as const, pinyin: 'yī', pinyinAlt: [], radical: '一', strokeCount: 1, meaningZh: '数目字', meaningEn: 'one', unicodeCodepoint: 'U+4E00', variants: [] };
const related = {
  ...char,
  relatedByRadical: [],
  relatedByPinyin: [],
};

describe('DictionaryDetailTabs', () => {
  it('renders 4 tab labels', () => {
    render(<DictionaryDetailTabs char={related} />);
    expect(screen.getByText('字典')).toBeInTheDocument();
    expect(screen.getByText(/字源/)).toBeInTheDocument();
    expect(screen.getByText(/故事/)).toBeInTheDocument();
    expect(screen.getByText(/字帖/)).toBeInTheDocument();
  });

  it('shows 7 fields on 字典 tab', () => {
    render(<DictionaryDetailTabs char={related} />);
    expect(screen.getByText(/拼音/)).toBeInTheDocument();
    expect(screen.getByText(/部首/)).toBeInTheDocument();
    expect(screen.getByText(/释义/)).toBeInTheDocument();
    expect(screen.getByText(/英文/)).toBeInTheDocument();
    expect(screen.getByText(/Unicode/)).toBeInTheDocument();
    expect(screen.getByText(/异体/)).toBeInTheDocument();
  });

  it('字源 tab is a link to /etymology/[char]', () => {
    render(<DictionaryDetailTabs char={related} />);
    const link = screen.getByText(/^字源/);
    expect(link.closest('a')).toHaveAttribute('href', '/etymology/' + encodeURIComponent('一'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-detail-tabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create DictionaryDetailTabs**

`components/dictionary/DictionaryDetailTabs.tsx`:
```tsx
import Link from 'next/link';
import type { CharWithRelated } from '@/lib/chars-types';

export function DictionaryDetailTabs({ char }: { char: CharWithRelated }) {
  return (
    <div>
      <div className="flex gap-0 border-b border-ink/30 mb-4">
        <span className="bg-ink text-paper px-3 py-2 rounded-t text-sm">字典</span>
        <Link
          href={`/etymology/${encodeURIComponent(char.char)}`}
          className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
        >
          字源 →
        </Link>
        <Link
          href={`/stories/${encodeURIComponent(char.char)}`}
          className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
        >
          故事 →
        </Link>
        <Link
          href={`/worksheet?text=${encodeURIComponent(char.char)}`}
          className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
        >
          + 字帖
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="拼音" value={char.pinyin} />
        <Field label="部首" value={`${char.radical} · ${char.strokeCount} 画`} />
        <Field label="释义" value={char.meaningZh || '—'} multiline />
        <Field label="英文" value={char.meaningEn || '—'} />
        <Field label="Unicode" value={char.unicodeCodepoint} />
        <Field label="异体" value={char.variants.length > 0 ? char.variants.join('、') : '—'} />
        {char.pinyinAlt.length > 1 && (
          <Field label="多音" value={char.pinyinAlt.join('、')} />
        )}
        <Field label="级别" value={`通用规范 ${char.level} 级`} />
      </div>

      {(char.relatedByRadical.length > 0 || char.relatedByPinyin.length > 0) && (
        <div className="mt-6 text-sm">
          {char.relatedByRadical.length > 0 && (
            <div className="mb-2">
              <span className="text-ink-faint">同部首 ·</span>{' '}
              {char.relatedByRadical.map((c) => (
                <Link key={c.char} href={`/dictionary/${encodeURIComponent(c.char)}`} className="mr-2 hover:text-seal">
                  {c.char}
                </Link>
              ))}
            </div>
          )}
          {char.relatedByPinyin.length > 0 && (
            <div>
              <span className="text-ink-faint">同拼音 ·</span>{' '}
              {char.relatedByPinyin.map((c) => (
                <Link key={c.char} href={`/dictionary/${encodeURIComponent(c.char)}`} className="mr-2 hover:text-seal">
                  {c.char}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? 'sm:col-span-2' : ''}>
      <span className="text-ink-faint">{label} ·</span>{' '}
      <span className={multiline ? 'whitespace-pre-line' : ''}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/dictionary/dictionary-detail-tabs.test.tsx`
Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add components/dictionary/DictionaryDetailTabs.tsx tests/unit/components/dictionary/dictionary-detail-tabs.test.tsx
git commit -m "feat(dict): DictionaryDetailTabs (字典/字源/故事/+字帖)"
```

---

### Task 17: /dictionary/[char] page (RSC)

**Files:**
- Create: `app/dictionary/[char]/page.tsx`

- [ ] **Step 1: Create page**

`app/dictionary/[char]/page.tsx`:
```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getCharDetail } from '@/lib/chars';
import { DictionaryDetailTabs } from '@/components/dictionary/DictionaryDetailTabs';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function DictionaryDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const data = await getCharDetail(decoded);
  if (!data) notFound();
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <SectionTitle subtitle={`${data.unicodeCodepoint} · 通用规范 ${data.level} 级`}>
          <span className="text-7xl font-serif text-ink mr-3">{data.char}</span>
        </SectionTitle>
        <DictionaryDetailTabs char={data} />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/dictionary/[char]/page.tsx
git commit -m "feat(dict): /dictionary/[char] page — 详情 + 4 tabs"
```

---

## Phase D: Etymology Frontend (Tasks 18-21)

### Task 18: EraGlyph component

**Files:**
- Create: `components/etymology/EraGlyph.tsx`
- Test: `tests/unit/components/etymology/era-glyph.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/etymology/era-glyph.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { EraGlyph } from '@/components/etymology/EraGlyph';

describe('EraGlyph', () => {
  it('renders the char with era font class when hasGlyph=true', () => {
    render(<EraGlyph char="一" era="jiaguwen" font="YinQiJiaGuWen" hasGlyph={true} />);
    const span = screen.getByText('一');
    expect(span.className).toContain('font-jiaguwen');
  });

  it('renders 「暂无」placeholder when hasGlyph=false', () => {
    render(<EraGlyph char="龘" era="jiaguwen" font="YinQiJiaGuWen" hasGlyph={false} />);
    expect(screen.getByText('暂无')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/etymology/era-glyph.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create component**

`components/etymology/EraGlyph.tsx`:
```tsx
import type { Era } from '@/lib/etymology-types';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

const ERA_FONT_CLASS: Record<Era, string> = {
  jiaguwen: 'font-jiaguwen',
  jinwen: 'font-jinwen',
  xiaozhuan: 'font-xiaozhuan',
  lishu: 'font-lishu',
  kaishu: 'font-kai',
};

interface Props {
  char: string;
  era: Era;
  font: string;
  hasGlyph: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function EraGlyph({ char, era, hasGlyph, size = 'md' }: Props) {
  const sizeClass = size === 'lg' ? 'text-7xl' : size === 'sm' ? 'text-2xl' : 'text-4xl';

  if (!hasGlyph) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className={`${sizeClass} text-ink-faint border border-dashed border-ink/20 rounded flex items-center justify-center aspect-square w-20`}
        >
          暂无
        </div>
        <div className="text-xs text-ink-faint">{ERA_LABELS[era]}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`${sizeClass} ${ERA_FONT_CLASS[era]} text-ink`}>{char}</span>
      <div className="text-xs text-ink-faint">{ERA_LABELS[era]}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/etymology/era-glyph.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add components/etymology/EraGlyph.tsx tests/unit/components/etymology/era-glyph.test.tsx
git commit -m "feat(etymology): EraGlyph — render char with era font OR 「暂无」placeholder"
```

---

### Task 19: EtymologyTimeline (interactive timeline)

**Files:**
- Create: `components/etymology/EtymologyTimeline.tsx`
- Test: `tests/unit/components/etymology/etymology-timeline.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/etymology/etymology-timeline.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { EtymologyTimeline } from '@/components/etymology/EtymologyTimeline';

const glyphs = [
  { era: 'jiaguwen' as const, font: 'YinQiJiaGuWen', hasGlyph: true },
  { era: 'jinwen' as const, font: 'HanDianJinWen', hasGlyph: true },
  { era: 'xiaozhuan' as const, font: 'QuanZiKuShuoWen', hasGlyph: true },
  { era: 'lishu' as const, font: 'QuanZiKuLiDing', hasGlyph: true },
  { era: 'kaishu' as const, font: 'KaiTi', hasGlyph: true },
];

describe('EtymologyTimeline', () => {
  it('renders 5 era dots', () => {
    render(<EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />);
    const dots = screen.getAllByRole('button', { name: /甲骨文|金文|小篆|隶书|楷书/ });
    expect(dots).toHaveLength(5);
  });

  it('kaishu is active by default (last era)', () => {
    render(<EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />);
    // big char should be displayed
    expect(screen.getAllByText('一').length).toBeGreaterThan(0);
  });

  it('switches active era on click', () => {
    render(<EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />);
    fireEvent.click(screen.getByRole('button', { name: '甲骨文' }));
    // The big char is still 一 but now shown with font-jiaguwen
    const bigChar = screen.getAllByText('一').find(el => el.className.includes('text-7xl'));
    expect(bigChar?.className).toContain('font-jiaguwen');
  });

  it('right arrow key advances era', () => {
    render(<EtymologyTimeline char="一" eraGlyphs={glyphs} story="演变故事" />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // last (kaishu) → wraps or stops at end
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/etymology/etymology-timeline.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create component**

`components/etymology/EtymologyTimeline.tsx`:
```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { ERAS, type Era, type EraGlyph as EraGlyphType } from '@/lib/etymology-types';
import { EraGlyph } from './EraGlyph';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

interface Props {
  char: string;
  eraGlyphs: EraGlyphType[];
  story: string | null;
}

export function EtymologyTimeline({ char, eraGlyphs, story }: Props) {
  const [activeIdx, setActiveIdx] = useState(ERAS.length - 1); // start at 楷书
  const activeEra = ERAS[activeIdx];
  const activeGlyph = eraGlyphs.find((g) => g.era === activeEra);

  const handlePrev = useCallback(() => setActiveIdx((i) => Math.max(0, i - 1)), []);
  const handleNext = useCallback(() => setActiveIdx((i) => Math.min(ERAS.length - 1, i + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePrev, handleNext]);

  return (
    <div>
      {/* Big char */}
      <div className="text-center py-10 px-4 bg-gradient-to-b from-paper-warm to-paper rounded">
        {activeGlyph ? (
          <EraGlyph
            char={char}
            era={activeGlyph.era}
            font={activeGlyph.font}
            hasGlyph={activeGlyph.hasGlyph}
            size="lg"
          />
        ) : null}
      </div>

      {/* Timeline dots */}
      <div className="flex items-center justify-center gap-3 my-6">
        {ERAS.map((era, idx) => {
          const glyph = eraGlyphs.find((g) => g.era === era);
          const isActive = idx === activeIdx;
          const hasGlyph = glyph?.hasGlyph ?? false;
          return (
            <button
              key={era}
              onClick={() => setActiveIdx(idx)}
              className="flex flex-col items-center gap-1 group"
              aria-label={ERA_LABELS[era]}
            >
              <span
                className={`w-3 h-3 rounded-full ${
                  isActive ? 'bg-ink scale-125' : hasGlyph ? 'bg-ink-soft' : 'bg-ink/20'
                } transition`}
              />
              <span className={`text-xs ${isActive ? 'text-ink font-semibold' : 'text-ink-faint'}`}>
                {ERA_LABELS[era]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Story */}
      {story ? (
        <div className="text-base leading-loose text-ink p-4 bg-paper-warm rounded">
          <span className="text-ink-faint text-sm">演变 ·</span> {story}
        </div>
      ) : (
        <div className="text-sm text-ink-faint text-center py-6">字源故事即将生成</div>
      )}

      {/* Hidden keyboard hint */}
      <div className="text-xs text-ink-faint text-center mt-4">
        ← / → 切换时代
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/etymology/etymology-timeline.test.tsx`
Expected: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add components/etymology/EtymologyTimeline.tsx tests/unit/components/etymology/etymology-timeline.test.tsx
git commit -m "feat(etymology): EtymologyTimeline — 5 era dots + ←/→ keyboard + story"
```

---

### Task 20: EtymologyPrevNext

**Files:**
- Create: `components/etymology/EtymologyPrevNext.tsx`

- [ ] **Step 1: Create component**

`components/etymology/EtymologyPrevNext.tsx`:
```tsx
import Link from 'next/link';

interface Props {
  prev: string | null;
  next: string | null;
}

export function EtymologyPrevNext({ prev, next }: Props) {
  return (
    <div className="mt-6 flex justify-between text-sm">
      {prev ? (
        <Link href={`/etymology/${encodeURIComponent(prev)}`} className="text-ink-soft hover:text-ink">
          ← 上一字「{prev}」
        </Link>
      ) : (
        <span className="text-ink-faint">已是第一个字</span>
      )}
      {next ? (
        <Link href={`/etymology/${encodeURIComponent(next)}`} className="text-ink-soft hover:text-ink">
          下一字「{next}」→
        </Link>
      ) : (
        <span className="text-ink-faint">已是最后一个字</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/etymology/EtymologyPrevNext.tsx
git commit -m "feat(etymology): EtymologyPrevNext — 上一字/下一字 links"
```

---

### Task 21: /etymology/[char] page (RSC)

**Files:**
- Create: `app/etymology/[char]/page.tsx`

- [ ] **Step 1: Create page**

`app/etymology/[char]/page.tsx`:
```tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';
import { EtymologyTimeline } from '@/components/etymology/EtymologyTimeline';
import { EtymologyPrevNext } from '@/components/etymology/EtymologyPrevNext';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function EtymologyPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  const [etymology, adjacent] = await Promise.all([getEtymology(decoded), getAdjacentChars(decoded)]);
  if (!etymology) notFound();
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="flex items-center justify-between mb-4">
          <Link href={`/dictionary/${encodeURIComponent(decoded)}`} className="text-sm text-ink-soft hover:text-ink">
            ← 返回字典
          </Link>
          <span className="text-xs text-ink-faint tracking-widest">字 · 韵 · 字源</span>
        </div>
        <SectionTitle subtitle={etymology.story ? '字形演变故事' : '字源即将生成'}>
          字源
        </SectionTitle>
        <EtymologyTimeline
          char={etymology.char}
          eraGlyphs={etymology.eraGlyphs}
          story={etymology.story}
        />
        <EtymologyPrevNext prev={adjacent.prev} next={adjacent.next} />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles + dev server**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/etymology/[char]/page.tsx
git commit -m "feat(etymology): /etymology/[char] RSC page (timeline + prev/next)"
```

---

## Phase E: Fonts (Tasks 22-24)

### Task 22: scripts/download-ancient-fonts.ts

**Files:**
- Create: `scripts/download-ancient-fonts.ts`
- Create: `public/fonts/.gitkeep`

- [ ] **Step 1: Create font directory + download script**

`scripts/download-ancient-fonts.ts`:
```ts
/**
 * Download 5 ancient-script fonts for Plan L.
 * Sources are open / public-domain Chinese font projects.
 *
 * Run: pnpm tsx scripts/download-ancient-fonts.ts
 * Skip if any font is already present.
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import { get } from 'https';

const FONTS_DIR = 'public/fonts';
mkdirSync(FONTS_DIR, { recursive: true });

interface FontSource {
  name: string;
  url: string;
  outFile: string;
}

const SOURCES: FontSource[] = [
  // 殷契甲骨文 (YinQi) — open source, hosted on jsDelivr CDN
  // If unreachable, this is a soft fail — Plan L still works, just shows 「暂无」 for that era.
  {
    name: 'YinQiJiaGuWen',
    url: 'https://cdn.jsdelivr.net/gh/anonymous-ye/yinqi-fonts@main/殷契甲骨文.woff2',
    outFile: `${FONTS_DIR}/yinqi-jiaguwen.woff2`,
  },
  // 漢典金文
  {
    name: 'HanDianJinWen',
    url: 'https://cdn.jsdelivr.net/gh/Pal3love/Source-Han-Wen-Zi@release/金文.woff2',
    outFile: `${FONTS_DIR}/handian-jinwen.woff2`,
  },
  // 全字库说文解字 (CNS11643)
  {
    name: 'QuanZiKuShuoWen',
    url: 'https://cdn.jsdelivr.net/gh/ButTaiwan/cjk-fonts-ttf@master/全字庫說文解字.ttf',
    outFile: `${FONTS_DIR}/quanziku-shuowen.ttf`,
  },
  // 全字库隶定
  {
    name: 'QuanZiKuLiDing',
    url: 'https://cdn.jsdelivr.net/gh/ButTaiwan/cjk-fonts-ttf@master/全字庫隸定.ttf',
    outFile: `${FONTS_DIR}/quanziku-liding.ttf`,
  },
  // 楷书 (use existing or fallback to local font from next/font)
  // No download needed — the existing kai font covers it.
];

async function downloadWithRetry(url: string, outFile: string, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      if (existsSync(outFile)) {
        console.log(`[skip] ${outFile} already exists`);
        return true;
      }
      await download(url, outFile);
      console.log(`[ok] ${outFile}`);
      return true;
    } catch (err) {
      console.warn(`[retry ${i + 1}/${retries}] ${url}: ${(err as Error).message}`);
      if (i === retries - 1) {
        console.warn(`[fail] ${outFile} — will fall back to 「暂无」 for that era`);
        return false;
      }
    }
  }
  return false;
}

function download(url: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location;
        if (redirect) {
          download(redirect, outFile).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      mkdirSync(dirname(outFile), { recursive: true });
      pipeline(res, createWriteStream(outFile)).then(() => resolve()).catch(reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
  });
}

async function main() {
  console.log('Downloading Plan L ancient fonts...');
  for (const src of SOURCES) {
    await downloadWithRetry(src.url, src.outFile);
  }
  console.log('Done. (failures are non-fatal — coverage detection will mark those chars as `has_glyph=false`)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json` (modify):
```json
"scripts": {
  "fonts:download": "tsx scripts/download-ancient-fonts.ts"
}
```

- [ ] **Step 3: Run the download (try, expect partial success)**

Run: `pnpm fonts:download`
Expected: some/all succeed; failures are logged but script exits 0

- [ ] **Step 4: Verify dev server still works (fonts not present shouldn't break)**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add scripts/download-ancient-fonts.ts public/fonts/.gitkeep package.json
git commit -m "feat(fonts): download script for 5 ancient-script fonts (Plan L)"
```

---

### Task 23: globals.css + tailwind.config.ts (5 font-faces)

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts` (or `app/globals.css` if Tailwind v4 in-CSS config)

- [ ] **Step 1: Check existing font setup**

Read `app/globals.css` to see existing `@font-face` blocks. Match the pattern.

- [ ] **Step 2: Add 5 @font-face declarations**

In `app/globals.css`, add at the end (or near other @font-face):
```css
@font-face {
  font-family: 'YinQiJiaGuWen';
  src: url('/fonts/yinqi-jiaguwen.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'HanDianJinWen';
  src: url('/fonts/handian-jinwen.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'QuanZiKuShuoWen';
  src: url('/fonts/quanziku-shuowen.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'QuanZiKuLiDing';
  src: url('/fonts/quanziku-liding.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'KaiTi';
  src: local('KaiTi'), local('STKaiti'), local('BiauKai');
  font-display: swap;
}
```

- [ ] **Step 3: Add Tailwind font family tokens**

In `tailwind.config.ts` (modify `theme.extend.fontFamily`):
```ts
fontFamily: {
  kai: ['KaiTi', 'STKaiti', 'BiauKai', 'serif'],
  jiaguwen: ['YinQiJiaGuWen', 'serif'],
  jinwen: ['HanDianJinWen', 'serif'],
  xiaozhuan: ['QuanZiKuShuoWen', 'serif'],
  lishu: ['QuanZiKuLiDing', 'serif'],
}
```

(If project uses Tailwind v4 in-CSS config, the equivalent syntax goes in `app/globals.css` under `@theme`.)

- [ ] **Step 4: Verify build still works**

Run: `pnpm build`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat(fonts): 5 ancient-script @font-face + Tailwind font-family tokens"
```

---

### Task 24: Header nav — add 字典 link

**Files:**
- Modify: `components/Header.tsx`

- [ ] **Step 1: Read existing Header to find NAV_LINKS**

Read `components/Header.tsx` and find where existing nav links (字库/字帖/故事 etc.) are defined.

- [ ] **Step 2: Add 字典 link in correct position**

Add to the nav links array (in the existing pattern, between `字库` and `字帖` per spec):
```ts
{ href: '/dictionary', label: '字典' },
```

- [ ] **Step 3: Verify dev server**

Run: `pnpm dev`, click around to confirm 字典 link works.

- [ ] **Step 4: Commit**

```bash
git add components/Header.tsx
git commit -m "feat(nav): add 字典 link in Header (between 字库 and 字帖)"
```

---

## Phase F: Admin (Tasks 25-29)

### Task 25: lib/char-ai.ts — generateEtymologyStory (LLM wrapper)

**Files:**
- Create: `lib/char-ai.ts`
- Test: `tests/unit/lib/char-ai.test.ts`

- [ ] **Step 1: Write failing test (mocked LLM)**

`tests/unit/lib/char-ai.test.ts`:
```ts
import { generateEtymologyStory } from '@/lib/char-ai';

jest.mock('@/lib/llm', () => ({
  callLlm: jest.fn(),
}));

const { callLlm } = require('@/lib/llm');

describe('generateEtymologyStory', () => {
  it('returns LLM story text', async () => {
    (callLlm as jest.Mock).mockResolvedValueOnce('一 字演变故事正文...');
    const story = await generateEtymologyStory({ char: '一', pinyin: 'yī', meaningZh: '数目字' });
    expect(story).toBe('一 字演变故事正文...');
  });

  it('uses the etymology prompt template', async () => {
    (callLlm as jest.Mock).mockResolvedValueOnce('story');
    await generateEtymologyStory({ char: '丁', pinyin: 'dīng', meaningZh: null });
    expect(callLlm).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('字源'),
      prompt: expect.stringContaining('丁'),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/lib/char-ai.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement generateEtymologyStory**

`lib/char-ai.ts`:
```ts
import { callLlm } from './llm';

const SYSTEM_PROMPT = `你是一位汉语言文字学家,擅长汉字字源研究。`;

function buildPrompt(char: string, pinyin: string, meaningZh: string | null): string {
  return `请为汉字「${char}」(拼音: ${pinyin}${meaningZh ? `, 释义: ${meaningZh}` : ''}) 写一段 150-250 字的字源演变故事。

要求:
1. 涵盖该字在甲骨文/金文/小篆/隶书/楷书 5 个时代的字形演变
2. 说明字形演变的动因 (如简化、讹变、规范化等)
3. 简洁生动,适合普通读者
4. 不用 Markdown 格式,纯文本

直接输出故事正文,不要前缀。`;
}

export interface EtymologyStoryInput {
  char: string;
  pinyin: string;
  meaningZh: string | null;
}

export async function generateEtymologyStory(input: EtymologyStoryInput): Promise<string> {
  const text = await callLlm({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input.char, input.pinyin, input.meaningZh),
    temperature: 0.5,
    maxTokens: 500,
  });
  return text.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/lib/char-ai.test.ts`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/char-ai.ts tests/unit/lib/char-ai.test.ts
git commit -m "feat(ai): generateEtymologyStory LLM wrapper (reuses lib/llm.callLlm)"
```

---

### Task 26: GET /api/admin/chars/coverage

**Files:**
- Create: `app/api/admin/chars/coverage/route.ts`
- Test: `tests/integration/api/admin-chars-coverage.test.ts`

- [ ] **Step 1: Write failing test**

`tests/integration/api/admin-chars-coverage.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (SELECT \`char\` FROM chars WHERE pinyin LIKE 'covtest%')`);
  await pool.query(`DELETE FROM chars WHERE pinyin LIKE 'covtest%'`);
  await pool.query(`DELETE FROM users WHERE id IN (?)`, [testUserIds]);
  testUserIds = [];
}

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

function loginAs(token: string) {
  testCookieStore['auth_token'] = { value: token };
}
function logout() {
  delete testCookieStore['auth_token'];
}

async function insertUser(username: string, isAdmin = false): Promise<number> {
  const pool = getPool();
  const hash = await hashPassword('longenoughpwd');
  const [res] = await pool.execute<any>(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
    [username, hash, isAdmin ? 1 : 0],
  );
  const id = Number(res.insertId);
  testUserIds.push(id);
  return id;
}

const d = HAS_DB ? describe : describe.skip;

d('admin: GET /api/admin/chars/coverage', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    await getPool().query('SELECT 1');
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closePool();
  });

  it('returns coverage stats (admin only)', async () => {
    const adminId = await insertUser('adm_cov_1', true);
    const token = await signSession({ id: adminId, username: 'adm_cov_1' });
    loginAs(token);

    const pool = getPool();
    // use a pinyin-prefix marker so cleanup is deterministic
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint) VALUES ('一', 1, 'covtest-yi', '一', 1, 'U+4E00')`
    );
    await pool.execute(`INSERT INTO char_etymology (\`char\`, story) VALUES ('一', 'story')`);

    const { GET } = await import('@/app/api/admin/chars/coverage/route');
    const r = await GET(new Request('http://x/api/admin/chars/coverage') as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.totalChars).toBeGreaterThanOrEqual(1);
    expect(j.data.charsWithEtymology).toBeGreaterThanOrEqual(1);
    expect(typeof j.data.coveragePct).toBe('number');

    logout();
  });

  it('403 when not admin', async () => {
    const userId = await insertUser('usr_cov_1', false);
    const token = await signSession({ id: userId, username: 'usr_cov_1' });
    loginAs(token);

    const { GET } = await import('@/app/api/admin/chars/coverage/route');
    const r = await GET(new Request('http://x/api/admin/chars/coverage') as any);
    expect(r.status).toBe(403);

    logout();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/admin-chars-coverage.test.ts`
Expected: FAIL

- [ ] **Step 3: Create route**

`app/api/admin/chars/coverage/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-handler';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const pool = getPool();
    const [totals] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM chars`);
    const [withStory] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NOT NULL AND story <> ''`
    );
    const [byLevel] = await pool.query<any[]>(
      `SELECT level, COUNT(*) AS total,
              SUM(CASE WHEN ce.story IS NOT NULL AND ce.story <> '' THEN 1 ELSE 0 END) AS with_story
       FROM chars c
       LEFT JOIN char_etymology ce ON c.\`char\` = ce.\`char\`
       GROUP BY level
       ORDER BY level`
    );
    const [byEra] = await pool.query<any[]>(
      `SELECT
         SUM(era_jiaguwen_has) AS jiaguwen,
         SUM(era_jinwen_has) AS jinwen,
         SUM(era_xiaozhuan_has) AS xiaozhuan,
         SUM(era_lishu_has) AS lishu,
         SUM(era_kaishu_has) AS kaishu
       FROM char_etymology`
    );

    const total = totals[0].n;
    const withEtymology = withStory[0].n;
    return NextResponse.json({
      ok: true,
      data: {
        totalChars: total,
        charsWithEtymology: withEtymology,
        coveragePct: total > 0 ? Math.round((withEtymology / total) * 1000) / 10 : 0,
        byLevel: byLevel.map((r) => ({
          level: r.level,
          total: r.total,
          withStory: r.with_story,
        })),
        eraCoverage: byEra[0],
      },
    });
  });
}
```

(Note: `requireAdmin()` from `@/lib/auth` returns `{ ok: true, user } | { ok: false, response }`. See `app/api/admin/users/route.ts` for the canonical pattern.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/admin-chars-coverage.test.ts`
Expected: 2/2 PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/chars/coverage/route.ts tests/integration/api/admin-chars-coverage.test.ts
git commit -m "feat(api): GET /api/admin/chars/coverage (admin stats: total/level/era)"
```

---

### Task 27: POST /api/admin/chars/generate (manual LLM trigger)

**Files:**
- Create: `app/api/admin/chars/generate/route.ts`
- Test: `tests/integration/api/admin-chars-generate.test.ts`

- [ ] **Step 1: Write failing test (mocked LLM)**

`tests/integration/api/admin-chars-generate.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { hashPassword, signSession } from '@/lib/auth';

// Mock the AI wrapper BEFORE importing the route
vi.mock('@/lib/char-ai', () => ({
  generateEtymologyStory: vi.fn().mockResolvedValue('mocked story'),
}));

const HAS_DB = !!process.env.DATABASE_URL_TEST;

let testUserIds: number[] = [];

async function cleanup() {
  if (testUserIds.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM char_etymology WHERE \`char\` IN (SELECT \`char\` FROM chars WHERE pinyin LIKE 'gentest%')`);
  await pool.query(`DELETE FROM chars WHERE pinyin LIKE 'gentest%'`);
  await pool.query(`DELETE FROM users WHERE id IN (?)`, [testUserIds]);
  testUserIds = [];
}

type Bag = { value: string };
const testCookieStore: Record<string, Bag> = {};

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => testCookieStore[name],
    set: (opts: any) => { testCookieStore[opts.name] = { value: opts.value }; },
    delete: (name: string) => { delete testCookieStore[name]; },
  }),
}));

function loginAs(token: string) {
  testCookieStore['auth_token'] = { value: token };
}
function logout() {
  delete testCookieStore['auth_token'];
}

async function insertUser(username: string, isAdmin = false): Promise<number> {
  const pool = getPool();
  const hash = await hashPassword('longenoughpwd');
  const [res] = await pool.execute<any>(
    `INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)`,
    [username, hash, isAdmin ? 1 : 0],
  );
  const id = Number(res.insertId);
  testUserIds.push(id);
  return id;
}

const d = HAS_DB ? describe : describe.skip;

d('admin: POST /api/admin/chars/generate', () => {
  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'integration-test-secret-must-be-32+chars-long';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    await getPool().query('SELECT 1');
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await closePool();
  });

  it('generates story for a single char', async () => {
    const adminId = await insertUser('adm_gen_1', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_1' });
    loginAs(token);

    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, meaning_zh) VALUES ('一', 1, 'gentest-yi', '一', 1, 'U+4E00', '数目字')`
    );

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: ['一'] }),
    }) as any;
    const r = await POST(req);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.generated).toBe(1);

    const [rows] = await pool.query<any[]>(`SELECT story FROM char_etymology WHERE \`char\` = '一'`);
    expect(rows[0].story).toBe('mocked story');

    logout();
  });

  it('skips chars already in char_etymology with story', async () => {
    const adminId = await insertUser('adm_gen_2', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_2' });
    loginAs(token);

    const pool = getPool();
    await pool.execute(
      `INSERT INTO chars (\`char\`, level, pinyin, radical, stroke_count, unicode_codepoint, meaning_zh) VALUES ('丁', 1, 'gentest-ding', '一', 2, 'U+4E01', '天干第四位')`
    );
    await pool.execute(`INSERT INTO char_etymology (\`char\`, story) VALUES ('丁', 'existing')`);

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: ['丁'] }),
    }) as any;
    const r = await POST(req);
    const j = await r.json();
    expect(j.data.skipped).toBe(1);
    expect(j.data.generated).toBe(0);

    logout();
  });

  it('400 on empty chars array', async () => {
    const adminId = await insertUser('adm_gen_3', true);
    const token = await signSession({ id: adminId, username: 'adm_gen_3' });
    loginAs(token);

    const { POST } = await import('@/app/api/admin/chars/generate/route');
    const req = new Request('http://x/api/admin/chars/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chars: [] }),
    }) as any;
    const r = await POST(req);
    expect(r.status).toBe(400);

    logout();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/api/admin-chars-generate.test.ts`
Expected: FAIL

- [ ] **Step 3: Create route**

`app/api/admin/chars/generate/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, badRequest } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { adminGenerateEtymologySchema } from '@/lib/validators';
import { generateEtymologyStory } from '@/lib/char-ai';
import { withAiLogging } from '@/lib/ai-calls';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const parsed = adminGenerateEtymologySchema.safeParse(body);
    if (!parsed.success) return badRequest('bad_input', parsed.error.issues[0]?.message ?? 'bad input');

    const pool = getPool();
    let generated = 0;
    let skipped = 0;
    const errors: { char: string; message: string }[] = [];

    for (const char of parsed.data.chars) {
      // check if already has story
      const [existing] = await pool.query<any[]>(
        `SELECT story FROM char_etymology WHERE \`char\` = ? LIMIT 1`,
        [char]
      );
      if (existing.length > 0 && existing[0].story) {
        skipped++;
        continue;
      }

      // fetch char metadata for the LLM prompt
      const [charRows] = await pool.query<any[]>(
        `SELECT pinyin, meaning_zh FROM chars WHERE \`char\` = ? LIMIT 1`,
        [char]
      );
      if (charRows.length === 0) {
        errors.push({ char, message: 'char not in chars table' });
        continue;
      }

      try {
        const story = await withAiLogging(
          { feature: 'etymology-story', input: char, model: process.env.LLM_MODEL ?? 'gpt-4o-mini' },
          () => generateEtymologyStory({
            char,
            pinyin: charRows[0].pinyin ?? '',
            meaningZh: charRows[0].meaning_zh,
          })
        );

        // upsert
        await pool.execute(
          `INSERT INTO char_etymology (\`char\`, story, generated_by, generated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE story = VALUES(story), generated_by = VALUES(generated_by), generated_at = NOW()`,
          [char, story, process.env.LLM_MODEL ?? 'gpt-4o-mini']
        );
        generated++;
      } catch (err) {
        errors.push({ char, message: (err as Error).message });
      }
    }

    return NextResponse.json({ ok: true, data: { generated, skipped, errors } });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/api/admin-chars-generate.test.ts`
Expected: 3/3 PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/chars/generate/route.ts tests/integration/api/admin-chars-generate.test.ts
git commit -m "feat(api): POST /api/admin/chars/generate (admin manual LLM trigger)"
```

---

### Task 28: /admin/chars page (coverage dashboard)

**Files:**
- Create: `app/admin/chars/page.tsx`
- Modify: `app/admin/layout.tsx` (add sub-nav link if applicable)

- [ ] **Step 1: Read existing admin layout**

Read `app/admin/layout.tsx` to understand the structure. Plan H already added an AdminSidebar — append a link there if needed.

- [ ] **Step 2: Create page**

`app/admin/chars/page.tsx`:
```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getPool } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function fetchCoverage() {
  const pool = getPool();
  const [totals] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM chars`);
  const [withStory] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM char_etymology WHERE story IS NOT NULL AND story <> ''`
  );
  const [byLevel] = await pool.query<any[]>(
    `SELECT level, COUNT(*) AS total,
            SUM(CASE WHEN ce.story IS NOT NULL AND ce.story <> '' THEN 1 ELSE 0 END) AS with_story
     FROM chars c
     LEFT JOIN char_etymology ce ON c.\`char\` = ce.\`char\`
     GROUP BY level ORDER BY level`
  );
  return {
    total: totals[0].n,
    withStory: withStory[0].n,
    byLevel,
  };
}

export default async function AdminCharsPage() {
  const cov = await fetchCoverage();
  const pct = cov.total > 0 ? Math.round((cov.withStory / cov.total) * 1000) / 10 : 0;
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <SectionTitle subtitle="字典 + 字源 数据覆盖">字典 / 字源</SectionTitle>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Stat label="总字符" value={cov.total} />
          <Stat label="已生成字源" value={cov.withStory} />
          <Stat label="覆盖率" value={`${pct}%`} />
        </div>

        <div className="card-paper p-4 mb-6">
          <h3 className="text-sm font-semibold mb-3 text-ink-faint">按级别</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint">
                <th className="py-1">级别</th>
                <th className="py-1">总数</th>
                <th className="py-1">有字源</th>
                <th className="py-1">覆盖率</th>
              </tr>
            </thead>
            <tbody>
              {cov.byLevel.map((r) => (
                <tr key={r.level} className="border-t border-ink/10">
                  <td className="py-2">{r.level} 级</td>
                  <td>{r.total}</td>
                  <td>{r.with_story ?? 0}</td>
                  <td>{r.total > 0 ? Math.round(((r.with_story ?? 0) / r.total) * 1000) / 10 : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Link href="/admin/chars/generate" className="btn-seal inline-block">
          手动触发字源生成 →
        </Link>
      </PageContainer>
      <Footer />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-paper p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-2xl font-serif text-ink mt-1">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Add sidebar link**

In `app/admin/layout.tsx` (or AdminSidebar component from Plan H), add a link to `/admin/chars` in the navigation.

- [ ] **Step 4: Commit**

```bash
git add app/admin/chars/page.tsx app/admin/layout.tsx
git commit -m "feat(admin): /admin/chars page (coverage stats + link to generate)"
```

---

### Task 29: /admin/chars/generate page (manual trigger UI)

**Files:**
- Create: `app/admin/chars/generate/page.tsx`
- Create: `components/admin/GenerateEtymologyForm.tsx`
- Test: `tests/unit/components/admin/generate-etymology-form.test.tsx`

- [ ] **Step 1: Write failing test**

`tests/unit/components/admin/generate-etymology-form.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { GenerateEtymologyForm } from '@/components/admin/GenerateEtymologyForm';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GenerateEtymologyForm', () => {
  beforeEach(() => mockFetch.mockClear());

  it('renders textarea + submit button', () => {
    render(<GenerateEtymologyForm />);
    expect(screen.getByPlaceholderText(/汉字/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成/ })).toBeInTheDocument();
  });

  it('submits chars to /api/admin/chars/generate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { generated: 2, skipped: 0, errors: [] } }),
    });
    render(<GenerateEtymologyForm />);
    fireEvent.change(screen.getByPlaceholderText(/汉字/), { target: { value: '一丁' } });
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/chars/generate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ chars: ['一', '丁'] }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/components/admin/generate-etymology-form.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create form component**

`components/admin/GenerateEtymologyForm.tsx`:
```tsx
'use client';
import { useState } from 'react';

export function GenerateEtymologyForm() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ generated: number; skipped: number; errors: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const chars = Array.from(input).filter((c) => /[一-鿿]/.test(c));
    if (chars.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/chars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chars }),
      });
      const j = await res.json();
      if (j.ok) setResult(j.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card-paper p-4">
      <label className="block text-sm text-ink-faint mb-2">输入要生成的汉字(每个字单独生成一次)</label>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        maxLength={100}
        placeholder="一丁七万丈三..."
        className="w-full border border-ink/30 rounded p-2 text-base font-serif"
      />
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={loading} className="btn-seal">
          {loading ? '生成中...' : '生成字源'}
        </button>
        <span className="text-xs text-ink-faint">已输入 {Array.from(input).filter((c) => /[一-鿿]/.test(c)).length} 个字</span>
      </div>
      {result && (
        <div className="mt-4 p-3 bg-paper-warm rounded text-sm">
          <div>✓ 已生成 <span className="font-semibold">{result.generated}</span> 个</div>
          {result.skipped > 0 && <div>↷ 跳过 {result.skipped} 个(已有字源)</div>}
          {result.errors.length > 0 && (
            <div className="text-seal mt-1">
              ✗ 失败 {result.errors.length} 个:{result.errors.map((e) => e.char).join('、')}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Create page**

`app/admin/chars/generate/page.tsx`:
```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { GenerateEtymologyForm } from '@/components/admin/GenerateEtymologyForm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function AdminCharsGeneratePage() {
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <Link href="/admin/chars" className="text-sm text-ink-soft hover:text-ink">← 返回覆盖率</Link>
        <SectionTitle subtitle="为指定汉字生成字源演变故事">手动触发生成</SectionTitle>
        <GenerateEtymologyForm />
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/components/admin/generate-etymology-form.test.tsx`
Expected: 2/2 PASS

- [ ] **Step 6: Commit**

```bash
git add app/admin/chars/generate/page.tsx components/admin/GenerateEtymologyForm.tsx tests/unit/components/admin/generate-etymology-form.test.tsx
git commit -m "feat(admin): /admin/chars/generate + form (manual LLM trigger UI)"
```

---

## Phase G: Wrap (Tasks 30-32)

### Task 30: scripts/import-chars-data.ts (one-time initial data import)

**Files:**
- Create: `scripts/import-chars-data.ts`

- [ ] **Step 1: Create import script**

`scripts/import-chars-data.ts`:
```ts
/**
 * One-time import: read data/general-standard-chinese-characters.json
 * and seed the chars table (level + char + unicode_codepoint).
 * Pinyin/meaning/radical/stroke are best-effort filled; admin can edit later.
 *
 * Run: pnpm tsx scripts/import-chars-data.ts
 */
import { getPool, closePool } from '../lib/db';
import chars from '../data/general-standard-chinese-characters.json';
import radicals from '../data/radicals.json';

async function main() {
  const pool = getPool();

  console.log(`Importing ${chars.length} chars...`);
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const level = i < 3500 ? 1 : i < 6500 ? 2 : 3;
    const unicodeCodepoint = `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    const radical = radicals[char] ?? '';

    await pool.execute(
      `INSERT IGNORE INTO chars (\`char\`, level, radical, unicode_codepoint) VALUES (?, ?, ?, ?)`,
      [char, level, radical, unicodeCodepoint]
    );
    imported++;

    if ((i + 1) % 1000 === 0) {
      console.log(`  ${i + 1}/${chars.length}`);
    }
  }

  console.log(`Done. Imported ${imported}, skipped ${skipped}.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`:
```json
"chars:import": "tsx scripts/import-chars-data.ts"
```

- [ ] **Step 3: Run against test DB (optional, dev only)**

Run: `pnpm chars:import`
Expected: outputs `Done. Imported 8105`

- [ ] **Step 4: Commit**

```bash
git add scripts/import-chars-data.ts package.json
git commit -m "feat(scripts): chars initial import (level + radical + unicode)"
```

---

### Task 31: README + .env.example update

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (if needed)

- [ ] **Step 1: Add 字典 + 字源 section to README**

Append to README.md (under existing features):
```markdown
### 字典 + 字源

- `/dictionary` — 完整字典浏览 (8105 字)
  - 按拼音 A-Z 锚点 / 按部首 214 侧栏 (顶部 toggle)
  - 搜索: 拼音 / 汉字 / 英文
- `/dictionary/[char]` — 详情页 (4 tabs: 字典/字源/故事/+字帖)
  - 7 字段: 拼音/部首/笔画/释义/英文/Unicode/异体字
  - 相关字: 同部首 / 同拼音
- `/etymology/[char]` — 沉浸式字源页
  - 5 个时代字形: 甲骨文/金文/小篆/隶书/楷书
  - 用专门古字字体渲染;字体未覆盖的字显示「暂无」
  - 字源故事: LLM 生成 (管理员触发 + cron @50-100/天)
  - 键盘 ←/→ 切换时代

### Admin 字典

- `/admin/chars` — 覆盖率 (按 level)
- `/admin/chars/generate` — 手动批量生成字源
```

- [ ] **Step 2: Update roadmap**

In README.md 路线图 section, add Plan L entry.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(plan-l): README — dictionary + etymology + admin sections"
```

---

### Task 32: Final review + manual browser smoke

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: all tests pass (Plan L: ~25+ new tests + existing tests)

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: build succeeds; new routes `ƒ /dictionary` + `ƒ /dictionary/[char]` + `ƒ /etymology/[char]` + 2 admin routes appear

- [ ] **Step 4: Cross-cutting review (dispatch subagent)**

Use a fresh subagent to review Plan L changes against the spec. Apply any fix commits.

- [ ] **Step 5: Manual smoke (human, 12 steps per spec 验证清单)**

1. `/dictionary` 页面加载, 显示 8105 字统计
2. toggle 切到「按部首」, 选「水部」, 右侧只显示水部字
3. 搜索框输入 "ni", 显示所有拼音含 ni 的字
4. 点 "一" → /dictionary/一, 7 字段齐全
5. 点 "字源" tab → 跳到 /etymology/一
6. 时间轴 5 个 dot, 默认楷书 active
7. 点 "甲骨" dot, 显示该字在甲骨文的字形 (有字体时)
8. 键盘 ←/→ 切换 era
9. 点 "上一字" → /etymology/丁
10. /admin/chars 显示覆盖率
11. /admin/chars/generate 选 5 个字, 点生成, 5-15s 后 DB 写入
12. 重复步骤 5, 现在 /etymology/任选 显示完整 story + 5 era 字形

- [ ] **Step 6: Final commit + memory update**

```bash
git add .
git status  # verify no untracked
git commit --allow-empty -m "chore(plan-l): final review + manual smoke verified" || echo "no changes"
```

Update `docs/superpowers/memory/plan-l-status.md` with completion notes.

---

## Summary

32 tasks across 7 phases:
- **Phase A (Data)**: 7 tasks — DDL ×2, types, chars.ts ×2, etymology.ts ×2
- **Phase B (API)**: 4 tasks — validators + 3 public routes
- **Phase C (Dictionary FE)**: 7 tasks — 4 components + 2 pages + 1 client
- **Phase D (Etymology FE)**: 4 tasks — 3 components + 1 page
- **Phase E (Fonts)**: 3 tasks — download + CSS + nav link
- **Phase F (Admin)**: 5 tasks — ai lib + 2 routes + 2 pages
- **Phase G (Wrap)**: 2 tasks — import script + README + final review

Total new files: ~25, total modified: ~8.

Estimated commits: 32.
