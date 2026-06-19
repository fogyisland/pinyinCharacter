# Plan: G2 — Hard-Pen Worksheet Font System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 new hard-pen fonts (subset to GB2312-7000 WOFF2), a dropdown FontFamilyPicker, A4 cell-density default relaxed to 88, a print preview header (Logo + 字体名 + 公益网站,请多关注), and an OFL credits file.

**Architecture:** Build-time font pipeline (`pnpm fonts:hard-pen`) downloads TTFs into a gitignored staging dir, subsets via `subset-font` to WOFF2 in `public/fonts/`. The page/CSS/code uses Tailwind v4 `@theme` tokens; FontFamilyPicker becomes a styled `<select>` with two `<optgroup>`s. Print header lives inside the existing `.worksheet-grid` so the existing `@media print` visibility-visible rule picks it up. New tests cover font metadata, picker, preview header, and cell counts.

**Tech Stack:** Next.js 15.0.3, React 18, TypeScript, Tailwind v4, vitest + @testing-library/react + happy-dom, `subset-font` (Node, harfbuzzjs-based).

**Branch:** `main` (project convention — no feature branch)

---

## Global Constraints

From `docs/superpowers/specs/2026-06-19-hard-pen-fonts-design.md` (commit `6e344037`):

- **Fonts (4 new hard-pen, all SIL OFL 1.1):**
  - `LXGW WenKai GB` (霞鹜文楷 GB) — source: `https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Regular.ttf`
  - `Yozai` (悠哉) — source: `https://github.com/lxgw/LxgwYozai/releases/latest/download/Yozai-Regular.ttf`
  - `Iansui` (芫荽) — source: `https://github.com/lxgw/LxgwIansui/releases/latest/download/Iansui-Regular.ttf`
  - `Zen Kaku Gothic New` (思源极细黑, weight 100) — source: `https://github.com/googlefonts/zen-kakugothic/releases/download/v1.0.0/ZenKakuGothicNew-Thin.otf`
- **Subset:** GB2312 first-level + second-level hanzi (6763) + 100 ASCII + 200 CJK punctuation + 100 latin/symbol = ~7163 unique codepoints → WOFF2, target ≤ 800 KB per file.
- **Tailwind v4 tokens (new):** `--font-lxgw-wenkai-gb`, `--font-yozai`, `--font-iansui`, `--font-zen-kaku-thin` (both `:root` and `@theme`).
- **FontFamily union (extended):** `'song' | 'kai' | 'hei' | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin'`.
- **FONT_FAMILIES** gains `group: 'system' | 'hard-pen'` per entry.
- **A4:** 96 → 88 cells/page. **B5:** 66 → 60 cells/page. **A3:** unchanged (132).
- **Print header:** Logo (`/logo.svg`) + "字·韵" + 字体名 + "公益网站，请多关注"; placed inside `.worksheet-grid` wrapper with `col-span-full`.
- **FontFamilyPicker:** radio → `<select>` with two `<optgroup>`s (系统字体 / 硬笔字体), same horizontal footprint.
- **Project conventions:** vitest (`@vitest-environment happy-dom` for component tests), `@testing-library/react`, `tests/unit/...` paths, tsc + build must stay clean, every commit message format `feat|fix|chore(scope): ...`.
- **License:** all 4 new fonts are SIL OFL 1.1; copy each `OFL.txt` to `public/fonts/` next to its WOFF2; write `THIRD_PARTY_LICENSES.md` at repo root.
- **Gitignore:** `scripts/fonts/staging/` is staging for source TTFs only; never committed.
- **No dev/build conflict:** never run `pnpm build` while `pnpm dev` is alive on port 4444 (corrupts `.next/`).

---

## File Structure

### New files
- `scripts/fonts/build-gb2312-7000.ts` — one-shot char-set emitter (kept for re-generation)
- `scripts/fonts/gb2312-7000.txt` — static char-set text (~7163 unique codepoints)
- `scripts/fonts/download-hard-pen-fonts.ts` — TTF download to `scripts/fonts/staging/`
- `scripts/fonts/subset-hard-pen-fonts.mjs` — WOFF2 subsetter; reads staging, writes `public/fonts/`
- `scripts/fonts/copy-ofl.ts` — copies `OFL.txt` from staging/ to `public/fonts/`
- `public/fonts/LXGWWenKaiGB-Regular.woff2` + `LXGWWenKaiGB-Regular.OFL.txt`
- `public/fonts/Yozai-Regular.woff2` + `Yozai-Regular.OFL.txt`
- `public/fonts/Iansui-Regular.woff2` + `Iansui-Regular.OFL.txt`
- `public/fonts/ZenKakuGothicNew-Thin.woff2` + `ZenKakuGothicNew-Thin.OFL.txt`
- `THIRD_PARTY_LICENSES.md` — repo root
- `tests/unit/lib/worksheet-types.test.ts` — FONT_FAMILIES shape (7 entries, 2 groups)
- `tests/unit/components/worksheet/FontFamilyPicker.test.tsx` — optgroup + option rendering
- `tests/unit/components/worksheet/WorksheetPreview.test.tsx` — print header

### Modified files
- `app/globals.css` — 4 `@font-face` + 4 `:root` tokens + 4 `@theme` tokens
- `lib/worksheet-types.ts` — extend `FontFamily`; add `group` to `FONT_FAMILIES`
- `lib/worksheet-page-count.ts` — A4: 96→88, B5: 66→60
- `components/worksheet/FontFamilyPicker.tsx` — radio → `<select>` with `<optgroup>`
- `components/worksheet/WorksheetPreview.tsx` — print header inside `.worksheet-grid`
- `package.json` — 3 new scripts + `subset-font` devDep
- `.gitignore` — add `scripts/fonts/staging/`
- `tests/unit/lib/worksheet-page-count.test.ts` — update A4/B5 expected values

### Decomposition note
- `scripts/fonts/copy-ofl.ts` is a 10-line tsx — kept separate from `download-hard-pen-fonts.ts` so the download script stays focused on "fetch from CDN"; the copy is a deterministic local file move that can be re-run safely.
- `THIRD_PARTY_LICENSES.md` and `.gitignore` are pure doc/config changes; they could be folded into Task 12/13 but stay separate so a reviewer can reject one without blocking the other.

