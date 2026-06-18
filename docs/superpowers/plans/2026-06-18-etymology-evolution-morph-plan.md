# Spec C: 字源形变演示 (Etymology evolution morph) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-era-at-a-time `<EtymologyTimeline>` on `/etymology/[char]` with a new `<EtymologyMorph>` component that demonstrates how a Chinese character's shape evolved across the 5 historical script eras (甲骨文 → 金文 → 小篆 → 隶书 → 楷书) via an autoplay crossfade animation + a scrubbable timeline. Add a char-level badge + coverage hint.

**Architecture:** Pure UI replacement. The data layer (lib/etymology.ts) gains one new field (`level`); the DB schema and content JSON already carry the data — no migrations needed. The existing `<EtymologyTimeline>` (single-era) is deleted after migration. New `<EtymologyMorph>` is a single client component with `useState({currentIndex, isPlaying})` and a 1.2s `setInterval` for autoplay. Respects `prefers-reduced-motion`.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 18 (useState/useEffect), Vitest + @testing-library/react, Tailwind CSS (existing tokens: `text-ink/ink-soft/ink-faint`, `bg-paper-warm`, `bg-seal`).

## Global Constraints

- New component file: `components/etymology/EtymologyMorph.tsx` (`'use client'`).
- New static data file: `components/etymology/era-dates.ts` — exports `ERA_DATES`, `LEVEL_LABEL`, `coverageHint()`.
- New test file: `tests/unit/components/etymology/etymology-morph.test.tsx` (vitest happy-dom env).
- Modify `lib/etymology.ts` — extend `Etymology` type + `getEtymology()` to populate `level: 1|2|3`.
- Modify `lib/etymology-types.ts` — add `level: 1|2|3` to `Etymology` and `EtymologyClient` interfaces.
- Modify `app/etymology/[char]/page.tsx` — use `<EtymologyMorph>` instead of `<EtymologyTimeline>`, pass `level` prop.
- Modify `app/api/etymology/[char]/route.ts` — the EtymologyClient type now has `level`; no code change needed beyond the type widening (existing `...etymology` spread covers it).
- Delete `components/etymology/EtymologyTimeline.tsx` + `tests/unit/components/etymology/etymology-timeline.test.tsx` after migration.
- Era font CSS classes (from existing `components/etymology/EraGlyph.tsx`): `font-jiaguwen`, `font-jinwen`, `font-xiaozhuan`, `font-lishu`, `font-kai`. (The 5th era is `font-kai`, NOT `font-kaishu` — match existing.)
- Era labels (Chinese): 甲骨文 / 金文 / 小篆 / 隶书 / 楷书 (from existing `EtymologyTimeline.tsx:6-12`).
- Era date ranges (static, per spec §Static data).
- Autoplay: 1200ms per era. Wrap-around: `(currentIndex + 1) % eras.length`.
- `prefers-reduced-motion`: on match, initial `isPlaying = false` AND the 500ms CSS transition is replaced with instant swap (Tailwind `motion-reduce:transition-none`).
- `level` source priority in `getEtymology()`: file-first (`data/content/<char>.json` → `content.level`), DB fallback (`chars.level`), default `1` if neither has the char (defensive — should never happen).
- JSON `content.level` is typed as `number` in `CharContentSchema` (`scripts/schemas/content.ts:27`, `z.number().int().min(1).max(4).optional()`). Cast to `1|2|3` defensively; values outside 1-3 default to `1`.
- Existing CSS font classes for eras are NOT touched (defined in `app/globals.css`).
- No `pnpm build` while `pnpm dev` is alive on port 4444 (per project memory).
- Verification skips DB-backed integration tests if `piyin_test` access is denied (per project memory).
- 2 implementation commits + 1 smoke task (no commit unless fix needed).

---

### Task 1: Build EtymologyMorph component + era-dates + tests (TDD)

**Files:**
- Create: `components/etymology/era-dates.ts` (static data + helper)
- Create: `components/etymology/EtymologyMorph.tsx` (client component)
- Create: `tests/unit/components/etymology/etymology-morph.test.tsx` (vitest + happy-dom)

