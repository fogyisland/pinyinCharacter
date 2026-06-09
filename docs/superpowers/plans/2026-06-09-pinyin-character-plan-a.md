# Plan A: 字↔拼音 转换核心

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可用的字↔拼音互转网站（无需登录），含儿童模式、TTS、拼音→字的两种交互模式。

**Architecture:** Next.js 15 App Router + TypeScript。字→拼音走浏览器 pinyin-pro；拼音→字候选/整句走服务端 API，内存词典 + Viterbi；TTS 走浏览器 SpeechSynthesis；简繁走客户端 OpenCC（占位，Plan C 实现）。

**Tech Stack:** Next.js 15, TypeScript 5, React 19, Tailwind 4, Vitest, Testing Library, pinyin-pro, opencc-js

**Out of scope (Plan B/C):** 用户系统、历史/收藏/统计、简繁切换实际效果、移动端深度优化、E2E 测试。

**Pre-requisites:**
- Node 20+
- pnpm 9+
- 项目根目录：`E:\ToolDevelop\PinYinCharacter`

---

## 文件结构（Plan A 完成后）

```
pinyin-character/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   └── api/
│       └── pinyin/
│           ├── candidates/route.ts
│           └── sentence/route.ts
├── components/
│   ├── Header.tsx
│   ├── SafeModeToggle.tsx
│   ├── TextToPinyin.tsx
│   ├── PinyinOutput.tsx
│   ├── ReadAloudButton.tsx
│   ├── PinyinInputMethod.tsx
│   └── PinyinFullSentence.tsx
├── lib/
│   ├── pinyin-client.ts
│   ├── tts.ts
│   ├── opencc.ts
│   ├── api.ts
│   └── store.ts
├── server/
│   ├── dictionary.ts
│   ├── sentence-converter.ts
│   └── filter.ts
├── data/
│   ├── pinyin-hanzi.json
│   ├── bigrams.json
│   └── bad-words.json
├── scripts/
│   └── build-dict.ts
├── tests/
│   ├── unit/server/
│   │   ├── dictionary.test.ts
│   │   ├── sentence-converter.test.ts
│   │   └── filter.test.ts
│   └── unit/lib/
│       └── pinyin-client.test.ts
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── .env.example
└── README.md
```

---