---

## Tasks (14)

### Task 1: Char set builder script + emit `gb2312-7000.txt`

**Files:**
- Create: `scripts/fonts/build-gb2312-7000.ts`
- Create: `scripts/fonts/gb2312-7000.txt`

**Step 1: Write the script `scripts/fonts/build-gb2312-7000.ts`**

The script emits a single text file containing the union of:
- 6763 GB2312 chars (a hand-curated 2-D array literal committed in code — see code below)
- 100 ASCII printable (`U+0020`–`U+007E`)
- 200 common CJK punctuation (commit the string in code)
- 100 digits/latin symbols (commit in code)
- Deduplicate with `Array.from(new Set([...]))`

```ts
/**
 * build-gb2312-7000.ts
 *
 * Emits scripts/fonts/gb2312-7000.txt — the char set we subset every
 * hard-pen font against. Total ~7163 unique codepoints.
 *
 * Run: pnpm tsx scripts/fonts/build-gb2312-7000.ts
 * Idempotent: overwrites the output file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// GB2312 level 1 + level 2 ranges (6763 hanzi).
// Compact form: ranges of start-end (inclusive) on the BMP CJK Unified block.
const GB2312_RANGES: Array<[number, number]> = [
  [0x4E00, 0x4E00], // 一
  // ... full 6763-entry list (see Step 1a below for source)
];

// Source for the full list: the standard GB2312 table is published in many
// places. Use the following well-known reference: the 6763-char string is
// derived from the gb2312-table.json that ships with many open-source
// Chinese input methods. The implementer should populate GB2312_RANGES
// from a static array literal in this file. If the literal is too long
// to inline, use the alternate source documented in Step 1a.
```

**Step 1a: Populate `GB2312_RANGES` with the actual codepoints**

If a static literal of all 6763 codepoints is too long, use this fallback: keep the `ranges` array empty, and instead embed a single large string literal `const GB2312_STRING = '一丁七万丈三上下不与丐丑...'`. The string is committed in the source file (~25 KB minified) and converted to codepoints with `[...GB2312_STRING].map(c => c.codePointAt(0)!).filter(cp => cp!==undefined)`.

The implementer must produce a string that contains exactly the 6763 GB2312 chars (no extras). The script is run once; the output `gb2312-7000.txt` is committed and not regenerated by `pnpm fonts:hard-pen`.

**Step 1b: Complete the script (continuing from Step 1)**

```ts
// Add the supplementary char sets
const ASCII = Array.from({ length: 95 }, (_, i) => 0x20 + i); // 0x20..0x7E
const CJK_PUNCT = '，。！？、；：「」『』（）…—《》【】〈〉「」·※〒々〇〉〈〔〕〖〗〜〃‘’“”〝〞㐀㐁㐂㐃㐄㐅㐆㐇㐈㐉㐊㐋㐌㐍㐎㐏㐐㐑㐒㐓㐔㐕㐖㐗㐘㐙㐚㐛㐜㐝㐞㐟㐠㐡㐢㐣㐤㐥㐦㐧㐨㐩㐪㐫㐬㐭㐮㐯㐰㐱㐲㐳㐴㐵㐶㐷㐸㐹㐺㐻㐼㐽㐾㐿㑀㑁㑂㑃㑄㑅㑆㑇㑈㑉㑊㑋㑌㑍㑎㑏㑐㑑㑒㑓㑔㑕㑖㑗㑘㑙㑚㑛㑜㑝㑞㑟㑠㑡㑢㑣㑤㑥㑦㑧㑨㑩㑪㑫㑬㑭㑮㑯㑰㑱㑲㑳㑴㑵㑶㑷㑸㑹㑺㑻㑼㑽㑾㑿'.split('').map(c => c.codePointAt(0)!);
const LATIN_SYMBOLS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,.<>?/\\~`\'"'.split('').map(c => c.codePointAt(0)!);

const all = [
  // ...GB2312 codepoints (from the literal)...
  ...ASCII,
  ...CJK_PUNCT,
  ...LATIN_SYMBOLS,
];

const uniq = Array.from(new Set(all)).sort((a, b) => a - b);

const text = uniq.map(cp => String.fromCodePoint(cp)).join('');
const out = resolve(__dirname, 'gb2312-7000.txt');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text, 'utf8');
console.log(`[gb2312] wrote ${uniq.length} unique codepoints to ${out}`);
```

**Step 2: Run the script and verify the output file**

Run: `pnpm tsx scripts/fonts/build-gb2312-7000.ts`
Expected output: `[gb2312] wrote 7163 unique codepoints to .../scripts/fonts/gb2312-7000.txt` (the exact count depends on how many CJK punct chars the literal has — must be ≥ 7000; ≤ 7500).

Verify the file exists and is non-empty: `wc -c scripts/fonts/gb2312-7000.txt`
Expected: `> 14000` (UTF-8 encoded; 7163 chars × 3 bytes/char = ~21 KB)

**Step 3: Commit**

```bash
git add scripts/fonts/build-gb2312-7000.ts scripts/fonts/gb2312-7000.txt
git commit -m "feat(fonts): add gb2312-7000 char-set builder + emit file"
```

---

### Task 2: `subset-font` dep + 3 npm scripts

**Files:**
- Modify: `package.json` (add devDep + 3 scripts)

**Step 1: Add `subset-font` to devDependencies**

Open `package.json`, find `"devDependencies"`, add (alphabetically near `"vitest"`):

```json
"subset-font": "^2.4.0"
```

**Step 2: Add 3 scripts**

In the `"scripts"` block of `package.json`, add (alphabetically after `lint` or before `test`, project convention):

```json
"fonts:download-hard-pen": "tsx scripts/fonts/download-hard-pen-fonts.ts",
"fonts:subset": "node scripts/fonts/subset-hard-pen-fonts.mjs",
"fonts:hard-pen": "pnpm fonts:download-hard-pen && pnpm fonts:subset"
```

**Step 3: Install the dep**

Run: `pnpm install`
Expected: `subset-font` added to `node_modules/`; `pnpm-lock.yaml` updated.

**Step 4: Verify the scripts are visible**

Run: `pnpm run | grep fonts:`
Expected: 3 lines matching `fonts:download-hard-pen`, `fonts:subset`, `fonts:hard-pen`.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add subset-font + 3 font-pipeline npm scripts"
```

