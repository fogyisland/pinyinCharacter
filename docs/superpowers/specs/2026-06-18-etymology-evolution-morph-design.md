# Spec C: 字源形变演示 (Etymology evolution morph)

## Goal

Replace the existing single-era-at-a-time `<EtymologyTimeline>` on `/etymology/[char]` with a new `<EtymologyMorph>` component that **demonstrates** how a Chinese character's shape evolved across the 5 historical script eras (甲骨文 → 金文 → 小篆 → 隶书 → 楷书) via an autoplay crossfade animation + a scrubbable timeline. Add a char-level badge + coverage hint so users understand why some chars have partial era data (L1 = full coverage, L3 = limited).

## Background

- `/etymology/[char]` is a RSC at `app/etymology/[char]/page.tsx` that calls `getEtymology(char)` from `lib/etymology.ts` + `getAdjacentChars(char)` and renders `<EtymologyTimeline>` + `<EtymologyPrevNext>`.
- The current `<EtymologyTimeline>` is a client component with a dot-style era selector. Each era's glyph is rendered via a CSS font (`font-jiaguwen`, `font-jinwen`, etc.) loaded by the browser — the WOFF files are external (per Plan L). The same `char` string is wrapped in different font families.
- Each era has a `hasGlyph: boolean` flag (DB column `era_<era>_has`). When `false`, the current UI shows "暂无" placeholder.
- The JSON content schema (`scripts/schemas/content.ts`) has `char`, `pinyin`, `level`, `etymology_story`, etc. but **no era fields**. Era glyph data lives only in the MySQL `char_etymology` table.
- Existing tests: `tests/unit/components/etymology/etymology-timeline.test.tsx` (target the old component) and `era-glyph.test.tsx` (data shape — still valid).
- Dictionary detail page (`app/dictionary/[char]/page.tsx`) already has a tab/link to `/etymology/<char>`. No additional entry point needed.

User decisions confirmed in brainstorm:
1. Animation = auto-play crossfade, 1.2s per era, scrubbable.
2. Missing eras = skip (no "暂无" mid-animation).
3. Era context = date range label per era (static data).
4. Autoplay default = on (respects `prefers-reduced-motion`).
5. Add a char-level badge + coverage hint so partial coverage is contextualized.

## Design

### Component

**New file:** `components/etymology/EtymologyMorph.tsx` (`'use client'`)

**Props:**
```ts
interface EtymologyMorphProps {
  char: string;
  eras: EraGlyph[];     // already filtered to hasGlyph: true
  story: string;        // etymology_story
  level: 1 | 2 | 3;     // from content JSON
}
```

**State:**
```ts
const [currentIndex, setCurrentIndex] = useState(0);
const [isPlaying, setIsPlaying] = useState(true);
```

**Render structure:**
```tsx
<section aria-label="字形演变">
  {/* Header row: char + level badge + coverage hint */}
  <div className="flex items-baseline gap-3">
    <h2 className="text-3xl font-kai">{char}</h2>
    <span className="text-xs px-2 py-0.5 rounded bg-paper-warm
                     border border-ink-faint/30">
      {LEVEL_LABEL[level]}
    </span>
    <span className="text-xs text-ink-faint">{coverageHint(eras.length, level)}</span>
  </div>

  {/* Big glyph stage — all 5 (or N) eras stacked absolutely */}
  <div className="relative h-48 sm:h-64">
    {eras.map((era, i) => (
      <span
        key={era.id}
        aria-hidden={i !== currentIndex}
        className={`absolute inset-0 flex items-center justify-center
                    text-9xl transition-opacity duration-500
                    motion-reduce:transition-none
                    ${i === currentIndex ? 'opacity-100' : 'opacity-0'}`}
        style={{ fontFamily: era.font }}
      >
        {char}
      </span>
    ))}
  </div>

  {/* Play/pause + current era label */}
  <div className="flex items-center justify-between">
    <button onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>
      {isPlaying ? '⏸' : '▶'}
    </button>
    <span>{eras[currentIndex].label} · {ERA_DATES[eras[currentIndex].id].range}</span>
  </div>

  {/* Scrubber */}
  <div role="slider" aria-valuemin={0} aria-valuemax={eras.length-1}
       aria-valuenow={currentIndex} aria-label="字形演变时间轴">
    {eras.map((era, i) => (
      <button key={era.id} onClick={() => goTo(i)}
              aria-current={i === currentIndex ? 'true' : 'false'}
              className={chipClass(i === currentIndex)}>
        {era.label}
        <small className="text-xs text-ink-faint">{ERA_DATES[era.id].range}</small>
      </button>
    ))}
  </div>

  {/* Story */}
  <p className="text-base text-ink-soft leading-relaxed">{story}</p>
</section>
```

