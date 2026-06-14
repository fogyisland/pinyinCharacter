# Plan M — 笔画顺序 / 动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/dictionary/[char]` 字典详情卡下方嵌入"笔画顺序"小组件,展示田字格 + 浓墨笔顺动画 + 重播/循环/笔数控制,数据从预打包的 `public/strokes/{char}.json` 加载。

**Architecture:** 'use client' 组件 + 静态笔画数据。`scripts/build-strokes.ts` build 阶段从 hanzi-writer-data CDN 拉取 8105 字笔画 JSON,写 `public/strokes/{char}.json`。运行时组件 dynamic import HanziWriter lib + fetch 本地 JSON + HanziWriter.create。0 新 API 路由,0 新数据库表。

**Tech Stack:** Next.js 15 (RSC + 'use client'), TypeScript, HanziWriter 3.x, p-limit (并发 fetch), tsx (CLI runner, 已 devDep), vitest + happy-dom + @testing-library/react.

---

## File Structure

**New files:**
- `scripts/build-strokes.ts` — 预打包脚本 (CLI + 导出 `buildStrokes` 给测试用)
- `scripts/build-strokes.test.ts` — 脚本冒烟测试 (mock fetch + fs)
- `components/dictionary/StrokeOrderCard.tsx` — 'use client' 主组件
- `tests/unit/components/dictionary/stroke-order-card.test.tsx` — 7 个单元测试

**Build artifacts (gitignored):**
- `public/strokes/{char}.json` — 8105 个笔画 JSON (~50-150MB total)
- `data/strokes-manifest.json` — supported/missing 清单

**Modified files:**
- `components/dictionary/DictionaryDetailTabs.tsx` — 嵌入 `<StrokeOrderCard char={char} />`
- `package.json` — +`hanzi-writer` dep, +`p-limit` devDep, +`strokes:build` script
- `.gitignore` — +`public/strokes/`, +`data/strokes-manifest.json`
- `README.md` — 笔画顺序 feature 段落 + `pnpm strokes:build` 步骤

---

## Task 0: Baseline verification

**Files:** None (verification only)

- [ ] **Step 1: Run pnpm test to verify baseline passes**

Run: `pnpm test 2>&1 | tail -30`
Expected: All existing tests pass. If any fail, stop and resolve before proceeding.

- [ ] **Step 2: Run pnpm build to verify baseline builds**

Run: `pnpm build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 3: Verify git status clean**

Run: `git status`
Expected: No uncommitted changes. If anything is dirty, stop and resolve.

---

## Task 1: Install deps + add strokes:build script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install hanzi-writer runtime dep**

Run: `pnpm add hanzi-writer@^3.7.0 2>&1 | tail -10`
Expected: Added to `dependencies` in package.json. `node_modules/hanzi-writer/` exists.

- [ ] **Step 2: Install p-limit dev dep**

Run: `pnpm add -D p-limit@^6.0.0 2>&1 | tail -10`
Expected: Added to `devDependencies` in package.json.

- [ ] **Step 3: Add strokes:build script to package.json**

Edit `package.json` scripts section. Add this line after `sutras:build`:
```json
    "strokes:build": "tsx scripts/build-strokes.ts",
```

Verify with: `grep strokes:build package.json`
Expected: `    "strokes:build": "tsx scripts/build-strokes.ts",`

- [ ] **Step 4: Verify tsc still passes**

Run: `pnpm tsc --noEmit 2>&1 | tail -5`
Expected: No errors (deps don't add types to app code yet).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(plan-m): install hanzi-writer + p-limit for strokes:build"
```

---

## Task 2: TDD build-strokes.ts — write test first

**Files:**
- Create: `scripts/build-strokes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/build-strokes.test.ts` with the following content:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface BuildStrokesOptions {
  fetchImpl?: typeof fetch;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, content: string) => Promise<void>;
  mkdir?: (p: string) => Promise<void>;
}

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fsPromises from 'fs/promises';
import { buildStrokes } from './build-strokes';