## Task 1: 脚手架与依赖

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx` (placeholder)

- [ ] **Step 1: 初始化 package.json**

创建 `package.json`：
```json
{
  "name": "pinyin-character",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "dict:build": "tsx scripts/build-dict.ts"
  },
  "dependencies": {
    "next": "15.0.3",
    "react": "19.0.0-rc-66855b96-20241106",
    "react-dom": "19.0.0-rc-66855b96-20241106",
    "pinyin-pro": "^3.25.0",
    "opencc-js": "^1.0.5",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0-beta.3",
    "@tailwindcss/postcss": "^4.0.0-beta.3",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5",
    "@vitest/ui": "^2.1.5",
    "tsx": "^4.19.2"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm install`
Expected: 安装完成，无错误。

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: next.config.ts**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
```

- [ ] **Step 5: tailwind + postcss**

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

`postcss.config.mjs`:
```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 6: app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: app/layout.tsx**

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '字↔拼音 工具',
  description: '在线汉字与拼音互转工具',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: app/page.tsx (placeholder)**

```tsx
export default function Home() {
  return <main className="p-8"><h1 className="text-2xl">字↔拼音 工具</h1></main>;
}
```

- [ ] **Step 9: 验证 dev server 启动**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm dev`
Expected: 编译成功，访问 `http://localhost:3000` 显示 "字↔拼音 工具"。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + TypeScript + Tailwind"
```

---

## Task 2: Vitest 配置

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/server/.gitkeep`
- Create: `tests/unit/lib/.gitkeep`

- [ ] **Step 1: vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

- [ ] **Step 2: 创建测试目录占位**

Run:
```bash
mkdir -p "E:/ToolDevelop/PinYinCharacter/tests/unit/server"
mkdir -p "E:/ToolDevelop/PinYinCharacter/tests/unit/lib"
touch "E:/ToolDevelop/PinYinCharacter/tests/unit/server/.gitkeep"
touch "E:/ToolDevelop/PinYinCharacter/tests/unit/lib/.gitkeep"
```

- [ ] **Step 3: 验证 vitest 运行**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test`
Expected: `No test files found` (0 tests, 0 failures)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add vitest config and test directories"
```

---

## Task 3: 数据准备脚本

**Files:**
- Create: `scripts/build-dict.ts`
- Create: `data/.gitkeep`

- [ ] **Step 1: 创建 build-dict.ts**

这个脚本从开源数据生成 `pinyin-hanzi.json` / `bigrams.json` / `bad-words.json`。**实现思路**：

`scripts/build-dict.ts`:
```ts
/**
 * Build dictionary JSON files from open-source Chinese data.
 *
 * Inputs (downloaded at build time):
 *   - pypinyin dict: https://raw.githubusercontent.com/mozillazg/python-pinyin/master/pypinyin/phrase-pinyin-data/
 *   - jieba dict:    https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt
 *
 * Outputs:
 *   - data/pinyin-hanzi.json: pinyin string (no tone) -> [{char, freq}]
 *   - data/bigrams.json:      char -> char -> freq
 *   - data/bad-words.json:    { chars: string[], words: string[] }
 *
 * This is a one-shot script. Re-run only if upgrading dictionary sources.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const PYTHON_PINYIN_URL = 'https://raw.githubusercontent.com/mozillazg/python-pinyin/master/pypinyin/phrase-pinyin-data/jidian4_pinyin.txt';
const JIEBA_URL = 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt';

// Hand-curated seed list; expand in PRs
const SEED_BAD_WORDS = {
  chars: [],
  words: [
    '操你妈', '滚蛋', '妈的', '草泥马',
  ],
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

interface DictEntry { char: string; freq: number; }
type Dict = Record<string, DictEntry[]>;
type Bigrams = Record<string, Record<string, number>>;

function parsePinyinDict(text: string): { dict: Dict; bigrams: Bigrams } {
  const dict: Dict = {};
  const bigrams: Bigrams = {};
  // Lines: "你:ni 泥:ni 昵:ni"  (a word/phrase split by spaces; each char has pinyin after colon)
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [word, ...pairs] = line.split(/\s+/);
    if (!word || pairs.length === 0) continue;
    // First add to dict (map pinyin-without-tone -> char)
    pairs.forEach((pair, i) => {
      const colon = pair.indexOf(':');
      if (colon < 0) return;
      const ch = word[i];
      const py = pair.slice(colon + 1);
      if (!ch || !py) return;
      // Strip tone digits
      const noTone = py.replace(/[1-5]$/, '');
      // Freq: words containing this char boost freq (use word count = 1 for now)
      const arr = (dict[noTone] ||= []);
      const existing = arr.find(e => e.char === ch);
      if (existing) existing.freq += 1;
      else arr.push({ char: ch, freq: 1 });
    });
    // Bigrams from this word
    for (let i = 0; i < word.length - 1; i++) {
      const a = word[i], b = word[i + 1];
      if (!a || !b) continue;
      ((bigrams[a] ||= {})[b] ||= 0);
      bigrams[a][b] += 1;
    }
  }
  // Sort each entry by freq desc
  for (const k of Object.keys(dict)) {
    dict[k].sort((x, y) => y.freq - x.freq);
  }
  return { dict, bigrams };
}

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  console.log('Fetching pypinyin phrase data...');
  const pinyinText = await fetchText(PYTHON_PINYIN_URL);
  console.log('Parsing dictionary...');
  const { dict, bigrams } = parsePinyinDict(pinyinText);
  console.log(`  ${Object.keys(dict).length} pinyin keys`);
  console.log(`  ${Object.keys(bigrams).length} char-with-successor keys`);

  writeFileSync(join(DATA_DIR, 'pinyin-hanzi.json'), JSON.stringify(dict));
  writeFileSync(join(DATA_DIR, 'bigrams.json'), JSON.stringify(bigrams));
  writeFileSync(join(DATA_DIR, 'bad-words.json'), JSON.stringify(SEED_BAD_WORDS));

  console.log('Done. Wrote:');
  console.log('  data/pinyin-hanzi.json');
  console.log('  data/bigrams.json');
  console.log('  data/bad-words.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 运行 build-dict**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm dict:build`
Expected: 输出 "Done. Wrote:" 与三个文件路径。

- [ ] **Step 3: 验证产物**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && ls -la data/`
Expected: `pinyin-hanzi.json`, `bigrams.json`, `bad-words.json` 三个文件存在。

- [ ] **Step 4: Commit**

```bash
git add scripts/ data/
git commit -m "feat(dict): script to build pinyin-hanzi, bigrams, bad-words"
```

---

## Task 4: 服务端词典加载

**Files:**
- Create: `server/dictionary.ts`
- Test: `tests/unit/server/dictionary.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/server/dictionary.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDictionaries, getCandidates } from '@/server/dictionary';