**Interfaces:**
- Consumes: `EraGlyph[]` from `@/lib/etymology-types` (each `{ era: Era, font: string, hasGlyph: boolean }`).
- Produces: `<EtymologyMorph char eraGlyphs story level />` — pure client component, no exported helpers.
- Produces: `ERA_DATES: Record<Era, { range: string }>`, `LEVEL_LABEL: Record<1|2|3, string>`, `coverageHint(eraCount, level): string` from `era-dates.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/etymology/etymology-morph.test.tsx` with this exact content:

```tsx
// @vitest-environment happy-dom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EtymologyMorph } from '@/components/etymology/EtymologyMorph';

const fullGlyphs = [
  { era: 'jiaguwen' as const, font: 'YinQiJiaGuWen', hasGlyph: true },
  { era: 'jinwen' as const, font: 'HanDianJinWen', hasGlyph: true },
  { era: 'xiaozhuan' as const, font: 'QuanZiKuShuoWen', hasGlyph: true },
  { era: 'lishu' as const, font: 'QuanZiKuLiDing', hasGlyph: true },
  { era: 'kaishu' as const, font: 'KaiTi', hasGlyph: true },
];

describe('EtymologyMorph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the first era (jiaguwen) visibly by default', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // The first era is the visible one (opacity-100); others opacity-0
    const jiaguwen = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(jiaguwen).toBeDefined();
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('marks non-current era glyphs aria-hidden=true', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const allEras = screen.getAllByText('一');
    const hidden = allEras.filter((el) => el.getAttribute('aria-hidden') === 'true');
    const visible = allEras.filter((el) => el.getAttribute('aria-hidden') === 'false');
    expect(visible).toHaveLength(1);
    expect(hidden).toHaveLength(4);
  });

  it('clicking an era chip jumps to that era and pauses autoplay', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    fireEvent.click(screen.getByRole('button', { name: '隶书' }));
    const lishu = screen.getAllByText('一').find(
      (el) => el.className.includes('font-lishu')
    );
    expect(lishu!.className).toContain('opacity-100');
    // After click, the play/pause button should now read "▶" (paused state)
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('autoplay advances currentIndex every 1200ms and wraps around', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // After 1200ms → jiaguwen (0) → jinwen (1)
    act(() => { vi.advanceTimersByTime(1200); });
    const jinwen = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jinwen')
    );
    expect(jinwen!.className).toContain('opacity-100');
    // Advance enough to wrap around (5 eras × 1200ms = 6000ms)
    act(() => { vi.advanceTimersByTime(5 * 1200); });
    // Back to jiaguwen
    const jiaguwen = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('play/pause toggle button stops and resumes the autoplay', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // Default: playing, label "暂停"
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    // After pause, advancing timers should NOT change currentIndex
    const before = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    )!.className;
    act(() => { vi.advanceTimersByTime(5000); });
    const after = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    )!.className;
    expect(before).toContain('opacity-100');
    expect(after).toContain('opacity-100');
  });

  it('does not autoplay when eras.length === 1', () => {
    const oneGlyph = [fullGlyphs[0]];
    render(<EtymologyMorph char="一" eraGlyphs={oneGlyph} story="演变故事" level={1} />);
    act(() => { vi.advanceTimersByTime(10000); });
    // Still on the only era
    const only = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(only!.className).toContain('opacity-100');
  });

  it('renders the fallback message when eras is empty', () => {
    render(<EtymologyMorph char="一" eraGlyphs={[]} story={null} level={1} />);
    expect(screen.getByText(/暂无字源数据/)).toBeInTheDocument();
  });

  it('keyboard: Space toggles play/pause', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    // Default: playing
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    // Fire Space on the section container
    const section = screen.getByRole('region', { name: '字形演变' });
    fireEvent.keyDown(section, { key: ' ' });
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('keyboard: ArrowRight advances the current era (no wrap with autoplay on)', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const section = screen.getByRole('region', { name: '字形演变' });
    // Jump to 隶书 directly via arrow
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    fireEvent.keyDown(section, { key: 'ArrowRight' });
    const lishu = screen.getAllByText('一').find(
      (el) => el.className.includes('font-lishu')
    );
    expect(lishu!.className).toContain('opacity-100');
  });

  it('keyboard: Home/End jump to first/last era', () => {
    render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    const section = screen.getByRole('region', { name: '字形演变' });
    fireEvent.keyDown(section, { key: 'End' });
    const kaishu = screen.getAllByText('一').find(
      (el) => el.className.includes('font-kai')
    );
    expect(kaishu!.className).toContain('opacity-100');
    fireEvent.keyDown(section, { key: 'Home' });
    const jiaguwen = screen.getAllByText('一').find(
      (el) => el.className.includes('font-jiaguwen')
    );
    expect(jiaguwen!.className).toContain('opacity-100');
  });

  it('shows the level badge with the correct Chinese label', () => {
    const { rerender } = render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    expect(screen.getByText('一级')).toBeInTheDocument();
    rerender(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={2} />);
    expect(screen.getByText('二级')).toBeInTheDocument();
    rerender(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={3} />);
    expect(screen.getByText('三级')).toBeInTheDocument();
  });

  it('shows the coverage hint based on era count + level', () => {
    const { rerender } = render(<EtymologyMorph char="一" eraGlyphs={fullGlyphs} story="演变故事" level={1} />);
    expect(screen.getByText(/5\/5 字形 · 完整/)).toBeInTheDocument();

    const partialGlyphs = fullGlyphs.slice(0, 2);
    rerender(<EtymologyMorph char="一" eraGlyphs={partialGlyphs} story="演变故事" level={2} />);
    expect(screen.getByText(/2\/5 字形 · 部分 \(L2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/components/etymology/etymology-morph.test.tsx`
