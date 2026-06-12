# Plan E visual redesign — automated smoke notes (2026-06-12)

**Status:** ✅ All 31 tasks complete, build green, tests green, no regressions.

## Verification done (automated, no manual browser)

- **Unit tests:** 116 passed, 38 skipped (154) — same as pre-Plan E baseline
- **Typecheck:** `pnpm exec tsc --noEmit` — exit 0
- **Build:** `pnpm build` — 19 static pages, all routes listed, exit 0
- **HTTP checks (port 3000):**
  - `/` → 200 (62 KB HTML, all design tokens present)
  - `/rare-chars` → 200
  - `/rare-chars/[char]` → 200 (story block has `border-l-4 border-seal` applied)
  - `/worksheet` → 200
  - `/worksheet/history` → 307 (auth redirect, expected)
  - `/game` → 200
  - `/404` (via /nonexistent) → 404 (not-found.tsx rendered with 「无」 + 「404」 stamp)
  - `/profile` → 307 (auth redirect, expected)
  - `/history` → 307 (auth redirect, expected)
  - `/admin` → 307 (admin auth redirect, expected)
  - `/forgot-password` → 200
  - `/reset-password` → 200

## Design token coverage (verified by HTML grep)

- `font-kai` ✓ (all pages use 文楷 for titles)
- `bg-paper`, `bg-paper-soft`, `bg-paper-deep` ✓ (paper background)
- `bg-ink`, `bg-seal`, `text-ink`, `text-ink-soft`, `text-ink-faint` ✓ (ink + seal)
- `btn-seal`, `btn-ghost` ✓ (paper-themed CTAs)
- `card-paper` ✓ (BentoGrid + admin + auth)
- `paper-rule` ✓ (section dividers)
- `stamp` ✓ (404 + error pages)
- `shadow-paper-md`, `shadow-paper-lg` ✓ (Header, mobile drawer)

## Fixes applied during implementation (beyond spec)

- `cc44082` — Replaced invented tokens (`bg-ink-primary`, `bg-ink-deep`, `text-paper-base`) in worksheet history with `btn-seal`
- `88eab76` — Wrapped `useSearchParams()` in Suspense in Header (build was failing because not-found.tsx includes Header)

## Pending: human UI smoke (Task 31 second half)

The automated smoke verifies the structural/functional side. The **visual** side needs human eyes:

- Do the fonts actually render correctly (LXGW WenKai TC vs SC overlap — does TC look OK for mainland audience?)
- Does the 米黄 background feel right, not too yellow?
- Is the 「字·韵」 brand mark legible at all sizes?
- Does the stamp rotated text (404 / 500) look intentional?
- Do the BentoGrid cards have the right visual weight?
- Does the mobile drawer (hamburger) feel right at 375px?

Open `http://localhost:3000` in a browser and click through:
1. Home (Hero + Bento + ValueProps + TextToPinyin)
2. /rare-chars (search + list)
3. /worksheet (form + preview)
4. /game
5. /nonexistent (404)
6. Click "登录" → AuthModal (test login flow)
7. After login: /profile + /history
8. Set viewport to 375px (DevTools) and check mobile

## What's NOT covered in the smoke

- Dark mode (explicitly out of scope per spec §12)
- Lighthouse score (out of scope per spec §12)
- Real mobile device (curl with iPhone UA only confirms response, not UX)
- A11y audit (color contrast, keyboard nav) — not required for v1
- LXGW WenKai SC: Google Fonts only has TC variant; SC chars still render but kerning may differ from spec mockup

## Next steps

1. Human browser smoke (above checklist)
2. If any visual issues, follow-up commit per fix
3. Update Plan E memory file with final state
4. Decide on follow-up work (logo, dark mode, more pages) — out of scope for v1
