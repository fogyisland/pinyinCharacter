# Plan E: 字·韵 视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把整个网站从"默认 Tailwind 灰白"重塑为"宣纸/墨/印章"传统风，全站统一，零功能改动。

**Architecture:** 设计令牌 (Tailwind v4 `@theme` in CSS) → 全局字体加载 (`next/font/google`) → 共享组件重做 → 逐页替换样式。视觉为主、改动分散，所以采用"小步快跑+频繁 commit"策略，每个 page 一个独立 task。

**Tech Stack:** Next.js 15 + React 19 + Tailwind v4 (CSS-based config) + next/font + lucide-react (new dep) + 霞鹜文楷/思源黑体/思源宋体 (Google Fonts)

**Reference spec:** `docs/superpowers/specs/2026-06-11-visual-redesign-design.md`

---

## Design Tokens (Reference)

```css
/* tailwind v4: these are used in @theme block in app/globals.css */

--color-paper: #F4ECD8;        /* 宣纸米黄 */
--color-paper-soft: #FFFAEE;   /* 浅宣纸 */
--color-paper-deep: #E8DCC0;   /* 深宣纸 */
--color-ink: #3A2A14;          /* 墨黑 */
--color-ink-soft: #5A4530;     /* 浅墨 */
--color-ink-faint: #8B6F3A;    /* 墨痕 */
--color-seal: #B22B2B;         /* 印章红 */
--color-success: #4A7C59;
--color-warning: #C99A3E;
--color-danger: #B22B2B;
--color-info: #4F6B8C;

--font-kai: var(--font-wenkai);    /* 霞鹜文楷 */
--font-han-serif: var(--font-han-serif);
--font-han-sans: var(--font-han-sans);

--shadow-paper: 0 1px 2px rgba(58,42,20,0.06);
--shadow-paper-md: 0 4px 12px rgba(58,42,20,0.10);
--shadow-paper-lg: 0 12px 32px rgba(58,42,20,0.14);
```

---

## Phase 1 — Foundation (Tokens + Fonts + Layout)

### Task 1: Install lucide-react

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install lucide-react as dependency**

```bash
cd E:/ToolDevelop/PinYinCharacter && pnpm add lucide-react
```

- [ ] **Step 2: Verify install**

```bash
ls node_modules/lucide-react/package.json
```

Expected: file exists, has `"name": "lucide-react"` in JSON.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add lucide-react for icon system"
```

---

### Task 2: Define design tokens in app/globals.css

**Files:**
- Modify: `app/globals.css:1-3` (replace `@tailwind` directives + add `@theme` block)

- [ ] **Step 1: Replace app/globals.css with new content**

```css
@import "tailwindcss";

/* ============ Design Tokens (字·韵) ============ */
@theme {
  /* Colors */
  --color-paper: #F4ECD8;
  --color-paper-soft: #FFFAEE;
  --color-paper-deep: #E8DCC0;
  --color-ink: #3A2A14;
  --color-ink-soft: #5A4530;
  --color-ink-faint: #8B6F3A;
  --color-seal: #B22B2B;
  --color-success: #4A7C59;
  --color-warning: #C99A3E;
  --color-danger: #B22B2B;
  --color-info: #4F6B8C;

  /* Fonts */
  --font-sans: var(--font-han-sans), system-ui, -apple-system, sans-serif;
  --font-serif: var(--font-han-serif), Georgia, serif;
  --font-kai: var(--font-wenkai), "LXGW WenKai", "Kaiti SC", serif;

  /* Shadows */
  --shadow-paper: 0 1px 2px rgba(58, 42, 20, 0.06);
  --shadow-paper-md: 0 4px 12px rgba(58, 42, 20, 0.10);
  --shadow-paper-lg: 0 12px 32px rgba(58, 42, 20, 0.14);

  /* Border radius (small) */
  --radius-paper: 3px;
}

/* ============ Base Layer ============ */
@layer base {
  body {
    background-color: #F4ECD8;
    background-image:
      radial-gradient(circle at 20% 30%, rgba(178, 43, 43, 0.018) 0%, transparent 40%),
      radial-gradient(circle at 80% 70%, rgba(58, 42, 20, 0.025) 0%, transparent 50%);
    color: #3A2A14;
    font-family: var(--font-sans);
  }
}

