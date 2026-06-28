# Era Font Admin — Design Spec

**Date:** 2026-06-28
**Status:** Draft (awaiting user review)
**Scope:** Make the 5 字源 era→font mappings (甲骨文/金文/小篆/隶书/楷书) admin-configurable via a new admin page, with a curated font list per era and sensible defaults. Oracular replaces founder-jiaguwen for 甲骨文 by default; 王汉宗魏碑 becomes the 金文 proxy default.

---

## Context

`/etymology/[char]` renders 5 evolution stages. Currently the era→font mapping is **hardcoded** in `components/etymology/EtymologyMorph.tsx:14-20`, which makes switching fonts require a code deploy.

User feedback 2026-06-28:
> "E:\ToolDevelop\PinYinCharacter\public\fonts 将甲骨文的效果替换为oracular 的内容。另外我们将在后台设置字源对应字体，例如甲骨文有两个可以选择"
> "为字源设置不同格式的字体"
> "例如甲骨文、小篆 楷体 等等全部都会有多个不同的字体类型，到时候可以在后台设置"

We surveyed open-source fonts in each era (2026-06-28):

| Era | Best open-source option | Fallback |
|---|---|---|
| 甲骨文 | **Oracular** (32MB, full oracle-bone style at standard CPs) | Oracular-Inverted (white-on-black, like real bones), founder-jiaguwen |
| 金文 | **No real 金文 font exists.** 王汉宗魏碑 (10MB) is the closest angular visual proxy. | BabelStone Han Basic (basic 金文 subset, broader) |
| 小篆 | **全字庫說文解字** (10MB, dedicated 小篆) | BabelStone Han Basic |
| 隶书 | **王漢宗中隸書繁** (8.1MB, dedicated 隶书) | Iansui (modern 隶书 feel) |
| 楷书 | **ZCOOLXiaoWei** (6.1MB TTF, also works in react-pdf) | KaiTi (system), Iansui, MaShanZheng |

---

## Goals

1. Admin UI at `/admin/settings/fonts` lets an admin pick one **global default** font per era from a curated list.
2. `EtymologyMorph` reads the active font per era from `app_config` (not hardcoded).
3. Defaults match the surveyed best option per era (Oracular, 魏碑, 全字庫說文解字, 王漢宗中隸書繁, 站酷小薇).
4. Visual change ships with no migration risk: pre-existing `/etymology/[char]` renders identically with new defaults.
5. All changes are auditable in `audit_log` (per memory `user-action-audit-preference`).

## Non-Goals

- **No per-character override (v1)** — the DB columns `era_${era}_font` on `char_etymology` table (already exist per `init-db.ts:32-41`, hardcoded defaults `YinQiJiaGuWen` / `HanDianJinWen` / `QuanZiKuShuoWen` / `QuanZiKuLiDing` / `KaiTi`) are reserved for future use but not exposed in this UI. v1 uses `app_config` only.
- **No font upload** — admins pick from a curated list; new fonts must be added to `public/fonts/` + `lib/era-fonts.ts` in code.
- **No live preview** in admin UI for now — dropdown shows the font name; actual rendering is on `/etymology/[char]`.
- **No font subsetting** — already shipped in Plan G2 hard-pen subset pipeline; ancient-script fonts ship as full TTF (~30MB total).

---

## Design

### Section 1 — Data model: 5 new `app_config` rows

```
era.jiaguwen.font = "Oracular"
era.jinwen.font    = "WangHanzongWeibei"
era.xiaozhuan.font = "QuanZiKuShuoWen"
era.lishu.font     = "WangHanzongLishu"
era.kaishu.font    = "ZCOOLXiaoWei"
```

Keys are added to `KEY_VALIDATORS` in `lib/config.ts` (line 3-45). Each validator is an `(v: string) => boolean` that accepts only the curated font IDs for that era.

### Section 2 — `lib/era-fonts.ts` (NEW, ~70 lines)

Central registry mapping era → curated font list + CSS `@font-face` family ID + display label. Replaces the hardcoded `ERA_FONT_FAMILY` in `EtymologyMorph`.

