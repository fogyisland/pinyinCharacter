# Era Font Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/etymology/[char]` era→font mapping admin-configurable via a new `/admin/settings/fonts` page, with curated font lists per era and Oracular as the new 甲骨文 default.

**Architecture:** 5 `app_config` rows (`era.${era}.font`) drive the font chosen per era. RSC `/etymology/[char]/page.tsx` reads them via `getActiveEraFonts()` and passes the result to `EtymologyMorph` as a prop. Admin UI writes via `PUT /api/admin/font-config` (validated by `KEY_VALIDATORS`). New `@font-face` declarations register 4 alternative TTF files.

**Tech Stack:** Next.js 15.5.19 (App Router, RSC), React 19, TypeScript, Vitest, MySQL 5.7, fontTools (read TTF names, not required at runtime).

**Spec:** `docs/superpowers/specs/2026-06-28-era-font-admin-design.md` (commit 3def0ead)

---

## Global Constraints

These apply to every task unless a task overrides them.

- **Per-task pnpm build** required for tasks that touch `app/**/page.tsx` or add new routes (per memory `feedback-per-task-build-check`). Pure lib/ files: `tsc --noEmit` only.
- **Kill `pnpm dev` on port 4444 before `pnpm build`** (per memory `dev-build-cache-stomp`).
- **Idempotent SQL migrations** (per memory `feedback-per-task-build-check`): use `INSERT ... ON DUPLICATE KEY UPDATE`.
- **Frequent commits**: 1 task = 1 commit (per memory pattern).
- **TDD order**: failing test first → run to verify fail → impl → run to verify pass → commit.
- **No emojis** in code, comments, or commits.
- **Audit log every mutating admin endpoint** (per memory `user-action-audit-preference`); metadata must include resolved Chinese labels, not raw IDs.
- **Reuse existing helpers**: `requireAdmin()`, `setConfig`, `setConfigBatch`, `getAllConfig`, `auditLog` from `lib/audit.ts`. Do not write parallel validation/auth.
- **CSS @font-face family ID** is independent of TTF internal name. Use clean IDs (`Oracular`, `WangHanzongWeibei`) as `font-family` strings, regardless of TTF `name.nameID 1`.
- **Existing era columns on `char_etymology` table** (`era_jiaguwen_font`, `era_jinwen_font`, etc.) are reserved for future per-char override; v1 does not read them. v1 source of truth is `app_config` only.

---

## File Structure

### New (5 source + 4 tests = 9 files)

| Path | Purpose |
|---|---|
| `lib/era-fonts.ts` | Curated registry + `DEFAULT_ERA_FONTS` + `getActiveEraFonts()` resolver |
| `app/api/admin/font-config/route.ts` | GET + PUT for era font config |
| `app/admin/settings/fonts/page.tsx` | RSC wrapper for admin font settings page |
| `components/admin/FontConfigForm.tsx` | 'use client' form with 5 era dropdowns |
| `scripts/migrations/2026-06-28-era-font-defaults.sql` | Seed 5 default `app_config` rows |
| `tests/unit/lib/era-fonts.test.ts` | Unit tests for registry + resolver |
| `tests/unit/app/api/admin/font-config.test.ts` | API tests for GET + PUT |
| `tests/unit/components/admin/FontConfigForm.test.tsx` | Form tests (renders + save) |
| `tests/integration/etymology-era-font.test.ts` | End-to-end: set app_config → /etymology HTML reflects |

### Modified (8 files)

| Path | Change |
|---|---|
| `app/globals.css` | Add 4 `@font-face` blocks (Oracular, OracularInverted, WangHanzongWeibei, WangHanzongXingshu) |
| `lib/config.ts` | Add 5 `KEY_VALIDATORS` entries |
| `components/etymology/EtymologyMorph.tsx` | Drop hardcoded `ERA_FONT_FAMILY`; accept `eraFonts` prop |
| `app/etymology/[char]/page.tsx` | Fetch `getActiveEraFonts()` and pass to EtymologyMorph |
| `scripts/init-db.ts` | Append 5 INSERTs to inline DDL for fresh installs |
| `scripts/download-ancient-fonts.ts` | Add 4 `FontEntry` rows for new fonts |
| `components/admin/AdminSidebar.tsx` | Add 「字源字体」 link under settings group |
| `docs/superpowers/specs/...` | (spec already committed; no further edits needed) |

---

### Task 1: Foundation — register 4 new TTF files in CSS + download script

**Files:**
- Modify: `app/globals.css:204` (append after existing ancient-script block)
- Modify: `scripts/download-ancient-fonts.ts:72` (append 4 new `FontEntry` rows to the `FONTS` array)

**Interfaces:**
- Produces: 4 new `font-family` IDs usable in `EtymologyMorph`: `Oracular`, `OracularInverted`, `WangHanzongWeibei`, `WangHanzongXingshu`.

- [ ] **Step 1: Append 4 `@font-face` declarations to globals.css**

Open `app/globals.css`. After the existing `@font-face { font-family: 'KaiTi' ... }` block (line 204), append:

```css

/* ============ Era font alternatives (added 2026-06-28) ============ */
@font-face {
  font-family: 'Oracular';
  src: url('/fonts/Oracular-Regular.ttf') format('truetype'),
       url('/fonts/BabelStoneHanBasic.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'OracularInverted';
  src: url('/fonts/Oracular-Inverted.ttf') format('truetype'),
       url('/fonts/BabelStoneHanBasic.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'WangHanzongWeibei';
  src: url('/fonts/wang-hanzong-weibei.ttf') format('truetype'),
       url('/fonts/BabelStoneHanBasic.ttf') format('truetype');
  font-display: swap;
}
@font-face {
  font-family: 'WangHanzongXingshu';
  src: url('/fonts/wang-hanzong-xingshu.ttf') format('truetype'),
       url('/fonts/BabelStoneHanBasic.ttf') format('truetype');
  font-display: swap;
}
```