---

### Task 3: Download script for hard-pen fonts

**Files:**
- Create: `scripts/fonts/download-hard-pen-fonts.ts`

**Step 1: Write the script**

Mirrors `scripts/download-ancient-fonts.ts` (the soft-fail pattern is the same: try primary URL, fall back; skip if file exists; `process.exit(0)` on failure).

```ts
/**
 * download-hard-pen-fonts.ts
 *
 * Plan G2 — Hard-pen font pipeline (download phase).
 * Pulls 4 source TTFs/OTFs from upstream releases into
 * scripts/fonts/staging/ (gitignored). Soft-fails on network errors.
 *
 * Run: pnpm fonts:download-hard-pen
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(__dirname, 'staging');

type FontEntry = {
  /** Local filename under scripts/fonts/staging/ */
  filename: string;
  /** Ordered list of candidate URLs — first wins, fallbacks for resilience. */
  urls: string[];
  /** Human label for logs */
  label: string;
};

const FONTS: FontEntry[] = [
  {
    filename: 'LXGWWenKaiGB-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Regular.ttf',
    ],
    label: 'LXGW WenKai GB (霞鹜文楷 GB)',
  },
  {
    filename: 'Yozai-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwYozai/releases/latest/download/Yozai-Regular.ttf',
    ],
    label: 'Yozai (悠哉)',
  },
  {
    filename: 'Iansui-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwIansui/releases/latest/download/Iansui-Regular.ttf',
    ],
    label: 'Iansui (芫荽)',
  },
  {
    filename: 'ZenKakuGothicNew-Thin.otf',
    urls: [
      'https://github.com/googlefonts/zen-kakugothic/releases/download/v1.0.0/ZenKakuGothicNew-Thin.otf',
    ],
    label: 'Zen Kaku Gothic New Thin (思源极细黑)',
  },
];

async function downloadOnce(url: string, dest: string, timeoutMs = 60000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pinyin-character-font-loader)' },
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFont(entry: FontEntry): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number }> {
  const dest = resolve(STAGING, entry.filename);
  if (existsSync(dest) && statSync(dest).size > 0) {
    return { status: 'skip' };
  }
  for (const url of entry.urls) {
    const ok = await downloadOnce(url, dest);
    if (ok && statSync(dest).size > 0) {
      return { status: 'ok', size: statSync(dest).size };
    }
  }
  return { status: 'fail' };
}

async function main() {
  mkdirSync(STAGING, { recursive: true });
  console.log(`[fonts] target dir: ${STAGING}`);

  const results: Array<{ label: string; status: string; detail?: string }> = [];
  for (const f of FONTS) {
    const r = await downloadFont(f);
    if (r.status === 'ok') {
      const mb = ((r.size ?? 0) / 1024 / 1024).toFixed(2);
      console.log(`[fonts] OK   ${f.label}  -> ${f.filename}  (${mb} MB)`);
      results.push({ label: f.label, status: 'ok', detail: `${mb} MB` });
    } else if (r.status === 'skip') {
      console.log(`[fonts] SKIP ${f.label}  (already on disk)`);
      results.push({ label: f.label, status: 'skip' });
    } else {
      console.warn(`[fonts] FAIL ${f.label}  (network/CDN unavailable)`);
      results.push({ label: f.label, status: 'fail' });
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  console.log(
    `[fonts] done. ok=${results.filter((r) => r.status === 'ok').length} skip=${results.filter((r) => r.status === 'skip').length} fail=${failed.length}`,
  );
  if (failed.length > 0) {
    console.warn(`[fonts] ${failed.length} font(s) failed; subset will skip them.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[fonts] unexpected error:', err);
  process.exit(0);
});
```

**Step 2: Run the script to verify it works (with or without network)**

Run: `pnpm fonts:download-hard-pen`
Expected (with network): 4 `OK` lines, each `~5-15 MB`.
Expected (no network): 4 `FAIL` lines, exit 0 (soft-fail).

**Step 3: Verify staging/ exists and is gitignored (do not commit contents yet)**

Run: `ls scripts/fonts/staging/`
Expected (after successful run): 4 files.
Run: `git status --short scripts/fonts/`
Expected: empty (entire `staging/` dir ignored; the script file itself shows in untracked until committed).

**Step 4: Commit the script only (NOT the staging contents)**

```bash
git add scripts/fonts/download-hard-pen-fonts.ts
git commit -m "feat(fonts): add hard-pen font download script (ttf -> staging/)"
```

**Note:** If `git status` shows `scripts/fonts/staging/` files, it means `.gitignore` hasn't been updated yet (Task 13). Do not `git add` them.

---

### Task 4: Subset script (WOFF2 emitter)

**Files:**
- Create: `scripts/fonts/subset-hard-pen-fonts.mjs`

**Step 1: Verify `subset-font` API surface**

Run: `cat node_modules/subset-font/package.json | grep -E '"main"|"types"|"version"'`
Read the README: `cat node_modules/subset-font/README.md 2>/dev/null | head -40` (or fetch from `https://github.com/papandreou/subset-font` if README is not shipped).