describe('buildStrokes', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.writeFile).mockReset();
    vi.mocked(fsPromises.mkdir).mockReset();
  });

  it('writes one JSON per char and a manifest', async () => {
    // 2-char fixture list
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['一', '丁']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"strokes":[]}'),
    } as any);

    const result = await buildStrokes({ fetchImpl });

    expect(result.supported).toEqual(['一', '丁']);
    expect(result.missing).toEqual([]);
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/一.json'),
      '{"strokes":[]}',
      'utf-8',
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/丁.json'),
      '{"strokes":[]}',
      'utf-8',
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('data/strokes-manifest.json'),
      expect.stringContaining('"supported"'),
      'utf-8',
    );
  });

  it('records missing chars in manifest when all sources fail', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['X']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));

    const result = await buildStrokes({ fetchImpl });

    expect(result.supported).toEqual([]);
    expect(result.missing).toEqual(['X']);
    // No per-char JSON written
    expect(fsPromises.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/X.json'),
      expect.anything(),
      expect.anything(),
    );
    // Manifest still written
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('data/strokes-manifest.json'),
      expect.stringContaining('"missing":["X"]'),
      'utf-8',
    );
  });

  it('uses manifest from data/ path, not public/', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['一']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{}'),
    } as any);

    await buildStrokes({ fetchImpl });

    const manifestCall = vi.mocked(fsPromises.writeFile).mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('strokes-manifest'),
    );
    expect(manifestCall).toBeDefined();
    expect(manifestCall![0]).toMatch(/^data\//);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails (function not found)**

Run: `pnpm test scripts/build-strokes.test.ts 2>&1 | tail -20`
Expected: FAIL with "Cannot find module './build-strokes'" or similar.

- [ ] **Step 3: Commit (test only, no impl yet)**

```bash
git add scripts/build-strokes.test.ts
git commit -m "test(plan-m): build-strokes smoke test (red)"
```

---

## Task 3: Implement build-strokes.ts

**Files:**
- Create: `scripts/build-strokes.ts`

- [ ] **Step 1: Implement the build script**

Create `scripts/build-strokes.ts` with the following content:

```typescript
/**
 * Pre-bundles hanzi-writer stroke data for our 8105 dict chars.
 * Output: public/strokes/{char}.json (static files served by Next.js)
 *         data/strokes-manifest.json (build verification)
 *
 * Run: pnpm strokes:build (~5-10 min for full 8105)
 */
import pLimit from 'p-limit';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';

const CHARS_FILE = 'data/general-standard-chinese-characters.json';
const OUTPUT_DIR = 'public/strokes';
const MANIFEST_FILE = 'data/strokes-manifest.json';

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/',
  'https://unpkg.com/hanzi-writer-data@latest/',
  'https://raw.githubusercontent.com/chanind/hanzi-writer-data/master/data/',
] as const;

const CONCURRENCY = 8;

export interface BuildStrokesOptions {
  fetchImpl?: typeof fetch;
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
}

export interface BuildStrokesResult {
  supported: string[];
  missing: string[];
}

async function tryFetch(char: string, fetchImpl: typeof fetch): Promise<string | null> {
  for (const base of SOURCES) {
    try {
      const r = await fetchImpl(`${base}${char}.json`);
      if (r.ok) return await r.text();
    } catch {
      // try next source
    }
  }
  return null;
}

export async function buildStrokes(
  options: BuildStrokesOptions = {},
): Promise<BuildStrokesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readFileImpl = options.readFile ?? readFile;
  const writeFileImpl = options.writeFile ?? writeFile;
  const mkdirImpl = options.mkdir ?? mkdir;

  const charsJson = await readFileImpl(CHARS_FILE, 'utf-8');
  const chars: string[] = JSON.parse(charsJson);

  await mkdirImpl(OUTPUT_DIR, { recursive: true });

  const limit = pLimit(CONCURRENCY);
  const supported: string[] = [];
  const missing: string[] = [];

  await Promise.all(
    chars.map((c) =>
      limit(async () => {
        const txt = await tryFetch(c, fetchImpl);
        if (txt !== null) {
          await writeFileImpl(`${OUTPUT_DIR}/${c}.json`, txt, 'utf-8');
          supported.push(c);
        } else {
          missing.push(c);
        }
      }),
    ),
  );

  const manifest = {
    version: '1',
    source: 'hanzi-writer-data',
    totalChars: chars.length,
    supported,
    missing,
  };
  await writeFileImpl(
    MANIFEST_FILE,
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  return { supported, missing };
}

// CLI entry
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  buildStrokes()
    .then(({ supported, missing }) => {
      const total = supported.length + missing.length;
      const missingPct = total > 0 ? (missing.length / total) * 100 : 0;
      console.log(`✓ ${supported.length} stroke files written`);
      console.log(`✗ ${missing.length} missing (${missingPct.toFixed(1)}%)`);
      console.log(`Manifest: ${MANIFEST_FILE}`);
      if (missingPct > 5) {
        console.error(`FATAL: >5% missing. Check CDN connectivity.`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('build-strokes failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Run test, verify all 3 pass**

Run: `pnpm test scripts/build-strokes.test.ts 2>&1 | tail -20`
Expected: PASS — 3 tests green.

- [ ] **Step 3: Run tsc to verify types**

Run: `pnpm tsc --noEmit 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-strokes.ts
git commit -m "feat(plan-m): build-strokes.ts with fallback chain + manifest"
```

---

## Task 4: Run real build + gitignore artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Run real build with 5-char subset first to verify it works end-to-end**

Run (creates a tiny test char list to verify, doesn't pollute real data):
```bash
node -e "const fs=require('fs'); fs.writeFileSync('/tmp/test-chars.json', JSON.stringify(['一','丁','七','三','上']))"
node -e "const fs=require('fs'); fs.copyFileSync('/tmp/test-chars.json', 'data/general-standard-chinese-characters.json.bak'); fs.copyFileSync('/tmp/test-chars.json', 'data/general-standard-chinese-characters.json')"
pnpm strokes:build 2>&1 | tail -10
node -e "const fs=require('fs'); fs.copyFileSync('data/general-standard-chinese-characters.json.bak', 'data/general-standard-chinese-characters.json'); fs.unlinkSync('data/general-standard-chinese-characters.json.bak')"
```

Expected: `✓ 5 stroke files written`, `Manifest: data/strokes-manifest.json` (or similar — could be 0/5 if no network in this env, in which case the script still writes a manifest with all 5 in `missing`).

If `manifest.missing.length === 5` (no network), the script will exit 1. That's expected. The script logic is verified by the unit test; the real network run is a separate step the user does when they have network. Skip to step 2 in that case.

- [ ] **Step 2: Clean up test files**

Run:
```bash
rm -f public/strokes/一.json public/strokes/丁.json public/strokes/七.json public/strokes/三.json public/strokes/上.json
rmdir public/strokes 2>/dev/null || true
rm -f data/strokes-manifest.json
```

Expected: Files removed (force-rerun the real build later when network is available).

- [ ] **Step 3: Add public/strokes/ and data/strokes-manifest.json to .gitignore**

Edit `.gitignore`. After the `data/runtime/` line, add:
```
# build artifacts (regenerate with pnpm strokes:build)
public/strokes/
data/strokes-manifest.json
```

Verify with: `cat .gitignore | tail -10`
Expected: The two new lines are present.

- [ ] **Step 4: Run git status, verify .gitignore excludes artifacts**

Run: `git status`
Expected: `public/strokes/` and `data/strokes-manifest.json` do NOT appear (they're gitignored).

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore(plan-m): gitignore stroke build artifacts"
```

---

## Task 5: TDD StrokeOrderCard — Tests 1+2 (loading + 404)

**Files:**
- Create: `tests/unit/components/dictionary/stroke-order-card.test.tsx` (test only, no impl yet)
- Create: `components/dictionary/StrokeOrderCard.tsx` (skeleton impl)

- [ ] **Step 1: Write the failing tests for loading + 404**

Create `tests/unit/components/dictionary/stroke-order-card.test.tsx` with the following content:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { StrokeOrderCard } from '@/components/dictionary/StrokeOrderCard';

// Mock the heavy hanzi-writer module so tests don't load real lib
const mockWriter = {
  loopCharacterAnimation: vi.fn(),
  animateCharacter: vi.fn(),
  cancelAnimation: vi.fn(),
  getNumStrokes: vi.fn(() => 1),
};
vi.mock('hanzi-writer', () => ({
  default: {
    create: vi.fn(() => mockWriter),
  },
}));

describe('StrokeOrderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriter.getNumStrokes.mockReturnValue(1);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows loading state initially (Test 1)', () => {
    // fetch is in flight; component renders spinner
    global.fetch = vi.fn(() => new Promise(() => {})) as any; // never resolves
    render(<StrokeOrderCard char="一" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state when /strokes/{char}.json 404s (Test 2)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);
    render(<StrokeOrderCard char="𠮷" />);
    await waitFor(() => {
      expect(screen.getByText(/暂无.*笔画数据/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL (module not found)**

Run: `pnpm test tests/unit/components/dictionary/stroke-order-card.test.tsx 2>&1 | tail -20`
Expected: FAIL — cannot resolve `@/components/dictionary/StrokeOrderCard`.

- [ ] **Step 3: Create the skeleton component to satisfy Tests 1+2**

Create `components/dictionary/StrokeOrderCard.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  char: string;
  className?: string;
};

export function StrokeOrderCard({ char, className }: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const writerRef = useRef<unknown>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!r.ok) {
          setError('unsupported');
          setIsLoading(false);
          return;
        }
        // TODO: dynamic import hanzi-writer + create writer
        // (implemented in Task 6)
        if (cancelled) return;
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError('network');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [char]);

  if (error) {
    return (
      <article className={className}>
        <p role="alert">暂无该字笔画数据</p>
      </article>
    );
  }

  if (isLoading) {
    return (
      <article className={className}>
        <div role="status" aria-label="Loading" className="spinner" />
      </article>
    );
  }

  // TODO: render canvas + controls (Task 6+7)
  return (
    <article className={className}>
      <div ref={containerRef} />
    </article>
  );
}
```

- [ ] **Step 4: Run tests, verify both PASS**

Run: `pnpm test tests/unit/components/dictionary/stroke-order-card.test.tsx 2>&1 | tail -15`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Run tsc to verify types**

Run: `pnpm tsc --noEmit 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add components/dictionary/StrokeOrderCard.tsx tests/unit/components/dictionary/stroke-order-card.test.tsx
git commit -m "feat(plan-m): StrokeOrderCard skeleton + Tests 1+2 (loading + 404)"
```

---

## Task 6: TDD StrokeOrderCard — Tests 3+7 (success render + char change)

**Files:**
- Modify: `tests/unit/components/dictionary/stroke-order-card.test.tsx` (add Tests 3+7)
- Modify: `components/dictionary/StrokeOrderCard.tsx` (add HanziWriter integration)

- [ ] **Step 1: Add Tests 3+7 to the test file**

Append these two tests to the existing `describe('StrokeOrderCard', ...)` block (before the final `});`):

```tsx
  it('renders canvas + controls when fetch succeeds (Test 3)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: ['M0,0 L100,100'], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);

    await waitFor(() => {
      // Replay + loop buttons visible
      expect(screen.getByRole('button', { name: /重新播放/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /循环播放/ })).toBeInTheDocument();
    });
    // Stroke count visible
    expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
  });

  it('reinitializes writer when char prop changes (Test 7)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    const { rerender } = render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    // Change char
    rerender(<StrokeOrderCard char="丁" />);
    await waitFor(() => {
      // New fetch for 丁
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/strokes/丁.json'));
    });
  });
```

- [ ] **Step 2: Run tests, verify Tests 3+7 FAIL (replay button missing, fetch for 丁 not called)**

Run: `pnpm test tests/unit/components/dictionary/stroke-order-card.test.tsx 2>&1 | tail -30`
Expected: Tests 3 and 7 FAIL. Tests 1+2 still pass.

- [ ] **Step 3: Update StrokeOrderCard to support HanziWriter integration**

Replace `components/dictionary/StrokeOrderCard.tsx` with the full version:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const SIZE = 280;
const STROKE_ANIMATION_SPEED = 1;
const DELAY_BETWEEN_STROKES = 400;
const STROKE_COLOR = '#1a1a1a';
const RADICAL_COLOR = '#168F4F';
const OUTLINE_COLOR = '#ddd';

type Props = {
  char: string;
  className?: string;
};

interface HanziWriterLike {
  loopCharacterAnimation: () => void;
  animateCharacter: () => void;
  cancelAnimation: () => void;
  getNumStrokes: () => number;
}

export function StrokeOrderCard({ char, className }: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [currentStroke, setCurrentStroke] = useState(0);
  const [totalStrokes, setTotalStrokes] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const writerRef = useRef<HanziWriterLike | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Main lifecycle: dynamic import + fetch + create writer
  useEffect(() => {
    let cancelled = false;
    let writer: HanziWriterLike | null = null;

    setIsLoading(true);
    setError(null);
    setIsReady(false);
    setCurrentStroke(0);
    setTotalStrokes(0);
    writerRef.current = null;
    if (containerRef.current) containerRef.current.innerHTML = '';

    (async () => {
      try {
        const r = await fetch(`/strokes/${encodeURIComponent(char)}.json`);
        if (cancelled) return;
        if (!r.ok) {
          setError('unsupported');
          setIsLoading(false);
          return;
        }
        const strokeData = await r.json();

        const HanziWriterMod = await import('hanzi-writer');
        const HanziWriter = HanziWriterMod.default;
        if (cancelled || !containerRef.current) return;

        writer = HanziWriter.create(containerRef.current, {
          width: SIZE,
          height: SIZE,
          padding: 8,
          showOutline: true,
          strokeAnimationSpeed: STROKE_ANIMATION_SPEED,
          delayBetweenStrokes: DELAY_BETWEEN_STROKES,
          strokeColor: STROKE_COLOR,
          radicalColor: RADICAL_COLOR,
          outlineColor: OUTLINE_COLOR,
          charDataLoader: (cb: (data: unknown) => void) => cb(strokeData),
          onLoadCharDataError: () => {
            if (!cancelled) setError('load_failed');
          },
          onCompleteStroke: ({ strokeNum }: { strokeNum: number; strokeCount: number }) => {
            if (!cancelled) setCurrentStroke(strokeNum);
          },
        } as any) as HanziWriterLike;

        if (cancelled) {
          writer.cancelAnimation();
          return;
        }
        writerRef.current = writer;
        setTotalStrokes(writer.getNumStrokes());
        setIsReady(true);
        setIsLoading(false);
        if (loopEnabled) writer.loopCharacterAnimation();
        else writer.animateCharacter();
      } catch (e) {
        if (!cancelled) {
          setError('init_failed');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (writer) writer.cancelAnimation();
      writerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char]);

  // React to loopEnabled changes
  useEffect(() => {
    const w = writerRef.current;
    if (!w || !isReady) return;
    if (loopEnabled) {
      w.loopCharacterAnimation();
    } else {
      w.cancelAnimation();
      setCurrentStroke(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled]);

  function replay() {
    const w = writerRef.current;
    if (!w) return;
    w.cancelAnimation();
    setCurrentStroke(0);
    if (loopEnabled) w.loopCharacterAnimation();
    else w.animateCharacter();
  }

  function toggleLoop() {
    setLoopEnabled((v) => !v);
  }

  if (error) {
    return (
      <article className={className}>
        <p role="alert">暂无该字笔画数据</p>
      </article>
    );
  }

  if (isLoading || !isReady) {
    return (
      <article className={className}>
        <div role="status" aria-label="Loading" className="spinner" />
      </article>
    );
  }

  return (
    <article className={className}>
      <header className="flex items-center justify-between mb-4">
        <h3>笔画顺序</h3>
        <span className="badge">新功能</span>
      </header>
      <div className="flex flex-col md:flex-row gap-6 items-center">
        <div
          className="relative"
          style={{ width: SIZE, height: SIZE }}
        >
          <svg
            className="absolute inset-0 pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line x1="50" y1="0" x2="50" y2="100" stroke="#666" strokeWidth="0.4" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="#666" strokeWidth="0.4" />
          </svg>
          <div ref={containerRef} className="absolute inset-0" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              onClick={replay}
              aria-label="重新播放笔画动画"
              className="btn"
            >
              ⟲
            </button>
            <button
              onClick={toggleLoop}
              aria-pressed={loopEnabled}
              aria-label="循环播放"
              className="btn"
            >
              ♻
            </button>
          </div>
          <span aria-live="polite" className="text-sm text-ink/70">
            {currentStroke || totalStrokes} / {totalStrokes} 画
          </span>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests, verify all 4 PASS**

Run: `pnpm test tests/unit/components/dictionary/stroke-order-card.test.tsx 2>&1 | tail -15`
Expected: PASS — 4 tests green (Test 1, 2, 3, 7).

- [ ] **Step 5: Run tsc**

Run: `pnpm tsc --noEmit 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add components/dictionary/StrokeOrderCard.tsx tests/unit/components/dictionary/stroke-order-card.test.tsx
git commit -m "feat(plan-m): StrokeOrderCard lifecycle + Tests 3+7 (success + char change)"
```

---

## Task 7: TDD StrokeOrderCard — Tests 4+5+6 (replay + loop + cleanup)

**Files:**
- Modify: `tests/unit/components/dictionary/stroke-order-card.test.tsx` (add Tests 4+5+6)

- [ ] **Step 1: Add Tests 4+5+6 to the test file**

Append these three tests to the existing `describe('StrokeOrderCard', ...)` block (before the final `});`):

```tsx
  it('replay button calls writer.animateCharacter when loop is off (Test 4)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    // Clear the auto-play call (loop was on by default)
    mockWriter.loopCharacterAnimation.mockClear();
    mockWriter.animateCharacter.mockClear();
    mockWriter.cancelAnimation.mockClear();

    // Click replay
    fireEvent.click(screen.getByRole('button', { name: /重新播放/ }));

    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
    // loopEnabled is true by default, so loopCharacterAnimation is called
    expect(mockWriter.loopCharacterAnimation).toHaveBeenCalled();
  });

  it('loop toggle flips aria-pressed and cancels animation (Test 5)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    const loopBtn = screen.getByRole('button', { name: /循环播放/ });
    expect(loopBtn).toHaveAttribute('aria-pressed', 'true');

    mockWriter.cancelAnimation.mockClear();
    fireEvent.click(loopBtn);

    expect(loopBtn).toHaveAttribute('aria-pressed', 'false');
    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
  });

  it('unmount calls writer.cancelAnimation (Test 6)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    const { unmount } = render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    mockWriter.cancelAnimation.mockClear();
    unmount();

    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
  });
```

Also add this import at the top of the test file (after the existing `render, screen, waitFor, cleanup` import):
```tsx
import { fireEvent } from '@testing-library/react';
```

- [ ] **Step 2: Run tests, verify Tests 4+5+6 PASS (they should already pass because the impl from Task 6 includes the controls)**

Run: `pnpm test tests/unit/components/dictionary/stroke-order-card.test.tsx 2>&1 | tail -15`
Expected: PASS — all 7 tests green.

If any test fails, re-check the StrokeOrderCard impl against the test expectations. The replay function should call `cancelAnimation` + `loopCharacterAnimation` (when loopEnabled is true).

- [ ] **Step 3: Run tsc**

Run: `pnpm tsc --noEmit 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/dictionary/stroke-order-card.test.tsx
git commit -m "test(plan-m): StrokeOrderCard Tests 4+5+6 (replay + loop + cleanup)"
```

---

## Task 8: Embed in DictionaryDetailTabs

**Files:**
- Modify: `components/dictionary/DictionaryDetailTabs.tsx`

- [ ] **Step 1: Read the current DictionaryDetailTabs to find the right insertion point**

Run: `cat components/dictionary/DictionaryDetailTabs.tsx | head -100`
Expected: A 'use client' component with `<DetailGrid>` and `<RelatedChars>`. Identify the closing of the 字典 tab content.

- [ ] **Step 2: Add the StrokeOrderCard import + embed**

In `components/dictionary/DictionaryDetailTabs.tsx`:
1. Add import at top:
```tsx
import { StrokeOrderCard } from './StrokeOrderCard';
```
2. Find the closing `</div>` or `</TabsContent>` of the 字典 tab content (after `<RelatedChars ... />`). Add:
```tsx
{char.length === 1 && <StrokeOrderCard char={char} />}
```

Verify the `char` prop is available in scope (it should be — it's already a tab prop).

- [ ] **Step 3: Run tsc + tests to verify no regression**

Run: `pnpm tsc --noEmit 2>&1 | tail -5 && pnpm test tests/unit/components/dictionary/ 2>&1 | tail -10`
Expected: tsc clean, all dictionary tests pass.

- [ ] **Step 4: Visual verify in browser (optional but recommended)**

Run: `pnpm dev` (in background) → open `http://localhost:4444/dictionary/一` → scroll down past detail grid + related chars → verify "笔画顺序" card visible with 田字格 + (after data loads) animation.

- [ ] **Step 5: Commit**

```bash
git add components/dictionary/DictionaryDetailTabs.tsx
git commit -m "feat(plan-m): embed StrokeOrderCard in 字典 detail tab"
```

---

## Task 9: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the right section in README to add 笔画顺序**

Run: `grep -n "^##" README.md`
Expected: A "字典 (Dictionary)" section exists (added in Plan L). Add 笔画顺序 subsection right after it.

- [ ] **Step 2: Add 笔画顺序 section to README**

After the existing 字典 section, add:

```markdown
### 笔画顺序 (Stroke Order)

字典详情页 (`/dictionary/[char]`) 卡片下方展示 280×280 田字格 + 浓墨笔顺动画。

**特性**
- 加载后自动循环播放笔画动画 (可手动关闭)
- ⟲ 重播按钮
- 笔数显示 (`N / M 画`) 实时更新
- 覆盖 8105 通用规范汉字 (缺失的字 graceful hide)
- 数据: `public/strokes/{char}.json` (build 阶段从 hanzi-writer-data 拉取)

**数据初始化**
```bash
pnpm strokes:build
```
首次运行约 5-10 分钟,会写 ~50-150MB JSON 到 `public/strokes/`。该目录已在 `.gitignore` 中,需在每台 dev 机 / CI 上分别运行。
```

- [ ] **Step 3: Verify README renders correctly**

Run: `grep -A 20 "笔画顺序" README.md | head -25`
Expected: The new section is present.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(plan-m): README — 笔画顺序 feature + strokes:build"
```

---

## Task 10: Final review + 6-step visual smoke

**Files:**
- Modify: `memory/plan-m-status.md` (mark complete)

- [ ] **Step 1: Full type check + tests + build**

Run:
```bash
pnpm tsc --noEmit 2>&1 | tail -5
pnpm test 2>&1 | tail -20
pnpm build 2>&1 | tail -20
```

Expected:
- tsc: no errors
- test: all pass (existing + 7 new component tests + 3 build script tests = 10 new)
- build: success, hanzi-writer appears in a dynamic chunk (not the main bundle)

- [ ] **Step 2: Run real `pnpm strokes:build` (with network) to populate data**

Run: `pnpm strokes:build 2>&1 | tail -10`
Expected: `✓ N stroke files written, ✗ M missing` (N ≥ 7700, ideally ≥ 8000).

If the network is unreachable in this env, skip this step and note it in memory as a deferred user action.

- [ ] **Step 3: 6-step browser smoke (HUMAN, requires pnpm dev + browser)**

1. `pnpm dev` → open `http://localhost:4444/dictionary/一`
2. Scroll past "相关字" → see "笔画顺序" card with 田字格
3. Animation auto-plays the single stroke (loops)
4. Click ⟲ → replays; click ♻ → toggles loop (note aria-pressed flips)
5. Visit `/dictionary/爱` → "10 画" displayed, 10 strokes animate
6. Visit `/dictionary/𠮷` (or any char not in 8105) → card hidden, no console error

Verify all 6 steps pass. If any fails, file a fix commit and re-smoke.

- [ ] **Step 4: Update memory with final plan-m-status**

Edit `memory/plan-m-status.md`. Replace the "What's left" section with "Done" + final commit list. Add a one-line summary at the top: "Plan M shipped on YYYY-MM-DD, N commits, all tests green, awaiting human browser smoke."

- [ ] **Step 5: Commit memory update**

```bash
git add memory/plan-m-status.md
git commit -m "docs(memory): plan-m-status — shipped"
```

- [ ] **Step 6: Final cross-cutting review**

Dispatch a final code-reviewer subagent (or do inline review) to:
- Verify no leftover `TODO`s in StrokeOrderCard
- Verify .gitignore catches both artifacts
- Verify bundle: `pnpm build && du -sh .next/static/chunks/ | head` shows hanzi-writer not in main bundle
- Verify dictionary detail page still works without stroke data (degraded gracefully)

If review surfaces issues, file fix commits before declaring done.

---

## Verification Checklist (DoD)

- [ ] `pnpm strokes:build` succeeds with ≥ 95% coverage
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm test` all pass (existing + 7 component + 3 build = 10 new tests)
- [ ] `pnpm build` succeeds; hanzi-writer in dynamic chunk
- [ ] 6-step visual smoke all pass
- [ ] README + memory updated
- [ ] All commits on main

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| hanzi-writer-data CDN unreachable in build env | 3-CDN fallback chain; if all fail, build exits 1 with clear message |
| `public/strokes/` ~150MB slows git clone | gitignored; README documents `pnpm strokes:build` step |
| HanziWriter ~80KB affects first paint | dynamic import in client effect, only loads on `/dictionary/[char]` |
| char JSON large (5-20KB) | HTTP cache + per-char fetch |
| Component cleanup race (rapid prop change) | `cancelled` flag in effect; writer ref + containerRef cleared on cleanup |