- [ ] **Step 2: Append 4 `FontEntry` rows to download-ancient-fonts.ts**

Open `scripts/download-ancient-fonts.ts`. Find the `const FONTS: FontEntry[] = [...]` array (currently ends at line 72 with the wang-hanzong-lishu entry). After that closing `},`, append 4 more entries:

```ts
  {
    filename: 'Oracular-Regular.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/jamshidh/Oracular@master/Oracular-Regular.ttf'],
    label: 'Oracular (甲骨文)',
  },
  {
    filename: 'Oracular-Inverted.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/jamshidh/Oracular@master/Oracular-Inverted.ttf'],
    label: 'Oracular Inverted (甲骨文 阴文)',
  },
  {
    filename: 'wang-hanzong-weibei.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/%E4%B8%AD%E6%96%87/%E7%8E%8B%E6%B1%89%E5%AE%97%E5%AD%97%E4%BD%93%E7%B3%BB%E5%88%97/%E7%8E%8B%E6%BC%A2%E5%AE%97%E4%B8%AD%E9%AD%9A%E9%9A%86%E7%A2%91.ttf'],
    label: '王漢宗魏碑 (Wang Hanzong WeiBei, 金文近似)',
  },
  {
    filename: 'wang-hanzong-xingshu.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/%E4%B8%AD%E6%96%87/%E7%8E%8B%E6%B1%89%E5%AE%97%E5%AD%97%E4%BD%93%E7%B3%BB%E5%88%97/%E7%8E%8B%E6%BC%A2%E5%AE%97%E8%A1%8C%E6%9B%B8%E7%B9%81.ttf'],
    label: '王漢宗行書繁 (Wang Hanzong XingShu)',
  },
```

- [ ] **Step 3: Run tsc to verify**

Run: `pnpm tsc --noEmit`
Expected: clean (no new TypeScript usage yet).

- [ ] **Step 4: Commit**

```bash
git add app/globals.css scripts/download-ancient-fonts.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(fonts): register Oracular + 王漢宗魏碑/行書繁 @font-face + download entries"
```

---

### Task 2: lib/era-fonts.ts — curated registry + defaults + resolver

**Files:**
- Create: `lib/era-fonts.ts`
- Create: `tests/unit/lib/era-fonts.test.ts`

**Interfaces:**
- Exports: `EraFontOption`, `ERA_FONTS`, `DEFAULT_ERA_FONTS`, `getActiveEraFonts()`
- Consumes: `ERAS` from `lib/etymology-types` (already exports this), `getAllConfig` from `lib/config.ts`
- Produces: a typed `Record<Era, string>` map that downstream tasks (`EtymologyMorph`, admin form) rely on.

- [ ] **Step 1: Read existing types to confirm ERAS shape**

Run:
```bash
grep -n "export.*ERAS\|export.*Era " lib/etymology-types.ts
```
Expected: `export const ERAS = [...]` and `export type Era = 'jiaguwen' | 'jinwen' | ...`. Note the import path for use in Step 3.

- [ ] **Step 2: Write failing tests**

Create `tests/unit/lib/era-fonts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config', () => ({
  getAllConfig: vi.fn(),
}));

import { ERA_FONTS, DEFAULT_ERA_FONTS, getActiveEraFonts } from '@/lib/era-fonts';
import { getAllConfig } from '@/lib/config';
import { ERAS } from '@/lib/etymology-types';

const mockedGetAllConfig = vi.mocked(getAllConfig);

describe('ERA_FONTS registry', () => {
  it('has exactly the 5 eras from ERAS', () => {
    for (const era of ERAS) {
      expect(ERA_FONTS[era]).toBeDefined();
      expect(ERA_FONTS[era].length).toBeGreaterThan(0);
    }
  });

  it('every option has id, label, file|desc shape', () => {
    for (const era of ERAS) {
      for (const opt of ERA_FONTS[era]) {
        expect(typeof opt.id).toBe('string');
        expect(opt.id.length).toBeGreaterThan(0);
        expect(typeof opt.label).toBe('string');
        expect(opt.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('default id for each era appears in that era\'s curated list', () => {
    for (const era of ERAS) {
      const ids = ERA_FONTS[era].map((o) => o.id);
      expect(ids).toContain(DEFAULT_ERA_FONTS[era]);
    }
  });
});

describe('DEFAULT_ERA_FONTS', () => {
  it('matches the spec values', () => {
    expect(DEFAULT_ERA_FONTS).toEqual({
      jiaguwen: 'Oracular',
      jinwen: 'WangHanzongWeibei',
      xiaozhuan: 'QuanZiKuShuoWen',
      lishu: 'WangHanzongLishu',
      kaishu: 'ZCOOLXiaoWei',
    });
  });
});

describe('getActiveEraFonts', () => {
  beforeEach(() => mockedGetAllConfig.mockReset());

  it('returns defaults when app_config is empty', async () => {
    mockedGetAllConfig.mockResolvedValue({});
    expect(await getActiveEraFonts()).toEqual(DEFAULT_ERA_FONTS);
  });

  it('overrides a single era when app_config has a valid id', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.jiaguwen.font': 'OracularInverted' });
    const out = await getActiveEraFonts();
    expect(out.jiaguwen).toBe('OracularInverted');
    expect(out.jinwen).toBe(DEFAULT_ERA_FONTS.jinwen);
  });

  it('ignores invalid ids (not in curated list) — keeps default', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.kaishu.font': 'NotARealFont' });
    const out = await getActiveEraFonts();
    expect(out.kaishu).toBe(DEFAULT_ERA_FONTS.kaishu);
  });

  it('ignores unrelated config keys', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'smtp.host': 'mail.example.com' });
    const out = await getActiveEraFonts();
    expect(out).toEqual(DEFAULT_ERA_FONTS);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/unit/lib/era-fonts.test.ts`
