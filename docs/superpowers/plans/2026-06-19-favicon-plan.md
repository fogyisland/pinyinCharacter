# 字·韵 Favicon (replace Next.js default gray earth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Next.js default gray-earth favicon with the existing `/public/logo.png` brand mark across modern browsers, iOS, legacy browsers, and the PWA manifest, plus a brand-brown `theme-color` meta tag.

**Architecture:** A one-time `sharp`-based build script (`scripts/build-favicon.ts`) reads the 370×370 source PNG and emits 4 derived image files (32×32 PNG, 180×180 PNG, multi-size ICO at `app/`, and a duplicate ICO at `public/`). The PWA manifest is hand-written as a static JSON. The root layout gets two new `<head>` tags (theme-color + manifest link). All 5 files are committed; the build script is for regeneration only — not part of the Next.js build chain.

**Tech Stack:** Next.js 15 App Router, TypeScript, `sharp@0.33.5` (already in deps), `tsx` (already in deps), vitest + @testing-library/react (for layout render test).

## Global Constraints

- **No new dependency.** `sharp@0.33.5` is already in `package.json`. `tsx` is already available. Do NOT add any new package.
- **No logo color change.** Brand brown is `#5A4530` (verified from `public/logo.png`); paper background is `#FBF7EC` (verified from `app/globals.css` :root tokens).
- **Source of truth is one file** (`public/logo.png`). All 4 image outputs are derived from it.
- **`pnpm build` must NOT require `pnpm favicon:build`.** All 4 image files + manifest are committed. Clean clone must build green.
- **Project convention: main branch, no feature branch.** Commit directly to main.
- **Dev server pinned to port 4444** (from `package.json`). Never run `pnpm build` while `pnpm dev` is alive on 4444 (corrupts `.next/`, browser 404s on all chunks).
- **File encoding:** LF in source, but `git config core.autocrlf` may rewrite on Windows; this is fine.
- **One commit per task** (4 commits total + 1 verification commit = 4 actual commits; verification has no commit).
- **Chinese labels in `manifest.json`:** `name` = `字·韵`, `short_name` = `字·韵`, `description` = `公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。`

---

### Task 1: Build script + npm script

**Files:**
- Create: `scripts/build-favicon.ts`
- Modify: `package.json` (add `favicon:build` script)
- Test: `tests/unit/scripts/build-favicon.test.ts` (NOT a unit test — an integration test that runs the script and asserts the 4 output files exist with non-zero size)

**Interfaces:**
- Consumes: `public/logo.png` (370×370, RGBA, 266 KB). Must exist already.
- Produces: 4 image files written to disk:
  - `app/icon.png` — 32×32 PNG
  - `app/apple-icon.png` — 180×180 PNG
  - `app/favicon.ico` — multi-size ICO (16+32+48)
  - `public/favicon.ico` — same bytes as `app/favicon.ico` (write the buffer twice)