/* ============ Utility Classes ============ */
@layer utilities {
  .paper-rule {
    background-image: linear-gradient(to right, transparent, rgba(139, 111, 58, 0.4), transparent);
    height: 1px;
  }
  .stamp {
    display: inline-block;
    border: 2px solid #B22B2B;
    color: #B22B2B;
    padding: 4px 10px;
    font-family: var(--font-kai);
    transform: rotate(-4deg);
    letter-spacing: 0.15em;
    background: transparent;
  }
  .btn-seal {
    background-color: #B22B2B;
    color: #FFFAEE;
    padding: 8px 18px;
    font-family: var(--font-kai);
    letter-spacing: 0.1em;
    border: none;
    cursor: pointer;
    transition: transform 100ms ease;
  }
  .btn-seal:hover:not(:disabled) {
    transform: scale(1.02);
  }
  .btn-ghost {
    background: transparent;
    color: #3A2A14;
    border: 1px solid rgba(58, 42, 20, 0.20);
    padding: 8px 18px;
    cursor: pointer;
    transition: background-color 200ms, border-color 200ms;
  }
  .btn-ghost:hover {
    background-color: #FFFAEE;
    border-color: rgba(58, 42, 20, 0.40);
  }
  .card-paper {
    background-color: #FFFAEE;
    border: 1px solid rgba(58, 42, 20, 0.10);
    box-shadow: var(--shadow-paper);
    transition: box-shadow 200ms, border-color 200ms;
  }
  .card-paper:hover {
    border-color: #B22B2B;
    box-shadow: var(--shadow-paper-md);
  }
}

/* ============ Print (worksheet) ============ */
@media print {
  body * {
    visibility: hidden;
  }
  .worksheet-grid, .worksheet-grid * {
    visibility: visible;
  }
  .worksheet-grid {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .worksheet-no-print {
    display: none !important;
  }
  @page {
    margin: 1.5cm;
    size: A4;
  }
}
```

- [ ] **Step 2: Verify dev server still starts (manual)**

```bash
cd E:/ToolDevelop/PinYinCharacter && pnpm dev &
sleep 5 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3003/
```

Expected: HTTP 200 (some style loss expected, that's fine — fix in Task 4).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(style): add 字·韵 design tokens (paper/ink/seal + utility classes)"
```

---

### Task 3: Add 3 Chinese fonts via next/font in app/layout.tsx

**Files:**
- Modify: `app/layout.tsx:1-19` (full replacement)

- [ ] **Step 1: Replace app/layout.tsx**

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { Noto_Sans_SC, Noto_Serif_SC, LXGW_WenKai_TC } from 'next/font/google';
import { AuthSync } from './_auth-sync';

const hanSans = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-han-sans',
});

const hanSerif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-han-serif',
});

const wenkai = LXGW_WenKai_TC({
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-wenkai',
});