Expected: all 12 tests FAIL with "Cannot find module '@/components/etymology/EtymologyMorph'".

- [ ] **Step 3: Create `components/etymology/era-dates.ts`**

Create the file with this exact content:

```ts
import type { Era } from '@/lib/etymology-types';

export const ERA_DATES: Record<Era, { range: string }> = {
  jiaguwen:  { range: '商代晚期 (~1200-1046 BC)' },
  jinwen:    { range: '西周 (~1046-771 BC)' },
  xiaozhuan: { range: '秦 (~221-206 BC)' },
  lishu:     { range: '汉 (~206 BC-220 AD)' },
  kaishu:    { range: '魏晋至今 (~220 AD+)' },
};

export type CharLevel = 1 | 2 | 3;

export const LEVEL_LABEL: Record<CharLevel, string> = {
  1: '一级',
  2: '二级',
  3: '三级',
};

export function coverageHint(eraCount: number, level: CharLevel): string {
  if (eraCount === 5) return `${eraCount}/5 字形 · 完整`;
  if (eraCount >= 3) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖较全)`;
  if (eraCount >= 1) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖有限)`;
  return '暂无字形';
}
```

- [ ] **Step 4: Create `components/etymology/EtymologyMorph.tsx`**

Create the file with this exact content:

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Era, EraGlyph as EraGlyphType } from '@/lib/etymology-types';
import { ERA_DATES, LEVEL_LABEL, coverageHint, type CharLevel } from './era-dates';

const ERA_LABELS: Record<Era, string> = {
  jiaguwen: '甲骨文',
  jinwen: '金文',
  xiaozhuan: '小篆',
  lishu: '隶书',
  kaishu: '楷书',
};

const ERA_FONT_FAMILY: Record<Era, string> = {
  jiaguwen: 'YinQiJiaGuWen',
  jinwen: 'HanDianJinWen',
  xiaozhuan: 'QuanZiKuShuoWen',
  lishu: 'QuanZiKuLiDing',
  kaishu: 'KaiTi',
};

interface Props {
  char: string;
  eraGlyphs: EraGlyphType[];
  story: string | null;
  level: CharLevel;
}