Expected: FAIL — `lib/era-fonts.ts` doesn't exist yet (module not found).

- [ ] **Step 4: Implement lib/era-fonts.ts**

Create `lib/era-fonts.ts`:

```ts
import { ERAS, type Era } from '@/lib/etymology-types';
import { getAllConfig } from '@/lib/config';

export interface EraFontOption {
  /** CSS @font-face family ID — what gets passed to font-family. */
  id: string;
  /** Human-readable label for the admin dropdown. */
  label: string;
  /** File under public/fonts/ — null if the font is a system/local fallback. */
  file: string | null;
  /** Short description shown in admin UI (size, style, notes). */
  desc: string;
}

export const ERA_FONTS: Record<Era, EraFontOption[]> = {
  jiaguwen: [
    { id: 'Oracular',         label: 'Oracular (默认)',         file: 'Oracular-Regular.ttf',  desc: '32MB, 甲骨文, 1531 BMP chars' },
    { id: 'OracularInverted', label: 'Oracular 阴文',           file: 'Oracular-Inverted.ttf', desc: '白底黑字, 类似真实甲骨' },
    { id: 'YinQiJiaGuWen',    label: 'Founder 甲骨文',          file: 'founder-jiaguwen.ttf',  desc: '方正甲骨文, 旧默认, 2.7MB' },
  ],
  jinwen: [
    { id: 'WangHanzongWeibei', label: '王汉宗魏碑 (默认)',     file: 'wang-hanzong-weibei.ttf', desc: '10MB, 魏碑 ≈ 金文风格' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',  desc: '25MB, 通用甲骨/金文/简帛 fallback' },
  ],
  xiaozhuan: [
    { id: 'QuanZiKuShuoWen',   label: '全字庫說文解字 (默认)', file: 'quanziku-shuowen.ttf',    desc: '10MB, 专用小篆' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',  desc: '25MB, 通用 fallback' },
  ],
  lishu: [
    { id: 'WangHanzongLishu',  label: '王漢宗中隸書繁 (默认)', file: 'wang-hanzong-lishu.ttf',  desc: '8.1MB, 专用隶书' },
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇',              file: 'zcool-xiaowei.ttf',       desc: '6.1MB, 现代隶书感' },
  ],
  kaishu: [
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇 (默认)',       file: 'zcool-xiaowei.ttf',       desc: '6.1MB, react-pdf 兼容' },
    { id: 'KaiTi',             label: '系统楷体',              file: null,                      desc: 'local(KaiTi) / STKaiti / BiauKai' },
    { id: 'Iansui',            label: '汉仪润圆',              file: 'Iansui-Regular.woff2',    desc: '1.2MB, 圆润楷书' },
    { id: 'MaShanZheng',       label: '马善政',                file: 'ma-shan-zheng.woff2',     desc: '3.2MB, 楷书带毛笔感' },
  ],
};

export const DEFAULT_ERA_FONTS: Record<Era, string> = {
  jiaguwen: 'Oracular',
  jinwen: 'WangHanzongWeibei',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'WangHanzongLishu',
  kaishu: 'ZCOOLXiaoWei',
};

/** Resolve the active font ID per era from app_config, with default fallback.
 *  Used by /etymology/[char] RSC. Invalid IDs are silently ignored so that
 *  an admin deleting a font file can't crash etymology rendering. */
export async function getActiveEraFonts(): Promise<Record<Era, string>> {
  const cfg = await getAllConfig();
  const out: Record<Era, string> = { ...DEFAULT_ERA_FONTS };
  for (const era of ERAS) {
    const v = cfg[`era.${era}.font`];
    if (v && ERA_FONTS[era].some((opt) => opt.id === v)) {
      out[era] = v;
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/unit/lib/era-fonts.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/era-fonts.ts tests/unit/lib/era-fonts.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(era-fonts): curated registry + defaults + getActiveEraFonts resolver"
```

---

### Task 3: KEY_VALIDATORS + SQL migration + init-db.ts update

**Files:**
- Modify: `lib/config.ts:3-45` (add 5 entries to KEY_VALIDATORS)
- Create: `scripts/migrations/2026-06-28-era-font-defaults.sql`
- Modify: `scripts/init-db.ts` (append 5 INSERTs to the inline DDL block)

**Interfaces:**
- Produces: 5 `app_config` keys `era.${era}.font` accepted by `setConfig` / `setConfigBatch`; new SQL migration file for prod upgrade; inline seed for fresh `init-db.ts` runs.

- [ ] **Step 1: Add 5 KEY_VALIDATORS to lib/config.ts**

Open `lib/config.ts`. After the `'site.url'` validator (line 44), add:

```ts
  'era.jiaguwen.font': (v) => ['Oracular', 'OracularInverted', 'YinQiJiaGuWen'].includes(v),
  'era.jinwen.font':    (v) => ['WangHanzongWeibei', 'HanDianJinWen'].includes(v),
  'era.xiaozhuan.font': (v) => ['QuanZiKuShuoWen', 'HanDianJinWen'].includes(v),
  'era.lishu.font':     (v) => ['WangHanzongLishu', 'ZCOOLXiaoWei'].includes(v),
  'era.kaishu.font':    (v) => ['ZCOOLXiaoWei', 'KaiTi', 'Iansui', 'MaShanZheng'].includes(v),
```