export const metadata = {
  title: '字·韵 — 汉字与拼音互转',
  description: '公益汉字工具：字↔拼音互转、千字罕见库、字帖打印、游戏识字。',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={`${hanSans.variable} ${hanSerif.variable} ${wenkai.variable}`}>
      <body className="font-sans antialiased min-h-screen">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify page renders without font errors**

```bash
sleep 3 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3003/
```

Expected: HTTP 200. Check dev server stdout for font download errors (acceptable if subset warnings appear).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(layout): load 3 Chinese fonts (思源黑/宋 + 霞鹜文楷)"
```

---

### Task 4: Build common lib file for shared design constants

**Files:**
- Create: `lib/design.ts`

- [ ] **Step 1: Create lib/design.ts with shared brand constants**

```ts
export const BRAND = {
  name: '字·韵',
  namePlain: '字韵',
  tagline: '汉字与拼音，一笔一画皆有意',
  shortDesc: '公益汉字工具，免费使用',
  copyright: '© 2026 字韵项目 · MIT License',
} as const;

export const NAV_LINKS = [
  { href: '/rare-chars', label: '罕见字库' },
  { href: '/worksheet', label: '字帖' },
  { href: '/game', label: '游戏' },
  { href: '/profile', label: '我的' },
] as const;

export const FOOTER_LINKS = [
  { href: '/about', label: '关于' },
  { href: '/guide', label: '使用指南' },
  { href: 'https://github.com/your/repo', label: 'GitHub', external: true },
  { href: '/feedback', label: '反馈' },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add lib/design.ts
git commit -m "feat(lib): add brand constants (字·韵 name + nav links)"
```

---

## Phase 2 — Shared Components + Header/Footer

### Task 5: Redesign LoadingSpinner

**Files:**
- Modify: `components/common/LoadingSpinner.tsx` (full replacement)

- [ ] **Step 1: Replace components/common/LoadingSpinner.tsx**

```tsx
import { Loader2 } from 'lucide-react';

type Size = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<Size, number> = { sm: 16, md: 24, lg: 32 };

export function LoadingSpinner({ size = 'md', label }: { size?: Size; label?: string }) {
  const px = SIZE_MAP[size];
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-ink-faint">
      <div className="relative" style={{ width: px, height: px }}>
        <Loader2 size={px} className="animate-spin text-ink" />
        <span
          className="absolute inset-0 block"
          style={{
            borderTop: `2px solid #B22B2B`,
            borderRadius: '50%',
            transform: 'rotate(45deg)',
            animation: 'spin 1s linear infinite reverse',
          }}
        />
      </div>
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify with `pnpm tsc`**

```bash
cd E:/ToolDevelop/PinYinCharacter && pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add components/common/LoadingSpinner.tsx
git commit -m "feat(components): redesign LoadingSpinner with seal arc"
```

---

### Task 6: Redesign EmptyState

**Files:**
- Modify: `components/common/EmptyState.tsx` (full replacement)

- [ ] **Step 1: Replace components/common/EmptyState.tsx**

```tsx
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-ink-faint mb-3">
        {icon ?? <Inbox size={32} strokeWidth={1.5} />}
      </div>
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-ink-soft max-w-md mb-4">{description}</p>
      )}
      {action}
      <div className="paper-rule w-24 mt-6" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/common/EmptyState.tsx
git commit -m "feat(components): redesign EmptyState (icon + rule)"
```

---

### Task 7: Create ErrorState component

**Files:**
- Create: `components/common/ErrorState.tsx`

- [ ] **Step 1: Create components/common/ErrorState.tsx**

```tsx
import { AlertCircle, RefreshCw } from 'lucide-react';

type Props = {
  title?: string;
  message: string;
  code?: string;
  onRetry?: () => void;
};

export function ErrorState({ title = '出错了', message, code, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AlertCircle size={36} strokeWidth={1.5} className="text-seal mb-3" />
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      <p className="text-sm text-ink-soft max-w-md mb-2">{message}</p>
      {code && (
        <code className="text-xs text-ink-faint font-mono mb-4">[{code}]</code>
      )}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost flex items-center gap-2 mt-2">
          <RefreshCw size={14} /> 重试
        </button>
      )}
      <div className="paper-rule w-24 mt-6" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/common/ErrorState.tsx
git commit -m "feat(components): add ErrorState component"
```

---

### Task 8: Create PageContainer layout component

**Files:**
- Create: `components/common/PageContainer.tsx`

- [ ] **Step 1: Create components/common/PageContainer.tsx**

```tsx
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
};

export function PageContainer({ children, className = '' }: Props) {
  return (
    <main className={`max-w-5xl mx-auto px-4 py-6 sm:py-8 ${className}`}>
      {children}
    </main>
  );
}

export function SectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="mb-4 sm:mb-6">
      <h2 className="font-kai text-2xl sm:text-3xl text-ink leading-tight">{children}</h2>
      {subtitle && <p className="text-sm text-ink-soft mt-1">{subtitle}</p>}
      <div className="paper-rule w-16 mt-3" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/common/PageContainer.tsx
git commit -m "feat(components): add PageContainer + SectionTitle"
```

---

### Task 9: Redesign Header with logo + nav

**Files:**
- Modify: `components/Header.tsx` (full replacement)

- [ ] **Step 1: Replace components/Header.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { SafeModeToggle } from './SafeModeToggle';
import { UserMenu } from './UserMenu';
import { AuthModal } from './AuthModal';
import { useAppStore } from '@/lib/store';
import { BRAND, NAV_LINKS } from '@/lib/design';

export function Header() {
  const safeMode = useAppStore(s => s.safeMode);
  const user = useAppStore(s => s.user);
  const [authOpen, setAuthOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('auth') === 'login' && !user) setAuthOpen(true);
  }, [searchParams, user]);

  return (
    <header className="border-b border-ink/10 bg-paper-soft/95 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-[72px] flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-kai text-2xl text-ink tracking-wide hover:text-seal transition-colors">
            {BRAND.name}
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-soft hover:text-seal transition-colors border-b-2 border-transparent hover:border-seal pb-0.5"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {safeMode && (
            <span className="hidden sm:inline text-xs px-2 py-0.5 rounded bg-success/15 text-success">
              已开启儿童模式
            </span>
          )}
          <SafeModeToggle />
          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="btn-seal text-sm"
            >
              登录 / 注册
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-1 text-ink"
            aria-label="打开菜单"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-ink/40" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute right-0 top-0 h-full w-64 bg-paper-soft p-4 shadow-paper-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <span className="font-kai text-xl">{BRAND.name}</span>
              <button onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
                <X size={22} />
              </button>
            </div>
            <nav className="flex flex-col gap-3">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="text-base text-ink py-2 border-b border-ink/10"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}
