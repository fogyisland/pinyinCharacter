# 诗词朝代扩展 + 全站 SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new poem collections (乐府 203, 古诗十九首 19, 曹操诗集 ~20, 纳兰性德 ~350, 辞赋 47) + 1 pianwen book (训蒙骈句) + form (体裁) filter on existing 190K poems + comprehensive site-wide SEO (dynamic sitemap, JSON-LD, canonical URLs on /poetry, /ancient, /chars detail pages).

**Architecture:** 
- Add `form` index + `category` column to `poems`, ALTER `dynasty` ENUM→VARCHAR. Backfill `form` on all 190K existing rows via structural inference (五言/七言/绝句/律诗) + source-tag merge (乐府/古风/词牌名/套数/小令).
- New content via 2 new build scripts: `build-poems-extra.ts` (chinese-poetry JSON + guwendao.net poem scrape) writes to `poems` table + `data/poems/<slug>.json`; `build-pianwen.ts` (guwendao.net book scrape) writes to `classics` table + `data/classics/xunmeng-pianju.json`.
- Form filter UI: client component with chips multi-select, URL-synced `?form=...`. /poetry page (already client component) gets `useState` for form filter.
- SEO: 1 config module (lib/seo/config.ts) for SITE_URL from env, 2 builders (lib/seo/metadata.ts, lib/seo/jsonld.ts), 1 sitemap + 3 sub-sitemaps (poetry/ancient/chars), 1 robots.txt. Detail pages add `generateMetadata` + JSON-LD `<script>`.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + MySQL 5.7 + vitest + sharp (for any image ops, not used here) + pinyin-pro (already used) + cheerio (for HTML parsing in scraper) + OpenCC t2s.

## Global Constraints

- **Schema migration must be idempotent**: every ALTER checks INFORMATION_SCHEMA first, so re-running the migration script does not error.
- **All new scripts must be idempotent**: re-running build-form-tags.ts on already-filled rows does not overwrite (whereFormNull=true default). build-poems-extra.ts uses content_hash + (title, author) UNIQUE KEY to skip duplicates.
- **Run on piyin_dev FIRST** for every step. Only push to prod `piyin` after piyin_dev smoke + browser verify.
- **Env var SITE_URL**: `NEXT_PUBLIC_SITE_URL` set in `.env.local` (dev) and prod env. Fallback to `http://localhost:3000` if missing.
- **No new dependencies** beyond what's in package.json. Reuse pinyin-pro, mysql2, OpenCC, cheerio if available. If cheerio not present, use existing regex+string parsing in build-classics-guwendao.ts.
- **Per-task tsc + build** (per memory rule `feedback-per-task-build-check`): each task that touches app/**/page.tsx or adds new route must run `pnpm build` before commit.
- **TDD**: unit tests written BEFORE implementation, verified to FAIL, then implementation makes them pass.
- **Frequent commits**: each step ends with `git commit` (or grouped steps end with one commit at the end of the task).
- **No emojis** in any file unless explicitly requested.
- **No documentation files** (README/CHANGELOG) created unless asked.

---

### Task 1: Schema migration script + idempotency

**Files:**
- Create: `scripts/migrate-poems-schema.ts`
- Test: `tests/unit/scripts/migrate-poems-schema.test.ts`

**Interfaces:**
- Consumes: `pool` from `lib/db.ts`
- Produces: idempotent migration that brings `poems` table to target schema (dynasty VARCHAR, category column + index, form VARCHAR(32) + index)

- [ ] **Step 1: Write failing test for idempotency**

```ts
// tests/unit/scripts/migrate-poems-schema.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/db', () => ({
  getPool: () => ({
    execute: vi.fn().mockResolvedValue([[]]),
    query: vi.fn().mockResolvedValue([[]]),
  }),
}));

describe('migratePoemsSchema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs without error', async () => {
    const { migratePoemsSchema } = await import('../../../scripts/migrate-poems-schema');
    await expect(migratePoemsSchema()).resolves.not.toThrow();
  });

  it('executes ALTER for dynasty, category, form', async () => {
    const { getPool } = await import('../../../lib/db');
    const { migratePoemsSchema } = await import('../../../scripts/migrate-poems-schema');
    const mockPool = getPool();
    await migratePoemsSchema();
    const calls = (mockPool.execute as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((s: string) => s.includes('MODIFY COLUMN dynasty'))).toBe(true);
    expect(calls.some((s: string) => s.includes('ADD COLUMN category'))).toBe(true);
    expect(calls.some((s: string) => s.includes('MODIFY COLUMN form'))).toBe(true);
    expect(calls.some((s: string) => s.includes('ADD INDEX idx_form'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/scripts/migrate-poems-schema.test.ts`
Expected: FAIL — module `scripts/migrate-poems-schema` not found

- [ ] **Step 3: Write minimal migration script**

```ts
// scripts/migrate-poems-schema.ts
import { getPool, closePool } from '../lib/db';

const TARGET_DDL = {
  dynasty: "ALTER TABLE poems MODIFY COLUMN dynasty VARCHAR(16) NOT NULL",
  category: "ALTER TABLE poems ADD COLUMN category VARCHAR(32) DEFAULT NULL AFTER dynasty",
  categoryIndex: "ALTER TABLE poems ADD INDEX idx_category (category)",
  form: "ALTER TABLE poems MODIFY COLUMN form VARCHAR(32) DEFAULT NULL",
  formIndex: "ALTER TABLE poems ADD INDEX idx_form (form)",
} as const;

interface ColumnInfo { COLUMN_NAME: string; COLUMN_TYPE: string; }
interface IndexInfo { INDEX_NAME: string; COLUMN_NAME: string; }

async function columnExists(pool: any, column: string): Promise<boolean> {
  const [rows] = await pool.execute<any[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = ?`,
    [column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(pool: any, index: string): Promise<boolean> {
  const [rows] = await pool.execute<any[]>(
    `SELECT INDEX_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND INDEX_NAME = ?`,
    [index]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function migratePoemsSchema(): Promise<{ ran: string[]; skipped: string[] }> {
  const pool = getPool();
  const ran: string[] = [];
  const skipped: string[] = [];

  // 1. dynasty ENUM -> VARCHAR(16) — check by column type containing 'enum'
  const [dynastyRows] = await pool.execute<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = 'dynasty'`
  );
  if (Array.isArray(dynastyRows) && dynastyRows[0] && dynastyRows[0].COLUMN_TYPE?.includes('enum')) {
    await pool.execute(TARGET_DDL.dynasty);
    ran.push('dynasty');
  } else {
    skipped.push('dynasty');
  }

  // 2. category column
  if (await columnExists(pool, 'category')) {
    skipped.push('category');
  } else {
    await pool.execute(TARGET_DDL.category);
    ran.push('category');
  }

  // 3. category index
  if (await indexExists(pool, 'idx_category')) {
    skipped.push('idx_category');
  } else {
    await pool.execute(TARGET_DDL.categoryIndex);
    ran.push('idx_category');
  }

  // 4. form column widening
  const [formRows] = await pool.execute<any[]>(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems' AND COLUMN_NAME = 'form'`
  );
  if (Array.isArray(formRows) && formRows[0] && formRows[0].COLUMN_TYPE?.includes('varchar(32)')) {
    skipped.push('form');
  } else {
    await pool.execute(TARGET_DDL.form);
    ran.push('form');
  }

  // 5. form index
  if (await indexExists(pool, 'idx_form')) {
    skipped.push('idx_form');
  } else {
    await pool.execute(TARGET_DDL.formIndex);
    ran.push('idx_form');
  }

  console.log(`[migrate-poems-schema] ran: ${ran.join(', ')}; skipped: ${skipped.join(', ')}`);
  return { ran, skipped };
}

if (require.main === module) {
  migratePoemsSchema().then(() => closePool()).catch((err) => {
    console.error('[migrate-poems-schema] failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/scripts/migrate-poems-schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/migrate-poems-schema.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "DESCRIBE poems;"
```

Expected first run: `ran: dynasty, category, idx_category, form, idx_form`
Expected DESCRIBE: `dynasty varchar(16)`, new `category varchar(32)`, `form varchar(32)`, both indexes listed

- [ ] **Step 6: Re-run to verify idempotency**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/migrate-poems-schema.ts
```

Expected: `ran: ; skipped: dynasty, category, idx_category, form, idx_form`

- [ ] **Step 7: tsc + commit**

```bash
pnpm tsc --noEmit
git add scripts/migrate-poems-schema.ts tests/unit/scripts/migrate-poems-schema.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): idempotent poems schema migration (dynasty VARCHAR + category + form idx)"
```

---

### Task 2: Existing form normalization (one-time UPDATE)

**Files:**
- Create: `scripts/normalize-existing-form.ts`
- Test: `tests/unit/scripts/normalize-existing-form.test.ts`

**Interfaces:**
- Consumes: `pool` from `lib/db.ts`
- Produces: one-shot UPDATEs that rename existing form values to canonical naming

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/scripts/normalize-existing-form.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }]) }),
}));