**Static data (separate file `components/etymology/era-dates.ts`):**
```ts
export const ERA_DATES: Record<EraId, { range: string }> = {
  jiaguwen:  { range: '商代晚期 (~1200-1046 BC)' },
  jinwen:    { range: '西周 (~1046-771 BC)' },
  xiaozhuan: { range: '秦 (~221-206 BC)' },
  lishu:     { range: '汉 (~206 BC-220 AD)' },
  kaishu:    { range: '魏晋至今 (~220 AD+)' },
};

export const LEVEL_LABEL: Record<1|2|3, string> = {
  1: '一级',
  2: '二级',
  3: '三级',
};

export function coverageHint(eraCount: number, level: 1|2|3): string {
  if (eraCount === 5) return `${eraCount}/5 字形 · 完整`;
  if (eraCount >= 3) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖较全)`;
  if (eraCount >= 1) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖有限)`;
  return '暂无字形';
}
```

**Effects:**
- Autoplay: `useEffect` registers a `setInterval` that advances `currentIndex` every 1200ms when `isPlaying && eras.length > 1`. Cleanup on pause / unmount / `eras.length` change.
- Wrap-around: `(currentIndex + 1) % eras.length`.
- `prefers-reduced-motion`: initial `isPlaying` state is `false` if matchMedia returns true.

**Keyboard:**
- Container `<div tabIndex={0} onKeyDown={...}>`:
  - `←` / `→` — prev / next era (wraps).
  - `Space` — toggle play / pause.
  - `Home` / `End` — jump to first / last era.