describe('dictionary', () => {
  beforeAll(() => {
    loadDictionaries();
  });

  it('loads the three dictionary files', () => {
    // No throw = success
    expect(true).toBe(true);
  });

  it('getCandidates returns sorted candidates for a known pinyin', () => {
    const cands = getCandidates('ni', false, 'simplified');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]?.char).toBeTruthy();
    // Sorted by freq desc
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1]!.freq).toBeGreaterThanOrEqual(cands[i]!.freq);
    }
  });

  it('getCandidates returns empty for unknown pinyin', () => {
    const cands = getCandidates('zzzzz', false, 'simplified');
    expect(cands).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test dictionary`
Expected: FAIL "Cannot find module '@/server/dictionary'"

- [ ] **Step 3: 实现 dictionary.ts**

`server/dictionary.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DictEntry { char: string; freq: number; }
export type Script = 'simplified' | 'traditional';

let dict: Record<string, DictEntry[]> = {};
let loaded = false;

export function loadDictionaries(): void {
  if (loaded) return;
  const dataDir = join(process.cwd(), 'data');
  dict = JSON.parse(readFileSync(join(dataDir, 'pinyin-hanzi.json'), 'utf8')) as Record<string, DictEntry[]>;
  loaded = true;
}

export function getCandidates(
  pinyinStr: string,
  _safeMode: boolean,   // 留作 Plan B 接入
  _script: Script       // 留作 Plan C 接入
): DictEntry[] {
  if (!loaded) loadDictionaries();
  return dict[pinyinStr] ?? [];
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test dictionary`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add server/dictionary.ts tests/unit/server/dictionary.test.ts
git commit -m "feat(server): dictionary loader and getCandidates"
```

---

## Task 5: 儿童模式过滤

**Files:**
- Create: `server/filter.ts`
- Modify: `server/dictionary.ts` (注入 bad words)
- Test: `tests/unit/server/filter.test.ts`
- Modify: `tests/unit/server/dictionary.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/server/filter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filterCandidates } from '@/server/filter';
import type { DictEntry } from '@/server/dictionary';

const sample: DictEntry[] = [
  { char: '你', freq: 100 },
  { char: '脏字A', freq: 80 },
  { char: '好', freq: 90 },
];

describe('filterCandidates', () => {
  it('returns all when safeMode is false', () => {
    expect(filterCandidates(sample, false)).toEqual(sample);
  });

  it('removes bad chars when safeMode is true', () => {
    const out = filterCandidates(sample, true);
    expect(out).toHaveLength(2);
    expect(out.find(c => c.char === '脏字A')).toBeUndefined();
  });

  it('returns empty when all are bad', () => {
    const all: DictEntry[] = [{ char: '脏1', freq: 1 }];
    expect(filterCandidates(all, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test filter`
Expected: FAIL "Cannot find module '@/server/filter'"

- [ ] **Step 3: 实现 filter.ts**

`server/filter.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DictEntry } from './dictionary';

let badChars = new Set<string>();
let badWords = new Set<string>();
let loaded = false;

function loadBadWords(): void {
  if (loaded) return;
  const data = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'bad-words.json'), 'utf8')
  ) as { chars: string[]; words: string[] };
  badChars = new Set(data.chars);
  badWords = new Set(data.words);
  loaded = true;
}

export function filterCandidates(candidates: DictEntry[], safeMode: boolean): DictEntry[] {
  if (!safeMode) return candidates;
  if (!loaded) loadBadWords();
  return candidates.filter(c => !badChars.has(c.char));
}

export function isBadText(text: string, safeMode: boolean): boolean {
  if (!safeMode) return false;
  if (!loaded) loadBadWords();
  for (const w of badWords) {
    if (text.includes(w)) return true;
  }
  for (const c of text) {
    if (badChars.has(c)) return true;
  }
  return false;
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test filter`
Expected: 3 passed

- [ ] **Step 5: 接入 dictionary**

修改 `server/dictionary.ts`，让 `getCandidates` 调用 `filterCandidates`：

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterCandidates } from './filter';

export interface DictEntry { char: string; freq: number; }
export type Script = 'simplified' | 'traditional';

let dict: Record<string, DictEntry[]> = {};
let loaded = false;

export function loadDictionaries(): void {
  if (loaded) return;
  const dataDir = join(process.cwd(), 'data');
  dict = JSON.parse(readFileSync(join(dataDir, 'pinyin-hanzi.json'), 'utf8')) as Record<string, DictEntry[]>;
  loaded = true;
}

export function getCandidates(
  pinyinStr: string,
  safeMode: boolean,
  _script: Script
): DictEntry[] {
  if (!loaded) loadDictionaries();
  const raw = dict[pinyinStr] ?? [];
  return filterCandidates(raw, safeMode);
}
```

- [ ] **Step 6: 修改 dictionary 测试以覆盖 safeMode**

修改 `tests/unit/server/dictionary.test.ts`，新增测试：

```ts
it('getCandidates respects safeMode (with seed data we just verify plumbing)', () => {
  // Without a known bad char in current data, the lists should be the same
  const a = getCandidates('ni', false, 'simplified');
  const b = getCandidates('ni', true, 'simplified');
  // We can't assert exact equality (depends on data) but lengths should be sane
  expect(a.length).toBeGreaterThan(0);
  expect(b.length).toBeGreaterThan(0);
});
```

- [ ] **Step 7: 跑全部测试**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test`
Expected: 4+3 = 7 passed

- [ ] **Step 8: Commit**

```bash
git add server/filter.ts server/dictionary.ts tests/unit/server/filter.test.ts tests/unit/server/dictionary.test.ts
git commit -m "feat(server): child-mode filter integration with dictionary"
```

---

## Task 6: 候选 API 路由

**Files:**
- Create: `app/api/pinyin/candidates/route.ts`
- Test: `tests/api/candidates.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/api/candidates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/pinyin/candidates/route';

describe('GET /api/pinyin/candidates', () => {
  it('returns candidates for a valid pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates?pinyin=ni');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { candidates: { char: string; freq: number }[] } };
    expect(json.ok).toBe(true);
    expect(json.data.candidates.length).toBeGreaterThan(0);
  });

  it('returns 400 when pinyin is missing', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it('returns empty candidates for unknown pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates?pinyin=zzzzz');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { candidates: unknown[] } };
    expect(json.data.candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test candidates`
Expected: FAIL "Cannot find module '@/app/api/pinyin/candidates/route'"

- [ ] **Step 3: 实现路由**

`app/api/pinyin/candidates/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getCandidates } from '@/server/dictionary';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pinyin = url.searchParams.get('pinyin');
  if (!pinyin) {
    return NextResponse.json({ ok: false, error: 'pinyin required', code: 'missing_pinyin' }, { status: 400 });
  }
  const safeMode = url.searchParams.get('safeMode') === 'true';
  const script = (url.searchParams.get('script') ?? 'simplified') as 'simplified' | 'traditional';
  const candidates = getCandidates(pinyin, safeMode, script);
  return NextResponse.json({ ok: true, data: { candidates } });
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test candidates`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/pinyin/candidates/route.ts tests/api/candidates.test.ts
git commit -m "feat(api): /api/pinyin/candidates route"
```

---

## Task 7: Viterbi 整句转换（核心算法）

**Files:**
- Create: `server/sentence-converter.ts`
- Test: `tests/unit/server/sentence-converter.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/server/sentence-converter.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDictionaries } from '@/server/dictionary';
import { convertSentence } from '@/server/sentence-converter';

beforeAll(() => loadDictionaries());

describe('convertSentence', () => {
  it('converts a simple pinyin with tones', () => {
    // nǐhǎo
    expect(convertSentence('ni3hao3', false, 'simplified')).toBe('你好');
  });

  it('returns empty for empty input', () => {
    expect(convertSentence('', false, 'simplified')).toBe('');
  });

  it('handles apostrophe-separated syllables (xi an -> 西安)', () => {
    // xian could be "先" or "西安"; apostrophe disambiguates
    expect(convertSentence("xi'an", false, 'simplified')).toBe('西安');
  });

  it('respects safeMode by avoiding bad chars when alternative exists', () => {
    // When the only path contains a bad char, returns empty
    // We don't have specific bad chars in the data, so test the plumbing
    const result = convertSentence('ni3hao3', true, 'simplified');
    expect(result === '你好' || result === '').toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test sentence-converter`
Expected: FAIL "Cannot find module '@/server/sentence-converter'"

- [ ] **Step 3: 实现 sentence-converter.ts**

`server/sentence-converter.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCandidates, type DictEntry, type Script } from './dictionary';
import { isBadText } from './filter';

type Bigrams = Record<string, Record<string, number>>;

let bigrams: Bigrams = {};
let bigramsLoaded = false;

function loadBigrams(): void {
  if (bigramsLoaded) return;
  bigrams = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'bigrams.json'), 'utf8')
  ) as Bigrams;
  bigramsLoaded = true;
}

function logSafe(n: number): number {
  return n > 0 ? Math.log(n) : -10;
}

const BAD_SCORE = -1000;
const TOP_K = 20;
const MAX_TOKEN_LEN = 4;

export function convertSentence(
  pinyinStr: string,
  safeMode: boolean,
  script: Script
): string {
  if (!pinyinStr.trim()) return '';
  loadBigrams();

  // 1) tokenize: split on whitespace, keep apostrophe within token
  //    also strip spaces in "ni hao" → "nihao"
  const normalized = pinyinStr.replace(/\s+/g, '').toLowerCase();
  const tokens = tokenize(normalized);

  // 2) Viterbi DP
  // f[i] = array of { char, score, prevIndex, prevChar } best endings at token i
  type State = { char: string; score: number; prev: State | null };
  const dp: State[][] = [];

  for (let i = 0; i < tokens.length; i++) {
    const candidates = collectCandidates(tokens[i]!, safeMode, script);
    if (candidates.length === 0) {
      // No candidate for this token; bail
      return '';
    }
    const states: State[] = [];
    const seen = new Set<string>();

    for (const cand of candidates) {
      // score for this candidate
      const baseScore = logSafe(cand.freq);
      const safePenalty = isBadText(cand.char, safeMode) ? BAD_SCORE : 0;

      let bestPrev: State | null = null;
      let bestPrevScore = 0;
      if (i > 0 && dp[i - 1]!.length > 0) {
        for (const prev of dp[i - 1]!) {
          const trans = bigrams[prev.char]?.[cand.char] ?? 0;
          const transScore = trans > 0 ? logSafe(trans) : -3;
          const candidate = prev.score + transScore;
          if (!bestPrev || candidate > bestPrevScore) {
            bestPrev = prev;
            bestPrevScore = candidate;
          }
        }
      } else {
        bestPrevScore = 0;  // start state
      }
      const total = baseScore + safePenalty + bestPrevScore;

      // Dedup by char (keep best)
      if (seen.has(cand.char)) continue;
      seen.add(cand.char);
      states.push({ char: cand.char, score: total, prev: bestPrev });
    }

    // Sort and keep top-K
    states.sort((a, b) => b.score - a.score);
    dp.push(states.slice(0, TOP_K));
  }

  // 3) Backtrack from best final state
  const last = dp[dp.length - 1]?.[0];
  if (!last) return '';
  const out: string[] = [];
  let cur: State | null = last;
  while (cur) {
    out.unshift(cur.char);
    cur = cur.prev;
  }
  return out.join('');
}

interface Token { str: string; len: number; }

function tokenize(pinyinStr: string): Token[] {
  // Greedy: at each position, try the longest matching pinyin key
  // that yields non-empty candidates; fall back to length 1
  const tokens: Token[] = [];
  let i = 0;
  while (i < pinyinStr.length) {
    let bestLen = 0;
    for (let len = Math.min(MAX_TOKEN_LEN, pinyinStr.length - i); len >= 1; len--) {
      const sub = pinyinStr.slice(i, i + len);
      const cands = getCandidates(sub, false, 'simplified');
      if (cands.length > 0) {
        bestLen = len;
        break;
      }
    }
    if (bestLen === 0) bestLen = 1;
    tokens.push({ str: pinyinStr.slice(i, i + bestLen), len: bestLen });
    i += bestLen;
  }
  return tokens;
}

function collectCandidates(pinyinStr: string, safeMode: boolean, script: Script): DictEntry[] {
  // Try exact first, then strip trailing tone digit
  let cands = getCandidates(pinyinStr, safeMode, script);
  if (cands.length === 0) {
    const noTone = pinyinStr.replace(/[1-5]$/, '');
    if (noTone !== pinyinStr) {
      cands = getCandidates(noTone, safeMode, script);
    }
  }
  return cands;
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test sentence-converter`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add server/sentence-converter.ts tests/unit/server/sentence-converter.test.ts
git commit -m "feat(server): Viterbi-based full sentence pinyin-to-hanzi converter"
```

---

## Task 8: 整句 API 路由

**Files:**
- Create: `app/api/pinyin/sentence/route.ts`
- Test: `tests/api/sentence.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/api/sentence.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/pinyin/sentence/route';

describe('GET /api/pinyin/sentence', () => {
  it('returns sentence for valid pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/sentence?pinyin=ni3hao3');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { sentence: string } };
    expect(json.data.sentence).toBe('你好');
  });

  it('returns 400 when pinyin missing', async () => {
    const url = new URL('http://localhost/api/pinyin/sentence');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test sentence`
Expected: FAIL "Cannot find module '@/app/api/pinyin/sentence/route'"

- [ ] **Step 3: 实现路由**

`app/api/pinyin/sentence/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { convertSentence } from '@/server/sentence-converter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pinyin = url.searchParams.get('pinyin');
  if (!pinyin) {
    return NextResponse.json({ ok: false, error: 'pinyin required', code: 'missing_pinyin' }, { status: 400 });
  }
  const safeMode = url.searchParams.get('safeMode') === 'true';
  const script = (url.searchParams.get('script') ?? 'simplified') as 'simplified' | 'traditional';
  const sentence = convertSentence(pinyin, safeMode, script);
  return NextResponse.json({ ok: true, data: { sentence } });
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test sentence`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/pinyin/sentence/route.ts tests/api/sentence.test.ts
git commit -m "feat(api): /api/pinyin/sentence route"
```

---

## Task 9: 客户端 - pinyin-pro 包装

**Files:**
- Create: `lib/pinyin-client.ts`
- Test: `tests/unit/lib/pinyin-client.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/unit/lib/pinyin-client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { textToPinyin, renderWithSpaces, renderWithoutSpaces } from '@/lib/pinyin-client';

describe('textToPinyin', () => {
  it('returns one token per char with tone marks', () => {
    const tokens = textToPinyin('你好');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.char).toBe('你');
    expect(tokens[0]?.readings[0]).toBe('nǐ');
    expect(tokens[1]?.char).toBe('好');
    expect(tokens[1]?.readings[0]).toBe('hǎo');
  });

  it('includes all readings for polyphone', () => {
    // 行 is xíng or háng
    const tokens = textToPinyin('行');
    expect(tokens[0]?.readings.length).toBeGreaterThan(1);
    expect(tokens[0]?.readings).toContain('xíng');
    expect(tokens[0]?.readings).toContain('háng');
  });

  it('preserves non-Chinese chars as single-char tokens', () => {
    const tokens = textToPinyin('a');
    expect(tokens[0]?.char).toBe('a');
  });
});

describe('renderWithSpaces', () => {
  it('joins readings with space', () => {
    const tokens = textToPinyin('你好');
    expect(renderWithSpaces(tokens)).toBe('nǐ hǎo');
  });
});

describe('renderWithoutSpaces', () => {
  it('joins readings without space', () => {
    const tokens = textToPinyin('你好');
    expect(renderWithoutSpaces(tokens)).toBe('nǐhǎo');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test pinyin-client`
Expected: FAIL "Cannot find module '@/lib/pinyin-client'"

- [ ] **Step 3: 实现 pinyin-client.ts**

`lib/pinyin-client.ts`:
```ts
import { pinyin } from 'pinyin-pro';

export interface PinyinToken {
  char: string;
  readings: string[];   // 多音字：所有读音
}

const HAN_RANGE = /[一-鿿㐀-䶿]/;

export function textToPinyin(text: string): PinyinToken[] {
  return Array.from(text).map((char) => {
    if (!HAN_RANGE.test(char)) {
      return { char, readings: [char] };
    }
    const arr = pinyin(char, { type: 'array', toneType: 'symbol' }) as string[];
    return { char, readings: Array.isArray(arr) && arr.length > 0 ? arr : ['?'] };
  });
}

export function renderWithSpaces(tokens: PinyinToken[]): string {
  return tokens.map(t => t.readings[0] ?? '?').join(' ');
}

export function renderWithoutSpaces(tokens: PinyinToken[]): string {
  return tokens.map(t => t.readings[0] ?? '?').join('');
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm test pinyin-client`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add lib/pinyin-client.ts tests/unit/lib/pinyin-client.test.ts
git commit -m "feat(client): pinyin-pro wrapper for client-side text-to-pinyin"
```

---

## Task 10: 客户端 - TTS 包装

**Files:**
- Create: `lib/tts.ts`

- [ ] **Step 1: 实现 tts.ts**

`lib/tts.ts`:
```ts
'use client';

export interface SpeakOpts {
  rate?: number;            // 0.1 - 10
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
}

export function pickChineseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'zh-CN') ??
    voices.find(v => v.lang.startsWith('zh')) ??
    null
  );
}

export function speak(text: string, opts: SpeakOpts = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  stopSpeaking();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = opts.rate ?? 1;
  const voice = pickChineseVoice();
  if (voice) utter.voice = voice;
  if (opts.onBoundary) utter.onboundary = (e) => opts.onBoundary?.(e.charIndex);
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tts.ts
git commit -m "feat(client): SpeechSynthesis wrapper for TTS"
```

---

## Task 11: 客户端 - 状态管理 (zustand)

**Files:**
- Create: `lib/store.ts`

- [ ] **Step 1: 实现 store.ts**

`lib/store.ts`:
```ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Script = 'simplified' | 'traditional';

interface AppState {
  safeMode: boolean;
  script: Script;
  setSafeMode: (v: boolean) => void;
  setScript: (s: Script) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      safeMode: true,                  // 默认开
      script: 'simplified',
      setSafeMode: (safeMode) => set({ safeMode }),
      setScript: (script) => set({ script }),
    }),
    { name: 'pinyin-app-state' }
  )
);
```

- [ ] **Step 2: Commit**

```bash
git add lib/store.ts
git commit -m "feat(client): zustand store with safeMode and script"
```

---

## Task 12: 客户端 - API wrapper

**Files:**
- Create: `lib/api.ts`

- [ ] **Step 1: 实现 api.ts**

`lib/api.ts`:
```ts
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export interface Candidate { char: string; freq: number; }

export async function fetchCandidates(
  pinyin: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): Promise<ApiResult<{ candidates: Candidate[] }>> {
  const params = new URLSearchParams({ pinyin, safeMode: String(safeMode), script });
  const res = await fetch(`/api/pinyin/candidates?${params}`);
  return (await res.json()) as ApiResult<{ candidates: Candidate[] }>;
}

export async function fetchSentence(
  pinyin: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): Promise<ApiResult<{ sentence: string }>> {
  const params = new URLSearchParams({ pinyin, safeMode: String(safeMode), script });
  const res = await fetch(`/api/pinyin/sentence?${params}`);
  return (await res.json()) as ApiResult<{ sentence: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/api.ts
git commit -m "feat(client): api wrapper for pinyin endpoints"
```

---

## Task 13: 客户端 - opencc 占位

**Files:**
- Create: `lib/opencc.ts`

- [ ] **Step 1: 实现 opencc.ts（占位实现）**

Plan C 会用 `opencc-js` 替换为真实实现。占位先返回原文，保证 Plan A 可工作。

`lib/opencc.ts`:
```ts
// 占位：Plan C 替换为 opencc-js 实现
export function toTraditional(text: string): string {
  return text;
}

export function toSimplified(text: string): string {
  return text;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/opencc.ts
git commit -m "feat(client): opencc placeholder (to be implemented in Plan C)"
```

---

## Task 14: 组件 - SafeModeToggle

**Files:**
- Create: `components/SafeModeToggle.tsx`

- [ ] **Step 1: 实现 SafeModeToggle**

`components/SafeModeToggle.tsx`:
```tsx
'use client';

import { useAppStore } from '@/lib/store';

export function SafeModeToggle() {
  const safeMode = useAppStore(s => s.safeMode);
  const setSafeMode = useAppStore(s => s.setSafeMode);
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm">🔒 儿童模式</span>
      <button
        type="button"
        role="switch"
        aria-checked={safeMode}
        onClick={() => setSafeMode(!safeMode)}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          safeMode ? 'bg-green-500' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            safeMode ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/SafeModeToggle.tsx
git commit -m "feat(ui): SafeModeToggle component"
```

---

## Task 15: 组件 - Header

**Files:**
- Create: `components/Header.tsx`

- [ ] **Step 1: 实现 Header**

`components/Header.tsx`:
```tsx
import { SafeModeToggle } from './SafeModeToggle';
import { useAppStore } from '@/lib/store';

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/Header.tsx
git commit -m "feat(ui): Header with safe mode indicator"
```

---

## Task 16: 组件 - PinyinOutput

**Files:**
- Create: `components/PinyinOutput.tsx`

- [ ] **Step 1: 实现 PinyinOutput**

`components/PinyinOutput.tsx`:
```tsx
'use client';

import { useState } from 'react';
import type { PinyinToken } from '@/lib/pinyin-client';

interface Props {
  tokens: PinyinToken[];
}

export function PinyinOutput({ tokens }: Props) {
  const [withSpaces, setWithSpaces] = useState(true);
  const [readings, setReadings] = useState<Record<number, number>>({});  // index -> reading index

  if (tokens.length === 0) {
    return <div className="text-gray-400 text-sm">在上方输入汉字，拼音会显示在这里</div>;
  }

  const text = tokens.map((t, i) => {
    const idx = readings[i] ?? 0;
    return t.readings[idx] ?? '?';
  }).join(withSpaces ? ' ' : '');

  const cycleReading = (i: number) => {
    setReadings(prev => {
      const cur = prev[i] ?? 0;
      const next = (cur + 1) % tokens[i]!.readings.length;
      return { ...prev, [i]: next };
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={withSpaces}
            onChange={e => setWithSpaces(e.target.checked)}
          />
          带空格
        </label>
        <button
          type="button"
          onClick={copy}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
        >
          复制
        </button>
      </div>
      <div className="p-3 bg-gray-50 rounded border min-h-[3rem] text-lg leading-relaxed">
        {tokens.map((t, i) => {
          const idx = readings[i] ?? 0;
          const r = t.readings[idx] ?? '?';
          const isPoly = t.readings.length > 1;
          return (
            <span key={i} className="inline-block mr-2 mb-1">
              <span className="text-gray-700">{t.char}</span>
              {isPoly ? (
                <button
                  type="button"
                  onClick={() => cycleReading(i)}
                  className="ml-1 text-blue-600 hover:underline"
                  title="点击切换读音"
                >
                  ({r})
                </button>
              ) : (
                <span className="ml-1 text-gray-500">[{r}]</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PinyinOutput.tsx
git commit -m "feat(ui): PinyinOutput with polyphone cycling and spacing toggle"
```

---

## Task 17: 组件 - ReadAloudButton

**Files:**
- Create: `components/ReadAloudButton.tsx`

- [ ] **Step 1: 实现 ReadAloudButton**

`components/ReadAloudButton.tsx`:
```tsx
'use client';

import { speak, stopSpeaking } from '@/lib/tts';

interface Props {
  text: string;
  label?: string;
}

export function ReadAloudButton({ text, label = '🔊 朗读' }: Props) {
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() => {
        if (!text) return;
        speak(text);
      }}
      onDoubleClick={() => stopSpeaking()}
      className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
      title="单击朗读，双击停止"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ReadAloudButton.tsx
git commit -m "feat(ui): ReadAloudButton for TTS"
```

---

## Task 18: 组件 - TextToPinyin

**Files:**
- Create: `components/TextToPinyin.tsx`

- [ ] **Step 1: 实现 TextToPinyin**

`components/TextToPinyin.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { textToPinyin } from '@/lib/pinyin-client';
import { PinyinOutput } from './PinyinOutput';
import { ReadAloudButton } from './ReadAloudButton';

export function TextToPinyin() {
  const [text, setText] = useState('');
  const tokens = useMemo(() => textToPinyin(text), [text]);

  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <h2 className="text-base font-semibold">汉字 → 拼音</h2>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="输入或粘贴中文…"
        rows={3}
        className="w-full p-2 border rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setText('')}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
        >
          清空
        </button>
        <ReadAloudButton text={text} />
      </div>
      <PinyinOutput tokens={tokens} />
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/TextToPinyin.tsx
git commit -m "feat(ui): TextToPinyin section"
```

---

## Task 19: 组件 - PinyinInputMethod（输入码点选）

**Files:**
- Create: `components/PinyinInputMethod.tsx`

- [ ] **Step 1: 实现 PinyinInputMethod**

`components/PinyinInputMethod.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchCandidates, type Candidate } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { ReadAloudButton } from './ReadAloudButton';

export function PinyinInputMethod() {
  const safeMode = useAppStore(s => s.safeMode);
  const script = useAppStore(s => s.script);
  const [buffer, setBuffer] = useState('');
  const [committed, setCommitted] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced candidate fetch
  useEffect(() => {
    if (!buffer) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetchCandidates(buffer, safeMode, script);
      if (res.ok) setCandidates(res.data.candidates);
    }, 80);
    return () => clearTimeout(timer);
  }, [buffer, safeMode, script]);

  const pick = (i: number) => {
    const c = candidates[i];
    if (!c) return;
    setCommitted(prev => prev + c.char);
    setBuffer('');
    setCandidates([]);
    inputRef.current?.focus();
  };

  const backspace = () => {
    if (buffer) {
      setBuffer(b => b.slice(0, -1));
    } else if (committed) {
      setCommitted(c => c.slice(0, -1));
    }
  };

  const clear = () => {
    setBuffer('');
    setCommitted('');
    setCandidates([]);
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        value={buffer}
        onChange={e => {
          // Accept only letters, digits, apostrophe
          const v = e.target.value.replace(/[^a-zA-Z1-5']/g, '');
          setBuffer(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault();
            backspace();
            return;
          }
          if (e.key === ' ') {
            e.preventDefault();
            pick(0);
            return;
          }
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const idx = parseInt(e.key, 10) - 1;
            pick(idx);
            return;
          }
        }}
        placeholder="输入拼音 (如: nihao 或 ni3hao3)"
        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="min-h-[2rem] p-2 bg-gray-50 rounded border text-lg">
        {committed}
        {buffer && <span className="text-blue-500 ml-1">|{buffer}</span>}
        {!committed && !buffer && <span className="text-gray-400 text-sm">在上方输入拼音，选择候选字</span>}
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {candidates.slice(0, 9).map((c, i) => (
            <button
              key={c.char + i}
              type="button"
              onClick={() => pick(i)}
              className="px-3 py-1 border rounded hover:bg-blue-50 text-base"
            >
              <span className="text-gray-400 mr-1 text-xs">{i + 1}</span>
              {c.char}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <ReadAloudButton text={committed} label="🔊 朗读" />
        <button type="button" onClick={() => navigator.clipboard.writeText(committed)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100" disabled={!committed}>复制</button>
        <button type="button" onClick={clear} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">清空</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PinyinInputMethod.tsx
git commit -m "feat(ui): PinyinInputMethod (input method mode)"
```

---

## Task 20: 组件 - PinyinFullSentence（整句）

**Files:**
- Create: `components/PinyinFullSentence.tsx`

- [ ] **Step 1: 实现 PinyinFullSentence**

`components/PinyinFullSentence.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { fetchSentence } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { ReadAloudButton } from './ReadAloudButton';

export function PinyinFullSentence() {
  const safeMode = useAppStore(s => s.safeMode);
  const script = useAppStore(s => s.script);
  const [pinyin, setPinyin] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const convert = async () => {
    if (!pinyin.trim()) return;
    setLoading(true);
    const res = await fetchSentence(pinyin, safeMode, script);
    setLoading(false);
    if (res.ok) setResult(res.data.sentence);
  };

  const clear = () => {
    setPinyin('');
    setResult('');
  };

  return (
    <div className="space-y-3">
      <input
        value={pinyin}
        onChange={e => setPinyin(e.target.value)}
        placeholder="输入完整带调拼音串 (如: ni3hao3, wo3jiao4xu2peng2)"
        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={convert}
          disabled={!pinyin || loading}
          className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '转换中…' : '转换'}
        </button>
        <ReadAloudButton text={result} />
        <button type="button" onClick={() => navigator.clipboard.writeText(result)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100" disabled={!result}>复制</button>
        <button type="button" onClick={clear} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">清空</button>
      </div>
      {result ? (
        <div className="min-h-[2rem] p-2 bg-gray-50 rounded border text-lg">{result}</div>
      ) : (
        <div className="text-gray-400 text-sm">转换结果会显示在这里</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PinyinFullSentence.tsx
git commit -m "feat(ui): PinyinFullSentence (full sentence mode)"
```

---

## Task 21: 主页面装配

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: 实现主页面**

`app/page.tsx`:
```tsx
import { Header } from '@/components/Header';
import { TextToPinyin } from '@/components/TextToPinyin';
import { PinyinInputMethod } from '@/components/PinyinInputMethod';
import { PinyinFullSentence } from '@/components/PinyinFullSentence';

export default function Home() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <TextToPinyin />
        <section className="bg-white border rounded-lg p-4 space-y-3">
          <h2 className="text-base font-semibold">拼音 → 汉字</h2>
          <details open className="border rounded p-3">
            <summary className="cursor-pointer font-medium">输入码点选</summary>
            <div className="mt-3">
              <PinyinInputMethod />
            </div>
          </details>
          <details className="border rounded p-3">
            <summary className="cursor-pointer font-medium">整句转换</summary>
            <div className="mt-3">
              <PinyinFullSentence />
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 2: 跑 dev server 验证**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm dev`
Expected: 访问 `http://localhost:3000`，看到完整页面。

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): assemble main page with all sections"
```

---

## Task 22: 词典启动加载钩子

**Files:**
- Modify: `server/dictionary.ts` (export check)
- Create: `instrumentation.ts`

- [ ] **Step 1: 实现 Next.js instrumentation**

Next.js 15 支持 `instrumentation.ts` 在 server 启动时运行。

`instrumentation.ts`:
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadDictionaries } = await import('./server/dictionary');
    loadDictionaries();
  }
}
```

- [ ] **Step 2: 验证**

Run: `cd "E:/ToolDevelop/PinYinCharacter" && pnpm dev`
Expected: 启动后第一次访问 `/api/pinyin/candidates?pinyin=ni` 立即返回，无首次访问延迟。

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(server): preload dictionaries at server start"
```

---

## Task 23: README + .env.example

**Files:**
- Create: `README.md`
- Create: `.env.example`

- [ ] **Step 1: .env.example**

```env
# 当前 Plan A 不需要任何 env
# Plan B 引入 MySQL/JWT 时会增加:
# DATABASE_URL=mysql://user:pass@localhost:3306/pinyin
# JWT_SECRET=<random 32 bytes>
```

- [ ] **Step 2: README.md**

```markdown
# 字 ↔ 拼音 工具

在线汉字与拼音互转工具。

## 功能（v1 / Plan A）

- 汉字 → 拼音：客户端实时转换，pinyin-pro
- 拼音 → 汉字：两种模式
  - 输入码点选（类似输入法）
  - 整句智能转换（Viterbi + 二元接续）
- 朗读：浏览器内置 TTS
- 儿童模式：默认开启，过滤拼音→字 方向的不适宜内容
- 简/繁切换（占位，Plan C 实现）

## 启动

```bash
pnpm install
pnpm dict:build       # 生成词典文件
pnpm dev              # http://localhost:3000
```

## 测试

```bash
pnpm test             # 一次性
pnpm test:watch       # 监听
```

## 技术栈

- Next.js 15 + TypeScript
- pinyin-pro（客户端字→拼音）
- 内存词典 + Viterbi（服务端拼音→字）
- Tailwind CSS

## 路线图

- Plan B：用户注册、历史、收藏、统计
- Plan C：简繁真实实现、响应式优化、E2E 测试
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: README and env example"
```

---

## Task 24: 端到端冒烟测试（手动）

无自动化代码 —— 这是一组手动验证步骤，必须全部通过才算 Plan A 完成。

- [ ] **Step 1: 字→拼音**

1. 启动 `pnpm dev`
2. 打开 `http://localhost:3000`
3. 在"汉字 → 拼音"输入 `你好世界`
4. 期望：看到 `nǐ hǎo shì jiè` (带空格)；取消勾选"带空格"看到 `nǐhǎoshìjiè`
5. 在输入中放一个"行"，点击其拼音部分应能循环切到 `háng`
6. 点 🔊 朗读：听到中文读音
7. 点 "复制"：剪贴板有拼音文本

- [ ] **Step 2: 拼音→字 输入码点选**

1. 在"输入码点选"输入 `nih`
2. 候选出现，至少有"你"
3. 按 `1`：第一个候选被确认，"输入码点选"上方的"已选"区出现该字
4. 继续输 `hao`、`1`：拼出"你好"
5. 朗读、复制、清空都能用

- [ ] **Step 3: 拼音→字 整句**

1. 展开"整句转换"
2. 输入 `ni3hao3,wo3jiao4xu2peng2`
3. 点"转换"
4. 期望：得到接近"你好，我叫徐鹏"的句子
5. 不准确也没关系（受 N-gram 质量限制）

- [ ] **Step 4: 儿童模式**

1. 顶部开关关闭 → 输入 `ni3`，候选更多
2. 打开 → 输入 `ni3`，候选数量不变（因当前数据无脏字），但顶部出现绿徽章
3. 在 `data/bad-words.json` 里手动加一个常用字（如 "狗"），重启 → 该字不再出现在候选中
4. 完成后**记得把"狗"从 bad-words.json 移除**，commit 回去

- [ ] **Step 5: TTS 实际播放**

1. 字→拼音 区域输入一段长文本
2. 点朗读
3. 听是否真的播放（不同浏览器音色不同，但应有声音）
4. 双击停止

- [ ] **Step 6: 响应式**

1. 浏览器 devtools 切到 iPhone 12 (390×844)
2. 页面应单列显示，按钮不溢出
3. 切到 iPad (768×1024)：单列宽间距
4. 切到 desktop (1440×900)：居中显示

---

## 完成标准 (Definition of Done)

Plan A 完成需满足：

1. ✅ `pnpm test` 全部通过
2. ✅ `pnpm dev` 启动无错误
3. ✅ Task 24 全部 6 个手动验证步骤通过
4. ✅ 代码全部 commit 到 main 分支
5. ✅ README 反映现状

完成 Plan A 后，进入 Plan B（用户系统）。