const AUTOPLAY_INTERVAL_MS = 1200;
const FADE_DURATION_MS = 500;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function EtymologyMorph({ char, eraGlyphs, story, level }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => !prefersReducedMotion());

  // Filter to eras that have glyph data (skip missing per spec).
  const eras = eraGlyphs.filter((g) => g.hasGlyph);

  const goTo = useCallback((i: number) => {
    setCurrentIndex(((i % eras.length) + eras.length) % eras.length);
  }, [eras.length]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % Math.max(1, eras.length));
  }, [eras.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + eras.length) % Math.max(1, eras.length));
  }, [eras.length]);

  // Autoplay
  useEffect(() => {
    if (!isPlaying || eras.length < 2) return;
    const id = setInterval(goNext, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, eras.length, goNext]);

  // Keyboard
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === ' ') {
      e.preventDefault();
      setIsPlaying((p) => !p);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(eras.length - 1);
    }
  }, [goNext, goPrev, goTo, eras.length]);

  // Empty state
  if (eras.length === 0) {
    return (
      <div className="text-center py-12 text-ink-faint">
        暂无字源数据
      </div>
    );
  }

  const currentEra = eras[currentIndex];
  const eraId = currentEra.era;

  return (
    <section
      aria-label="字形演变"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="focus:outline-none"
    >
      {/* Header row: char + level badge + coverage hint */}
      <div className="flex items-baseline gap-3 mb-4 flex-wrap">
        <h2 className="text-3xl font-kai text-ink">{char}</h2>
        <span className="text-xs px-2 py-0.5 rounded bg-paper-warm
                         border border-ink-faint/30 text-ink-soft">
          {LEVEL_LABEL[level]}
        </span>
        <span className="text-xs text-ink-faint">
          {coverageHint(eras.length, level)}
        </span>
      </div>

      {/* Big glyph stage — all eras stacked absolutely */}
      <div className="relative h-48 sm:h-64 bg-gradient-to-b from-paper-warm to-paper rounded mb-4">
        {eras.map((era, i) => (
          <span
            key={era.era}
            aria-hidden={i !== currentIndex}
            className={`absolute inset-0 flex items-center justify-center
                        text-9xl transition-opacity duration-500
                        motion-reduce:transition-none
                        ${i === currentIndex ? 'opacity-100' : 'opacity-0'}`}
            style={{ fontFamily: ERA_FONT_FAMILY[era.era] }}
          >
            {char}
          </span>
        ))}
      </div>

      {/* Play/pause + current era label */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          aria-label={isPlaying ? '暂停' : '播放'}
          className="w-10 h-10 rounded-full bg-paper-warm border border-ink/20
                     hover:bg-seal hover:text-paper-warm transition text-lg
                     flex items-center justify-center"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="text-sm text-ink-soft">
          {ERA_LABELS[eraId]} · {ERA_DATES[eraId].range}
        </span>
      </div>

      {/* Scrubber */}
      <div
        role="slider"
        aria-valuemin={0}
        aria-valuemax={eras.length - 1}
        aria-valuenow={currentIndex}
        aria-label="字形演变时间轴"
        className="flex flex-wrap gap-2 mb-6"
      >
        {eras.map((era, i) => {
          const isActive = i === currentIndex;
          return (
            <button
              key={era.era}
              type="button"
              onClick={() => {
                setIsPlaying(false);
                goTo(i);
              }}
              aria-current={isActive ? 'true' : 'false'}
              aria-label={ERA_LABELS[era.era]}
              className={`px-3 py-1.5 rounded text-xs flex flex-col items-center
                          transition ${
                            isActive
                              ? 'bg-seal text-paper-warm'
                              : 'bg-paper-warm text-ink-soft hover:bg-paper'
                          }`}
            >
              <span className="font-semibold">{ERA_LABELS[era.era]}</span>
              <span className="text-[10px] opacity-80">{ERA_DATES[era.era].range}</span>
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
        <div className="text-sm text-ink-faint text-center py-6">
          字源故事即将生成
        </div>
      )}

      <div className="text-xs text-ink-faint text-center mt-4">
        ← / → 切换时代 · Space 播放/暂停
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/unit/components/etymology/etymology-morph.test.tsx`
Expected: all 12 tests PASS.

- [ ] **Step 6: Run tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no errors. (The new component is self-contained; the page hasn't been migrated yet, so existing callers still use EtymologyTimeline.)

- [ ] **Step 7: Commit**

```bash
git add components/etymology/era-dates.ts components/etymology/EtymologyMorph.tsx tests/unit/components/etymology/etymology-morph.test.tsx
git commit -m "feat(etymology): add EtymologyMorph component + era-dates constants"
```

---

### Task 2: Extend getEtymology() with level + migrate page + delete EtymologyTimeline

**Files:**
- Modify: `lib/etymology-types.ts:10-16` (add `level` to `Etymology`)
- Modify: `lib/etymology-types.ts:23-31` (add `level` to `EtymologyClient`)
- Modify: `lib/etymology.ts:10-63` (populate `level` in `getEtymology()`)
- Modify: `app/etymology/[char]/page.tsx:8, 47-51` (import EtymologyMorph, pass level)
- Delete: `components/etymology/EtymologyTimeline.tsx`
- Delete: `tests/unit/components/etymology/etymology-timeline.test.tsx`

**Interfaces:**
- Consumes: `CharLevel = 1|2|3` from `@/components/etymology/era-dates` (per Task 1).
- Produces: `Etymology.level: CharLevel` and `EtymologyClient.level: CharLevel` (additive to existing fields).
- Produces: `getEtymology(char)` returns the same `Etymology` shape plus `level`. Two paths: file-first reads `content.level` from `getContent(char)`; DB fallback reads `chars.level`.

- [ ] **Step 1: Add `level` to the `Etymology` interface**

In `lib/etymology-types.ts`, replace the `Etymology` interface (lines 10-16) with:

```ts
import type { CharLevel } from '@/components/etymology/era-dates';

export interface Etymology {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  level: CharLevel;
}
```

(Adjust the import — if the file uses relative paths, swap `@/components/etymology/era-dates` to `../components/etymology/era-dates`. The repo convention per the import in `EtymologyTimeline.tsx:3` is `@/lib/etymology-types` for the lib file, so use `@/components/etymology/era-dates` for the components path.)

- [ ] **Step 2: Add `level` to the `EtymologyClient` interface**

In `lib/etymology-types.ts`, replace the `EtymologyClient` interface (lines 23-31) with:

```ts
export interface EtymologyClient {
  char: string;
  eraGlyphs: EraGlyph[];
  story: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  level: CharLevel;
  prev: string | null;
  next: string | null;
}
```

- [ ] **Step 3: Populate `level` in `getEtymology()`**

In `lib/etymology.ts`, the function has 2 return paths: (a) the slim-DB fallback at lines 33-43, (b) the DB+JSON merged path at lines 56-62. Both need `level` added.

Add a `toCharLevel` helper + `readLevel` async helper just above the function (after the existing imports — `getPool` and `getContent` are already imported; do NOT add a duplicate import):

```ts
import type { CharLevel } from '@/components/etymology/era-dates';

function toCharLevel(n: number | null | undefined): CharLevel {
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

async function readLevel(char: string): Promise<CharLevel> {
  // File-first (post 2026-06-17 slim-DB)
  const content = await getContent(char);
  if (content?.level != null) return toCharLevel(content.level);
  // DB fallback (legacy)
  const [rows] = await getPool().query<any[]>(
    `SELECT level FROM chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  return toCharLevel(rows[0]?.level);
}
```

Then in the function body, populate `level` for both return paths. Change the slim-DB return (lines 33-43) to include `level`:

```ts
if (rows.length === 0) {
  // Slim-DB path: no char_etymology row, but story may live in data/content/<char>.json.
  const contentOnly = await getContent(char);
  const storyOnly = contentOnly?.etymology?.story ?? null;
  if (!storyOnly) return null;
  return {
    char,
    eraGlyphs: ERAS.map((era) => ({
      era,
      font: '',
      hasGlyph: false,
    })),
    story: storyOnly,
    generatedBy: contentOnly?.etymology?.generated_by ?? null,
    generatedAt: contentOnly?.etymology?.generated_at ?? null,
    level: await readLevel(char),
  };
}
```

And replace the merged-path return (lines 56-62) — the `r` row is from `char_etymology` which does not carry `level`, so delegate to `readLevel` for file-first / DB-fallback:

```ts
return {
  char: r.char,
  eraGlyphs,
  story,
  generatedBy,
  generatedAt,
  level: await readLevel(char),
};
```

- [ ] **Step 4: Update the etymology page to use EtymologyMorph**

In `app/etymology/[char]/page.tsx`, make two changes:

(a) Replace the import at line 8:
```ts
// Before
import { EtymologyTimeline } from '@/components/etymology/EtymologyTimeline';
// After
import { EtymologyMorph } from '@/components/etymology/EtymologyMorph';
```

(b) Replace the JSX at lines 47-51:
```tsx
// Before
<EtymologyTimeline
  char={etymology.char}
  eraGlyphs={etymology.eraGlyphs}
  story={etymology.story}
/>
// After
<EtymologyMorph
  char={etymology.char}
  eraGlyphs={etymology.eraGlyphs}
  story={etymology.story}
  level={etymology.level}
/>
```

- [ ] **Step 5: Delete the old component + its test**

```bash
git rm components/etymology/EtymologyTimeline.tsx
git rm tests/unit/components/etymology/etymology-timeline.test.tsx
```

(The `git rm` stages the deletions; the actual commit happens in Step 7.)

- [ ] **Step 6: Run tsc + all etymology tests**

```bash
pnpm tsc --noEmit
pnpm test tests/unit/components/etymology/
pnpm test tests/unit/lib/etymology.test.ts 2>/dev/null || true  # skip if file doesn't exist
```

Expected:
- tsc: exit 0
- `etymology/` tests: etymology-morph.test.tsx (12 cases) PASS; era-glyph.test.tsx (existing) still PASS
- etymology.test.ts: PASS or skip cleanly (file may not exist — the 2>/dev/null || true handles that)

- [ ] **Step 7: Commit**

```bash
git add lib/etymology.ts lib/etymology-types.ts app/etymology/\[char\]/page.tsx
git add -u components/etymology/EtymologyTimeline.tsx tests/unit/components/etymology/etymology-timeline.test.tsx
git commit -m "feat(etymology): wire getEtymology level field + migrate page to EtymologyMorph"
```

---

### Task 3: Final smoke + verification

**Files:** none (smoke only)

- [ ] **Step 1: tsc**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: All etymology tests**

Run: `pnpm test tests/unit/components/etymology/`
Expected: 12/12 new + existing era-glyph cases pass.

- [ ] **Step 3: HTTP smoke (dev server on 4444)**

The dev server is already up on 4444 (per project memory).

```bash
curl -s -o /dev/null -w "etymology=%{http_code}\n" --max-time 10 "http://localhost:4444/etymology/一"
curl -s -o /dev/null -w "etymology-api=%{http_code}\n" --max-time 10 "http://localhost:4444/api/etymology/一"
```

Expected: 200 (page renders) and 200 (API returns EtymologyClient with `level` field). If the API response doesn't include `level`, the migration of `EtymologyClient` is incomplete — flag in the report.

Quick API body check:
```bash
curl -s --max-time 10 "http://localhost:4444/api/etymology/一" | python -c "import sys,json; d=json.load(sys.stdin); assert d.get('ok') and d['data'].get('level') in (1,2,3), d; print('level OK:', d['data']['level'])"
```
Expected: prints `level OK: <1|2|3>` (一 is L1).

- [ ] **Step 4: Render the page and check for "EtymologyMorph" markers**

```bash
curl -s --max-time 10 "http://localhost:4444/etymology/一" | grep -oE '字形演变|一级|5/5 字形' | head -3
```

Expected: prints `字形演变` (the section aria-label) and `一级` (level badge for 一) at least once each. The exact coverage hint may vary if 一's era data is partial.

- [ ] **Step 5: Manual browser smoke (deferred to human)**

Document for the human:
1. Open `/etymology/一` in browser → animation should auto-start, cycling through 5 eras.
2. Click `⏸` → animation pauses, current glyph stays visible.
3. Click any era chip in the scrubber → jumps to that era, animation stops.
4. Press `Space` → toggles play/pause.
5. Press `←` / `→` → steps prev/next era.
6. Open `/etymology/<char-with-only-2-eras>` → scrubber shows only 2 chips.
7. Open `/etymology/<char-with-no-etymology>` → fallback message visible.
8. Toggle OS reduced-motion → page does not auto-play.

This is the visual verification step.

- [ ] **Step 6: Final commit (only if drift)**

If tsc + tests surfaced no error, no commit needed. If a small fix was required (e.g., trailing newline caught by review), commit it focused.

---

## Self-Review

**Spec coverage** — checked each section of the spec:

| Spec requirement | Task |
|---|---|
| New `EtymologyMorph.tsx` client component | T1 |
| `era-dates.ts` with `ERA_DATES`, `LEVEL_LABEL`, `coverageHint` | T1 |
| Props `{char, eraGlyphs, story, level}` | T1 |
| `useState({currentIndex, isPlaying})` | T1 |
| `useEffect` autoplay interval (1200ms) | T1 |
| Crossfade `transition-opacity duration-500` + `motion-reduce:transition-none` | T1 |
| Wrap-around `(i+1) % eras.length` | T1 |
| `prefers-reduced-motion` check on mount → initial `isPlaying = false` | T1 |
| Keyboard: ←/→/Space/Home/End | T1 |
| `aria-hidden` on non-current glyphs | T1 |
| `role="slider"` on scrubber with `aria-valuemin/max/now` | T1 |
| `aria-current` on era chips | T1 |
| Level badge + coverage hint in header | T1 |
| Empty-eras fallback (`暂无字源数据`) | T1 |
| 1-era static render | T1 |
| 2+ eras full feature | T1 |
| Mobile `h-48 sm:h-64` | T1 |
| `Etymology.level: CharLevel` type field | T2 |
| `EtymologyClient.level: CharLevel` type field | T2 |
| `getEtymology` populates `level` (file-first, DB fallback) | T2 |
| Page uses `<EtymologyMorph>` + passes `level` | T2 |
| Delete `<EtymologyTimeline>` + its test | T2 |
| tsc + test verification | T3 |
| HTTP smoke of `/etymology/一` + `/api/etymology/一` | T3 |
| Browser smoke documented for human | T3 |

**Placeholder scan** — no "TBD"/"TODO"/"implement later"/"fill in details". Every code step shows actual code.

**Type consistency**:
- `CharLevel = 1|2|3` defined once in `components/etymology/era-dates.ts` and imported by `EtymologyMorph.tsx`, `Etymology`, `EtymologyClient`, `lib/etymology.ts` (via `toCharLevel` helper).
- `eraGlyphs: EraGlyph[]` used consistently (the actual field name on `Etymology`, not `eras` as the spec abbreviated it). The new component prop is `eraGlyphs` to match.
- `ERA_FONT_FAMILY` is local to `EtymologyMorph.tsx` (was `ERA_FONT_CLASS` in the deleted `EraGlyph.tsx` — only `EtymologyTimeline` was using it via `<EraGlyph>`, and we're replacing `EtymologyTimeline`).
- `coverageHint(eraCount, level)` signature: `(number, CharLevel) => string` consistent across tests and implementation.
- `ERA_DATES[eraId].range` is the access pattern used in JSX (`eraId` is `Era`, the keys of `ERA_DATES`).
- `goTo(i)` uses `((i % eras.length) + eras.length) % eras.length` for negative-safe modulo (called via Home/End with safe indices, but the formula is the standard JS trick for negative-safe modulo).

**Commit granularity** — 2 implementation commits + 1 smoke task. Each commit is independently revertable.

**Risk callouts for the implementer**:
- Step 3 in Task 2 (`getEtymology` level) has 2 places to modify; both need `await readLevel(char)`. Don't forget either.
- Step 5 in Task 2 uses `git rm` — this assumes the files exist in git's index. They do (per `git log --all -- components/etymology/EtymologyTimeline.tsx`).
- The new `<EtymologyMorph>` does NOT use the existing `<EraGlyph>` component (which has the "暂无" placeholder + dot nav). Spec C deliberately replaces that. The new component inlines its own font-family span rendering.

**One known minor**: The spec mentioned the `api/etymology/[char]/route.ts` would auto-pickup the new `level` field via the `EtymologyClient` spread, but the test in Step 3 (Task 3) verifies this. If the test fails, the issue is that `EtymologyClient` didn't get the `level` field — re-check Step 2 of Task 2.