- [ ] **Step 2: Create SQL migration file**

Create `scripts/migrations/2026-06-28-era-font-defaults.sql`:

```sql
-- Seed default era font config (2026-06-28 plan era-font-admin).
-- Idempotent: re-runs find rows already present, ON DUPLICATE KEY UPDATE is a no-op
-- when value already matches.
-- Apply on existing piyin_dev / piyin DB:
--   "E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev < this_file
--   (same for piyin when prod exists)

INSERT INTO app_config (`key`, value, updated_by) VALUES
  ('era.jiaguwen.font', 'Oracular',          NULL),
  ('era.jinwen.font',    'WangHanzongWeibei', NULL),
  ('era.xiaozhuan.font', 'QuanZiKuShuoWen',   NULL),
  ('era.lishu.font',     'WangHanzongLishu',  NULL),
  ('era.kaishu.font',    'ZCOOLXiaoWei',      NULL)
ON DUPLICATE KEY UPDATE value = VALUES(value);
```

- [ ] **Step 3: Append 5 INSERTs to init-db.ts inline DDL**

Open `scripts/init-db.ts`. Find the existing DDL array (starts at line 15 with `const DDL = [...]`). Append a 5th INSERT to the end of the array:

```ts
  `INSERT INTO app_config (\`key\`, value, updated_by) VALUES
     ('era.jiaguwen.font', 'Oracular',          NULL),
     ('era.jinwen.font',    'WangHanzongWeibei', NULL),
     ('era.xiaozhuan.font', 'QuanZiKuShuoWen',   NULL),
     ('era.lishu.font',     'WangHanzongLishu',  NULL),
     ('era.kaishu.font',    'ZCOOLXiaoWei',      NULL)
   ON DUPLICATE KEY UPDATE value = VALUES(value)`,
```

- [ ] **Step 4: Apply SQL migration to local piyin_dev**

Run:
```bash
"E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev < "E:/ToolDevelop/PinYinCharacter/scripts/migrations/2026-06-28-era-font-defaults.sql"
```
Expected: silent success.

Verify:
```bash
"E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev -e "SELECT \`key\`, value FROM app_config WHERE \`key\` LIKE 'era.%';"
```
Expected: 5 rows, one per era, with the values from the migration.

- [ ] **Step 5: Run tsc to verify**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts scripts/migrations/2026-06-28-era-font-defaults.sql scripts/init-db.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(config): 5 era font KEY_VALIDATORS + seed migration + init-db inline"
```

---

### Task 4: EtymologyMorph accepts eraFonts prop + RSC fetches config

**Files:**
- Modify: `components/etymology/EtymologyMorph.tsx:14-20,133` (drop hardcoded map, add prop)
- Modify: `app/etymology/[char]/page.tsx` (fetch `getActiveEraFonts()` and pass to component)

**Interfaces:**
- Consumes: `getActiveEraFonts()` from `lib/era-fonts.ts` (Task 2); `ERA_FONT_FALLBACK` constant defined inline.
- Produces: EtymologyMorph's `eraFonts` prop shape — `Record<Era, string>` — is the consumer-side contract for what gets passed as `font-family`.

- [ ] **Step 1: Read current EtymologyMorph to confirm hardcoded map location**

Run:
```bash
grep -n "ERA_FONT_FAMILY\|fontFamily:" components/etymology/EtymologyMorph.tsx
```
Expected: `ERA_FONT_FAMILY` defined around line 14-20; `fontFamily: ERA_FONT_FAMILY[era.era]` around line 133.

- [ ] **Step 2: Modify EtymologyMorph.tsx**

Open `components/etymology/EtymologyMorph.tsx`. Replace the import block (line 1-7) and add the prop interface. Then delete the `ERA_FONT_FAMILY` const and replace its usage on line 133.

Replace lines 1-20 (imports + hardcoded map) with:

```tsx
import type { EraGlyph, Era } from '@/lib/etymology-types';
import { getPresentation } from '@/lib/etymology-types';
import { DEFAULT_ERA_FONTS } from '@/lib/era-fonts';

interface Props {
  char: string;
  eraGlyphs: EraGlyph[];
  /** Active era→font-family mapping resolved server-side from app_config.
   *  Defaults to DEFAULT_ERA_FONTS if omitted (e.g. in tests). */
  eraFonts?: Record<Era, string>;
}
```

Delete the `const ERA_FONT_FAMILY: Record<Era, string> = { ... }` block (the 7-line object literal that follows).

Replace the function signature at line ~21:

```tsx
export function EtymologyMorph({ char, eraGlyphs, eraFonts = DEFAULT_ERA_FONTS }: Props) {
```

At line ~133, replace `style={{ fontFamily: ERA_FONT_FAMILY[era.era] }}` with:

```tsx
style={{ fontFamily: eraFonts[era.era] }}
```

- [ ] **Step 3: Modify app/etymology/[char]/page.tsx to fetch + pass eraFonts**

Open `app/etymology/[char]/page.tsx`. Find the existing data-fetch block (typically `const eraGlyphs = await getEraGlyphs(char)`). Replace with parallel fetch:

```tsx
import { getEraGlyphs } from '@/lib/etymology';
import { getActiveEraFonts } from '@/lib/era-fonts';
// ... other imports ...

export default async function EtymologyPage({ params }: { params: Promise<{ char: string }> }) {
  const { char } = await params;
  const [eraGlyphs, eraFonts] = await Promise.all([
    getEraGlyphs(char),
    getActiveEraFonts(),
  ]);
  return (
    <EtymologyMorph char={char} eraGlyphs={eraGlyphs} eraFonts={eraFonts} />
  );
}
```

(Exact JSX wrapper depends on the existing page; preserve any layout/header that wraps `<EtymologyMorph>`.)

- [ ] **Step 4: Run tsc to verify**

Run: `pnpm tsc --noEmit`
Expected: clean. If errors mention missing `eraFonts` prop, check that all call sites of `<EtymologyMorph>` now pass `eraFonts`. There should be only one call site — the RSC page.

- [ ] **Step 5: Kill dev + run pnpm build**

Per memory `dev-build-cache-stomp`: kill `pnpm dev` on port 4444 first.

```bash
# Find and kill any running pnpm dev
powershell -Command "Get-NetTCPConnection -LocalPort 4444 -State Listen | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
pnpm build
```
Expected: build succeeds. If build complains about EtymologyMorph prop changes, recheck Step 2.

- [ ] **Step 6: Commit**

```bash
git add components/etymology/EtymologyMorph.tsx app/etymology/[char]/page.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(etymology): EtymologyMorph accepts eraFonts prop from app_config"
```

---

### Task 5: Admin API — GET/PUT /api/admin/font-config

**Files:**
- Create: `app/api/admin/font-config/route.ts`
- Create: `tests/unit/app/api/admin/font-config.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (existing), `getAllConfig`/`setConfigBatch` (existing), `auditLog` from `lib/audit.ts`.
- Produces: GET returns `Record<Era, string>` shape; PUT accepts same shape, validates per key via `setConfigBatch`, audits each change.

- [ ] **Step 1: Read existing admin route for pattern**

Run:
```bash
ls app/api/admin/
grep -l "requireAdmin" app/api/admin/**/route.ts | head -3
```
Pick one (e.g. `app/api/admin/ai-config/route.ts` or similar) and read its full contents to mirror the auth + audit pattern.

- [ ] **Step 2: Write failing API tests**

Create `tests/unit/app/api/admin/font-config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getAllConfig: vi.fn(),
  setConfigBatch: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

import { GET, PUT } from '@/app/api/admin/font-config/route';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { auditLog } from '@/lib/audit';

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedGetAllConfig = vi.mocked(getAllConfig);
const mockedSetConfigBatch = vi.mocked(setConfigBatch);
const mockedAuditLog = vi.mocked(auditLog);

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ id: 1, is_admin: true } as any);
  mockedSetConfigBatch.mockResolvedValue(undefined);
  mockedAuditLog.mockResolvedValue(undefined);
});

describe('GET /api/admin/font-config', () => {
  it('returns era→font map merged with defaults', async () => {
    mockedGetAllConfig.mockResolvedValue({ 'era.jiaguwen.font': 'OracularInverted' });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      jiaguwen: 'OracularInverted',
      jinwen: 'WangHanzongWeibei',
      xiaozhuan: 'QuanZiKuShuoWen',
      lishu: 'WangHanzongLishu',
      kaishu: 'ZCOOLXiaoWei',
    });
  });

  it('returns 403 when not admin', async () => {
    mockedRequireAdmin.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/font-config', () => {
  it('accepts a valid full map and calls setConfigBatch + audit', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({
        jiaguwen: 'OracularInverted',
        jinwen: 'WangHanzongWeibei',
        xiaozhuan: 'QuanZiKuShuoWen',
        lishu: 'WangHanzongLishu',
        kaishu: 'ZCOOLXiaoWei',
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockedSetConfigBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        'era.jiaguwen.font': 'OracularInverted',
        'era.kaishu.font': 'ZCOOLXiaoWei',
      }),
      expect.anything(),
    );
    expect(mockedAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.font_config.update' }),
    );
  });

  it('returns 400 when an invalid font id is submitted', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({ jiaguwen: 'NotARealFont', jinwen: 'WangHanzongWeibei', xiaozhuan: 'QuanZiKuShuoWen', lishu: 'WangHanzongLishu', kaishu: 'ZCOOLXiaoWei' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    expect(mockedSetConfigBatch).not.toHaveBeenCalled();
  });

  it('returns 403 when not admin', async () => {
    mockedRequireAdmin.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it('accepts partial map (only changed eras) and only writes those keys', async () => {
    const req = new NextRequest('http://localhost/api/admin/font-config', {
      method: 'PUT',
      body: JSON.stringify({ jiaguwen: 'OracularInverted' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockedSetConfigBatch).toHaveBeenCalledWith(
      { 'era.jiaguwen.font': 'OracularInverted' },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/unit/app/api/admin/font-config.test.ts`
Expected: FAIL — `app/api/admin/font-config/route.ts` doesn't exist.

- [ ] **Step 4: Implement the route**

Create `app/api/admin/font-config/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllConfig, setConfigBatch } from '@/lib/config';
import { auditLog } from '@/lib/audit';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts';
import { ERAS, type Era } from '@/lib/etymology-types';

function configKey(era: Era): string {
  return `era.${era}.font`;
}

function isValidFontId(era: Era, id: string): boolean {
  return ERA_FONTS[era].some((opt) => opt.id === id);
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'admin required' }, { status: 403 });
  const cfg = await getAllConfig();
  const out: Record<Era, string> = { ...DEFAULT_ERA_FONTS };
  for (const era of ERAS) {
    const v = cfg[configKey(era)];
    if (v && isValidFontId(era, v)) out[era] = v;
  }
  return NextResponse.json(out);
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'admin required' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  const changes: Array<{ era: Era; from: string; to: string }> = [];
  for (const era of ERAS) {
    const newId = body[era];
    if (newId === undefined) continue;
    if (typeof newId !== 'string' || !isValidFontId(era, newId)) {
      return NextResponse.json(
        { error: `invalid font id for ${era}: ${String(newId)}` },
        { status: 400 },
      );
    }
    if (newId !== DEFAULT_ERA_FONTS[era]) {
      updates[configKey(era)] = newId;
      changes.push({ era, from: DEFAULT_ERA_FONTS[era], to: newId });
    }
  }

  if (Object.keys(updates).length > 0) {
    await setConfigBatch(updates, admin.id);
    await auditLog({
      userId: admin.id,
      action: 'admin.font_config.update',
      metadata: {
        changes: changes.map((c) => {
          const label = ERA_FONTS[c.era].find((o) => o.id === c.to)?.label ?? c.to;
          return `${c.era}: ${c.from} → ${label}`;
        }).join('; '),
      },
    });
  }
  return NextResponse.json({ ok: true, updated: Object.keys(updates) });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/unit/app/api/admin/font-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Kill dev + pnpm build**

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 4444 -State Listen | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
pnpm build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/font-config/route.ts tests/unit/app/api/admin/font-config.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(admin): GET+PUT /api/admin/font-config with audit log"
```

---

### Task 6: Admin UI — /admin/settings/fonts page + form + sidebar link

**Files:**
- Create: `app/admin/settings/fonts/page.tsx`
- Create: `components/admin/FontConfigForm.tsx`
- Create: `tests/unit/components/admin/FontConfigForm.test.tsx`
- Modify: `components/admin/AdminSidebar.tsx` (add 「字源字体」 link)

**Interfaces:**
- Consumes: `getActiveEraFonts()` (Task 2), `ERA_FONTS` (Task 2), `requireAdmin()` (existing), `PUT /api/admin/font-config` (Task 5).
- Produces: a working admin page that lets an admin change 5 era font dropdowns.

- [ ] **Step 1: Read AdminSidebar.tsx to confirm the existing settings group structure**

Run:
```bash
grep -n "settings\|字\|font" components/admin/AdminSidebar.tsx | head -20
```
Look for the existing settings group where you'll add the link.

- [ ] **Step 2: Write failing form tests**

Create `tests/unit/components/admin/FontConfigForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

global.fetch = vi.fn();

import { FontConfigForm } from '@/components/admin/FontConfigForm';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts';

const initial = DEFAULT_ERA_FONTS;

describe('FontConfigForm', () => {
  it('renders 5 selects — one per era', () => {
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(5);
  });

  it('renders each select with the current font preselected', () => {
    render(<FontConfigForm initial={{ ...initial, jiaguwen: 'OracularInverted' }} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // The first era select is jiaguwen
    expect(selects[0].value).toBe('OracularInverted');
  });

  it('renders all curated font options in the jiaguwen dropdown', () => {
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const jiaguwenOptions = Array.from(selects[0].options).map((o) => o.value);
    expect(jiaguwenOptions).toEqual(ERA_FONTS.jiaguwen.map((o) => o.id));
  });

  it('save button calls fetch with PUT + body of changed eras only', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<FontConfigForm initial={initial} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(selects[0], { target: { value: 'OracularInverted' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/font-config',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ jiaguwen: 'OracularInverted' }),
        }),
      );
    });
  });

  it('shows an error message when PUT returns non-ok', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid font id for kaishu' }) });
    render(<FontConfigForm initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(await screen.findByText(/invalid font id/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/unit/components/admin/FontConfigForm.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 4: Create FontConfigForm.tsx**

Create `components/admin/FontConfigForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ERAS, type Era } from '@/lib/etymology-types';
import { ERA_FONTS, DEFAULT_ERA_FONTS } from '@/lib/era-fonts';

const ERA_LABEL: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

interface Props {
  initial: Record<Era, string>;
}

export function FontConfigForm({ initial }: Props) {
  const [fonts, setFonts] = useState<Record<Era, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function changedEras(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const era of ERAS) {
      if (fonts[era] !== initial[era]) out[era] = fonts[era];
    }
    return out;
  }

  async function onSave() {
    const changes = changedEras();
    if (Object.keys(changes).length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/font-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `保存失败 (${res.status})`);
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {ERAS.map((era, i) => (
        <div key={era}>
          <label className="block text-sm font-medium text-ink mb-1">
            {ERA_LABEL[era]}
          </label>
          <select
            value={fonts[era]}
            onChange={(e) => setFonts((prev) => ({ ...prev, [era]: e.target.value }))}
            className="w-full max-w-md border border-paper-warm rounded px-2 py-1 text-sm bg-paper"
            data-testid={`era-${era}-select`}
            aria-label={ERA_LABEL[era]}
          >
            {ERA_FONTS[era].map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} — {opt.desc}
              </option>
            ))}
          </select>
          {fonts[era] !== DEFAULT_ERA_FONTS[era] && (
            <p className="mt-1 text-xs text-seal">非默认</p>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2 border-t border-paper-warm">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || Object.keys(changedEras()).length === 0}
          className="rounded bg-seal px-4 py-1.5 text-white text-sm hover:bg-seal/80 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {savedAt && (
          <span className="text-xs text-ink-faint">已于 {savedAt.toLocaleTimeString('zh-CN')} 保存</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run form tests to verify they pass**

Run: `pnpm test tests/unit/components/admin/FontConfigForm.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Create app/admin/settings/fonts/page.tsx**

Create `app/admin/settings/fonts/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getActiveEraFonts } from '@/lib/era-fonts';
import { FontConfigForm } from '@/components/admin/FontConfigForm';

export const dynamic = 'force-dynamic';

export default async function FontSettingsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect('/login');
  const fonts = await getActiveEraFonts();
  return (
    <div className="card-paper rounded-lg p-6">
      <h1 className="text-lg font-semibold text-ink mb-1">字源字体</h1>
      <p className="text-sm text-ink-soft mb-6">
        选择每个时代使用的字体。默认字体已配好,可在「/etymology/[字]」查看实际效果。
      </p>
      <FontConfigForm initial={fonts} />
    </div>
  );
}
```

- [ ] **Step 7: Add sidebar link**

Open `components/admin/AdminSidebar.tsx`. Find the existing settings group (look for `设置` or similar header). Add a new entry:

```tsx
{ href: '/admin/settings/fonts', label: '字源字体' },
```

(Exact placement depends on the existing structure — match the pattern of the other settings entries around it.)

- [ ] **Step 8: Kill dev + pnpm build**

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 4444 -State Listen | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
pnpm build
```
Expected: build succeeds (new routes registered).

- [ ] **Step 9: Commit**

```bash
git add app/admin/settings/fonts/page.tsx components/admin/FontConfigForm.tsx components/admin/AdminSidebar.tsx tests/unit/components/admin/FontConfigForm.test.tsx
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "feat(admin): /admin/settings/fonts page with 5 era dropdowns + sidebar link"
```

---

### Task 7: Integration test — config change → /etymology HTML reflects new font

**Files:**
- Create: `tests/integration/etymology-era-font.test.ts`

**Interfaces:**
- Consumes: real MySQL DB (via `getPool` from `lib/db.ts`), `setConfig` / `getConfig` from `lib/config.ts`, `EtymologyPage` rendering.
- Produces: end-to-end proof that admin-set config reaches the rendered HTML.

- [ ] **Step 1: Read an existing integration test for the pattern**

Run:
```bash
ls tests/integration/ | head -10
grep -l "setConfig\|getConfig" tests/integration/**/*.test.ts | head -2
```
Pick one and read its setup to confirm: pool init, cleanup, fetch pattern.

- [ ] **Step 2: Write the integration test**

Create `tests/integration/etymology-era-font.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { setConfig } from '@/lib/config';
import { DEFAULT_ERA_FONTS, getActiveEraFonts } from '@/lib/era-fonts';

describe('Integration: /etymology reflects app_config era fonts', () => {
  const testKey = 'era.jiaguwen.font';
  let originalValue: string | null = null;

  beforeAll(async () => {
    // Capture existing value so we can restore after the test
    const [rows] = await getPool().query<any[]>(
      `SELECT value FROM app_config WHERE \`key\` = ? LIMIT 1`,
      [testKey],
    );
    if (rows.length) originalValue = rows[0].value;
  });

  afterAll(async () => {
    // Restore original value (or delete if it didn't exist)
    if (originalValue === null) {
      await getPool().query(`DELETE FROM app_config WHERE \`key\` = ?`, [testKey]);
    } else {
      await setConfig(testKey, originalValue, null);
    }
    await closePool();
  });

  it('getActiveEraFonts reflects the admin-set value within the same request lifecycle', async () => {
    // Simulate admin PUT: write OracularInverted to app_config
    await setConfig(testKey, 'OracularInverted', null);

    const fonts = await getActiveEraFonts();
    expect(fonts.jiaguwen).toBe('OracularInverted');
    // Other eras untouched (still at their default)
    expect(fonts.jinwen).toBe(DEFAULT_ERA_FONTS.jinwen);
  });

  it('rejects unknown font id at write time (KEY_VALIDATORS blocks it)', async () => {
    await expect(setConfig(testKey, 'NotARealFont', null)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `pnpm test tests/integration/etymology-era-font.test.ts`
Expected: PASS (2 tests). Verify the cleanup actually fires — temporarily inspect `app_config` row to confirm it was restored.

- [ ] **Step 4: Verify EtymologyPage actually renders the chosen font (smoke check)**

Run:
```bash
pnpm dev &
sleep 5
# In another terminal — or use curl directly:
curl -s http://localhost:4444/etymology/永 | grep -o "font-family:[^\"]*" | head -5
```
Expected: at least one of the output lines is `font-family: Oracular` (matches Task 2 default).

Then change the config and re-fetch:
```bash
"E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev -e "UPDATE app_config SET value='OracularInverted' WHERE \`key\`='era.jiaguwen.font';"
curl -s http://localhost:4444/etymology/永 | grep -o "font-family:[^\"]*" | head -5
```
Expected: at least one line now shows `font-family: OracularInverted`.

Restore after smoke:
```bash
"E:/mysql/bin/mysql.exe" -uroot -pAdmin909217 piyin_dev -e "UPDATE app_config SET value='Oracular' WHERE \`key\`='era.jiaguwen.font';"
# Kill dev server
powershell -Command "Get-NetTCPConnection -LocalPort 4444 -State Listen | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/etymology-era-font.test.ts
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "test(etymology): integration — app_config change reflects in render"
```

---

### Task 8: Final regression — tsc + build + full vitest + memory

**Files:**
- Modify: `memory/MEMORY.md` and create `memory/plan-era-font-admin-status.md`

- [ ] **Step 1: Kill dev + full tsc + build**

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 4444 -State Listen | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
pnpm tsc --noEmit
pnpm build
```
Expected: both clean.

- [ ] **Step 2: Run full vitest suite**

Run: `pnpm test 2>&1 | tail -40`
Expected: all pre-existing tests still pass + new tests from Tasks 2, 5, 6, 7 pass. New total ~ existing + 22 (9 era-fonts + 6 font-config + 5 FontConfigForm + 2 integration).

- [ ] **Step 3: Push to origin (if prod env existed)**

Per memory `no-prod-env-2026-06-21.md`: no prod env, so push is **deferred** (same as other plans held back since 2026-06-21). Local commits stay on `main`. Skip `git push` — only run when prod is provisioned.

- [ ] **Step 4: Write status memory**

Create `memory/plan-era-font-admin-status.md`:

```markdown
---
name: Plan era-font-admin — shipped 2026-06-28, awaiting human smoke
description: 5 era→font mappings (甲骨文/金文/小篆/隶书/楷书) now configurable via /admin/settings/fonts; defaults Oracular + 王汉宗魏碑 + 全字庫說文解字 + 王汉宗隶书 + 站酷小薇
type: project
---
# Plan era-font-admin — shipped 2026-06-28

8 commits on local main (intentional deferred fill — run `git log --oneline -8` after Step 6 to capture):

1. CSS @font-face for Oracular/OracularInverted/WangHanzongWeibei/WangHanzongXingshu + download-ancient-fonts.ts entries
2. lib/era-fonts.ts curated registry + DEFAULT_ERA_FONTS + getActiveEraFonts (9 tests)
3. 5 KEY_VALIDATORS + SQL seed migration + init-db.ts inline INSERTs
4. EtymologyMorph accepts eraFonts prop; /etymology/[char] RSC fetches via getActiveEraFonts
5. GET/PUT /api/admin/font-config with audit log (6 tests)
6. /admin/settings/fonts page + FontConfigForm (5 tests) + AdminSidebar link
7. Integration test: app_config change → getActiveEraFonts reflects within same lifecycle
8. Final regression (this commit)

**Key design decisions:**
- v1 = global default per era, no per-char override (char_etymology.era_${era}_font columns reserved but unused)
- Curated font list per era (no free text), prevents admin from entering non-existent font names
- All 4 new @font-face cascade to BabelStone Han Basic as fallback (existing pattern, 56K+ CJK CPs)
- getActiveEraFonts silently ignores invalid font IDs so deleting a font file can't crash etymology rendering
- Wang Hanzong kaiti-zhuyin.ttf NOT offered in dropdown — has visible 注音 marks on every glyph

**Status:** tsc + build clean, ~22 new tests pass. NOT pushed (no prod env per memory `no-prod-env-2026-06-21`). Only human browser smoke remains:
1. Visit /etymology/永 → 甲骨文 renders with Oracular
2. Visit /admin/settings/fonts → 5 dropdowns show current defaults
3. Change 甲骨文 → Oracular Inverted, save → reload /etymology/永 → 甲骨文 inverted
4. Verify audit log row created with Chinese labels
```

Replace the placeholder line with the actual 8 commit hashes by running `git log --oneline -8` and pasting the result.

- [ ] **Step 5: Update MEMORY.md index**

Open `memory/MEMORY.md`. Add one line at the end:

```
- [Plan era-font-admin — shipped 2026-06-28, awaiting human smoke](plan-era-font-admin-status.md) — 5 era→font mappings admin-configurable; Oracular + 王汉宗魏碑 + 全字庫說文解字 + 王汉宗隶书 + 站酷小薇 defaults
```

- [ ] **Step 6: Commit memory + status**

```bash
git add memory/plan-era-font-admin-status.md memory/MEMORY.md
git -c user.email=claude@anthropic.com -c user.name=claude commit -m "docs(memory): plan-era-font-admin status — 8 commits, awaiting smoke"
```

---

## Verification (after all 8 tasks)

1. `pnpm tsc --noEmit` — clean
2. `pnpm test` — all pass (existing + new ~22 tests)
3. `pnpm build` — succeeds (per-task already done in Tasks 4, 5, 6)
4. **Human smoke (browser):**
   - Visit `/etymology/永` — 甲骨文 renders with **Oracular** (new default)
   - Visit `/admin/settings/fonts` — 5 dropdowns visible
   - Change 甲骨文 → Oracular Inverted → click 保存 → success toast
   - Reload `/etymology/永` — 甲骨文 now inverted
   - Change 金文 → BabelStone Han → save → /etymology/永 金文 uses Han-style 金文
   - Check `audit_log` table — row shows Chinese labels like `甲骨文: Oracular → Oracular 阴文`
   - Sidebar shows 「字源字体」 link under settings
5. **Audit log entry inspection:** verify `metadata.changes` field contains human-readable Chinese summary, not raw font IDs

---

## Commit Summary

8 commits on local main (no prod env, push deferred):

1. `feat(fonts): register Oracular + 王漢宗魏碑/行書繁 @font-face + download entries`
2. `feat(era-fonts): curated registry + defaults + getActiveEraFonts resolver`
3. `feat(config): 5 era font KEY_VALIDATORS + seed migration + init-db inline`
4. `feat(etymology): EtymologyMorph accepts eraFonts prop from app_config`
5. `feat(admin): GET+PUT /api/admin/font-config with audit log`
6. `feat(admin): /admin/settings/fonts page with 5 era dropdowns + sidebar link`
7. `test(etymology): integration — app_config change reflects in render`
8. `docs(memory): plan-era-font-admin status — 8 commits, awaiting smoke`