- No exported functions — the script is invoked via `tsx scripts/build-favicon.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scripts/build-favicon.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const OUTPUTS = [
  'app/icon.png',
  'app/apple-icon.png',
  'app/favicon.ico',
  'public/favicon.ico',
];

describe('scripts/build-favicon.ts', () => {
  beforeAll(() => {
    // Clean any prior outputs to ensure a fresh run
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      if (existsSync(p)) rmSync(p);
    }
  });

  afterAll(() => {
    // Clean up so this test does not pollute the working tree
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      if (existsSync(p)) rmSync(p);
    }
  });

  it('produces 4 favicon files at expected paths with non-zero size', () => {
    execSync('pnpm favicon:build', { cwd: ROOT, stdio: 'pipe' });
    for (const f of OUTPUTS) {
      const p = resolve(ROOT, f);
      expect(existsSync(p), `${f} should exist after build`).toBe(true);
      expect(statSync(p).size, `${f} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('favicon.ico bytes are identical at app/ and public/ paths', () => {
    const a = statSync(resolve(ROOT, 'app/favicon.ico')).size;
    const b = statSync(resolve(ROOT, 'public/favicon.ico')).size;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/scripts/build-favicon.test.ts`
Expected: FAIL — the script `scripts/build-favicon.ts` does not exist, so `pnpm favicon:build` fails with "script not found".

- [ ] **Step 3: Add the npm script to `package.json`**

Open `package.json`. In the `"scripts"` block, add a new entry (place it after the `fonts:*` block, before any other unrelated entry):

```json
"favicon:build": "tsx scripts/build-favicon.ts"
```

- [ ] **Step 4: Run test to confirm it still fails (now with a different error)**

Run: `pnpm test tests/unit/scripts/build-favicon.test.ts`
Expected: FAIL — the script file still doesn't exist; `pnpm favicon:build` now resolves but errors with "Cannot find module scripts/build-favicon.ts".

- [ ] **Step 5: Write the build script**

Create `scripts/build-favicon.ts`:

```ts
/**
 * build-favicon.ts
 *
 * Plan F1 — generates favicon files from the source /public/logo.png.
 * Outputs:
 *   app/icon.png         (32x32)
 *   app/apple-icon.png   (180x180)
 *   app/favicon.ico      (16+32+48 multi-size)
 *   public/favicon.ico   (same bytes as app/favicon.ico)
 *
 * Run: pnpm favicon:build
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/logo.png');

async function main() {
  const buf = readFileSync(SOURCE);
  const img = sharp(buf);

  const icon32 = await img.clone().resize(32, 32).png().toBuffer();
  const apple180 = await img.clone().resize(180, 180).png().toBuffer();
  const ico = await img.clone()
    .resize(256, 256) // sharp's .ico() requires a square >= 256 first
    .ico()
    .toBuffer();

  const dests = [
    { path: 'app/icon.png', data: icon32 },
    { path: 'app/apple-icon.png', data: apple180 },
    { path: 'app/favicon.ico', data: ico },
    { path: 'public/favicon.ico', data: ico },
  ];

  for (const d of dests) {
    const p = resolve(ROOT, d.path);
    writeFileSync(p, d.data);
    const kb = (statSync(p).size / 1024).toFixed(1);
    console.log(`[favicon] OK   ${d.path}  (${kb} KB)`);
  }
  console.log(`[favicon] done. ${dests.length} files written.`);
}

main().catch((err) => {
  console.error('[favicon] FAIL', err);
  process.exit(1);
});
```

- [ ] **Step 6: Run the build script directly to confirm it works**

Run: `pnpm favicon:build`
Expected: 4 lines of `[favicon] OK  <path>  (<size> KB)` + a `done. 4 files written.` line. Verify all 4 files exist.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test tests/unit/scripts/build-favicon.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 8: Run full test suite to ensure no regression**

Run: `pnpm test`
Expected: all green (the 1 pre-existing `etymology.test.ts` fail is unrelated and expected).

- [ ] **Step 9: Commit**

```bash
git add scripts/build-favicon.ts tests/unit/scripts/build-favicon.test.ts package.json app/icon.png app/apple-icon.png app/favicon.ico public/favicon.ico
git commit -m "feat(favicon): 字·韵 favicon build script (sharp from logo.png)"
```

---

### Task 2: PWA manifest `public/manifest.json`

**Files:**
- Create: `public/manifest.json`
- Test: `tests/unit/public/manifest.test.ts` (validates the JSON file has the required fields and types)

**Interfaces:**
- Consumes: hand-written JSON
- Produces: `public/manifest.json` referenced by the `<link rel="manifest">` in `app/layout.tsx` (added in Task 3)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/public/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const PATH = resolve(ROOT, 'public/manifest.json');

describe('public/manifest.json (F1)', () => {
  const manifest = JSON.parse(readFileSync(PATH, 'utf8'));

  it('has the required name and short_name', () => {
    expect(manifest.name).toBe('字·韵');
    expect(manifest.short_name).toBe('字·韵');
  });

  it('has the brand theme_color and paper background_color', () => {
    expect(manifest.theme_color).toBe('#5A4530');
    expect(manifest.background_color).toBe('#FBF7EC');
  });

  it('has a 32x32 icon entry pointing at /icon.png', () => {
    const i32 = manifest.icons.find((i: any) => i.sizes === '32x32');
    expect(i32).toBeDefined();
    expect(i32.src).toBe('/icon.png');
    expect(i32.type).toBe('image/png');
  });

  it('has a 180x180 apple icon entry', () => {
    const i180 = manifest.icons.find((i: any) => i.sizes === '180x180');
    expect(i180).toBeDefined();
    expect(i180.src).toBe('/apple-icon.png');
    expect(i180.type).toBe('image/png');
  });

  it('display is "standalone" and start_url is "/"', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/public/manifest.test.ts`
Expected: FAIL — `public/manifest.json` does not exist; `readFileSync` throws ENOENT.

- [ ] **Step 3: Write the manifest**

Create `public/manifest.json`:

```json
{
  "name": "字·韵",
  "short_name": "字·韵",
  "description": "公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FBF7EC",
  "theme_color": "#5A4530",
  "icons": [
    { "src": "/icon.png", "sizes": "32x32", "type": "image/png" },
    { "src": "/apple-icon.png", "sizes": "180x180", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/public/manifest.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all green (1 pre-existing `etymology.test.ts` fail is unrelated and expected).

- [ ] **Step 6: Commit**

```bash
git add public/manifest.json tests/unit/public/manifest.test.ts
git commit -m "feat(favicon): PWA manifest (name=字·韵, theme=#5A4530)"
```

---

### Task 3: `app/layout.tsx` — add theme-color + manifest link

**Files:**
- Modify: `app/layout.tsx` (add 2 lines inside the `<head>` block)
- Test: `tests/unit/app/layout.test.tsx` (renders RootLayout and asserts the 2 new tags exist in the rendered `<head>`)

**Interfaces:**
- Consumes: existing `app/layout.tsx` (already imports `globals.css`, `AuthSync`, `ToastViewport`, and exports `metadata`)
- Produces: 2 new tags inside `<head>`:
  - `<meta name="theme-color" content="#5A4530" />`
  - `<link rel="manifest" href="/manifest.json" />`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/layout.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RootLayout from '@/app/layout';

describe('RootLayout (F1 favicon)', () => {
  it('renders <meta name="theme-color" content="#5A4530"> in <head>', () => {
    const { container } = render(
      <RootLayout>
        <div data-testid="child">x</div>
      </RootLayout>,
    );
    const meta = container.querySelector('meta[name="theme-color"]');
    expect(meta).toBeInTheDocument();
    expect(meta?.getAttribute('content')).toBe('#5A4530');
  });

  it('renders <link rel="manifest" href="/manifest.json"> in <head>', () => {
    const { container } = render(
      <RootLayout>
        <div>x</div>
      </RootLayout>,
    );
    const link = container.querySelector('link[rel="manifest"]');
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute('href')).toBe('/manifest.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/app/layout.test.tsx`
Expected: FAIL — neither `<meta name="theme-color">` nor `<link rel="manifest">` exists yet.

- [ ] **Step 3: Edit `app/layout.tsx`**

Read `app/layout.tsx`. Inside the `<head>` block (after the existing `<link rel="stylesheet" href="/font/fonts.css" />`), add 2 lines:

```tsx
<head>
  <link rel="stylesheet" href="/font/fonts.css" />
  <meta name="theme-color" content="#5A4530" />
  <link rel="manifest" href="/manifest.json" />
</head>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/app/layout.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all green (1 pre-existing `etymology.test.ts` fail is unrelated and expected).

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx tests/unit/app/layout.test.tsx
git commit -m "feat(favicon): theme-color #5A4530 + manifest link in root layout"
```

---

### Task 4: Final verification (tsc + build)

**Files:** (no changes — verification only)

- [ ] **Step 1: Run TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 2: Kill any running dev server before build**

Run: `cmd.exe //c "netstat -ano | findstr :4444"` (Windows Git Bash) or `lsof -ti:4444` (Unix).
Expected: an empty output OR a `next dev` PID. If a PID is found, kill it: `cmd.exe //c "taskkill /F /PID <pid>"` (Windows) or `kill <pid>` (Unix).

- [ ] **Step 3: Run production build**

Run: `pnpm build`
Expected: build succeeds. Verify the favicon files end up in `.next/`'s build manifest (Next.js will copy `app/icon.png` and `app/apple-icon.png` into the build output automatically).

- [ ] **Step 4: Manual browser smoke (for the human, not automated)**

Document these in the final summary message:

1. Start dev: `pnpm dev` (port 4444).
2. Visit `http://localhost:4444/`.
3. **Tab favicon**: open the tab in a Chrome/Firefox window, check that the tab title `字·韵 — 汉字与拼音互转` shows a brown circular favicon (not the gray earth).
4. **iOS install** (skip if no iOS device): Safari → Share → Add to Home Screen; the new app icon should be the brown circle, not a gray earth.
5. **PWA manifest**: in Chrome, open DevTools → Application → Manifest; verify `name` = `字·韵`, `theme_color` = `#5A4530`, `background_color` = `#FBF7EC`, and 2 icons listed.
6. **theme-color** (mobile or Chrome responsive mode): the browser chrome (URL bar / status bar) should tint to brown.

**No commit** (verification only).

---

## Self-Review (post-write)

- **Spec coverage:**
  - §2 "5 file outputs" — Task 1 produces 4 image files; Task 2 produces manifest = 5 files total ✓
  - §3 "app/layout.tsx" theme-color + manifest link — Task 3 ✓
  - §4 "manifest.json shape" — Task 2 ✓
  - §5 "package.json script" — Task 1 Step 3 ✓
  - §6 "build script behavior" — Task 1 Step 5 ✓
  - §7 "no .gitignore impact" — verified, no entries needed
- **Placeholder scan:** No "TBD"/"TODO"/"later"/"implement later" in any task. Every step has concrete code or a run command.
- **Type consistency:** `sharp` import shape (`import sharp from 'sharp'`) used identically in script and tests. File paths (`app/icon.png`, etc.) used identically in all 4 tasks.
- **sharp API used:** `sharp(buf).clone().resize(w, h).png().toBuffer()` and `.ico().toBuffer()`. The `.ico()` encoder requires a square ≥256 first, so we resize to 256 before calling `.ico()` — this is the canonical sharp pattern and embeds multiple sizes inside the single ICO.
- **Test discipline:** TDD on every file-producing task (build script test, manifest test, layout test). Verification only at the end.
- **Commit discipline:** 1 commit per task. Verification has no commit.
- **No new dep:** `sharp@0.33.5` is already there (verified in package.json before this plan was written). `tsx` is already there. No install step.
- **Dev/build conflict:** Task 4 Step 2 explicitly handles killing the dev server (memory note).
- **Order of tasks:** Task 1 first (produces the icon files referenced by Task 2's manifest and Task 3's link), Task 2 second, Task 3 third, Task 4 verifies all together.