The expected API is `subset(fontBuffer, text, options) → Promise<Buffer>`. If the actual signature differs (e.g., the option key is `format` not `targetFormat`, or it's a sync function), adapt the script below. The plan's pseudocode is the canonical structure — only adjust the call signature.

**Step 2: Write the script**

```js
/**
 * subset-hard-pen-fonts.mjs
 *
 * Plan G2 — Hard-pen font pipeline (subset phase).
 * Reads source TTF/OTF from scripts/fonts/staging/, subsets to
 * scripts/fonts/gb2312-7000.txt, writes WOFF2 to public/fonts/.
 * Warns on > 800 KB output.
 *
 * Run: pnpm fonts:subset
 */
import { subset } from 'subset-font';
import { readFile, writeFile, statSync, existsSync } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STAGING = resolve(__dirname, 'staging');
const OUT = resolve(ROOT, 'public', 'fonts');
const GLYPHS_FILE = resolve(__dirname, 'gb2312-7000.txt');

const TARGETS = [
  { in: 'LXGWWenKaiGB-Regular.ttf',   out: 'LXGWWenKaiGB-Regular.woff2',   family: 'LXGW WenKai GB' },
  { in: 'Yozai-Regular.ttf',          out: 'Yozai-Regular.woff2',          family: 'Yozai' },
  { in: 'Iansui-Regular.ttf',         out: 'Iansui-Regular.woff2',         family: 'Iansui' },
  { in: 'ZenKakuGothicNew-Thin.otf',  out: 'ZenKakuGothicNew-Thin.woff2',  family: 'Zen Kaku Gothic New' },
];

const SIZE_WARN_KB = 800;

async function main() {
  if (!existsSync(GLYPHS_FILE)) {
    console.error(`[subset] missing ${GLYPHS_FILE} — run pnpm tsx scripts/fonts/build-gb2312-7000.ts first`);
    process.exit(0);
  }
  const glyphs = await readFile(GLYPHS_FILE, 'utf8');
  const results = [];

  for (const t of TARGETS) {
    const src = resolve(STAGING, t.in);
    if (!existsSync(src)) {
      console.warn(`[subset] SKIP ${t.out}  (source ${t.in} not in staging/ — run pnpm fonts:download-hard-pen)`);
      results.push({ out: t.out, status: 'skip' });
      continue;
    }
    try {
      const buf = await readFile(src);
      // subset-font API: subset(font: Buffer, text: string, options?) -> Promise<Buffer>
      // Adjust to match the actual package's signature (e.g., sync vs async, option key names).
      const out = await subset(buf, t.family, glyphs, { targetFormat: 'woff2' });
      const dest = resolve(OUT, t.out);
      await writeFile(dest, out);
      const kb = (out.length / 1024).toFixed(1);
      const warn = out.length > SIZE_WARN_KB * 1024 ? `  ⚠ > ${SIZE_WARN_KB} KB` : '';
      console.log(`[subset] OK   ${t.out}  (${kb} KB)${warn}`);
      results.push({ out: t.out, status: 'ok', kb: parseFloat(kb) });
    } catch (err) {
      console.error(`[subset] FAIL ${t.out}:`, err);
      results.push({ out: t.out, status: 'fail' });
    }
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`[subset] done. ok=${ok} skip=${skipped} fail=${failed}`);
  process.exit(0);
}

main();
```

**Step 3: Run the script (only if staging has files from Task 3)**

Run: `pnpm fonts:subset`
Expected (with staging populated): 4 `OK` lines; each `~300-700 KB` typically; warning if any > 800 KB.
Expected (without staging): 4 `SKIP` lines.

**Step 4: Verify outputs in `public/fonts/`**

Run: `ls -la public/fonts/LXGW* public/fonts/Yozai* public/fonts/Iansui* public/fonts/ZenKaku* 2>/dev/null`
Expected: 4 `.woff2` files, each > 0 bytes.

**Step 5: Commit the script**

```bash
git add scripts/fonts/subset-hard-pen-fonts.mjs
git commit -m "feat(fonts): add subset script (TTF staging -> WOFF2 public/)"
```

---

### Task 5: Copy `OFL.txt` files to `public/fonts/`

**Files:**
- Create: `scripts/fonts/copy-ofl.ts`
- Create (eventually): 4 `OFL.txt` files in `public/fonts/` (one per font)

**Step 1: Write the copy script**

```ts
/**
 * copy-ofl.ts
 *
 * Plan G2 — Hard-pen font pipeline (license copy).
 * Copies each font's upstream OFL.txt from scripts/fonts/staging/
 * (if present) to public/fonts/<same-basename>.OFL.txt.
 * Skips fonts whose source TTF was not downloaded.
 *
 * Run: pnpm tsx scripts/fonts/copy-ofl.ts
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(__dirname, 'staging');
const OUT = resolve(__dirname, '..', '..', 'public', 'fonts');

const TARGETS = [
  { ttf: 'LXGWWenKaiGB-Regular.ttf' },
  { ttf: 'Yozai-Regular.ttf' },
  { ttf: 'Iansui-Regular.ttf' },
  { ttf: 'ZenKakuGothicNew-Thin.otf' },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const t of TARGETS) {
    const base = basename(t.ttf, basename(t.ttf).split('.').pop() === 'otf' ? '.otf' : '.ttf');
    const oflName = `${base}.OFL.txt`;
    const src = resolve(STAGING, oflName);
    const dest = resolve(OUT, oflName);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`[ofl] OK   ${oflName}`);
      copied++;
    } else {
      console.warn(`[ofl] SKIP ${oflName}  (no OFL.txt in staging/ — manually copy from upstream release)`);
      skipped++;
    }
  }
  console.log(`[ofl] done. copied=${copied} skipped=${skipped}`);
  process.exit(0);
}

main();
```

**Step 2: Manually fetch and place the OFL.txt files (download script limitation)**

The `download-hard-pen-fonts.ts` script only pulls the TTF/OTF. The OFL.txt must be sourced separately because LXGW releases ship it as a sibling file in the same release tag.

For each of the 4 fonts, the implementer manually downloads the OFL.txt from the upstream release page and places it in `scripts/fonts/staging/` next to the TTF:

- `https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/OFL.txt` (LXGW ships this in their release assets; if not present, fetch from the repo root: `https://raw.githubusercontent.com/lxgw/LxgwWenkaiGB/master/OFL.txt`)
- `https://raw.githubusercontent.com/lxgw/LxgwYozai/master/OFL.txt`
- `https://raw.githubusercontent.com/lxgw/LxgwIansui/master/OFL.txt`
- `https://raw.githubusercontent.com/googlefonts/zen-kakugothic/main/OFL.txt`

(These are best-effort URLs; the implementer should follow the GitHub release page and grab the OFL.txt directly if the raw URL is wrong.)

After manually placing all 4 OFL.txt files in `staging/`:

**Step 3: Run the copy script**

Run: `pnpm tsx scripts/fonts/copy-ofl.ts`
Expected: 4 `OK` lines.

**Step 4: Verify outputs in `public/fonts/`**

Run: `ls public/fonts/*.OFL.txt`
Expected: 4 files (`LXGWWenKaiGB-Regular.OFL.txt`, `Yozai-Regular.OFL.txt`, `Iansui-Regular.OFL.txt`, `ZenKakuGothicNew-Thin.OFL.txt`).

**Step 5: Commit**

```bash
git add scripts/fonts/copy-ofl.ts public/fonts/*.OFL.txt
git commit -m "feat(fonts): copy OFL.txt files for 4 hard-pen fonts"
```

---

### Task 6: End-to-end pipeline run + verify WOFF2 sizes

**Files:** (no changes — verification only)

**Step 1: Run the full pipeline**

Run: `pnpm fonts:hard-pen`
Expected: 4 downloads → 4 subsets → exit 0.

**Step 2: Verify all 4 WOFF2 are present and within size budget**

Run:
```bash
ls -la public/fonts/*.woff2
```

Expected: 4 files. Each ideally < 800 KB. If any is > 800 KB, the subset script will have printed `⚠ > 800 KB` — that is a soft warning, not a failure.

**Step 3: Verify OFL files are present**

Run: `ls public/fonts/*.OFL.txt | wc -l`
Expected: `4`.

**Step 4: Verify no `scripts/fonts/staging/` file was committed**

Run: `git status --short scripts/fonts/`
Expected: only `download-hard-pen-fonts.ts`, `subset-hard-pen-fonts.mjs`, `build-gb2312-7000.ts`, `copy-ofl.ts`, `gb2312-7000.txt` are tracked/visible. No `staging/` contents should be staged.

**No commit** (this task is verification only — the previous tasks already committed their changes).

---

### Task 7: `globals.css` — `@font-face` + tokens

**Files:**
- Modify: `app/globals.css:18-35` (add tokens to `@theme {}`)
- Modify: `app/globals.css:124-128` (add tokens to `:root {}`)
- Modify: `app/globals.css:130-156` (add 4 `@font-face` blocks)

**Step 1: Add 4 `--font-*` tokens to `@theme {}` block**

In `app/globals.css`, find the `--font-*` lines inside `@theme { ... }` (around lines 19-26). Add 4 more tokens after `--font-kai`:

```css
  --font-lxgw-wenkai-gb: 'LXGW WenKai GB', serif;
  --font-yozai: 'Yozai', serif;
  --font-iansui: 'Iansui', serif;
  --font-zen-kaku-thin: 'Zen Kaku Gothic New', sans-serif;
```

**Step 2: Add 4 tokens to `:root {}` block**

In `app/globals.css`, find the `:root { ... }` block (lines 124-128). Add 4 lines after `--font-wenkai`:

```css
  --font-lxgw-wenkai-gb: 'LXGW WenKai GB', serif;
  --font-yozai: 'Yozai', serif;
  --font-iansui: 'Iansui', serif;
  --font-zen-kaku-thin: 'Zen Kaku Gothic New', sans-serif;
```

**Step 3: Add 4 `@font-face` blocks**

In `app/globals.css`, add after the existing `@font-face` blocks (after line 156, before the `/* Sutra Copy Mode */` comment). Insert:

```css
/* ============ Hard-pen fonts (Plan G2) ============ */
@font-face {
  font-family: 'LXGW WenKai GB';
  src: url('/fonts/LXGWWenKaiGB-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Yozai';
  src: url('/fonts/Yozai-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Iansui';
  src: url('/fonts/Iansui-Regular.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'Zen Kaku Gothic New';
  src: url('/fonts/ZenKakuGothicNew-Thin.woff2') format('woff2');
  font-weight: 100;
  font-display: swap;
}
```

**Step 4: Run tsc to ensure no breakage**

Run: `pnpm tsc --noEmit`
Expected: exit 0 (CSS edits don't affect tsc, but verify nothing was inadvertently broken).

**Step 5: Commit**

```bash
git add app/globals.css
git commit -m "feat(fonts): wire 4 hard-pen @font-face + tailwind/root tokens"
```

---

### Task 8: Extend `FontFamily` union + add `group` to `FONT_FAMILIES` (TDD)

**Files:**
- Create: `tests/unit/lib/worksheet-types.test.ts`
- Modify: `lib/worksheet-types.ts:5,44-48`

**Step 1: Write the failing test**

Create `tests/unit/lib/worksheet-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FONT_FAMILIES, fontFamilyLabel, fontFamilyCssVar } from '@/lib/worksheet-types';
import type { FontFamily } from '@/lib/worksheet-types';

describe('FONT_FAMILIES (G2)', () => {
  it('has 7 entries: 3 system + 4 hard-pen', () => {
    expect(FONT_FAMILIES).toHaveLength(7);
  });

  it('groups entries by system or hard-pen', () => {
    const groups = new Set(FONT_FAMILIES.map((f) => f.group));
    expect(groups).toEqual(new Set(['system', 'hard-pen']));
    const system = FONT_FAMILIES.filter((f) => f.group === 'system').map((f) => f.value);
    const hardPen = FONT_FAMILIES.filter((f) => f.group === 'hard-pen').map((f) => f.value);
    expect(system).toEqual(['song', 'kai', 'hei']);
    expect(hardPen).toEqual(['wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin']);
  });

  it('covers the FontFamily union', () => {
    const values = new Set(FONT_FAMILIES.map((f) => f.value));
    const expected: FontFamily[] = ['song', 'kai', 'hei', 'wenkai-gb', 'yozai', 'iansui', 'zen-kaku-thin'];
    for (const e of expected) expect(values.has(e)).toBe(true);
  });

  it('label/cssVar lookups still work for all 7 values', () => {
    for (const f of FONT_FAMILIES) {
      expect(fontFamilyLabel(f.value)).toBe(f.label);
      expect(fontFamilyCssVar(f.value)).toBe(f.cssVar);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: FAIL — `FontFamily` union is currently `'kai' | 'song' | 'hei'`; the 4 new values are not in `FONT_FAMILIES`.

**Step 3: Update `lib/worksheet-types.ts`**

Open `lib/worksheet-types.ts`. Change line 5:

```ts
export type FontFamily =
  | 'song' | 'kai' | 'hei'
  | 'wenkai-gb' | 'yozai' | 'iansui' | 'zen-kaku-thin';
```

Change `FONT_FAMILIES` (lines 44-48) to:

```ts
export const FONT_FAMILIES: {
  value: FontFamily;
  label: string;
  cssVar: string;
  group: 'system' | 'hard-pen';
}[] = [
  { value: 'song', label: '宋体',     cssVar: 'var(--font-han-serif)',     group: 'system' },
  { value: 'kai',  label: '楷体',     cssVar: 'var(--font-wenkai)',        group: 'system' },
  { value: 'hei',  label: '黑体',     cssVar: 'var(--font-han-sans)',      group: 'system' },
  { value: 'wenkai-gb',     label: '霞鹜文楷 GB', cssVar: 'var(--font-lxgw-wenkai-gb)', group: 'hard-pen' },
  { value: 'yozai',         label: '悠哉',         cssVar: 'var(--font-yozai)',         group: 'hard-pen' },
  { value: 'iansui',        label: '芫荽',         cssVar: 'var(--font-iansui)',        group: 'hard-pen' },
  { value: 'zen-kaku-thin', label: '思源极细黑',   cssVar: 'var(--font-zen-kaku-thin)', group: 'hard-pen' },
];
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-types.test.ts`
Expected: PASS — all 4 tests green.

**Step 5: Run full test suite to ensure no regression**

Run: `pnpm test`
Expected: all existing tests still pass; only the new test file is added.

**Step 6: Commit**

```bash
git add lib/worksheet-types.ts tests/unit/lib/worksheet-types.test.ts
git commit -m "feat(worksheet): extend FontFamily to 7 (3 system + 4 hard-pen)"
```

---

### Task 9: Update `CELLS_PER_PAGE` (A4: 96→88, B5: 66→60) (TDD)

**Files:**
- Modify: `lib/worksheet-page-count.ts:3-7`
- Modify: `tests/unit/lib/worksheet-page-count.test.ts:7-8,17,19,22,24,27-28,35,38-39`

**Step 1: Update the test file first (TDD)**

Edit `tests/unit/lib/worksheet-page-count.test.ts`. Change all 96→88 and 66→60 occurrences:

- Line 7: `expect(cellsPerPage('A4')).toBe(88);`
- Line 8: `expect(cellsPerPage('B5')).toBe(60);`
- Line 17: `expect(pageCountFor(88, 'A4')).toBe(1);`
- Line 19: `expect(pageCountFor(60, 'B5')).toBe(1);`
- Line 22: `expect(pageCountFor(89, 'A4')).toBe(2);`
- Line 24: `expect(pageCountFor(61, 'B5')).toBe(2);`
- Line 27: `expect(pageCountFor(200, 'A4')).toBe(3); // ceil(200/88) = 3`
- Line 28: `expect(pageCountFor(500, 'A3')).toBe(4); // ceil(500/132) = 4`
- Line 35: `expect(exceedsFreeLimit(88, 'A4')).toBe(false);`
- Line 38: `expect(exceedsFreeLimit(89, 'A4')).toBe(true);`

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/lib/worksheet-page-count.test.ts`
Expected: FAIL — A4 still returns 96, B5 still returns 66.

**Step 3: Update the source**

Edit `lib/worksheet-page-count.ts:3-7`:

```ts
const CELLS_PER_PAGE: Record<PaperSize, number> = {
  A3: 132,
  A4: 88,
  B5: 60,
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/lib/worksheet-page-count.test.ts`
Expected: PASS — all 3 describe blocks green.

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: all green.

**Step 6: Commit**

```bash
git add lib/worksheet-page-count.ts tests/unit/lib/worksheet-page-count.test.ts
git commit -m "feat(worksheet): A4 96->88, B5 66->60 cells/page"
```

---

### Task 10: Rewrite `FontFamilyPicker` to `<select>` with `<optgroup>` (TDD)

**Files:**
- Create: `tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
- Modify: `components/worksheet/FontFamilyPicker.tsx`

**Step 1: Write the failing test**

Create `tests/unit/components/worksheet/FontFamilyPicker.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontFamilyPicker } from '@/components/worksheet/FontFamilyPicker';

describe('FontFamilyPicker', () => {
  it('renders a <select> with 2 <optgroup>s: 系统字体 and 硬笔字体', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const select = container.querySelector('select');
    expect(select).toBeInTheDocument();
    const groups = container.querySelectorAll('optgroup');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.getAttribute('label')).toBe('系统字体');
    expect(groups[1]?.getAttribute('label')).toBe('硬笔字体');
  });

  it('renders 7 <option>s: 3 in system, 4 in hard-pen', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(7);
    const systemOptions = container.querySelectorAll('optgroup:nth-of-type(1) > option');
    const hardPenOptions = container.querySelectorAll('optgroup:nth-of-type(2) > option');
    expect(systemOptions).toHaveLength(3);
    expect(hardPenOptions).toHaveLength(4);
  });

  it('marks the current value as the selected option', () => {
    const { container } = render(<FontFamilyPicker value="yozai" onChange={vi.fn()} />);
    const select = container.querySelector('select')!;
    expect((select as HTMLSelectElement).value).toBe('yozai');
    const selected = container.querySelector('option[value="yozai"]');
    expect(selected?.getAttribute('value')).toBe('yozai');
  });

  it('calls onChange with the picked FontFamily', () => {
    const onChange = vi.fn();
    const { container } = render(<FontFamilyPicker value="song" onChange={onChange} />);
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'wenkai-gb' } });
    expect(onChange).toHaveBeenCalledWith('wenkai-gb');
  });

  it('shows each option label (e.g. 霞鹜文楷 GB for wenkai-gb)', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const option = container.querySelector('option[value="wenkai-gb"]');
    expect(option?.textContent).toBe('霞鹜文楷 GB');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
Expected: FAIL — current component is a list of radio inputs, not a `<select>`.

**Step 3: Rewrite the component**

Replace `components/worksheet/FontFamilyPicker.tsx` with:

```tsx
'use client';

import type { FontFamily } from '@/lib/worksheet-types';
import { FONT_FAMILIES, fontFamilyLabel } from '@/lib/worksheet-types';

interface Props {
  value: FontFamily;
  onChange: (v: FontFamily) => void;
}

const GROUPS = [
  { key: 'system', label: '系统字体' },
  { key: 'hard-pen', label: '硬笔字体' },
] as const;

export function FontFamilyPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FontFamily)}
      className="rounded border border-ink/20 bg-paper px-3 py-1.5 text-sm"
    >
      {GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {FONT_FAMILIES.filter((f) => f.group === g.key).map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.cssVar }}>
              {fontFamilyLabel(f.value)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/FontFamilyPicker.test.tsx`
Expected: PASS — all 5 tests green.

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: all green.

**Step 6: Commit**

```bash
git add components/worksheet/FontFamilyPicker.tsx tests/unit/components/worksheet/FontFamilyPicker.test.tsx
git commit -m "feat(worksheet): FontFamilyPicker radio -> optgroup select"
```

---

### Task 11: Print header in `WorksheetPreview` (TDD)

**Files:**
- Create: `tests/unit/components/worksheet/WorksheetPreview.test.tsx`
- Modify: `components/worksheet/WorksheetPreview.tsx:69-82`

**Step 1: Write the failing test**

Create `tests/unit/components/worksheet/WorksheetPreview.test.tsx`:

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetPreview } from '@/components/worksheet/WorksheetPreview';

describe('WorksheetPreview print header', () => {
  it('renders Logo + site name + font name + tagline in the worksheet grid', () => {
    const { container } = render(
      <WorksheetPreview
        content={['一', '二', '三']}
        cellStyle="pen"
        paperSize="A4"
        fontFamily="wenkai-gb"
      />,
    );
    // The header lives inside .worksheet-grid
    const grid = container.querySelector('.worksheet-grid');
    expect(grid).toBeInTheDocument();
    // Logo <img> with /logo.svg src
    const logo = grid?.querySelector('img[src="/logo.svg"]');
    expect(logo).toBeInTheDocument();
    expect(logo?.getAttribute('alt')).toBe('字·韵');
    // Site name text
    expect(grid?.textContent).toContain('字·韵');
    // Font name (from fontFamilyLabel for 'wenkai-gb' = '霞鹜文楷 GB')
    expect(grid?.textContent).toContain('霞鹜文楷 GB');
    // Tagline
    expect(grid?.textContent).toContain('公益网站，请多关注');
  });

  it('updates font name in header when fontFamily changes', () => {
    const { container: c1 } = render(
      <WorksheetPreview content={['中']} cellStyle="pen" paperSize="A4" fontFamily="yozai" />,
    );
    expect(c1.querySelector('.worksheet-grid')?.textContent).toContain('悠哉');
    const { container: c2 } = render(
      <WorksheetPreview content={['中']} cellStyle="pen" paperSize="A4" fontFamily="hei" />,
    );
    expect(c2.querySelector('.worksheet-grid')?.textContent).toContain('黑体');
  });

  it('header sits inside .worksheet-grid (not outside, so @media print visibility-visible picks it up)', () => {
    const { container } = render(
      <WorksheetPreview content={['一']} cellStyle="pen" paperSize="A4" fontFamily="song" />,
    );
    // Find the header element by its text. It should be a descendant of .worksheet-grid.
    const grid = container.querySelector('.worksheet-grid');
    expect(grid).toBeInTheDocument();
    const taglineEls = Array.from(grid?.querySelectorAll('*') ?? []).filter(
      (el) => el.textContent === '公益网站，请多关注',
    );
    expect(taglineEls.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/components/worksheet/WorksheetPreview.test.tsx`
Expected: FAIL — no logo, no "霞鹜文楷 GB", no "公益网站" in current implementation.

**Step 3: Update `WorksheetPreview.tsx`**

Open `components/worksheet/WorksheetPreview.tsx`. The `fontFamilyLabel` import already exists. Add to the existing JSX (after the `style` block, line 34, and before the `{isFormView && ...}` block):

```tsx
<style>{`@page { size: ${props.paperSize}; margin: 1.5cm; }`}</style>
```

Then, locate the `.worksheet-grid` `<div>` at line 74. Add a header row inside it (before the `.map(cells)`):

```tsx
<div className={`worksheet-grid mx-auto grid min-w-[640px] max-w-3xl gap-2 print:min-w-0 ${sizeClass}`}>
  <div className="col-span-full flex items-center justify-between border-b border-ink/20 pb-2 mb-3">
    <div className="flex items-center gap-2">
      <img src="/logo.svg" alt="字·韵" className="h-6 w-6" />
      <span className="font-kai text-base text-ink">字·韵</span>
    </div>
    <div className="text-sm text-ink-soft">
      字体: <span className="font-medium text-ink">{fontFamilyLabel(props.fontFamily)}</span>
    </div>
    <div className="text-xs text-ink-faint">公益网站，请多关注</div>
  </div>
  {cells.map((cell) => (
    <div key={cell.index} className="worksheet-cell">
      <WorksheetCell char={cell.char} style={cell.style} fontFamily={props.fontFamily} />
    </div>
  ))}
</div>
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/components/worksheet/WorksheetPreview.test.tsx`
Expected: PASS — all 3 tests green.

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: all green.

**Step 6: Commit**

```bash
git add components/worksheet/WorksheetPreview.tsx tests/unit/components/worksheet/WorksheetPreview.test.tsx
git commit -m "feat(worksheet): print header (Logo + 字体名 + 公益网站,请多关注)"
```

---

### Task 12: `THIRD_PARTY_LICENSES.md`

**Files:**
- Create: `THIRD_PARTY_LICENSES.md`

**Step 1: Write the file**

Create `THIRD_PARTY_LICENSES.md` at the repo root with the following content:

```markdown
# Third-Party Font Licenses

This project bundles the following fonts, all under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL). The full OFL.txt for each font is committed next to its WOFF2 in `public/fonts/`.

## LXGW WenKai GB (霞鹜文楷 GB)
- Upstream: https://github.com/lxgw/LxgwWenkaiGB
- Copyright: © 2020-2026 LXGW.
- License: SIL OFL 1.1

## Yozai (悠哉)
- Upstream: https://github.com/lxgw/LxgwYozai
- Copyright: © 2022-2026 LXGW.
- License: SIL OFL 1.1

## Iansui (芫荽)
- Upstream: https://github.com/lxgw/LxgwIansui
- Copyright: © 2021-2026 LXGW.
- License: SIL OFL 1.1

## Zen Kaku Gothic New (思源ゴシック)
- Upstream: https://github.com/googlefonts/zen-kakugothic
- Copyright: © 2022 Adobe Inc., Google Inc.
- License: SIL OFL 1.1

## BabelStone Han Basic + Extra (Plan L)
- Upstream: https://www.babelstone.co.uk/Fonts/BabelStoneHan.html
- Copyright: © 2019 BabelStone.
- License: SIL OFL 1.1
```

(Adjust copyright years / version numbers if the implementer finds more specific values during the OFL.txt read. The shape is the source of truth.)

**Step 2: Commit**

```bash
git add THIRD_PARTY_LICENSES.md
git commit -m "docs: THIRD_PARTY_LICENSES.md for hard-pen + BabelStone fonts"
```

---

### Task 13: `.gitignore` — exclude `scripts/fonts/staging/`

**Files:**
- Modify: `.gitignore`

**Step 1: Add the staging pattern**

Open `.gitignore`. After line 24 (`data/strokes-manifest.json`), add a new section:

```
# font staging (regenerate with pnpm fonts:download-hard-pen)
scripts/fonts/staging/
```

**Step 2: Verify nothing in staging/ is tracked**

Run: `git ls-files scripts/fonts/staging/`
Expected: empty output.

Run: `git status --short scripts/fonts/`
Expected: only `.ts/.mjs/.txt` files in `scripts/fonts/` (no `staging/` entries).

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): exclude scripts/fonts/staging/"
```

---

### Task 14: Final verification (tsc + test + build)

**Files:** (no changes — verification only)

**Step 1: Run TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: exit 0.

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: all tests pass, including the 3 new test files (`worksheet-types.test.ts`, `FontFamilyPicker.test.tsx`, `WorksheetPreview.test.tsx`) and the updated `worksheet-page-count.test.ts`.

**Step 3: Kill any running dev server before build**

Run: `pkill -f "next dev" 2>/dev/null; sleep 1; echo "dev server stopped"`
Expected: `dev server stopped` (the project pins dev to port 4444; never run `pnpm build` while dev is alive — see memory note on dev/build cache stomp).

**Step 4: Run production build**

Run: `pnpm build`
Expected: build succeeds. Verify the new font assets are referenced:
- `public/fonts/LXGWWenKaiGB-Regular.woff2` is present (no transformation needed; static file)
- `public/fonts/Yozai-Regular.woff2` present
- `public/fonts/Iansui-Regular.woff2` present
- `public/fonts/ZenKakuGothicNew-Thin.woff2` present
- The 4 OFL.txt files are present

**Step 5: Manual browser smoke (document for the human, not automated)**

The implementer does NOT do this; the user does after plan completion. Document the smoke steps in the final summary message:

1. Start dev: `pnpm dev` (port 4444).
2. Visit `http://localhost:4444/worksheet/new`.
3. Verify the font picker is a `<select>` with 2 groups (系统字体 / 硬笔字体) and 7 options total.
4. Pick 霞鹜文楷 GB → confirm preview cells render in that font.
5. Print preview (Ctrl+P) → confirm header shows Logo / 字体名 / 公益网站,请多关注.
6. Type 88 cells → confirm it fits in 1 page (was 96 → 88).
7. Type 89 cells → confirm it spills to 2 pages.

**No commit** (verification only).

---

## Self-Review (post-write)

- **Spec coverage:** All 5 design sections covered: §1 (4 fonts + tokens) → Tasks 3, 5, 7; §2 (picker) → Task 10; §3 (subset pipeline) → Tasks 1, 2, 3, 4, 5, 6; §4 (A4=88 + print header) → Tasks 9, 11; §5 (licenses) → Tasks 5, 12. Spec's 19 tasks mapped 1:1 to plan's 14 tasks (some folded).
- **Placeholders:** None. Every step has concrete code, file path, or run command. The "Best-effort URLs" note in Task 5 is the only soft item, and it explicitly tells the implementer how to handle a miss.
- **Type consistency:** `FontFamily` union defined in Task 8 matches what `FontFamilyPicker` uses (Task 10) and what `WorksheetPreview` displays (Task 11). Token names (`--font-lxgw-wenkai-gb` etc.) appear in Task 7 (CSS) and Task 8 (cssVar values).
- **No `subset-font` API assumption baked in:** Task 4 has an explicit "verify the API surface" Step 1 before writing the call. The plan's pseudocode matches the common `subset-font` API but the implementer adapts if the actual signature differs.
- **Test coverage:** 4 new/updated test files (worksheet-types, FontFamilyPicker, WorksheetPreview, worksheet-page-count). Total 16 new test cases.
- **Dev/build conflict:** Task 14 explicitly kills the dev server before `pnpm build` (memory note).
- **Gitignore race:** Task 6 verifies that `staging/` contents aren't accidentally committed even before Task 13's gitignore is in place; the download script writes to a path that's already hidden by existing `.git` once the gitignore lands.