```

- [ ] **Step 2: Verify dev server still starts**

```bash
sleep 3 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3003/
```

Expected: HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add components/Header.tsx
git commit -m "feat(header): redesign with 字·韵 logo + nav + mobile drawer"
```

---

### Task 10: Create Footer

**Files:**
- Create: `components/Footer.tsx`

- [ ] **Step 1: Create components/Footer.tsx**

```tsx
import Link from 'next/link';
import { BRAND, FOOTER_LINKS } from '@/lib/design';

export function Footer() {
  return (
    <footer className="border-t border-ink/10 mt-16 bg-paper-soft/60">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="font-kai text-lg text-ink">{BRAND.name}</div>
            <p className="text-xs text-ink-soft mt-1">{BRAND.shortDesc}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {FOOTER_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-soft hover:text-seal transition-colors"
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="paper-rule my-6" />
        <p className="text-xs text-ink-faint">{BRAND.copyright}</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/Footer.tsx
git commit -m "feat(components): add Footer with brand + nav links"
```

---

## Phase 3 — Home Page (Hero + Bento)

### Task 11: Create Hero component

**Files:**
- Create: `components/Hero.tsx`

- [ ] **Step 1: Create components/Hero.tsx**

```tsx
import Link from 'next/link';
import { BRAND } from '@/lib/design';

export function Hero() {
  return (
    <section className="text-center py-10 sm:py-16">
      <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-4">
        字 · 韵
      </div>
      <h1 className="font-kai text-3xl sm:text-5xl text-ink leading-tight mb-4">
        汉字与拼音，<br className="sm:hidden" />
        一笔一画皆有意
      </h1>
      <p className="text-sm sm:text-base text-ink-soft max-w-xl mx-auto leading-relaxed mb-8">
        {BRAND.shortDesc}。字 ↔ 拼音互转 · 千字罕见库 · 字帖打印 · 趣味识字游戏。
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Link href="/worksheet" className="btn-seal">
          立即开始
        </Link>
        <Link href="#features" className="btn-ghost">
          了解更多
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/Hero.tsx
git commit -m "feat(components): add Hero with 文楷 title + seal CTA"
```

---

### Task 12: Create BentoGrid component

**Files:**
- Create: `components/BentoGrid.tsx`

- [ ] **Step 1: Create components/BentoGrid.tsx**

```tsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type BentoItem = {
  char: string;
  title: string;
  description: string;
  href: string;
  variant: 'primary' | 'secondary' | 'accent' | 'outline';
};

const ITEMS: BentoItem[] = [
  { char: '字', title: '字 ↔ 拼音互转', description: '文本转拼音 + 整句转换', href: '/', variant: 'primary' },
  { char: '库', title: '罕见字库', description: '1450 个生僻字查询', href: '/rare-chars', variant: 'accent' },
  { char: '帖', title: '字帖打印', description: '毛笔格/田字格 PDF', href: '/worksheet', variant: 'outline' },
  { char: '戏', title: '趣味识字游戏', description: '拼音与字配对', href: '/game', variant: 'outline' },
];

const variantClass = {
  primary: 'bg-ink text-paper-soft',
  accent: 'bg-seal text-paper-soft',
  outline: 'bg-paper-soft border border-ink/20 text-ink',
} as const;

export function BentoGrid() {
  return (
    <section id="features" className="py-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          href={ITEMS[0]!.href}
          className={`card-paper ${variantClass[ITEMS[0]!.variant]} sm:row-span-2 p-6 flex flex-col justify-between min-h-[200px] group`}
        >
          <div className="font-kai text-6xl leading-none">{ITEMS[0]!.char}</div>
          <div>
            <div className="font-semibold text-lg mb-1">{ITEMS[0]!.title}</div>
            <div className="text-sm opacity-75 mb-2">{ITEMS[0]!.description}</div>
            <div className="flex items-center gap-1 text-sm font-kai">
              立即开始 <ArrowRight size={14} />
            </div>
          </div>
        </Link>
        {ITEMS.slice(1).map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`card-paper ${variantClass[item.variant]} p-5 flex items-center gap-4 group`}
          >
            <div className="font-kai text-3xl">{item.char}</div>
            <div>
              <div className="font-semibold">{item.title}</div>
              <div className="text-xs opacity-75">{item.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BentoGrid.tsx
git commit -m "feat(components): add BentoGrid (1 primary + 3 secondary entries)"
```

