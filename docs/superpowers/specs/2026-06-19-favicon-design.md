# Spec F1 — 字·韵 Favicon (replace Next.js default gray earth)

**Date:** 2026-06-19
**Branch:** main (project convention — no feature branch)
**Status:** design approved, awaiting implementation plan

## Context

The browser tab currently shows the Next.js default favicon (a small gray earth-like glyph, monochrome, not branded). When users open multiple tabs of the app, none of them are visually distinguishable from each other or from a stock Next.js project. The brand "字·韵" (Ziyun) has a clear visual mark already in use at the top of every page (`public/logo.png` — 370×370 PNG, brown circle with the character 字 in serif type), so the favicon slot is the only place where the brand is silent.

The existing logo is already on the page (Header.tsx imports `/logo.png` at 40×40), so users do see the brand, but only after loading the page. The favicon is the first visual contact — the tab title, the bookmark, the iOS home-screen pinned app, the browser history entry.

## Goals

1. Replace the gray earth favicon with the existing 字·韵 brand mark across all common surfaces (modern browsers, iOS, legacy browsers, PWA manifest).
2. Add a `<meta name="theme-color">` matching the brand brown so the browser chrome (URL bar, status bar on mobile) tints to brand color.
3. Ship a PWA manifest with the brand name, so "Add to Home Screen" produces a recognisable icon and title.
4. Generate the multi-size ICO from the source PNG via the already-installed `sharp@0.33.5`, so the source of truth stays as one file (`public/logo.png`).

## Non-Goals

- No new logo design. Reuse the existing `public/logo.png`.
- No logo color change. Theme color is fixed to the existing brand brown `#5A4530`.
- No offline / service-worker. PWA manifest is for the "add to home screen" affordance, not full offline.
- No animated / SVG-fancy favicon. PNG sources are sufficient and ship a smaller ICO.
- No change to `public/logo.svg` (the 32×32 placeholder created in Plan G2 Task 11 for the print header).

## Design

### 1. Source of truth

`public/logo.png` — 370×370, 8-bit RGBA, 266 KB. Already used by `components/Header.tsx` at 40×40 (desktop) and 28×28 (mobile menu). It is the brand mark.

A one-time build script (`scripts/build-favicon.ts`, run via `pnpm favicon:build`) reads `public/logo.png` with `sharp` and emits the 4 favicon files listed below. The script is idempotent — re-running it produces the same outputs.

### 2. Files created

| File | Source | Size | Purpose |
|------|--------|------|---------|
| `app/icon.png` | sharp resize from logo.png | 32×32 | Next.js App Router "icon" route — modern browser favicon. Next.js auto-injects the `<link rel="icon" type="image/png">` in `<head>`. |
| `app/apple-icon.png` | sharp resize from logo.png | 180×180 | iOS home-screen icon, Safari pinned-tab, default for "Add to Home Screen" on iOS. Next.js auto-injects `<link rel="apple-touch-icon">`. |
| `app/favicon.ico` | sharp multi-size ICO | 16+32+48 (multi) | Legacy browsers (IE, very old Chrome, some QR-code scanners). Next.js auto-injects `<link rel="icon" type="image/x-icon">`. |
| `public/favicon.ico` | same as app/favicon.ico | 16+32+48 (multi) | Belt-and-suspenders fallback for the root `/favicon.ico` path that some tools (browsers, third-party link previews, OpenGraph crawlers) probe independently of Next.js routing. The file is duplicated to `app/` AND `public/`; if a future cleanup removes the `app/` copy, the `public/` copy still works. |
| `public/manifest.json` | hand-written | ~400 B | PWA web app manifest — used by Chrome, Edge, Firefox, iOS Safari when the user "installs" the page. |

### 3. `app/layout.tsx` changes

Two new tags in `<head>`:

```tsx
<meta name="theme-color" content="#5A4530" />
<link rel="manifest" href="/manifest.json" />
```

The `theme-color` value `#5A4530` is the brown of the existing `public/logo.png` circle (verified by reading the PNG palette). The `<link rel="manifest">` is normally auto-injected by Next.js when `app/manifest.json` exists, but Next.js does not auto-create a manifest file — only the `<link>` injection. We must write the manifest ourselves and reference it via `app/manifest.json` so Next.js auto-injects the `<link>` for free, OR keep it in `public/manifest.json` and add the `<link>` manually. The latter is chosen (manifest is treated as a static asset; no need for Next.js's RSC routing).

### 4. `public/manifest.json` shape

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

- `background_color` `#FBF7EC` matches the project's paper-warm background (verified in `app/globals.css` :root tokens).
- `theme_color` `#5A4530` matches the brand brown.
- `display: "standalone"` hides browser chrome on installed-PWA launch.

### 5. `package.json` script

```json
"favicon:build": "tsx scripts/build-favicon.ts"
```

The `tsx` runner is already in the project (used by all other `scripts/*.ts` files). The script is NOT added to the `build` chain — favicons are a one-time generation, not a per-build dependency.

### 6. `scripts/build-favicon.ts` behavior

1. Read `public/logo.png` with `sharp`.
2. Generate 5 outputs into 4 destinations:
   - `app/icon.png` — 32×32 PNG
   - `app/apple-icon.png` — 180×180 PNG
   - `app/favicon.ico` — 16+32+48 multi-size ICO (sharp's `.ico()` encoder)
   - `public/favicon.ico` — same as the third output (write twice)
3. Print a one-line summary (file path + size in bytes).
4. `process.exit(0)` on success, `process.exit(1)` on error.

The script does NOT modify the source `public/logo.png`. Idempotent — re-running produces the same outputs.

### 7. `.gitignore` impact

None. All 5 generated files are committed. There is no transient state.

## Constraints

- **No new dependency.** `sharp@0.33.5` is already in the project.
- **No logo color change.** Reuse the existing `#5A4530` brown.
- **Source of truth is one file** (`public/logo.png`). The 5 outputs are derived.
- **`pnpm build` must not require `pnpm favicon:build`** — the favicon files are committed, so a clean clone has them. The build script is for regenerating after logo changes.
- **No browser chrome overrides** beyond `theme-color`. We do not add a `mask-icon` (Safari pinned tab monochrome) in this spec; can be added later if needed.
- **No service worker.** PWA install affordance only.
- **No iOS splash screens.** Out of scope.

## Open questions

None at spec time. The design was iterated with the user across 3 questions:
1. "Is the Logo really missing?" — clarification revealed it's the favicon slot, not the header
2. "Which asset?" — user picked `/logo.png` (the 370×370 source)
3. "How many files?" — user picked the full PWA-ready set

## Out of scope (deferred)

- `mask-icon` for Safari pinned tab (would need a separate monochrome SVG)
- iOS splash screens (`apple-touch-startup-image`)
- Service worker for full PWA offline support
- Theme-color dark variant (`<meta name="theme-color" media="(prefers-color-scheme: dark)" ...>`)
- A redesigned / multi-character mark (e.g. 字·韵 combined)