**User interactions pause autoplay:**
- Clicking any era chip in the scrubber → `setIsPlaying(false)`, `setCurrentIndex(i)`.
- Pressing ← / → / Home / End → keeps current `isPlaying` state (don't surprise the user by auto-pausing on every keypress).
- Pressing Space → toggles explicitly.

### Data flow

`lib/etymology.ts` — extend `EtymologyResult`:
```ts
export interface EtymologyResult {
  char: string;
  eras: EraGlyph[];
  story: string;
  level: 1 | 2 | 3;   // NEW
}
```

`getEtymology(char)` populates `level`:
- **File-first** (post 2026-06-17 slim-DB): read from `data/content/<char>.json` → `content.level` (cast to `1|2|3`).
- **DB fallback** (legacy): `SELECT level FROM chars WHERE char = ?`.
- **Default**: `1` if neither source has the char (extremely defensive — should never happen in practice since `/etymology/<char>` is only reachable for chars in the dictionary).

`app/etymology/[char]/page.tsx` — pass `level`:
```tsx
<EtymologyMorph
  char={etymology.char}
  eras={etymology.eras}
  story={etymology.story}
  level={etymology.level}
/>
```

`<EtymologyTimeline>` — delete. Migration note: 2 callers currently, both in the etymology page.

### Accessibility

- Only the current era's glyph has `aria-hidden="false"`; others `aria-hidden="true"`.
- Scrubber: `role="slider"`, `aria-valuemin={0}`, `aria-valuemax={eras.length-1}`, `aria-valuenow={currentIndex}`, `aria-label="字形演变时间轴"`.
- Era chips: `<button aria-current={i === currentIndex ? 'true' : 'false'}>`.
- Container: `aria-label="字形演变"` on the section.
- `prefers-reduced-motion`: motion query disables the 500ms transition + starts `isPlaying` as false.
- Color contrast: existing `text-ink/ink-soft/ink-faint` tokens; current era highlight via `bg-seal text-paper-warm` (same pattern as `<DictionaryDetailTabs>`).

### Edge cases

- `eras.length === 0` — render fallback `暂无字源数据`, no autoplay, no scrubber.
- `eras.length === 1` — render single era statically; autoplay interval not registered; scrubber shows 1 chip; keyboard arrows are no-ops.
- `eras.length >= 2` — full feature.
- Mobile (`< sm`): scrubber wraps to 2 rows (`flex flex-wrap gap-2`); big glyph stage shrinks to `h-48` from `h-64`.

### Risks

- **R1 — `getEtymology` return type change.** The function adds a `level` field. Any external callers (if any) need to handle the new field. The only known caller is `app/etymology/[char]/page.tsx`. Mitigation: TS will flag missing destructuring; the field is additive (no breaking removal).
- **R2 — `prefers-reduced-motion` initial state.** Checked on mount with `matchMedia`. SSR returns `true` (autoplay) as default; client hydrates and may flip to `false` if the user has the OS setting. Brief 1-frame flash possible on hydration. Acceptable; no good way to know SSR-side without UA sniffing.
- **R3 — fonts not loaded yet.** External WOFF fonts load async. The first frame may briefly show the wrong font (e.g., the serif fallback) before `YinQiJiaGuWen` loads. This is the same behavior as the current `<EtymologyTimeline>` — not a regression. No mitigation needed.
- **R4 — `level` is `string` in JSON.** `data/content/<char>.json` has `"level": "1"` (string per the schema). Need to cast: `Number(content.level) as 1|2|3`. Defensive: if `level` is not 1/2/3, default to `1`.

### Out of scope

- Server-side PDF / image generation of the evolution strip.
- Adding new era fields to the JSON content schema (era data stays in MySQL `char_etymology`).
- Animating the *story* text in sync with the era (would be cute but adds complexity for marginal value).
- Letting users reorder the eras (the historical order is fixed).
- Per-char shape-change annotations ("竖笔逐渐变直" etc.) — would require content generation per char.
- Visual redesign of the surrounding `/etymology/[char]` page header / footer.

## Verification

- `pnpm tsc --noEmit` exit 0.
- `pnpm test tests/unit/components/etymology/etymology-morph.test.tsx` — all 11 cases pass.
- `pnpm test tests/unit/components/etymology/era-glyph.test.tsx` — still passes (no change).
- `pnpm test tests/unit/lib/etymology.test.ts` (if exists) — still passes after `level` field addition.
- Manual smoke (7 paths documented in the plan §Smoke):
  1. `/etymology/丌` — animation starts automatically, cycles through eras.
  2. Click `⏸` — animation pauses.
  3. Click any era chip — jumps there, animation stops.
  4. Press Space — toggles play/pause.
  5. `/etymology/<char-with-only-2-eras>` — scrubber shows only 2 chips.
  6. `/etymology/<char-with-no-etymology>` — fallback message visible.
  7. Toggle OS reduced-motion — animation doesn't auto-start.

## Commit plan (2 logical commits + smoke)

1. `feat(etymology): add EtymologyMorph component + era-dates constants` — new component, tests, era-dates file.
2. `feat(etymology): extend getEtymology() with level field + page integration` — lib/etymology.ts level addition, page wiring, delete old EtymologyTimeline.

(Final smoke task — tsc + tests + HTTP probe — does not commit unless a fix is needed.)