---

### Task 13: Create ValueProps component

**Files:**
- Create: `components/ValueProps.tsx`

- [ ] **Step 1: Create components/ValueProps.tsx**

```tsx
const PROPS = [
  { title: '准确', body: '基于 16 万条语料统计的 Viterbi 整句转换', icon: '✓' },
  { title: '丰富', body: '1450 个通用规范三级字 + 词条', icon: '典' },
  { title: '易用', body: '字帖一键打印，支持毛笔格与田字格', icon: '印' },
];

export function ValueProps() {
  return (
    <section className="py-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {PROPS.map(p => (
          <div key={p.title} className="text-center">
            <div className="font-kai text-3xl text-seal mb-2">{p.icon}</div>
            <div className="font-semibold text-ink mb-1">{p.title}</div>
            <p className="text-sm text-ink-soft leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ValueProps.tsx
git commit -m "feat(components): add ValueProps (3 pillars)"
```

---

### Task 14: Replace app/page.tsx with new home structure

**Files:**
- Modify: `app/page.tsx` (full replacement)

- [ ] **Step 1: Replace app/page.tsx**

```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { BentoGrid } from '@/components/BentoGrid';
import { ValueProps } from '@/components/ValueProps';
import { Footer } from '@/components/Footer';
import { TextToPinyin } from '@/components/TextToPinyin';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';

export default function Home() {
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <Hero />
        <BentoGrid />
        <ValueProps />

        <section className="mt-8">
          <SectionTitle subtitle="试试看">字 → 拼音 互转</SectionTitle>
          <TextToPinyin />
        </section>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Verify home page renders**

```bash
sleep 2 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3003/
```

Expected: HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): replace with Hero + Bento + ValueProps + Footer"
```

---

## Phase 4 — Feature Pages

### Task 15: Refresh /rare-chars list page

**Files:**
- Modify: `app/rare-chars/page.tsx`

- [ ] **Step 1: Read current page to understand structure**

```bash
cat app/rare-chars/page.tsx
```