```ts
export const ERA_FONTS: Record<Era, EraFontOption[]> = {
  jiaguwen: [
    { id: 'Oracular',         label: 'Oracular (默认)',         file: 'Oracular-Regular.ttf',       desc: '32MB, 甲骨文, 1531 BMP chars' },
    { id: 'OracularInverted', label: 'Oracular 阴文',           file: 'Oracular-Inverted.ttf',      desc: '白底黑字, 类似真实甲骨' },
    { id: 'YinQiJiaGuWen',    label: 'Founder 甲骨文',          file: 'founder-jiaguwen.ttf',       desc: '方正甲骨文, 旧默认, 2.7MB' },
  ],
  jinwen: [
    { id: 'WangHanzongWeibei', label: '王汉宗魏碑 (默认)',     file: 'wang-hanzong-weibei.ttf',    desc: '10MB, 魏碑 ≈ 金文风格' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',     desc: '25MB, 通用甲骨/金文/简帛 fallback' },
  ],
  xiaozhuan: [
    { id: 'QuanZiKuShuoWen',   label: '全字庫說文解字 (默认)', file: 'quanziku-shuowen.ttf',       desc: '10MB, 专用小篆' },
    { id: 'HanDianJinWen',     label: 'BabelStone Han',         file: 'BabelStoneHanBasic.ttf',     desc: '25MB, 通用 fallback' },
  ],
  lishu: [
    { id: 'WangHanzongLishu',  label: '王漢宗中隸書繁 (默认)', file: 'wang-hanzong-lishu.ttf',     desc: '8.1MB, 专用隶书' },
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇',              file: 'zcool-xiaowei.ttf',          desc: '6.1MB, 现代隶书感' },
  ],
  kaishu: [
    { id: 'ZCOOLXiaoWei',      label: '站酷小薇 (默认)',       file: 'zcool-xiaowei.ttf',          desc: '6.1MB, react-pdf 兼容' },
    { id: 'KaiTi',             label: '系统楷体',              file: null,                         desc: 'local(KaiTi) / STKaiti / BiauKai' },
    { id: 'Iansui',            label: '汉仪润圆',              file: 'Iansui-Regular.woff2',       desc: '1.2MB, 圆润楷书' },
    { id: 'MaShanZheng',       label: '马善政',                file: 'ma-shan-zheng.woff2',        desc: '3.2MB, 楷书带毛笔感' },
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
 *  Used by /etymology/[char] RSC. */
export async function getActiveEraFonts(): Promise<Record<Era, string>> {
  const cfg = await getAllConfig();
  const out = { ...DEFAULT_ERA_FONTS };
  for (const era of ERAS) {
    const v = cfg[`era.${era}.font`];
    if (v && ERA_FONTS[era].some((opt) => opt.id === v)) out[era] = v;
  }
  return out;
}
```

### Section 3 — CSS: 4 new `@font-face` declarations in `app/globals.css`

Append after the existing ancient-script block (line 204):

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

Note: All 4 cascade to BabelStone Han Basic as fallback (mirrors existing pattern line 173-204). BabelStone Han has 56K+ CJK code points so it backstops any glyph the dedicated font lacks.

### Section 4 — `lib/config.ts`: 5 KEY_VALIDATORS additions

```ts
'era.jiaguwen.font': (v) => ['Oracular', 'OracularInverted', 'YinQiJiaGuWen'].includes(v),
'era.jinwen.font':    (v) => ['WangHanzongWeibei', 'HanDianJinWen'].includes(v),
'era.xiaozhuan.font': (v) => ['QuanZiKuShuoWen', 'HanDianJinWen'].includes(v),
'era.lishu.font':     (v) => ['WangHanzongLishu', 'ZCOOLXiaoWei'].includes(v),
'era.kaishu.font':    (v) => ['ZCOOLXiaoWei', 'KaiTi', 'Iansui', 'MaShanZheng'].includes(v),
```

### Section 5 — `components/etymology/EtymologyMorph.tsx`: accept `eraFonts` prop

Remove the hardcoded `ERA_FONT_FAMILY` map at lines 14-20. Replace with:

```tsx
interface Props {
  char: string;
  eraGlyphs: EraGlyph[];
  /** Active era→font mapping from app_config (resolved server-side). */
  eraFonts: Record<Era, string>;
}

export function EtymologyMorph({ char, eraGlyphs, eraFonts }: Props) {
  // ...
  // line 133: replace hardcoded lookup
  <text style={{ fontFamily: eraFonts[era.era] }}>{char}</text>
}
```

RSC wrapper at `app/etymology/[char]/page.tsx` adds `getActiveEraFonts()` to its parallel fetch.

### Section 6 — Admin API: `app/api/admin/font-config/route.ts` (NEW)

- **GET** — returns `{ jiaguwen: 'Oracular', jinwen: 'WangHanzongWeibei', ... }` shape (era name as key, font ID as value).
- **PUT** — accepts same shape; validates each value against `KEY_VALIDATORS` via `setConfigBatch`; writes audit_log entry `admin.font_config.update`.
- **Auth** — `requireAdmin()` (existing helper), 403 otherwise.

### Section 7 — Admin page: `/admin/settings/fonts`

- **RSC** at `app/admin/settings/fonts/page.tsx` — calls `getActiveEraFonts()`, passes to client form.
- **Client form** `components/admin/FontConfigForm.tsx` — 5 sections (one per era), each with label + `<select>` dropdown + short font description. Save button calls PUT.
- **Sidebar** — add 「字源字体」 link in `components/admin/AdminSidebar.tsx` next to existing settings entries.
- **Audit log** — save action logs which era changed from → to (per memory `user-action-audit-preference`, summary must include resolved labels not just IDs).

### Section 8 — Seed default values

Add a one-shot SQL seed to `scripts/migrations/2026-06-28-era-font-defaults.sql` (NEW):

```sql
INSERT INTO app_config (`key`, value, updated_by) VALUES
  ('era.jiaguwen.font', 'Oracular',         NULL),
  ('era.jinwen.font',    'WangHanzongWeibei',NULL),
  ('era.xiaozhuan.font', 'QuanZiKuShuoWen',  NULL),
  ('era.lishu.font',     'WangHanzongLishu', NULL),
  ('era.kaishu.font',    'ZCOOLXiaoWei',     NULL)
ON DUPLICATE KEY UPDATE value = VALUES(value);
```

`scripts/init-db.ts` (existing) gets the same 5 INSERTs appended to its DDL block (for fresh installs). Existing DBs (piyin_dev, future prod) apply the standalone .sql migration manually.

### Section 9 — `scripts/download-ancient-fonts.ts`: add 4 entries

Add 4 new `FontEntry` rows for Oracular + Oracular-Inverted + 王漢宗魏碑 + 王漢宗行書繁. jsDelivr CDN URLs (verified 2026-06-28 with ~500 KB/s throughput):

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

(`wang-hanzong-kaiti-zhuyin.ttf` already on disk but rejected from list — has 注音 marks visible on every glyph, not appropriate for 字源.)

---

## File Structure

### New — source (5)
- `lib/era-fonts.ts` — curated registry + `getActiveEraFonts()` helper
- `app/api/admin/font-config/route.ts` — GET + PUT
- `app/admin/settings/fonts/page.tsx` — RSC
- `components/admin/FontConfigForm.tsx` — 'use client', 5 dropdowns
- `scripts/migrations/2026-06-28-era-font-defaults.sql` — seed 5 default rows for existing DBs

### New — tests (4)
- `tests/unit/lib/era-fonts.test.ts`
- `tests/unit/app/api/admin/font-config.test.ts`
- `tests/unit/components/admin/FontConfigForm.test.tsx`
- `tests/integration/etymology-era-font.test.ts` — config change → /etymology/[char] HTML reflects font