describe('normalizeExistingForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs 4 UPDATE statements', async () => {
    const { getPool } = await import('../../../lib/db');
    const { normalizeExistingForm } = await import('../../../scripts/normalize-existing-form');
    const pool = getPool();
    await normalizeExistingForm();
    const updateCalls = (pool.execute as any).mock.calls.filter((c: any) => c[0].startsWith('UPDATE'));
    expect(updateCalls.length).toBe(4);
  });

  it('maps 五言律诗 -> 五律 etc.', async () => {
    const { getPool } = await import('../../../lib/db');
    const { NORMALIZE_MAP } = await import('../../../scripts/normalize-existing-form');
    expect(NORMALIZE_MAP).toEqual({
      '五言律诗': '五律',
      '七言律诗': '七律',
      '五言古诗': '五言古风',
      '七言古诗': '七言古风',
    });
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/scripts/normalize-existing-form.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal script**

```ts
// scripts/normalize-existing-form.ts
import { getPool, closePool } from '../lib/db';

export const NORMALIZE_MAP: Record<string, string> = {
  '五言律诗': '五律',
  '七言律诗': '七律',
  '五言古诗': '五言古风',
  '七言古诗': '七言古风',
};

export async function normalizeExistingForm(): Promise<{ updated: number }> {
  const pool = getPool();
  let updated = 0;
  for (const [from, to] of Object.entries(NORMALIZE_MAP)) {
    const [result] = await pool.execute<any>(
      `UPDATE poems SET form = ? WHERE form = ?`,
      [to, from]
    );
    const n = (result as any)?.affectedRows ?? 0;
    updated += n;
    console.log(`[normalize] ${from} -> ${to}: ${n} rows updated`);
  }
  return { updated };
}

if (require.main === module) {
  normalizeExistingForm().then((r) => {
    console.log(`[normalize] total updated: ${r.updated}`);
    return closePool();
  }).catch((err) => {
    console.error('[normalize] failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/unit/scripts/normalize-existing-form.test.ts`
Expected: PASS

- [ ] **Step 5: Run on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/normalize-existing-form.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT form, COUNT(*) AS n FROM poems GROUP BY form ORDER BY n DESC;"
```

Expected: `total updated: 189` (from existing 189 五言律诗/etc rows). New distribution: 五律/七律/五言古风/七言古风 instead of 五言律诗/七言律诗/五言古诗/七言古诗.

- [ ] **Step 6: Re-run to verify idempotent (no-op on second run)**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/normalize-existing-form.ts
```

Expected: `total updated: 0`

- [ ] **Step 7: Commit**

```bash
git add scripts/normalize-existing-form.ts tests/unit/scripts/normalize-existing-form.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): normalize existing form values to canonical naming (五律/七律/五言古风/七言古风)"
```

---

### Task 3: Form inference pure function + unit tests

**Files:**
- Create: `lib/poetry/infer-form.ts`
- Test: `tests/unit/lib/poetry/infer-form.test.ts`

**Interfaces:**
- Consumes: `paragraphs: string[]` (lines of poem), `type: string | null` (from chinese-poetry), `rhythmic: string | null` (词牌名), `category: string`
- Produces: `FormResult { primary: string | null; source: 'inferred' | 'source-tag' | 'passthrough'; confidence: number }`

- [ ] **Step 1: Write failing tests (≥20 cases)**

```ts
// tests/unit/lib/poetry/infer-form.test.ts
import { describe, it, expect } from 'vitest';
import { inferFormFromParagraphs, resolveFormFromSource, mergeForm } from '@/lib/poetry/infer-form';

describe('inferFormFromParagraphs', () => {
  it('classifies 5-char 4-line as 五绝', () => {
    const r = inferFormFromParagraphs(['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡']);
    expect(r.primary).toBe('五绝');
    expect(r.confidence).toBe(1.0);
  });

  it('classifies 7-char 4-line as 七绝', () => {
    const r = inferFormFromParagraphs([
      '两个黄鹂鸣翠柳',
      '一行白鹭上青天',
      '窗含西岭千秋雪',
      '门泊东吴万里船',
    ]);
    expect(r.primary).toBe('七绝');
  });

  it('classifies 5-char 8-line as 五律', () => {
    const r = inferFormFromParagraphs([
      '国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心',
      '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪',
    ]);
    expect(r.primary).toBe('五律');
  });

  it('classifies 7-char 8-line as 七律', () => {
    const r = inferFormFromParagraphs([
      '丞相祠堂何处寻', '锦官城外柏森森', '映阶碧草自春色', '隔叶黄鹂空好音',
      '三顾频烦天下计', '两朝开济老臣心', '出师未捷身先死', '长使英雄泪满襟',
    ]);
    expect(r.primary).toBe('七律');
  });

  it('classifies 5-char 6-line as 五言古风', () => {
    const r = inferFormFromParagraphs(['青青河畔草', '郁郁园中柳', '盈盈楼上女', '皎皎当窗牖', '娥娥红粉妆', '纤纤出素手']);
    expect(r.primary).toBe('五言古风');
  });

  it('classifies 7-char 6-line as 七言古风', () => {
    const r = inferFormFromParagraphs([
      '燕山雪花大如席', '片片吹落轩辕台', '幽州思妇十二月', '停歌罢笑双蛾摧',
      '谁念北风凌马足', '群狐寒夜啸如雷',
    ]);
    expect(r.primary).toBe('七言古风');
  });

  it('classifies mixed 5+7 line as 杂言古风', () => {
    const r = inferFormFromParagraphs(['唧唧复唧唧', '木兰当户织', '不闻机杼声', '唯闻女叹息', '问女何所思']);
    expect(r.primary).toBe('杂言古风');
  });

  it('returns null for empty', () => {
    expect(inferFormFromParagraphs([]).primary).toBeNull();
    expect(inferFormFromParagraphs(['', '  ']).primary).toBeNull();
  });

  it('ignores punctuation when counting characters', () => {
    const r = inferFormFromParagraphs(['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
    expect(r.primary).toBe('五绝');
  });

  it('handles 2-line poem (short)', () => {
    const r = inferFormFromParagraphs(['白日依山尽', '黄河入海流']);
    expect(r.primary).toBe('五言古风'); // 2 lines, not 4 nor 8
  });
});

describe('resolveFormFromSource', () => {
  it('passthrough rhythmic for 词 (category=song)', () => {
    const r = resolveFormFromSource('词', '水调歌头', 'song');
    expect(r.primary).toBe('水调歌头');
    expect(r.source).toBe('passthrough');
  });

  it('returns 套数 for 元曲 套数', () => {
    const r = resolveFormFromSource('套数', null, 'yuan');
    expect(r.primary).toBe('套数');
  });

  it('returns 小令 for 元曲 小令', () => {
    const r = resolveFormFromSource('小令', null, 'yuan');
    expect(r.primary).toBe('小令');
  });

  it('returns 乐府 from chinese-poetry type=乐府', () => {
    const r = resolveFormFromSource('乐府', null, '汉乐府');
    expect(r.primary).toBe('乐府');
  });

  it('returns 五言古诗 from chinese-poetry type=五言古诗', () => {
    const r = resolveFormFromSource('五言古诗', null, 'tang');
    expect(r.primary).toBe('五言古诗');
  });

  it('returns null for empty type', () => {
    expect(resolveFormFromSource(null, null, 'tang').primary).toBeNull();
  });
});

describe('mergeForm', () => {
  it('uses source-tag when present and structural agrees', () => {
    const struct = { primary: '五绝', source: 'inferred' as const, confidence: 1.0 };
    const source = { primary: '五言绝句', source: 'source-tag' as const, confidence: 1.0 };
    const m = mergeForm(struct, source);
    expect(m.primary).toBe('五言绝句');
  });

  it('falls back to structural when source-tag absent', () => {
    const struct = { primary: '七律', source: 'inferred' as const, confidence: 1.0 };
    const source = { primary: null, source: 'source-tag' as const, confidence: 0 };
    const m = mergeForm(struct, source);
    expect(m.primary).toBe('七律');
  });

  it('returns null when both are null', () => {
    const m = mergeForm(
      { primary: null, source: 'inferred' as const, confidence: 0 },
      { primary: null, source: 'source-tag' as const, confidence: 0 }
    );
    expect(m.primary).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm test tests/unit/lib/poetry/infer-form.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/poetry/infer-form.ts

export interface FormResult {
  primary: string | null;
  source: 'inferred' | 'source-tag' | 'passthrough';
  confidence: number;
}

const CN_PUNCT = /[，。！？、；：""''《》【】（）()·…—\s]/g;

function countChars(line: string): number {
  return Array.from(line.replace(CN_PUNCT, '')).length;
}

export function inferFormFromParagraphs(paragraphs: string[]): FormResult {
  const lines = paragraphs.map(p => p.trim()).filter(p => p.length > 0);
  if (lines.length === 0) return { primary: null, source: 'inferred', confidence: 0 };

  const lengths = lines.map(countChars);
  const uniqueLengths = [...new Set(lengths)];

  // Length mode
  let lengthMode: '五言' | '七言' | '杂言';
  if (uniqueLengths.length === 1) {
    if (uniqueLengths[0] === 5) lengthMode = '五言';
    else if (uniqueLengths[0] === 7) lengthMode = '七言';
    else {
      // 5 or 7 with extra chars (like 9 char lines) - treat as 古风
      return { primary: `${uniqueLengths[0]}言古风`, source: 'inferred', confidence: 0.6 };
    }
  } else {
    lengthMode = '杂言';
  }

  // Line count mode
  const lineCount = lines.length;
  let lineMode: '绝句' | '律诗' | '古风';
  let confidence = 1.0;
  if (lineCount === 4) lineMode = '绝句';
  else if (lineCount === 8) lineMode = '律诗';
  else {
    lineMode = '古风';
    confidence = 0.7;
  }

  // Combine
  if (lengthMode === '杂言') {
    return { primary: '杂言古风', source: 'inferred', confidence };
  }
  const lengthStr = lengthMode === '五言' ? '五' : '七';
  if (lineMode === '绝句') return { primary: `${lengthStr}绝`, source: 'inferred', confidence };
  if (lineMode === '律诗') return { primary: `${lengthStr}律`, source: 'inferred', confidence };
  return { primary: `${lengthMode}古风`, source: 'inferred', confidence };
}

const SOURCE_TAG_MAP: Record<string, string> = {
  '五言绝句': '五绝',
  '七言绝句': '七绝',
  '五言律诗': '五律',
  '七言律诗': '七律',
  '五言古诗': '五言古风',
  '七言古诗': '七言古风',
};

export function resolveFormFromSource(type: string | null, rhythmic: string | null, category: string): FormResult {
  // 词: passthrough 词牌名
  if (category === 'song' && rhythmic && rhythmic.length > 0) {
    return { primary: rhythmic, source: 'passthrough', confidence: 1.0 };
  }
  // 元曲: 套数/小令
  if (category === 'yuan' && (type === '套数' || type === '小令')) {
    return { primary: type, source: 'source-tag', confidence: 1.0 };
  }
  if (!type) return { primary: null, source: 'source-tag', confidence: 0 };
  // Map chinese-poetry legacy names to canonical
  const canonical = SOURCE_TAG_MAP[type] ?? type;
  return { primary: canonical, source: 'source-tag', confidence: 1.0 };
}

export function mergeForm(struct: FormResult, source: FormResult): FormResult {
  if (source.primary !== null && source.confidence > 0) return source;
  if (struct.primary !== null) return struct;
  return { primary: null, source: 'inferred', confidence: 0 };
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm test tests/unit/lib/poetry/infer-form.test.ts`
Expected: PASS (16+ tests)

- [ ] **Step 5: Commit**

```bash
git add lib/poetry/infer-form.ts tests/unit/lib/poetry/infer-form.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): form inference (五言/七言/绝句/律诗/古风) + source-tag merge"
```

---

### Task 4: Form backfill script + integration test

**Files:**
- Create: `scripts/build-form-tags.ts`
- Test: `tests/integration/scripts/build-form-tags.test.ts`

**Interfaces:**
- Consumes: `pool`, `inferFormFromParagraphs`, `resolveFormFromSource`, `mergeForm`
- Produces: `backfillForm({ dryRun, batchSize, whereFormNull })` — runs UPDATE on poems table, logs stats

- [ ] **Step 1: Write failing integration test (mock pool)**

```ts
// tests/integration/scripts/build-form-tags.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

describe('backfillForm', () => {
  it('processes all rows in batches', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 1, paragraphs: '["床前明月光","疑是地上霜","举头望明月","低头思故乡"]', type: null, rhythmic: null, dynasty: 'tang' }]])
      .mockResolvedValueOnce([[]]);
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { backfillForm } = await import('../../../scripts/build-form-tags');
    const result = await backfillForm({ batchSize: 100, whereFormNull: true });
    expect(result.formSet).toBe(1);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE poems SET form'), expect.any(Array));
  });

  it('--dry-run does not call UPDATE', async () => {
    mockQuery.mockReset();
    mockExecute.mockReset();
    mockQuery.mockResolvedValueOnce([[]]);
    const { backfillForm } = await import('../../../scripts/build-form-tags');
    await backfillForm({ dryRun: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/scripts/build-form-tags.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal script**

```ts
// scripts/build-form-tags.ts
import { getPool, closePool } from '../lib/db';
import { inferFormFromParagraphs, resolveFormFromSource, mergeForm } from '../lib/poetry/infer-form';

interface BackfillArgs {
  batchSize?: number;
  dryRun?: boolean;
  whereFormNull?: boolean;
}

interface BackfillResult {
  scanned: number;
  formSet: number;
  formNull: number;
  dryRun: boolean;
}

function parseJsonArray(s: unknown): string[] {
  if (Array.isArray(s)) return s as string[];
  if (typeof s === 'string') {
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

export async function backfillForm(args: BackfillArgs = {}): Promise<BackfillResult> {
  const pool = getPool();
  const batchSize = args.batchSize ?? 1000;
  const dryRun = args.dryRun ?? false;
  const whereFormNull = args.whereFormNull ?? true;
  const whereClause = whereFormNull ? 'WHERE form IS NULL' : '';
  let offset = 0;
  let scanned = 0;
  let formSet = 0;
  let formNull = 0;

  while (true) {
    const [rows] = await pool.query<any[]>(
      `SELECT id, category, dynasty, paragraphs, type, rhythmic, form FROM poems ${whereClause} ORDER BY id LIMIT ? OFFSET ?`,
      [batchSize, offset]
    );
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows as any[]) {
      scanned++;
      const paragraphs = parseJsonArray(row.paragraphs);
      const struct = inferFormFromParagraphs(paragraphs);
      const source = resolveFormFromSource(row.type, row.rhythmic, row.category || row.dynasty);
      const merged = mergeForm(struct, source);
      if (merged.primary === null) {
        formNull++;
        continue;
      }
      if (!dryRun) {
        await pool.execute(`UPDATE poems SET form = ? WHERE id = ?`, [merged.primary, row.id]);
      }
      formSet++;
    }
    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  console.log(`[build-form-tags] scanned=${scanned} formSet=${formSet} formNull=${formNull} dryRun=${dryRun}`);
  return { scanned, formSet, formNull, dryRun };
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  backfillForm({ dryRun }).then(() => closePool()).catch((err) => {
    console.error('[build-form-tags] failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/integration/scripts/build-form-tags.test.ts`
Expected: PASS

- [ ] **Step 5: Run --dry-run on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-form-tags.ts --dry-run
```

Expected: prints distribution of inferred forms (五绝/七绝/五律/七律/古风/乐府/词牌名 counts)

- [ ] **Step 6: Run actual backfill on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-form-tags.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT form, COUNT(*) AS n FROM poems GROUP BY form ORDER BY n DESC LIMIT 20;"
```

Expected: completes in 5-15 min. Distribution: formSet ≈ scanned - formNull. Most poems get form=五绝/七绝/五律/七律/古风/乐府/词牌名/套数/小令.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-form-tags.ts tests/integration/scripts/build-form-tags.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): build-form-tags one-shot backfill (structure + source merge)"
```

---

### Task 5: Extract guwendao.net scraping primitives to lib

**Files:**
- Create: `lib/guwendao-scraper.ts`
- Test: `tests/unit/lib/guwendao-scraper.test.ts`
- Modify: `scripts/build-classics-guwendao.ts` (refactor to import from lib)

**Interfaces:**
- Produces:
  - `fetchChapterList(bookId: string): Promise<string[]>` — list of chapter IDs for a book
  - `scrapeChapterContent(bookId: string, chapterId: string): Promise<{ title: string; paragraphs: string[] }>`
  - `scrapePoemList(category: 'yuefu' | 'shijiu' | 'cifu'): Promise<string[]>` — list of shiwenv_xxx IDs
  - `scrapePoemPage(poemId: string): Promise<{ title: string; author: string; dynasty: string; paragraphs: string[] }>`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/lib/guwendao-scraper.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('guwendao scraper primitives', () => {
  it('fetchChapterList returns array of chapter ids', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/guwen/bookv_abc.aspx">1</a><a href="/guwen/bookv_def.aspx">2</a></html>',
    });
    const { fetchChapterList } = await import('@/lib/guwendao-scraper');
    const ids = await fetchChapterList('xxx');
    expect(ids).toEqual(['abc', 'def']);
  });

  it('scrapePoemList for yuefu parses shiwenv_ links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><a href="/shiwenv_aaa.aspx">poem1</a><a href="/shiwenv_bbb.aspx">poem2</a></html>',
    });
    const { scrapePoemList } = await import('@/lib/guwendao-scraper');
    const ids = await scrapePoemList('yuefu');
    expect(ids).toEqual(['aaa', 'bbb']);
  });

  it('scrapePoemPage extracts title, author, dynasty, paragraphs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>静夜思</h1>
        <div class="sons"><div class="cont"><a href="...">李白</a>·唐</div></div>
        <div class="contson"><p>床前明月光，</p><p>疑是地上霜。</p><p>举头望明月，</p><p>低头思故乡。</p></div>
        </body></html>
      `,
    });
    const { scrapePoemPage } = await import('@/lib/guwendao-scraper');
    const r = await scrapePoemPage('xxx');
    expect(r.title).toBe('静夜思');
    expect(r.author).toBe('李白');
    expect(r.dynasty).toBe('唐');
    expect(r.paragraphs).toEqual(['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/lib/guwendao-scraper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/guwendao-scraper.ts
const BASE = 'https://www.guwendao.net';
const USER_AGENT = 'pinyin-character-build/1.0';

async function fetchText(path: string): Promise<string> {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fetch ${path} → ${res.status}`);
  return res.text();
}

export async function fetchChapterList(bookId: string): Promise<string[]> {
  const html = await fetchText(`/guwen/book_${bookId}.aspx`);
  const matches = [...html.matchAll(/bookv_([0-9a-f]+)\.aspx/g)];
  return [...new Set(matches.map(m => m[1]))];
}

export interface ChapterContent {
  title: string;
  paragraphs: string[];
}

export async function scrapeChapterContent(bookId: string, chapterId: string): Promise<ChapterContent> {
  const html = await fetchText(`/guwen/bookv_${chapterId}.aspx`);
  // title: <h1>...</h1> or first .book-title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/class="book-title"[^>]*>([^<]+)</);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // content: <div class="contson">...</div>
  const contentMatch = html.match(/<div class="contson"[^>]*>([\s\S]*?)<\/div>/);
  if (!contentMatch) return { title, paragraphs: [] };
  const inner = contentMatch[1];
  // split by <p> or <br/>
  const paragraphs = inner
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .split('\n')
    .map(s => s.replace(/<[^>]+>/g, '').trim())
    .filter(s => s.length > 0);
  return { title, paragraphs };
}

export type PoemCategory = 'yuefu' | 'shijiu' | 'cifu';

export async function scrapePoemList(category: PoemCategory): Promise<string[]> {
  const html = await fetchText(`/gushi/${category}.aspx`);
  const matches = [...html.matchAll(/shiwenv_([0-9a-f]+)\.aspx/g)];
  return [...new Set(matches.map(m => m[1]))];
}

export interface PoemPage {
  title: string;
  author: string;
  dynasty: string;
  paragraphs: string[];
}

export async function scrapePoemPage(poemId: string): Promise<PoemPage> {
  const html = await fetchText(`/shiwenv_${poemId}.aspx`);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // author + dynasty: pattern "作者：李白 · 唐" or class="sons"
  const authorMatch = html.match(/作者[：:]\s*<a[^>]*>([^<]+)<\/a>/) || html.match(/class="sons"[^>]*>[\s\S]*?>([^<]+)</);
  const author = authorMatch ? authorMatch[1].trim() : '';
  const dynastyMatch = html.match(/[·・]([南北朝汉魏晋隋唐宋元明清]+)(?=\s*<)/) || html.match(/朝代[：:]\s*([南北朝汉魏晋隋唐宋元明清]+)/);
  const dynasty = dynastyMatch ? dynastyMatch[1].trim() : '';
  // content: same pattern as chapters
  const { paragraphs } = await scrapeChapterContent('', poemId); // reuse parser
  return { title, author, dynasty, paragraphs };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/unit/lib/guwendao-scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor build-classics-guwendao.ts to use lib (no behavior change)**

In `scripts/build-classics-guwendao.ts`, replace inline scraping with imports from `lib/guwendao-scraper.ts`. Keep the public API of the script identical (book list, volume splits, manifest writing). Re-run on piyin_dev to verify same output:

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-classics-guwendao.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT COUNT(*) AS n FROM classics;"
```

Expected: still 195 classics (190 from yesterday + 5 chinese-poetry leftovers). No data change.

- [ ] **Step 6: tsc + build (per memory rule for scripts) + commit**

```bash
pnpm tsc --noEmit
git add lib/guwendao-scraper.ts tests/unit/lib/guwendao-scraper.test.ts scripts/build-classics-guwendao.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "refactor(scraper): extract guwendao primitives to lib/guwendao-scraper.ts"
```

---

### Task 6: New poem collection ingest (poems-extra)

**Files:**
- Create: `scripts/build-poems-extra.ts`
- Test: `tests/integration/scripts/build-poems-extra.test.ts`

**Interfaces:**
- Consumes: `pool`, `inferFormFromParagraphs`, `resolveFormFromSource`, `mergeForm`, `scrapePoemList`, `scrapePoemPage`
- Produces: rows in `poems` table (UNIQUE KEY (dynasty, title, author) prevents dupes) + `data/poems/<slug>.json`

- [ ] **Step 1: Write failing test (mock fetch + pool)**

```ts
// tests/integration/scripts/build-poems-extra.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

const mockScrape = {
  scrapePoemList: vi.fn(),
  scrapePoemPage: vi.fn(),
};

vi.mock('../../../lib/guwendao-scraper', () => mockScrape);

describe('buildPoemsExtra', () => {
  it('ingests yuefu poems with correct fields', async () => {
    mockScrape.scrapePoemList.mockResolvedValueOnce(['aaa']);
    mockScrape.scrapePoemPage.mockResolvedValueOnce({
      title: '长歌行', author: '佚名', dynasty: '汉',
      paragraphs: ['青青园中葵', '朝露待日晞', '阳春布德泽', '万物生光辉'],
    });
    mockQuery.mockResolvedValue([[]]); // no existing row
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { buildPoemsExtra } = await import('../../../scripts/build-poems-extra');
    const n = await buildPoemsExtra({ onlyCategory: '汉乐府' });
    expect(n.inserted).toBe(1);
    const insertCall = mockExecute.mock.calls.find((c: any) => c[0].startsWith('INSERT INTO poems'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('汉乐府');
    expect(insertCall[1]).toContain('汉');
  });

  it('skips existing (dynasty, title, author) duplicates', async () => {
    mockScrape.scrapePoemList.mockReset();
    mockScrape.scrapePoemPage.mockReset();
    mockQuery.mockReset();
    mockExecute.mockReset();
    mockScrape.scrapePoemList.mockResolvedValueOnce(['aaa']);
    mockScrape.scrapePoemPage.mockResolvedValueOnce({ title: 'X', author: 'Y', dynasty: '汉', paragraphs: ['1','2','3','4'] });
    mockQuery.mockResolvedValueOnce([[{ id: 99 }]]); // existing row found
    const { buildPoemsExtra } = await import('../../../scripts/build-poems-extra');
    const n = await buildPoemsExtra({ onlyCategory: '汉乐府' });
    expect(n.inserted).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/scripts/build-poems-extra.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal script**

```ts
// scripts/build-poems-extra.ts
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { inferFormFromParagraphs, resolveFormFromSource, mergeForm } from '../lib/poetry/infer-form';
import { scrapePoemList, scrapePoemPage } from '../lib/guwendao-scraper';

const DATA_DIR = join(process.cwd(), 'data', 'poems');

interface CollectionConfig {
  slug: string;
  title: string;
  category: string;
  dynasty: string;
  source: string;  // 'guwendao:<category>' or 'chinese-poetry:<path>'
  fetch: () => Promise<Array<{ title: string; author: string; dynasty: string; paragraphs: string[] }>>;
}

const CP_BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';

async function fetchChinesePoetry(path: string, normalize: 'paragraphs' | 'para' = 'paragraphs') {
  const res = await fetch(CP_BASE + path, { headers: { 'User-Agent': 'pinyin-character-build/1.0' } });
  if (!res.ok) throw new Error(`fetch ${path} → ${res.status}`);
  const raw: any[] = JSON.parse(await res.text());
  return raw.map((p) => ({
    title: p.title,
    author: p.author || '佚名',
    dynasty: '',
    paragraphs: normalize === 'para' ? (p.para || []) : (p.paragraphs || []),
  }));
}

const COLLECTIONS: CollectionConfig[] = [
  {
    slug: 'yuefu',
    title: '汉乐府',
    category: '汉乐府',
    dynasty: '汉',
    source: 'guwendao:yuefu',
    async fetch() {
      const ids = await scrapePoemList('yuefu');
      const poems = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'shijiu',
    title: '古诗十九首',
    category: '古诗十九首',
    dynasty: '汉末',
    source: 'guwendao:shijiu',
    async fetch() {
      const ids = await scrapePoemList('shijiu');
      const poems = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'cifu',
    title: '辞赋',
    category: '骈文',
    dynasty: 'mixed',
    source: 'guwendao:cifu',
    async fetch() {
      const ids = await scrapePoemList('cifu');
      const poems = [];
      for (const id of ids) poems.push(await scrapePoemPage(id));
      return poems;
    },
  },
  {
    slug: 'caocao',
    title: '曹操诗集',
    category: '魏',
    dynasty: '三国',
    source: 'chinese-poetry:/曹操诗集/caocao.json',
    fetch: () => fetchChinesePoetry('/曹操诗集/caocao.json', 'paragraphs'),
  },
  {
    slug: 'nalan',
    title: '纳兰性德',
    category: 'qing',
    dynasty: '清',
    source: 'chinese-poetry:/纳兰性德/纳兰性德诗集.json',
    fetch: () => fetchChinesePoetry('/纳兰性德/纳兰性德诗集.json', 'para'),
  },
];

function contentHash(paragraphs: string[]): string {
  return createHash('md5').update(JSON.stringify(paragraphs)).digest('hex');
}

export interface BuildResult {
  inserted: number;
  skipped: number;
  byCollection: Record<string, number>;
}

export async function buildPoemsExtra({ onlyCategory }: { onlyCategory?: string } = {}): Promise<BuildResult> {
  const pool = getPool();
  const result: BuildResult = { inserted: 0, skipped: 0, byCollection: {} };

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  for (const col of COLLECTIONS) {
    if (onlyCategory && col.category !== onlyCategory) continue;
    console.log(`[build-poems-extra] ${col.slug} (${col.category})...`);
    let poems;
    try {
      poems = await col.fetch();
    } catch (err) {
      console.warn(`[build-poems-extra] ${col.slug} fetch failed: ${(err as Error).message}; skip`);
      result.byCollection[col.slug] = 0;
      continue;
    }
    result.byCollection[col.slug] = poems.length;

    for (const p of poems) {
      const hash = contentHash(p.paragraphs);
      const [existing] = await pool.query<any[]>(
        `SELECT id FROM poems WHERE dynasty = ? AND title = ? AND author = ? LIMIT 1`,
        [col.dynasty, p.title, p.author]
      );
      if (Array.isArray(existing) && existing.length > 0) {
        result.skipped++;
        continue;
      }
      const form = mergeForm(inferFormFromParagraphs(p.paragraphs), resolveFormFromSource(null, null, col.category));
      await pool.execute(
        `INSERT INTO poems (dynasty, category, title, author, form, content, pinyin, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [col.dynasty, col.category, p.title, p.author, form.primary, JSON.stringify(p.paragraphs), JSON.stringify(p.paragraphs.map(() => [])), col.source]
      );
      result.inserted++;
    }

    // Source-of-truth JSON
    const filePath = join(DATA_DIR, `${col.slug}.json`);
    writeFileSync(filePath, JSON.stringify({ ...col, poems }, null, 2), 'utf8');
    console.log(`[build-poems-extra] ${col.slug}: ${poems.length} poems → ${filePath}`);
  }

  console.log(`[build-poems-extra] inserted=${result.inserted} skipped=${result.skipped}`);
  return result;
}

if (require.main === module) {
  buildPoemsExtra().then(() => closePool()).catch((err) => {
    console.error('[build-poems-extra] failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/integration/scripts/build-poems-extra.test.ts`
Expected: PASS

- [ ] **Step 5: Run on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-poems-extra.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT category, COUNT(*) AS n FROM poems GROUP BY category ORDER BY n DESC;"
```

Expected: inserted ~600 (5 collections × ~120 avg). Categories: 汉乐府 ~200, 古诗十九首 ~19, 骈文 ~47, 魏 ~20, qing ~350.

- [ ] **Step 6: Re-run to verify idempotent (no-op)**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-poems-extra.ts
```

Expected: `inserted=0 skipped=<previous total>`

- [ ] **Step 7: Commit**

```bash
git add scripts/build-poems-extra.ts tests/integration/scripts/build-poems-extra.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): ingest 5 new collections (乐府/古诗十九首/曹操/纳兰性德/辞赋) ~600 首"
```

---

### Task 7: 训蒙骈句 ingest (classics)

**Files:**
- Create: `scripts/build-pianwen.ts`
- Test: `tests/integration/scripts/build-pianwen.test.ts`

**Interfaces:**
- Consumes: `pool`, `fetchChapterList`, `scrapeChapterContent`
- Produces: 1 row in `classics` table + `data/classics/xunmeng-pianju.json`

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/scripts/build-pianwen.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

const mockScraper = {
  fetchChapterList: vi.fn(),
  scrapeChapterContent: vi.fn(),
};
vi.mock('../../../lib/guwendao-scraper', () => mockScraper);

describe('buildPianwen', () => {
  it('ingests xunmeng-pianju with 30 chapters', async () => {
    mockScraper.fetchChapterList.mockResolvedValueOnce(['c1', 'c2']);
    mockScraper.scrapeChapterContent
      .mockResolvedValueOnce({ title: '一东', paragraphs: ['p1', 'p2', 'p3'] })
      .mockResolvedValueOnce({ title: '二冬', paragraphs: ['p4', 'p5'] });
    mockQuery.mockResolvedValue([[]]);
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { buildPianwen } = await import('../../../scripts/build-pianwen');
    const r = await buildPianwen();
    expect(r.chapters).toBe(2);
    const insertCall = mockExecute.mock.calls.find((c: any) => c[0].startsWith('INSERT INTO classics'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('xunmeng-pianju');
    expect(insertCall[1]).toContain('pianwen');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/scripts/build-pianwen.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal script**

```ts
// scripts/build-pianwen.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../lib/db';
import { fetchChapterList, scrapeChapterContent } from '../lib/guwendao-scraper';

const DATA_DIR = join(process.cwd(), 'data', 'classics');
const BOOK_ID = '427c5eea5943';  // 训蒙骈句
const SLUG = 'xunmeng-pianju';
const SOURCE = 'guwendao.net/训蒙骈句';

export interface PianwenResult { chapters: number; bytes: number; }

export async function buildPianwen(): Promise<PianwenResult> {
  const pool = getPool();
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const chapterIds = await fetchChapterList(BOOK_ID);
  const chunks = [];
  for (let i = 0; i < chapterIds.length; i++) {
    const { title, paragraphs } = await scrapeChapterContent(BOOK_ID, chapterIds[i]);
    chunks.push({ id: i + 1, label: title, content: paragraphs, pinyin: [] });
  }

  const json = {
    slug: SLUG, title: '训蒙骈句', category: 'pianwen' as const,
    author: '萧良有/司祢', era: '明/清', source: SOURCE,
    bookId: BOOK_ID, bookTitle: '训蒙骈句', chapterRange: { from: 1, to: chunks.length },
    chunks,
  };
  const filePath = join(DATA_DIR, `${SLUG}.json`);
  writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');

  const chunksJson = JSON.stringify(chunks);
  await pool.execute(
    `INSERT INTO classics (slug, title, category, author, era, chunks, source) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), category=VALUES(category), author=VALUES(author), era=VALUES(era), chunks=VALUES(chunks), source=VALUES(source)`,
    [SLUG, '训蒙骈句', 'pianwen', '萧良有/司祢', '明/清', chunksJson, SOURCE]
  );
  console.log(`[build-pianwen] ${chunks.length} chapters, ${chunksJson.length} bytes JSON → ${filePath}`);
  return { chapters: chunks.length, bytes: chunksJson.length };
}

if (require.main === module) {
  buildPianwen().then(() => closePool()).catch((err) => {
    console.error('[build-pianwen] failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/integration/scripts/build-pianwen.test.ts`
Expected: PASS

- [ ] **Step 5: Run on piyin_dev**

```bash
DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/piyin_dev" pnpm tsx scripts/build-pianwen.ts
"/e/mysql/bin/mysql.exe" -h127.0.0.1 -uroot -pAdmin909217 --default-character-set=utf8mb4 piyin_dev -e "SELECT slug, title, category, JSON_LENGTH(chunks) AS chapters FROM classics WHERE category='pianwen';"
```

Expected: 1 row inserted, 30 chapters, ~10KB JSON.

- [ ] **Step 6: tsc + commit**

```bash
pnpm tsc --noEmit
git add scripts/build-pianwen.ts tests/integration/scripts/build-pianwen.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(classics): ingest 训蒙骈句 (30 chapters, pianwen category)"
```

---

### Task 8: API + form filter query (lib/api-poetry.ts)

**Files:**
- Modify: `lib/poetry.ts` (add `getAvailableForms`, support `forms` in `ListPoemsArgs`, support `category` filter)
- Modify: `lib/poetry-types.ts` (extend `Dynasty` to support non-tang/song; add `PoemCategory` type)
- Test: `tests/unit/lib/poetry.test.ts`

**Interfaces:**
- Produces:
  - `getAvailableForms(category: string): Promise<string[]>` — returns SHI_FORMS for 诗类, top 30 词牌名 for song, ['小令','套数'] for yuan
  - `listPoems({ dynasty?, category?, forms?, q?, page?, pageSize? })` — supports multiple filters

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/lib/poetry.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

describe('getAvailableForms', () => {
  it('returns 诗类 fixed forms for tang', async () => {
    const { getAvailableForms } = await import('@/lib/poetry');
    const forms = await getAvailableForms('tang');
    expect(forms).toEqual(expect.arrayContaining(['五绝', '七绝', '五律', '七律', '五言古风', '七言古风', '乐府']));
  });

  it('returns 词牌名 top 30 for song (from DB)', async () => {
    mockQuery.mockResolvedValueOnce([[{ rhythmic: '水调歌头' }, { rhythmic: '浣溪沙' }]]);
    const { getAvailableForms } = await import('@/lib/poetry');
    const forms = await getAvailableForms('song');
    expect(forms).toContain('水调歌头');
    expect(forms).toContain('浣溪沙');
  });

  it('returns 元曲 fixed forms for yuan', async () => {
    const { getAvailableForms } = await import('@/lib/poetry');
    expect(await getAvailableForms('yuan')).toEqual(['小令', '套数']);
  });

  it('returns 诗类 fixed forms for 汉乐府', async () => {
    const { getAvailableForms } = await import('@/lib/poetry');
    const forms = await getAvailableForms('汉乐府');
    expect(forms.length).toBeGreaterThan(0);
  });
});

describe('listPoems with form filter', () => {
  it('adds WHERE form IN (?) when forms provided', async () => {
    mockQuery
      .mockReset()
      .mockResolvedValueOnce([[{ id: 1, title: 't', author: 'a', dynasty: 'tang', form: '五绝' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    const { listPoems } = await import('@/lib/poetry');
    const r = await listPoems({ dynasty: 'tang', forms: ['五绝', '七绝'] } as any);
    expect(r.items.length).toBe(1);
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toMatch(/form IN \(\?,\?\)/);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/lib/poetry.test.ts`
Expected: FAIL

- [ ] **Step 3: Modify lib/poetry-types.ts**

```ts
// lib/poetry-types.ts (replace Dynasty type)
export type Dynasty = string;  // 'tang' | 'song' | '汉' | '魏' | '清' | 'mixed' | etc.

export interface PoemListItem {
  id: number;
  title: string;
  author: string;
  dynasty: Dynasty;
  category: string | null;
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

// existing POEM_FONT_* exports unchanged
```

- [ ] **Step 4: Modify lib/poetry.ts**

Replace entire file with:
```ts
// lib/poetry.ts
import { getPool } from './db';
import type { Dynasty, PoemDetail, PoemListItem, PoemListResult } from './poetry-types';

const PAGE_SIZE = 24;

export const SHI_FORMS = ['五绝', '七绝', '五律', '七律', '五言古风', '七言古风', '杂言古风', '乐府'] as const;
const YUAN_FORMS = ['小令', '套数'] as const;
const SHI_CATEGORIES = new Set(['tang', '汉乐府', '古诗十九首', '魏', '骈文']);

export interface ListPoemsArgs {
  dynasty?: Dynasty;
  category?: string;
  q?: string;
  forms?: string[];
  page?: number;
  pageSize?: number;
}

export function buildSearchWhere(q: string): { where: string; params: string[] } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { where: '', params: [] };
  const firstChar = Array.from(trimmed)[0] ?? '';
  return {
    where: '(title LIKE ? OR author LIKE ? OR title LIKE ?)',
    params: [`%${trimmed}%`, `%${trimmed}%`, `%${firstChar}%`],
  };
}

function mapRow(r: any): PoemListItem {
  return {
    id: Number(r.id),
    title: r.title,
    author: r.author,
    dynasty: r.dynasty,
    category: r.category ?? null,
    form: r.form ?? null,
  };
}

export async function getAvailableForms(category: string): Promise<string[]> {
  if (YUAN_FORMS.includes(category as any)) return [...YUAN_FORMS];
  if (category === 'song' || category === 'qing') {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT rhythmic, COUNT(*) AS n FROM poems WHERE category = ? AND rhythmic IS NOT NULL GROUP BY rhythmic ORDER BY n DESC LIMIT 30`,
      [category]
    );
    return (rows as any[]).map(r => r.rhythmic);
  }
  if (SHI_CATEGORIES.has(category)) return [...SHI_FORMS];
  return [];
}

export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const pool = getPool();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, args.pageSize ?? PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: any[] = [];
  if (args.dynasty) { conditions.push('dynasty = ?'); params.push(args.dynasty); }
  if (args.category) { conditions.push('category = ?'); params.push(args.category); }
  if (args.forms && args.forms.length > 0) {
    const placeholders = args.forms.map(() => '?').join(',');
    conditions.push(`form IN (${placeholders})`);
    params.push(...args.forms);
  }
  const { where: searchWhere, params: searchParams } = buildSearchWhere(args.q ?? '');
  if (searchWhere) { conditions.push(searchWhere); params.push(...searchParams); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT id, title, author, dynasty, category, form FROM poems ${where} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const [rows] = await pool.query<any[]>(sql, [...params, pageSize, offset]);
  const [[{ total }]] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM poems ${where}`, params);

  return {
    items: (rows as any[]).map(mapRow),
    total: Number(total),
    page,
    pageSize,
  };
}

function parseJsonArray<T>(s: any, fallback: T): T {
  if (Array.isArray(s)) return s as T;
  if (typeof s === 'string') {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : T;
    } catch { return fallback; }
  }
  return fallback;
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
    `SELECT id, title, author, dynasty, category, form, content, pinyin, appreciation FROM poems WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}

export async function getRandomPoem(): Promise<PoemDetail | null> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, title, author, dynasty, category, form, content, pinyin, appreciation FROM poems ORDER BY RAND() LIMIT 1`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return mapDetailRow((rows as any[])[0]);
}
```

- [ ] **Step 5: Run test, verify PASS**

Run: `pnpm test tests/unit/lib/poetry.test.ts`
Expected: PASS

- [ ] **Step 6: tsc + commit**

```bash
pnpm tsc --noEmit
git add lib/poetry.ts lib/poetry-types.ts tests/unit/lib/poetry.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): getAvailableForms + form filter query + Dynasty to string"
```

---

### Task 9: FormFilterBar component + /poetry page integration

**Files:**
- Create: `components/poetry/FormFilterBar.tsx`
- Modify: `app/poetry/page.tsx` (add form filter state + URL sync)
- Modify: `lib/api-poetry.ts` (add `forms` param to `listPoemsRequest`)
- Test: `tests/unit/components/poetry/FormFilterBar.test.tsx`

**Interfaces:**
- `FormFilterBar({ category, selectedForms, onChange, availableForms }: Props): JSX.Element`

- [ ] **Step 1: Write failing component test**

```tsx
// tests/unit/components/poetry/FormFilterBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormFilterBar } from '@/components/poetry/FormFilterBar';

describe('FormFilterBar', () => {
  it('renders chips for each available form', () => {
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝', '五律']}
        selectedForms={[]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('五绝')).toBeDefined();
    expect(screen.getByText('七绝')).toBeDefined();
    expect(screen.getByText('五律')).toBeDefined();
  });

  it('toggles selection on click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('七绝'));
    expect(onChange).toHaveBeenCalledWith(['五绝', '七绝']);
  });

  it('removes selection on second click', () => {
    const onChange = vi.fn();
    render(
      <FormFilterBar
        category="tang"
        availableForms={['五绝', '七绝']}
        selectedForms={['五绝', '七绝']}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('五绝'));
    expect(onChange).toHaveBeenCalledWith(['七绝']);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/components/poetry/FormFilterBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal component**

```tsx
// components/poetry/FormFilterBar.tsx
'use client';

interface FormFilterBarProps {
  category: string;
  availableForms: string[];
  selectedForms: string[];
  onChange: (forms: string[]) => void;
}

export function FormFilterBar({ category, availableForms, selectedForms, onChange }: FormFilterBarProps) {
  if (availableForms.length === 0) return null;
  const toggle = (form: string) => {
    if (selectedForms.includes(form)) {
      onChange(selectedForms.filter(f => f !== form));
    } else {
      onChange([...selectedForms, form]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 my-4" data-category={category}>
      <span className="text-sm text-ink-faint self-center mr-2">体裁：</span>
      {availableForms.map(form => {
        const isSelected = selectedForms.includes(form);
        return (
          <button
            key={form}
            type="button"
            onClick={() => toggle(form)}
            className={`text-sm px-3 h-8 rounded-full border transition-colors ${
              isSelected
                ? 'bg-ink text-paper border-ink'
                : 'bg-paper text-ink border-ink-faint hover:bg-mist'
            }`}
          >
            {form}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/unit/components/poetry/FormFilterBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Modify lib/api-poetry.ts to add forms param**

```ts
// lib/api-poetry.ts (add forms to listPoemsRequest)
export async function listPoemsRequest(args: { dynasty?: string; category?: string; q?: string; forms?: string[]; page?: number }): Promise<PoemListResult> {
  const sp = new URLSearchParams();
  if (args.dynasty) sp.set('dynasty', args.dynasty);
  if (args.category) sp.set('category', args.category);
  if (args.forms && args.forms.length > 0) sp.set('forms', args.forms.join(','));
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const r = await fetch(`/api/poetry?${sp}`);
  if (!r.ok) throw new Error(`poetry list failed: ${r.status}`);
  return r.json();
}
```

Also add the corresponding API route at `app/api/poetry/route.ts` (next task will create).

- [ ] **Step 6: Modify app/poetry/page.tsx to integrate form filter**

```tsx
// app/poetry/page.tsx — add form filter
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PoemSearch } from '@/components/poetry/PoemSearch';
import { PoemCard } from '@/components/poetry/PoemCard';
import { PoemPagination } from '@/components/poetry/PoemPagination';
import { FormFilterBar } from '@/components/poetry/FormFilterBar';
import { listPoemsRequest } from '@/lib/api-poetry';
import { getAvailableFormsRequest } from '@/lib/api-poetry';
import type { PoemListItem } from '@/lib/poetry-types';

export default function PoetryListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [category, setCategory] = useState<string>(searchParams.get('category') || 'tang');
  const [selectedForms, setSelectedForms] = useState<string[]>(
    (searchParams.get('form') || '').split(',').filter(Boolean)
  );
  const [availableForms, setAvailableForms] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PoemListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available forms when category changes
  useEffect(() => {
    let cancelled = false;
    getAvailableFormsRequest(category).then(forms => {
      if (!cancelled) setAvailableForms(forms);
    });
    return () => { cancelled = true; };
  }, [category]);

  // Sync URL when form/category changes
  useEffect(() => {
    const sp = new URLSearchParams();
    if (category !== 'tang') sp.set('category', category);
    if (selectedForms.length > 0) sp.set('form', selectedForms.join(','));
    const qs = sp.toString();
    router.replace(`/poetry${qs ? '?' + qs : ''}`, { scroll: false });
  }, [category, selectedForms, router]);

  // Fetch poems
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const r = await listPoemsRequest({ category, q: q || undefined, forms: selectedForms.length > 0 ? selectedForms : undefined, page });
        if (!cancelled) { setItems(r.items); setTotal(r.total); }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [category, q, page, selectedForms]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
        <SectionTitle subtitle="诗三百首 · 词三百首 · 打印字帖">古诗词</SectionTitle>
        <PoemSearch
          category={category}
          q={q}
          onCategoryChange={(c) => { setCategory(c); setPage(1); setSelectedForms([]); }}
          onQChange={(v) => { setQ(v); setPage(1); }}
        />
        <FormFilterBar
          category={category}
          availableForms={availableForms}
          selectedForms={selectedForms}
          onChange={(forms) => { setSelectedForms(forms); setPage(1); }}
        />
        {error ? <ErrorState message={error} onRetry={() => setPage(p => p)} /> : loading ? <LoadingSpinner /> : items.length === 0 ? <EmptyState title="无匹配诗作" /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
              {items.map(p => <PoemCard key={p.id} poem={p} />)}
            </div>
            <PoemPagination page={page} pageSize={24} total={total} onPageChange={setPage} />
          </>
        )}
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 7: Modify lib/api-poetry.ts to add getAvailableFormsRequest**

```ts
// lib/api-poetry.ts (add)
export async function getAvailableFormsRequest(category: string): Promise<string[]> {
  const r = await fetch(`/api/poetry/forms?category=${encodeURIComponent(category)}`);
  if (!r.ok) return [];
  const d = await r.json();
  return d.forms || [];
}
```

- [ ] **Step 8: Verify tsc + build (per memory rule)**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: tsc clean; build green (Task 10 will create the API routes build-poems-extra reads; for now, /poetry may 404 on /api/poetry/forms but build should still pass).

- [ ] **Step 9: Commit**

```bash
git add components/poetry/FormFilterBar.tsx app/poetry/page.tsx lib/api-poetry.ts tests/unit/components/poetry/FormFilterBar.test.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): form filter chips UI + URL sync on /poetry"
```

---

### Task 10: API routes for /api/poetry + /api/poetry/forms

**Files:**
- Create: `app/api/poetry/route.ts`
- Create: `app/api/poetry/forms/route.ts`
- Test: `tests/integration/api/poetry-list.test.ts`

**Interfaces:**
- `GET /api/poetry?category=...&forms=五绝,七绝&q=...&page=1` → `PoemListResult`
- `GET /api/poetry/forms?category=...` → `{ forms: string[] }`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/api/poetry-list.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery, execute: mockExecute }),
}));

describe('GET /api/poetry', () => {
  it('parses forms CSV and passes to listPoems', async () => {
    mockQuery
      .mockReset()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);
    const { GET } = await import('@/app/api/poetry/route');
    const req = new Request('http://localhost/api/poetry?category=tang&forms=%E4%BA%94%E7%BB%9D%2C%E4%B8%83%E7%BB%9D&page=1');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/form IN/);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/api/poetry-list.test.ts`
Expected: FAIL

- [ ] **Step 3: Create API routes**

```ts
// app/api/poetry/route.ts
import { NextResponse } from 'next/server';
import { listPoems } from '@/lib/poetry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') || undefined;
  const dynasty = url.searchParams.get('dynasty') || undefined;
  const formsParam = url.searchParams.get('forms');
  const forms = formsParam ? formsParam.split(',').filter(Boolean) : undefined;
  const q = url.searchParams.get('q') || undefined;
  const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

  try {
    const result = await listPoems({ category, dynasty, forms, q, page } as any);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

```ts
// app/api/poetry/forms/route.ts
import { NextResponse } from 'next/server';
import { getAvailableForms } from '@/lib/poetry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') || 'tang';
  try {
    const forms = await getAvailableForms(category);
    return NextResponse.json({ forms });
  } catch (err) {
    return NextResponse.json({ forms: [] });
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/integration/api/poetry-list.test.ts`
Expected: PASS

- [ ] **Step 5: Smoke on dev server**

```bash
pnpm dev
# in another terminal:
curl -s "http://localhost:4444/api/poetry/forms?category=tang" | python -m json.tool | head -10
curl -s "http://localhost:4444/api/poetry?category=tang&forms=%E4%BA%94%E7%BB%9D" | python -m json.tool | head -10
```

Expected: `{"forms": ["五绝", "七绝", "五律", "七律", ...]}`; `{"items": [...], "total": N}` for 七绝.

- [ ] **Step 6: Browser smoke: /poetry form chips work**

```bash
# open browser to http://localhost:4444/poetry
# click 五绝 chip → URL has ?form=五绝, list filters
# click 七绝 → URL has ?form=五绝,七绝, list shows both
# switch to 宋词 tab → chips become 词牌名
```

- [ ] **Step 7: tsc + build + commit**

```bash
pnpm tsc --noEmit
pnpm build
git add app/api/poetry/route.ts app/api/poetry/forms/route.ts tests/integration/api/poetry-list.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(poetry): API routes /api/poetry + /api/poetry/forms"
```

---

### Task 11: SEO config + JSON-LD + metadata builders

**Files:**
- Create: `lib/seo/config.ts`
- Create: `lib/seo/metadata.ts`
- Create: `lib/seo/jsonld.ts`
- Create: `lib/seo/canonical.ts`
- Test: `tests/unit/lib/seo/metadata.test.ts`
- Test: `tests/unit/lib/seo/jsonld.test.ts`

**Interfaces:**
- `SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'`
- `SITE_NAME = '字·韵'`
- `SITE_LOCALE = 'zh_CN'`
- `generatePoemMetadata(id)`, `generateClassicMetadata(slug)`, `generateCharMetadata(char)`
- `buildCreativeWork(poem)`, `buildBook(classic)`, `buildDefinedTerm(char)`, `buildBreadcrumbList(items)`, `buildOrganization()`, `buildWebSite()`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/lib/seo/metadata.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ getPool: () => ({ query: vi.fn().mockResolvedValue([[{ id: 1, title: '静夜思', author: '李白', dynasty: 'tang', category: 'tang', content: JSON.stringify(['床前明月光','疑是地上霜','举头望明月','低头思故乡']), pinyin: '[]', appreciation: null }]]), execute: vi.fn() }) }));

describe('generatePoemMetadata', () => {
  it('returns unique title, description, canonical', async () => {
    const { generatePoemMetadata } = await import('@/lib/seo/metadata');
    const m = await generatePoemMetadata(1);
    expect(m.title).toContain('静夜思');
    expect(m.title).toContain('李白');
    expect(m.description).toBeTruthy();
    expect(m.alternates?.canonical).toMatch(/\/poetry\/1$/);
  });
});
```

```ts
// tests/unit/lib/seo/jsonld.test.ts
import { describe, it, expect } from 'vitest';
import { buildCreativeWork, buildBook, buildDefinedTerm, buildBreadcrumbList, buildOrganization, buildWebSite } from '@/lib/seo/jsonld';

describe('JSON-LD builders', () => {
  it('buildCreativeWork includes required fields', () => {
    const json = buildCreativeWork({ title: '静夜思', author: '李白', dynasty: 'tang', content: ['床前明月光'], category: 'tang', form: '五绝' });
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('CreativeWork');
    expect(json.name).toBe('静夜思');
    expect(json.author).toEqual({ '@type': 'Person', name: '李白' });
    expect(json.inLanguage).toBe('zh-CN');
  });

  it('buildBook includes era as datePublished', () => {
    const json = buildBook({ title: '论语', author: '孔子', era: '春秋' });
    expect(json['@type']).toBe('Book');
    expect(json.datePublished).toBe('春秋');
  });

  it('buildDefinedTerm has correct schema', () => {
    const json = buildDefinedTerm({ char: '学', meaning_zh: '学习' });
    expect(json['@type']).toBe('DefinedTerm');
    expect(json.name).toBe('学');
  });

  it('buildBreadcrumbList with multiple items', () => {
    const json = buildBreadcrumbList([{ name: '首页', url: '/' }, { name: '字典', url: '/chars' }, { name: '学', url: '/chars/学' }]);
    expect(json.itemListElement.length).toBe(3);
  });

  it('buildWebSite includes SearchAction', () => {
    const json = buildWebSite();
    expect(json['@type']).toBe('WebSite');
    expect(json.potentialAction['@type']).toBe('SearchAction');
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `pnpm test tests/unit/lib/seo/metadata.test.ts tests/unit/lib/seo/jsonld.test.ts`
Expected: FAIL

- [ ] **Step 3: Create lib/seo/config.ts**

```ts
// lib/seo/config.ts
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
export const SITE_NAME = '字·韵';
export const SITE_LOCALE = 'zh_CN';
```

- [ ] **Step 4: Create lib/seo/canonical.ts**

```ts
// lib/seo/canonical.ts
import { SITE_URL } from './config';

export function buildCanonicalUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${cleanPath}`;
}
```

- [ ] **Step 5: Create lib/seo/metadata.ts**

```ts
// lib/seo/metadata.ts
import type { Metadata } from 'next';
import { getPool } from '@/lib/db';
import { SITE_NAME, SITE_URL } from './config';
import { buildCanonicalUrl } from './canonical';

const DYNASTY_LABEL: Record<string, string> = {
  tang: '唐', song: '宋', yuan: '元',
  '汉': '汉', '魏': '魏', '清': '清', '汉末': '汉末', '魏晋': '魏晋', '南北朝': '南北朝',
  '三国': '三国', 'mixed': '历代',
};

interface PoemRow { id: number; title: string; author: string; dynasty: string; category: string | null; content: string | null; form: string | null; }

function parseParagraphs(content: string | null): string[] {
  if (!content) return [];
  try { const v = JSON.parse(content); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function generatePoemMetadata(id: number): Promise<Metadata> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT id, title, author, dynasty, category, content, form FROM poems WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(rows) || rows.length === 0) return { title: `未找到 | ${SITE_NAME}` };
  const p = (rows as any[])[0] as PoemRow;
  const paragraphs = parseParagraphs(p.content);
  const excerpt = paragraphs.slice(0, 2).join(' ').slice(0, 60);
  const desc = `${p.author}《${p.title}》${excerpt} 拼音注音 | ${SITE_NAME}`;
  const dynastyLabel = DYNASTY_LABEL[p.dynasty] || p.dynasty;
  const title = `${p.title} - ${p.author} (${dynastyLabel}) | ${SITE_NAME}`;
  return {
    title,
    description: desc,
    alternates: { canonical: buildCanonicalUrl(`/poetry/${id}`) },
    openGraph: { title: p.title, description: desc, type: 'article' },
    twitter: { card: 'summary', title: p.title, description: desc },
  };
}

export async function generateClassicMetadata(slug: string): Promise<Metadata> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT slug, title, author, era FROM classics WHERE slug = ? LIMIT 1`,
    [slug]
  );
  if (!Array.isArray(rows) || rows.length === 0) return { title: `未找到 | ${SITE_NAME}` };
  const c = (rows as any[])[0];
  const title = `${c.title} (${c.era || '古代'}) 全文 拼音 | ${SITE_NAME}`;
  const desc = `${c.title}${c.author ? ` - ${c.author}` : ''} (${c.era || ''}) 全文带拼音注音 | ${SITE_NAME}`;
  return {
    title,
    description: desc,
    alternates: { canonical: buildCanonicalUrl(`/ancient/${slug}`) },
    openGraph: { title: c.title, description: desc, type: 'book' },
    twitter: { card: 'summary', title: c.title, description: desc },
  };
}

export async function generateCharMetadata(char: string): Promise<Metadata> {
  const pool = getPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT c.char, c.pinyin, m.meaning_zh FROM chars c LEFT JOIN char_meanings m ON c.id = m.char_id WHERE c.char = ? LIMIT 1`,
    [char]
  );
  if (!Array.isArray(rows) || rows.length === 0) return { title: `${char} | ${SITE_NAME}` };
  const r = (rows as any[])[0];
  const pinyin = r.pinyin || '';
  const meaning = r.meaning_zh?.slice(0, 60) || '';
  const title = `${char} - 拼音 ${pinyin} - 释义 | ${SITE_NAME}`;
  const desc = `汉字「${char}」的拼音 ${pinyin}，释义：${meaning} | ${SITE_NAME}`;
  return {
    title,
    description: desc,
    alternates: { canonical: buildCanonicalUrl(`/chars/${encodeURIComponent(char)}`) },
    openGraph: { title: `汉字 ${char} (${pinyin})`, description: desc, type: 'article' },
    twitter: { card: 'summary', title: `汉字 ${char}`, description: desc },
  };
}
```

- [ ] **Step 6: Create lib/seo/jsonld.ts**

```ts
// lib/seo/jsonld.ts
import { SITE_URL, SITE_NAME } from './config';

interface PoemForJsonLd { title: string; author: string; dynasty: string; content: string[]; category: string | null; form: string | null; }

export function buildCreativeWork(p: PoemForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: p.title,
    author: { '@type': 'Person', name: p.author || '佚名' },
    inLanguage: 'zh-CN',
    isPartOf: p.category ? { '@type': 'Book', name: p.category } : undefined,
    text: p.content.join('\n'),
    genre: p.form || undefined,
  };
}

interface BookForJsonLd { title: string; author: string | null; era: string | null; }
export function buildBook(b: BookForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: b.title,
    author: { '@type': 'Person', name: b.author || '佚名' },
    inLanguage: 'zh-CN',
    datePublished: b.era || undefined,
  };
}

interface TermForJsonLd { char: string; meaning_zh: string | null; }
export function buildDefinedTerm(t: TermForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: t.char,
    description: t.meaning_zh || undefined,
    inLanguage: 'zh-CN',
  };
}

export function buildBreadcrumbList(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${SITE_URL}${item.url.startsWith('/') ? item.url : '/' + item.url}`,
    })),
  };
}

export function buildOrganization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
  };
}

export function buildWebSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}
```

- [ ] **Step 7: Run tests, verify PASS**

Run: `pnpm test tests/unit/lib/seo/metadata.test.ts tests/unit/lib/seo/jsonld.test.ts`
Expected: PASS

- [ ] **Step 8: tsc + commit**

```bash
pnpm tsc --noEmit
git add lib/seo/ tests/unit/lib/seo/
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): lib/seo module (config, canonical, metadata, jsonld)"
```

---

### Task 12: app/sitemap.ts + app/robots.ts + 3 sub-sitemap routes

**Files:**
- Create: `app/sitemap.ts`
- Create: `app/robots.ts`
- Create: `app/sitemap/poetry.xml/route.ts`
- Create: `app/sitemap/ancient.xml/route.ts`
- Create: `app/sitemap/chars.xml/route.ts`
- Test: `tests/integration/app/sitemap.test.ts`

**Interfaces:**
- `GET /sitemap.xml` → Next.js auto-generated sitemap index
- `GET /sitemap/poetry.xml` → XML with all poem URLs (~10MB)
- `GET /sitemap/ancient.xml` → XML with all classic URLs
- `GET /sitemap/chars.xml` → XML with all char URLs
- `GET /robots.txt` → robots with sitemap reference

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/app/sitemap.test.ts
import { describe, it, expect, vi } from 'vitest';
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: () => ({ query: mockQuery, execute: vi.fn() }) }));

describe('sitemap routes', () => {
  it('GET /sitemap/poetry.xml returns XML with poem URLs', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce([[{ id: 1, updated_at: new Date() }, { id: 2, updated_at: new Date() }]]);
    const { GET } = await import('@/app/sitemap/poetry.xml/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<urlset');
    expect(text).toContain('/poetry/1');
    expect(text).toContain('/poetry/2');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/integration/app/sitemap.test.ts`
Expected: FAIL

- [ ] **Step 3: Create app/sitemap.ts**

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/config';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    { url: `${SITE_URL}/`, lastModified: new Date(), priority: 1.0, changeFrequency: 'daily' },
    { url: `${SITE_URL}/poetry`, priority: 0.9, changeFrequency: 'daily' },
    { url: `${SITE_URL}/ancient`, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${SITE_URL}/chars`, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${SITE_URL}/sitemap/poetry.xml`, lastModified: new Date() },
    { url: `${SITE_URL}/sitemap/ancient.xml`, lastModified: new Date() },
    { url: `${SITE_URL}/sitemap/chars.xml`, lastModified: new Date() },
  ];
}
```

- [ ] **Step 4: Create app/robots.ts**

```ts
// app/robots.ts
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

- [ ] **Step 5: Create 3 sub-sitemap routes**

```ts
// app/sitemap/poetry.xml/route.ts
import { getPool } from '@/lib/db';
import { SITE_URL } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT id, updated_at FROM poems ORDER BY id`);
  const urls = (rows as any[]).map(r => {
    const lastmod = r.updated_at instanceof Date ? r.updated_at.toISOString() : new Date(r.updated_at).toISOString();
    return `<url><loc>${SITE_URL}/poetry/${r.id}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`;
  }).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

```ts
// app/sitemap/ancient.xml/route.ts
import { getPool } from '@/lib/db';
import { SITE_URL } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT slug, updated_at FROM classics ORDER BY slug`);
  const urls = (rows as any[]).map(r => {
    const lastmod = r.updated_at instanceof Date ? r.updated_at.toISOString() : new Date(r.updated_at).toISOString();
    return `<url><loc>${SITE_URL}/ancient/${r.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`;
  }).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

```ts
// app/sitemap/chars.xml/route.ts
import { getPool } from '@/lib/db';
import { SITE_URL } from '@/lib/seo/config';

export const revalidate = 3600;

export async function GET() {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT char, updated_at FROM chars ORDER BY id`);
  const urls = (rows as any[]).map(r => {
    const lastmod = r.updated_at instanceof Date ? r.updated_at.toISOString() : new Date(r.updated_at).toISOString();
    return `<url><loc>${SITE_URL}/chars/${encodeURIComponent(r.char)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`;
  }).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
}
```

- [ ] **Step 6: Run test, verify PASS**

Run: `pnpm test tests/integration/app/sitemap.test.ts`
Expected: PASS

- [ ] **Step 7: Smoke on dev server**

```bash
pnpm dev
# in another terminal:
curl -sI http://localhost:4444/sitemap.xml
curl -sI http://localhost:4444/robots.txt
curl -s http://localhost:4444/sitemap/poetry.xml | head -c 200
curl -s http://localhost:4444/sitemap/ancient.xml | head -c 200
```

Expected: 200 OK for all; valid XML.

- [ ] **Step 8: tsc + build + commit**

```bash
pnpm tsc --noEmit
pnpm build
git add app/sitemap.ts app/robots.ts app/sitemap/ tests/integration/app/sitemap.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): dynamic sitemap (poetry/ancient/chars) + robots.txt"
```

---

### Task 13: Detail page metadata + JSON-LD injection (poetry/ancient/chars)

**Files:**
- Modify: `app/poetry/[id]/page.tsx` (add `generateMetadata` + JSON-LD `<script>`)
- Modify: `app/ancient/[slug]/page.tsx` (same)
- Modify: `app/chars/[char]/page.tsx` (same)
- Modify: `app/page.tsx` (add Organization + WebSite JSON-LD)
- Modify: `app/layout.tsx` (upgrade global metadata + add `metadataBase`)
- Test: (manual smoke + verify in browser View Source)

**Interfaces:**
- Each detail page exports `generateMetadata` from `lib/seo/metadata.ts`
- Each detail page injects JSON-LD via `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />`
- BreadcrumbList appended on each detail page

- [ ] **Step 1: Read current detail pages**

```bash
# Note exact line numbers and existing structure
cat "E:/ToolDevelop/PinYinCharacter/app/poetry/[id]/page.tsx" | head -10
cat "E:/ToolDevelop/PinYinCharacter/app/ancient/[slug]/page.tsx" | head -10
cat "E:/ToolDevelop/PinYinCharacter/app/chars/[char]/page.tsx" | head -10
cat "E:/ToolDevelop/PinYinCharacter/app/page.tsx" | head -20
```

Document the existing return structure (RSC, async, uses getXxxById functions) for each so the modify steps match the actual signatures.

- [ ] **Step 2: Modify app/poetry/[id]/page.tsx — add generateMetadata + JSON-LD**

```tsx
// app/poetry/[id]/page.tsx — add at top of file after imports:
import { generatePoemMetadata } from '@/lib/seo/metadata';
import { buildCreativeWork, buildBreadcrumbList } from '@/lib/seo/jsonld';

export async function generateMetadata({ params }: Props) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return {};
  return generatePoemMetadata(id);
}

// Inside PoemDetailPage, after the `if (!poem) notFound();` line, add:
const jsonLdCreative = buildCreativeWork(poem);
const jsonLdBreadcrumb = buildBreadcrumbList([
  { name: '首页', url: '/' },
  { name: '诗词', url: '/poetry' },
  { name: poem.title, url: `/poetry/${poem.id}` },
]);

// In the JSX, just before `</PageContainer>` or at the end, add:
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdCreative) }} />
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }} />
```

(Adjust exact placement to match existing structure.)

- [ ] **Step 3: Modify app/ancient/[slug]/page.tsx — same pattern**

```tsx
// Add import + generateMetadata + JSON-LD
import { generateClassicMetadata } from '@/lib/seo/metadata';
import { buildBook, buildBreadcrumbList } from '@/lib/seo/jsonld';

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return generateClassicMetadata(slug);
}

// Inside the page component, after fetching classic:
const jsonLdBook = buildBook(classic);
const jsonLdBreadcrumb = buildBreadcrumbList([
  { name: '首页', url: '/' },
  { name: '古籍', url: '/ancient' },
  { name: classic.title, url: `/ancient/${classic.slug}` },
]);

// In JSX add the two scripts
```

- [ ] **Step 4: Modify app/chars/[char]/page.tsx — same pattern**

```tsx
// Add import + generateMetadata + JSON-LD
import { generateCharMetadata } from '@/lib/seo/metadata';
import { buildDefinedTerm, buildBreadcrumbList } from '@/lib/seo/jsonld';

export async function generateMetadata({ params }: Props) {
  const { char } = await params;
  return generateCharMetadata(decodeURIComponent(char));
}

// Inside page, after fetching char:
const jsonLdTerm = buildDefinedTerm({ char: charInfo.char, meaning_zh: charInfo.meaning_zh });
const jsonLdBreadcrumb = buildBreadcrumbList([
  { name: '首页', url: '/' },
  { name: '字典', url: '/chars' },
  { name: charInfo.char, url: `/chars/${encodeURIComponent(charInfo.char)}` },
]);

// In JSX add the two scripts
```

- [ ] **Step 5: Modify app/page.tsx (homepage) — add Organization + WebSite JSON-LD**

```tsx
// app/page.tsx — add at top:
import { buildOrganization, buildWebSite } from '@/lib/seo/jsonld';

// Inside HomePage, before return:
const jsonLdOrg = buildOrganization();
const jsonLdSite = buildWebSite();

// In JSX, add at end of return:
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdOrg) }} />
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSite) }} />
```

- [ ] **Step 6: Modify app/layout.tsx — upgrade global metadata + metadataBase**

```tsx
// app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';
import { AuthSync } from './_auth-sync';
import { ToastViewport } from '@/components/common/Toast';
import { SITE_URL, SITE_NAME } from '@/lib/seo/config';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — 汉字与拼音互转`, template: `%s | ${SITE_NAME}` },
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
  openGraph: { siteName: SITE_NAME, locale: 'zh_CN', type: 'website' },
  twitter: { card: 'summary' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/font/fonts.css" />
        <meta name="theme-color" content="#5A4530" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
```

- [ ] **Step 7: tsc + build (mandatory per memory rule for new route + page changes)**

```bash
pnpm tsc --noEmit
pnpm build
```

Expected: both pass clean.

- [ ] **Step 8: Browser smoke**

```bash
pnpm dev
# in browser:
# - view-source:http://localhost:4444/poetry/1 → see unique title, description, canonical
# - view-source:http://localhost:4444/ancient/lunyu → see Book JSON-LD
# - view-source:http://localhost:4444/chars/学 → see DefinedTerm JSON-LD
# - view-source:http://localhost:4444/ → see Organization + WebSite JSON-LD
# - view-source:http://localhost:4444/robots.txt → Sitemap: http://localhost:4444/sitemap.xml
# - visit http://localhost:4444/sitemap.xml → see index references 3 sub-sitemaps
# - visit http://localhost:4444/sitemap/poetry.xml → ~10MB XML with all poem URLs
```

- [ ] **Step 9: Commit**

```bash
git add app/poetry/[id]/page.tsx app/ancient/[slug]/page.tsx app/chars/[char]/page.tsx app/page.tsx app/layout.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(seo): generateMetadata + JSON-LD on /poetry /ancient /chars + homepage + layout upgrade"
```

---

### Task 14: Full regression + dev smoke + prod push

**Files:** none new; this is a verification + push task.

- [ ] **Step 1: Run full test suite**

```bash
pnpm tsc --noEmit
pnpm build
pnpm test
```

Expected: tsc clean; build green; vitest ≥ 575/578 (G6 baseline) — should be ~600/600+ now with the new tests.

- [ ] **Step 2: 8-step dev smoke (browser)**

1. /poetry → category=唐诗 → form chips show, hover 数字 = DB 实际数
2. form chip 选 七绝 → 列表只剩 七绝 诗，分页正确
3. form chip 多选（七绝 + 七律）→ 列表是两类的并集
4. URL 复制 `?form=七绝,七律` 刷新 → 状态保留
5. category 切到 宋词 → form chips 自动切到词牌名（前 30）
6. category 切到 汉乐府 (新) → form chips 显示诗类，列表有 ~200 首
7. /poetry/<id>（某首 新汉乐府）→ 详情正常显示，head 有 unique metadata + JSON-LD
8. /ancient 列表 → 训蒙骈句 出现，点击进入阅读器正常

- [ ] **Step 3: 5-step SEO smoke (browser)**

9. View Source /poetry/<id> → unique title, description, canonical, JSON-LD `<script>`
10. /sitemap.xml → 200 OK，引用 3 个分片
11. /sitemap/poetry.xml → 200 OK，包含所有诗 URL (~10MB)
12. /robots.txt → 含 Sitemap 指向
13. 详情页 JSON-LD CreativeWork/Book/DefinedTerm 字段正确（用 Google Rich Results Test 在线工具或本地解析）

- [ ] **Step 4: git push to remote**

```bash
git push origin main
```

Expected: GH Actions / auto-deploy triggers; verify the changes reach origin (status check).

- [ ] **Step 5: Run all 4 prod migration steps (after dev smoke passes)**

```bash
DATABASE_URL="mysql://piyin:Admin909217@139.5.108.245:3306/piyin" pnpm tsx scripts/migrate-poems-schema.ts
DATABASE_URL="...piyin" pnpm tsx scripts/normalize-existing-form.ts
DATABASE_URL="...piyin" pnpm tsx scripts/build-form-tags.ts
DATABASE_URL="...piyin" pnpm tsx scripts/build-poems-extra.ts
DATABASE_URL="...piyin" pnpm tsx scripts/build-pianwen.ts
"/e/mysql/bin/mysql.exe" -h139.5.108.245 -upiyin -pAdmin909217 --default-character-set=utf8mb4 piyin -e "SELECT category, COUNT(*) AS n FROM poems GROUP BY category; SELECT COUNT(*) AS pianwen FROM classics WHERE category='pianwen';"
```

Expected: categories include 汉乐府/古诗十九首/魏/qing/骈文 with correct counts; 训蒙骈句 in classics.

- [ ] **Step 6: Browser smoke on prod (https://pinyin.example.com — replace with actual domain)**

Repeat the 8 + 5 step smoke on prod. Verify SEO is working (sitemaps reachable, JSON-LD valid).

- [ ] **Step 7: Update memory + final report**

```bash
# Update memory file plan-poetry-expansion-status.md with COMPLETE status
# Final report to user: total commits, tasks done, smoke results
```

- [ ] **Step 8: Final commit (if any doc updates)**

```bash
git add memory/
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "docs(memory): poetry+SEO plan COMPLETE 2026-06-21" || echo "no memory changes"
```

---

## Verification Checklist (before claiming complete)

- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm build` exit 0
- [ ] `pnpm test` ≥ 575/578 (G6 baseline) — new tests should bring it higher
- [ ] 8-step /poetry + form filter smoke passes on dev
- [ ] 5-step SEO smoke passes on dev (sitemap.xml, robots.txt, JSON-LD, canonical all valid)
- [ ] All 4 prod migration steps run successfully on piyin (migration + normalize + backfill + ingest)
- [ ] Browser smoke on prod passes (8 + 5 steps)
- [ ] Sitemap production URLs reachable; JSON-LD valid on detail pages
- [ ] Memory file updated with COMPLETE status