(Read but don't modify yet — adjust next step to wrap with new container.)

- [ ] **Step 2: Replace with header + wrapper**

```tsx
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { DailyCharBanner } from '@/components/rare/DailyCharBanner';
import { RareCharSearch } from '@/components/rare/RareCharSearch';
import { RareCharCard } from '@/components/rare/RareCharCard';
import { RareCharPagination } from '@/components/rare/RareCharPagination';

export default async function RareCharsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  // ... existing data fetching unchanged ...
  // (Keep existing logic — only change the render wrapper)
  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵 · 千字罕见库</div>
        <SectionTitle subtitle="通用规范汉字表三级 · 1450 字">罕见字库</SectionTitle>
        {/* ... existing DailyCharBanner + Search + grid + Pagination, wrapped in card-paper for grid items ... */}
      </PageContainer>
      <Footer />
    </>
  );
}
```

(Adapter: wrap the existing rendering in `<PageContainer>`, add the title + decorative line. Keep all data fetching and existing components — only the outer chrome changes. Apply same pattern to the remaining feature pages.)

- [ ] **Step 3: Commit**

```bash
git add app/rare-chars/page.tsx
git commit -m "feat(rare-chars): wrap with PageContainer + title"
```

---

### Task 16: Refresh /rare-chars/[char] detail

**Files:**
- Modify: `app/rare-chars/[char]/page.tsx`

- [ ] **Step 1: Wrap with PageContainer + add decoration**

```tsx
// In return: replace <main> with:
<>
  <Suspense><Header /></Suspense>
  <PageContainer>
    <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
    {/* existing detail content, but wrap the big char in card-paper with border-l-4 border-seal pl-6 for story */}
  </PageContainer>
  <Footer />
</>
```

- [ ] **Step 2: Commit**

```bash
git add app/rare-chars/[char]/page.tsx
git commit -m "feat(rare-chars-detail): wrap with PageContainer + seal-accented story"
```

---

### Task 17: Refresh /worksheet page

**Files:**
- Modify: `app/worksheet/page.tsx`

- [ ] **Step 1: Wrap with new chrome**

```tsx
// Replace outer return with:
<>
  <Suspense><Header /></Suspense>
  <PageContainer>
    <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
    <SectionTitle subtitle="毛笔格 · 田字格 · 打印友好">字帖生成</SectionTitle>
    {/* existing form/preview, but with card-paper wrapper */}
  </PageContainer>
  <Footer />
</>
```

- [ ] **Step 2: Commit**

```bash
git add app/worksheet/page.tsx
git commit -m "feat(worksheet): wrap with PageContainer + section title"
```

---

### Task 18: Refresh /worksheet/history and /worksheet/[id]

**Files:**
- Modify: `app/worksheet/history/page.tsx`
- Modify: `app/worksheet/[id]/page.tsx`

- [ ] **Step 1: Apply same wrap pattern to both**

Add `<Header>` + `<PageContainer>` + `<SectionTitle>我的字帖</SectionTitle>` + `<Footer>`.

- [ ] **Step 2: Commit**

```bash
git add app/worksheet/history/page.tsx app/worksheet/[id]/page.tsx
git commit -m "feat(worksheet-history): wrap both list and detail with new chrome"
```

---

### Task 19: Refresh /game page

**Files:**
- Modify: `app/game/page.tsx`

- [ ] **Step 1: Wrap with new chrome**

```tsx
<>
  <Suspense><Header /></Suspense>
  <PageContainer>
    <div className="font-kai text-xs text-ink-faint tracking-[0.3em] mb-3">字 · 韵</div>
    <SectionTitle subtitle="把拼音拖到对应的字上">趣味识字</SectionTitle>
    {/* existing DragMatchGame */}
  </PageContainer>
  <Footer />
</>
```

- [ ] **Step 2: Commit**

```bash
git add app/game/page.tsx
git commit -m "feat(game): wrap with new chrome + section title"
```

---

## Phase 5 — User System + Admin

### Task 20: Refresh auth pages (login / forgot / reset)

**Files:**
- Modify: `app/forgot-password/page.tsx`
- Modify: `app/forgot-password/ForgotForm.tsx`
- Modify: `app/reset-password/page.tsx`
- Modify: `app/reset-password/ResetForm.tsx`

- [ ] **Step 1: Replace blue button with btn-seal in ForgotForm**

In `ForgotForm.tsx`, find:
```tsx
className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50"
```
Replace with:
```tsx
className="w-full btn-seal disabled:opacity-50"
```

- [ ] **Step 2: Replace blue button in ResetForm**

Same pattern: `bg-blue-600 text-white rounded py-2` → `btn-seal`.

- [ ] **Step 3: Wrap forgot-password page with new chrome**

```tsx
<>
  <Suspense><Header /></Suspense>
  <PageContainer>
    <div className="max-w-sm mx-auto card-paper p-6 mt-8">
      <div className="font-kai text-center text-ink-faint tracking-[0.3em] text-xs mb-4">字 · 韵</div>
      <h1 className="font-kai text-2xl text-center text-ink mb-2">忘记密码</h1>
      <div className="paper-rule w-12 mx-auto mb-6" />
      <ForgotForm />
    </div>
  </PageContainer>
  <Footer />
</>
```

- [ ] **Step 4: Same wrap pattern for reset-password page**

- [ ] **Step 5: Commit**

```bash
git add app/forgot-password/page.tsx app/forgot-password/ForgotForm.tsx app/reset-password/page.tsx app/reset-password/ResetForm.tsx
git commit -m "feat(auth): redesign login-related pages with paper card + seal CTA"
```

---

### Task 21: Refresh AuthModal

**Files:**
- Modify: `components/AuthModal.tsx`

- [ ] **Step 1: Replace default white card with paper card**

Find `bg-white` references in AuthModal and replace with `card-paper`. Find `bg-blue-600 text-white` with `btn-seal`. Add the decorative「字 · 韵」small text at the top.

- [ ] **Step 2: Commit**

```bash
git add components/AuthModal.tsx
git commit -m "feat(components): redesign AuthModal with paper card"
```

---

### Task 22: Refresh UserMenu

**Files:**
- Modify: `components/UserMenu.tsx`

- [ ] **Step 1: Replace default white dropdown with paper card**

`bg-white border rounded shadow-lg` → `card-paper`. Apply consistent padding.

- [ ] **Step 2: Commit**

```bash
git add components/UserMenu.tsx
git commit -m "feat(components): redesign UserMenu dropdown"
```

---

### Task 23: Refresh /profile

**Files:**
- Modify: `app/profile/page.tsx`

- [ ] **Step 1: Wrap with new chrome + redesign stat cards**

```tsx
<>
  <Suspense><Header /></Suspense>
  <PageContainer>
    <SectionTitle subtitle="你的汉字学习足迹">个人主页</SectionTitle>
    {/* existing user info, but stat cards now use card-paper + font-kai for big numbers */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(s => (
        <div key={s.label} className="card-paper p-4 text-center">
          <div className="font-kai text-3xl text-ink">{s.value}</div>
          <div className="text-xs text-ink-soft mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  </PageContainer>
  <Footer />
</>
```

- [ ] **Step 2: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat(profile): redesign with paper stat cards"
```

---

### Task 24: Refresh /history

**Files:**
- Modify: `app/history/page.tsx`

- [ ] **Step 1: Wrap with chrome + redesign list items**

Apply same pattern. Replace `bg-white border rounded` with `card-paper`. Favorite star uses `text-seal` (red) instead of yellow.

- [ ] **Step 2: Commit**

```bash
git add app/history/page.tsx
git commit -m "feat(history): redesign list with paper cards + seal star"
```

---

### Task 25: Refresh admin layout + pages

**Files:**
- Modify: `app/admin/layout.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/users/page.tsx`
- Modify: `app/admin/users/[id]/page.tsx`
- Modify: `app/admin/users/[id]/UserDetailClient.tsx`
- Modify: `app/admin/audit/page.tsx`
- Modify: `app/admin/stats/page.tsx`

- [ ] **Step 1: Replace `bg-gray-50` with `bg-paper` in admin layout**

In `app/admin/layout.tsx`, find `bg-gray-50` and replace with `bg-paper` (or `bg-paper-soft` if it's the main area).

- [ ] **Step 2: Replace `bg-white border rounded` with `card-paper` in all admin pages**

Sed-like replace:
- `bg-white border rounded-lg` → `card-paper rounded-sm` (or just `card-paper` since the class includes border)
- `bg-gray-50` → `bg-paper-deep`
- `bg-blue-600 text-white` → `btn-seal`
- `text-blue-600 hover:underline` → `text-seal hover:underline`
- `bg-blue-100 text-blue-700` (admin badge) → `bg-seal/15 text-seal`

- [ ] **Step 3: Commit**

```bash
git add app/admin/
git commit -m "feat(admin): replace default colors with paper/seal tokens"
```

---

## Phase 6 — Errors + Mobile + Final Polish

### Task 26: Create 404 page

**Files:**
- Create: `app/not-found.tsx`

- [ ] **Step 1: Create app/not-found.tsx**

```tsx
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';

export default function NotFound() {
  return (
    <>
      <Header />
      <PageContainer>
        <div className="text-center py-16">
          <div className="font-kai text-[160px] sm:text-[200px] text-ink/15 leading-none">无</div>
          <div className="stamp inline-block mt-4">404</div>
          <p className="text-ink-soft mt-6 mb-2">页面不存在，或已被移走</p>
          <p className="text-sm text-ink-faint mb-8">Not Found</p>
          <Link href="/" className="btn-seal">返回首页</Link>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/not-found.tsx
git commit -m "feat: 404 page with big 无 character + stamp"
```

---

### Task 27: Create global error page

**Files:**
- Create: `app/error.tsx`

- [ ] **Step 1: Create app/error.tsx**

```tsx
'use client';

import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Header />
      <PageContainer>
        <div className="text-center py-16">
          <div className="font-kai text-[120px] text-ink/15 leading-none">误</div>
          <div className="stamp inline-block mt-4">500</div>
          <p className="text-ink-soft mt-6 mb-2">页面加载出错了</p>
          {error.digest && (
            <code className="text-xs text-ink-faint font-mono mb-4 block">[{error.digest}]</code>
          )}
          <button onClick={reset} className="btn-seal mt-2">刷新重试</button>
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/error.tsx
git commit -m "feat: global error page with big 误 character"
```

---

### Task 28: Sweep residual `bg-gray-*` / `bg-white` / `bg-blue-*` colors

**Files:**
- All page + component files

- [ ] **Step 1: Find remaining default Tailwind color usages**

```bash
cd E:/ToolDevelop/PinYinCharacter && grep -rEn "bg-gray-|text-gray-|bg-white|text-blue-|bg-blue-|text-green-|bg-green-" app/ components/ | grep -v node_modules
```

- [ ] **Step 2: Replace remaining occurrences**

Apply the substitution table:
- `bg-gray-50` → `bg-paper-deep`
- `bg-gray-100` → `bg-paper-deep`
- `bg-white` → `bg-paper-soft` (for cards) or remove (for transparent)
- `text-gray-700` / `text-gray-900` → `text-ink-soft` / `text-ink`
- `text-blue-600` / `bg-blue-600` → `text-seal` / `bg-seal`
- `text-green-700` / `bg-green-100` → `text-success` / `bg-success/15`
- `hover:bg-gray-50` → `hover:bg-paper-deep`

Edit each file or use sed if simple.

- [ ] **Step 3: Verify no default colors remain**

```bash
grep -rEn "bg-gray-|text-gray-|bg-white|text-blue-|bg-blue-" app/ components/ | grep -v node_modules
```

Expected: empty output (or only print-CSS related).

- [ ] **Step 4: Run typecheck**

```bash
cd E:/ToolDevelop/PinYinCharacter && pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(style): sweep remaining default Tailwind colors → paper/ink/seal"
```

---

### Task 29: Mobile responsive sweep

**Files:**
- Various

- [ ] **Step 1: Test mobile viewport (375px wide)**

```bash
curl -s -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" http://localhost:3003/ | head -100
```

- [ ] **Step 2: Add mobile-specific tweaks**

Look for any `overflow-x-auto` needs in:
- Worksheet preview (already scrollable)
- Admin tables (add `overflow-x-auto` wrapper if missing)
- Long character rows in rare-chars

- [ ] **Step 3: Verify no horizontal overflow at 375px**

Run the dev server in browser, set viewport to 375px, check key pages.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(mobile): ensure no horizontal overflow at 375px viewport"
```

---

## Phase 7 — Verification

### Task 30: Run full test suite + typecheck + build

- [ ] **Step 1: Run unit tests**

```bash
cd E:/ToolDevelop/PinYinCharacter && pnpm test 2>&1 | tail -10
```

Expected: `Tests ... 116 passed, 38 skipped (154)` (or similar — same as before).

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Production build**

```bash
pnpm build 2>&1 | tail -30
```

Expected: builds successfully, all 16 pages + 7 API routes listed.

- [ ] **Step 4: Commit if any fixes**

```bash
git add -A && git commit -m "fix: build/typecheck fixes for visual redesign" || echo "No changes"
```

---

### Task 31: Browser smoke test (manual)

- [ ] **Step 1: Open http://localhost:3003 in browser**

Verify:
- [ ] Hero with 文楷 title renders
- [ ] Bento grid: 1 large dark + 3 small cards
- [ ] ValueProps 3 columns
- [ ] Footer with 字·韵 + nav links
- [ ] Background is 米黄 (not gray)

- [ ] **Step 2: Navigate to /rare-chars**

Verify:
- [ ] PageContainer wrapper
- [ ] SectionTitle "罕见字库"
- [ ] Daily banner with stamp

- [ ] **Step 3: Navigate to /worksheet**

Verify:
- [ ] New chrome + section title
- [ ] Worksheet form/preview still works

- [ ] **Step 4: Navigate to /game**

Verify:
- [ ] New chrome + 趣味识字 section title

- [ ] **Step 5: Visit /nonexistent → 404**

Verify:
- [ ] Big 「无」 character
- [ ] 「404」 stamp
- [ ] "返回首页" button works

- [ ] **Step 6: Test mobile (375px viewport)**

Verify:
- [ ] Header collapses to hamburger
- [ ] Bento grid stacks to 1 column
- [ ] No horizontal overflow

- [ ] **Step 7: Document any issues found**

Create a notes file if issues found:
```bash
docs/superpowers/notes/2026-06-11-plan-e-smoke.md
```

- [ ] **Step 8: Commit notes (if any)**

```bash
git add docs/superpowers/notes/ && git commit -m "docs(plan-e): browser smoke notes"
```

---

## Plan E Complete

When all tasks above are checked off, the visual redesign is shipped. Total estimated time: 4-6 hours of focused work.

---

## Risks & Notes

1. **Tailwind v4 syntax** — `theme.extend` doesn't work; we use `@theme` in CSS instead. All token names are CSS variables.
2. **LXGW WenKai** on Google Fonts is the TC (Traditional Chinese) variant. SC (Simplified) isn't on Google Fonts. For a Chinese-mainland audience, TC still works (most chars overlap). Could switch to a local font file if kerning is critical.
3. **Font performance** — 3 fonts at ~3-5MB total before subset. Use `display: 'swap'` to avoid blocking.
4. **Existing tests** — visual changes don't break logic, all 116 unit tests should pass.
5. **Lucide icons used in spec** — installed in Task 1, used in Header/MobileMenu/LoadingSpinner/Bento/ErrorState.