### Modified (8)
- `app/globals.css` — add 4 `@font-face` blocks
- `lib/config.ts` — add 5 KEY_VALIDATORS
- `lib/etymology.ts` (or new `lib/era-fonts.ts`) — `getActiveEraFonts()`
- `components/etymology/EtymologyMorph.tsx` — drop hardcoded map, accept `eraFonts` prop
- `app/etymology/[char]/page.tsx` — fetch `getActiveEraFonts()` and pass down
- `scripts/init-db.ts` — append 5 INSERTs to inline DDL
- `scripts/download-ancient-fonts.ts` — add 4 font entries
- `components/admin/AdminSidebar.tsx` — add 「字源字体」 link

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Admin submits invalid font ID | KEY_VALIDATOR throws; API returns 400 with validator message; form shows inline error |
| Non-admin calls PUT | `requireAdmin()` returns 403 |
| `app_config` table read fails | `getActiveEraFonts()` catches and returns `DEFAULT_ERA_FONTS`; etymology renders with built-in defaults |
| Font file missing from `public/fonts/` | `@font-face` silently falls through to BabelStone Han Basic; visible glyphs degrade gracefully |
| First deploy with no `app_config` rows | Migration seeds defaults; admin page shows current = default |

---

## Testing Strategy

### Unit (3 files)
- `tests/unit/lib/era-fonts.test.ts` — `ERA_FONTS` shape (5 entries each, has `id`/`label`/`file`); `DEFAULT_ERA_FONTS` references valid IDs; `getActiveEraFonts()` merges config + defaults; rejects unknown font IDs.
- `tests/unit/app/api/admin/font-config.test.ts` — GET returns `Record<Era, string>`; PUT validates per-key; 403 non-admin; audit log entry written.
- `tests/unit/components/admin/FontConfigForm.test.tsx` — renders 5 selects with current value selected; onChange updates local state; save calls PUT with full shape.

### Integration (1 file)
- `tests/integration/etymology-era-font.test.ts` — set `era.jiaguwen.font = 'OracularInverted'` in app_config → fetch `/etymology/永` HTML → assert `font-family: OracularInverted` appears in the rendered SVG.

### Smoke (human, post-deploy)
- Visit `/etymology/永` — 甲骨文 renders with Oracular (new default).
- Visit `/admin/settings/fonts` — 5 dropdowns show current defaults.
- Change 甲骨文 → Oracular Inverted, save → reload `/etymology/永` — 甲骨文 now renders inverted.
- Change 金文 → BabelStone Han, save → 金文 renders with BabelStone's 金文 style.
- Verify audit log shows the change with resolved Chinese labels.

---

## Decisions Made

1. **v1 = global default per era, no per-char override.** DB columns reserved, not exposed. Keeps scope focused; per-char override is a future plan when admins ask for it.
2. **Oracular replaces founder-jiaguwen as 甲骨文 default.** Visual comparison showed Oracular is significantly closer to actual oracle-bone carving style.
3. **魏碑 as 金文 proxy.** No real 金文 font exists in open source. 王漢宗魚龍魏碑's angular 5th-century style is the closest visual match.
4. **Admin-only writes.** Font choice is site-wide, not per-user; admins control it once and it ships.
5. **Curated list, not free text.** Prevents admins from entering font names that don't exist in `public/fonts/`.
6. **BabelStone Han Basic as universal fallback** in every new `@font-face` cascade — has 56K+ CJK code points and is already on disk.
7. **Wang Hanzong kaiti-zhuyin NOT offered.** Visible 注音 (phonetic) marks on every glyph pollute the 字源 view. Use lishu or zcool-xiaowei instead.

---

## Migration & Rollout

1. Apply SQL migration to local `piyin_dev` + (when prod exists) prod DB.
2. Deploy code. Existing etymology renders unchanged for now (defaults match the prior hardcoded mapping for 小篆/隶书/楷书, **changes** for 甲骨文 [founder→Oracular] and 金文 [BabelStone→魏碑]).
3. Admin can revert any era to its previous default via the new admin page.
4. `download-ancient-fonts.ts` is re-runnable; existing fonts are skipped.

---

## Out of Scope (future plans)

- Per-character era font override (`chars.era_${era}_font` columns)
- Font upload + admin preview
- 自动跟随 char.difficulty 选择不同字体
- A/B testing of font choices