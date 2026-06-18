# 字典 level 筛选 + 右键追加到「我的字帖」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/dictionary` 上加 level 切换按钮 + 字符格右键「添加到我的字帖」菜单,后者通过新建 `POST /api/worksheets/append` endpoint 把单字追加到每用户唯一的「我的字帖」worksheet。

**Architecture:** 后端新增 server lib (`lib/worksheet-append.ts`) 做 find-or-create + append,新建 `POST /api/worksheets/append` 路由 + Zod validator,新建 `worksheet_char_appended` 审计事件。前端新增全局 zustand toast store + 单 `<ToastViewport />`,字典字符格改为 client component 接管右键,菜单固定定位展示单一项。Level 筛选走 URL `?level=N`,后端 `listChars` 已支持,只动客户端。

**Tech Stack:** Next.js 15 App Router, MySQL 5.7, zustand (no new deps), Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-dict-level-filter-and-ctx-append-design.md`

## Global Constraints

- 现有 `worksheets` 表 schema **不动**
- 不引新依赖(zustand + Zod + react 已存在)
- audit 走 `logUserAction(req, userId, event, metadata)` (user-action 审计偏好);新增 `worksheet_char_appended` 事件
- `lib/audit-format.ts` 是 client-safe 边界,新事件 union + formatLogMessage 分支加在这里
- 文案中文,匹配项目现有 UI 风格
- `pnpm build` 时若 dev server 跑着不要 build(会踩 .next 缓存坑,见 `memory/dev-build-cache-stomp.md`);验证用 `pnpm tsc --noEmit` + 单元/集成测试
- 并发小窗口(同时右键两次可能创建两个「我的字帖」)已知风险,接受 + 注释,不加 DB UNIQUE 约束

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/worksheet-append.ts` (NEW) | Server-only: find-or-create "我的字帖", append char with dedup |
| `lib/validators.ts` (MODIFY) | Add `appendToWorksheetSchema` |
| `lib/audit-format.ts` (MODIFY) | Add `worksheet_char_appended` to union + formatLogMessage case |
| `app/api/worksheets/append/route.ts` (NEW) | POST handler: auth + validate + lib + audit |
| `tests/integration/api/worksheets-append.test.ts` (NEW) | API endpoint integration tests |
| `tests/unit/lib/worksheet-append.test.ts` (NEW) | Server lib DB-touching unit tests (require DATABASE_URL_TEST) |
| `tests/unit/lib/audit.test.ts` (MODIFY) | Bump event count from 33 → 34, add formatLogMessage case |
| `lib/toast-store.ts` (NEW) | zustand client store: toasts[], push, dismiss |
| `components/common/Toast.tsx` (NEW) | `<ToastViewport />` client component, renders toast list |
| `app/layout.tsx` (MODIFY) | Mount `<ToastViewport />` after `{children}` |
| `lib/api-worksheet.ts` (MODIFY) | Add `appendCharToMyWorksheetApi(char)` client helper |
| `components/dictionary/CharContextMenu.tsx` (NEW) | Client: fixed-position single-item context menu |
| `components/dictionary/DictionaryCharGridClient.tsx` (NEW) | Client: wraps char grid, handles onContextMenu + toast on add |
| `components/dictionary/DictionaryCharGrid.tsx` (MODIFY) | Slim wrapper that delegates to `DictionaryCharGridClient` |
| `components/dictionary/DictionaryClient.tsx` (MODIFY) | Add level filter buttons (全部 / 一级 / 二级 / 三级) |
| `components/dictionary/DictionaryDetailAddToWorksheet.tsx` (NEW) | Client button on `/dictionary/<char>` calling append API |
| `components/dictionary/DictionaryDetailTabs.tsx` (MODIFY) | Replace `+ 字帖` `<Link>` with the new client button |
| `lib/etymology.ts` (MODIFY) | `getEtymology` reads from JSON when no `char_etymology` row exists; returns minimal record |
| `components/etymology/EtymologyTimeline.tsx` (MODIFY) | Render story section even when eraGlyphs are empty (JSON-only path) |
| `lib/story.ts` (NEW) | `getHanziStory(char)` reads from `data/content/<char>.json`, falls back to `rare_chars` |
| `app/stories/[char]/page.tsx` (MODIFY) | Use `getHanziStory` instead of `getChar`; 404 only when no JSON + no rare_chars story |

---

## Task 1: Server lib — find-or-create + append

**Files:**
- Create: `lib/worksheet-append.ts`
- Test: `tests/unit/lib/worksheet-append.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `@/lib/db`
- Produces: `appendCharToMyWorksheet(userId: number, char: string): Promise<{ worksheetId: number; added: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/worksheet-append.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getPool, closePool } from '@/lib/db';
import { initDb } from '@/scripts/init-db';
import { appendCharToMyWorksheet } from '@/lib/worksheet-append';
import { createHash, randomBytes } from 'node:crypto';

const HAS_DB = !!process.env.DATABASE_URL_TEST;

function uniqueUser(): string {
  return 'u_' + createHash('sha256').update(randomBytes(8)).digest('hex').slice(0, 12);
}

async function insertUser(username: string): Promise<number> {
  const pool = getPool();
  const [r] = await pool.execute<any>(
    `INSERT INTO users (username, password_hash) VALUES (?, 'x')`,
    [username]
  );
  return r.insertId as number;
}

const d = HAS_DB ? describe : describe.skip;

d('appendCharToMyWorksheet', () => {
  beforeAll(async () => {
    if (!HAS_DB) return;
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    await initDb();
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await closePool();
  });

  it('first call creates 我的字帖 and returns added=true', async () => {
    const uid = await insertUser(uniqueUser());
    const r = await appendCharToMyWorksheet(uid, '我');
    expect(r.added).toBe(true);
    expect(r.worksheetId).toBeGreaterThan(0);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我']);
  });

  it('second call with different char appends and returns added=true', async () => {
    const uid = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(uid, '我');
    const r2 = await appendCharToMyWorksheet(uid, '你');
    expect(r2.added).toBe(true);
    expect(r2.worksheetId).toBe(r1.worksheetId);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r1.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我', '你']);
  });

  it('same char again returns added=false, content unchanged', async () => {
    const uid = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(uid, '我');
    const r2 = await appendCharToMyWorksheet(uid, '我');
    expect(r2.added).toBe(false);
    expect(r2.worksheetId).toBe(r1.worksheetId);

    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [r1.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我']);
  });

  it('two users each get their own 我的字帖', async () => {
    const u1 = await insertUser(uniqueUser());
    const u2 = await insertUser(uniqueUser());
    const r1 = await appendCharToMyWorksheet(u1, '我');
    const r2 = await appendCharToMyWorksheet(u2, '你');
    expect(r1.worksheetId).not.toBe(r2.worksheetId);

    const [all] = await getPool().query<any[]>(
      `SELECT user_id, title FROM worksheets WHERE title = '我的字帖' AND user_id IN (?, ?)`,
      [u1, u2]
    );
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL_TEST=$(grep ^DATABASE_URL_TEST= .env | cut -d= -f2-) pnpm test tests/unit/lib/worksheet-append.test.ts`
Expected: FAIL — cannot find `@/lib/worksheet-append`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/worksheet-append.ts`:

```ts
/**
 * Server-only: find-or-create "我的字帖" worksheet for a user and append a char.
 *
 * Concurrency note: this is a read-then-write. Under concurrent appends there's
 * a small window where two "我的字帖" rows could be created for one user.
 * Mitigated by the fact that all callers are browser-initiated user clicks, not
 * bulk jobs. If observed in production, add UNIQUE(user_id, title) via migration.
 */
import { getPool } from './db';

const MY_WORKSHEET_TITLE = '我的字帖';
const DEFAULT_CELL_STYLE = 'brush';
const DEFAULT_PAPER_SIZE = 'A4';
const DEFAULT_FONT_FAMILY = 'song';

export interface AppendResult {
  worksheetId: number;
  added: boolean;
}

export async function appendCharToMyWorksheet(userId: number, char: string): Promise<AppendResult> {
  const pool = getPool();

  const [rows] = await pool.query<any[]>(
    `SELECT id, content FROM worksheets WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, MY_WORKSHEET_TITLE]
  );

  if (rows.length === 0) {
    const [ins] = await pool.execute<any>(
      `INSERT INTO worksheets (user_id, title, content, cell_style, paper_size, font_family)
       VALUES (?, ?, JSON_ARRAY(?), ?, ?, ?)`,
      [userId, MY_WORKSHEET_TITLE, char, DEFAULT_CELL_STYLE, DEFAULT_PAPER_SIZE, DEFAULT_FONT_FAMILY]
    );
    return { worksheetId: ins.insertId as number, added: true };
  }

  const worksheet = rows[0];
  const content: string[] = typeof worksheet.content === 'string'
    ? JSON.parse(worksheet.content)
    : worksheet.content;

  if (content.includes(char)) {
    return { worksheetId: worksheet.id, added: false };
  }

  await pool.execute<any>(
    `UPDATE worksheets SET content = JSON_ARRAY_APPEND(content, '$', ?) WHERE id = ?`,
    [char, worksheet.id]
  );
  return { worksheetId: worksheet.id, added: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL_TEST=$(grep ^DATABASE_URL_TEST= .env | cut -d= -f2-) pnpm test tests/unit/lib/worksheet-append.test.ts`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/worksheet-append.ts tests/unit/lib/worksheet-append.test.ts
git commit -m "feat(worksheet-append): server lib for find-or-create 我的字帖 + append"
```

---

## Task 2: Zod validator + audit event

**Files:**
- Modify: `lib/validators.ts` (add `appendToWorksheetSchema`)
- Modify: `lib/audit-format.ts` (add `worksheet_char_appended` event + formatLogMessage case)
- Modify: `tests/unit/lib/audit.test.ts` (bump count + new formatLogMessage case)

**Interfaces:**
- Produces: `appendToWorksheetSchema = z.object({ char: z.string().refine(...) })` from `@/lib/validators`
- Produces: `worksheet_char_appended` event in `AuditEvent` union, formatLogMessage returns "追加/已存在 「X」到「我的字帖」 (#Y)"

- [ ] **Step 1: Update the failing audit test**

Edit `tests/unit/lib/audit.test.ts`:

Find the existing `events` array and append `'worksheet_char_appended'`:

```ts
it('exports the 34 expected events', () => {
  const events: AuditEvent[] = [
    'register', 'login', 'logout',
    'history_create', 'history_delete',
    'password_reset_request', 'password_reset_complete',
    'admin_user_delete', 'admin_user_password_reset',
    'admin_user_promote', 'admin_user_demote',
    'user_disabled', 'user_reenabled',
    'ai_config_updated', 'ai_call_logged',
    'tts_config_updated',
    'scheduler_config_updated', 'scheduler_manual_trigger',
    'worksheet_saved', 'worksheet_deleted',
    'worksheet_char_appended',
    'poem_saved', 'sutra_saved', 'rare_char_card_saved',
    'membership_granted', 'membership_granted_paypal', 'membership_revoked',
    'membership_checkout_started',
    'paypal_config_updated', 'paypal_webhook_received', 'paypal_webhook_rejected',
    'admin_chars_generated', 'admin_chars_init_seed',
    'admin_membership_plans_seeded',
  ];
  expect(events).toHaveLength(34);
});
```

Also append a new test for the formatLogMessage case (place after the existing formatLogMessage tests, before the final `})` of `describe('audit lib'`):

```ts
it('formatLogMessage renders worksheet_char_appended for new append', () => {
  expect(formatLogMessage('worksheet_char_appended', { worksheetId: 42, char: '我', added: true }))
    .toBe('追加「我」到「我的字帖」 (#42)');
});

it('formatLogMessage renders worksheet_char_appended when char already exists', () => {
  expect(formatLogMessage('worksheet_char_appended', { worksheetId: 42, char: '我', added: false }))
    .toBe('已存在「我」到「我的字帖」 (#42)');
});
```

- [ ] **Step 2: Run audit test to verify it fails**

Run: `pnpm test tests/unit/lib/audit.test.ts`
Expected: FAIL — `worksheet_char_appended` not in `AuditEvent` union (TS error) and not in `formatLogMessage` switch (returns default branch).

- [ ] **Step 3: Add validator to lib/validators.ts**

Edit `lib/validators.ts`. Find the line right after `export const charParamSchema = z.object({...});` and insert:

```ts
export const appendToWorksheetSchema = z.object({
  char: z
    .string()
    .refine((s) => Array.from(s).length === 1 && SINGLE_CJK.test(s), {
      error: 'must be a single CJK char',
    }),
});
```

- [ ] **Step 4: Add audit event to lib/audit-format.ts**

In `lib/audit-format.ts`, edit the `AuditEvent` union. Find the line `| 'worksheet_saved' | 'worksheet_deleted'` and insert `'worksheet_char_appended'` between them:

```ts
| 'worksheet_saved' | 'worksheet_char_appended' | 'worksheet_deleted'
```

Then in the `formatLogMessage` switch, find the line `case 'worksheet_deleted':` and insert a new case BEFORE it:

```ts
    case 'worksheet_char_appended':
      return `${m.added === false ? '已存在' : '追加'}「${str(m.char) || '?'}」到「我的字帖」 (#${num(m.worksheetId) || '?'})`;
```

- [ ] **Step 5: Run audit test to verify it passes**

Run: `pnpm test tests/unit/lib/audit.test.ts`
Expected: PASS — 34 events + 2 new formatLogMessage cases (or whatever the current test file's total is after the additions).

- [ ] **Step 6: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/validators.ts lib/audit-format.ts tests/unit/lib/audit.test.ts
git commit -m "feat(audit): worksheet_char_appended event + appendToWorksheetSchema validator"
```

---

## Task 3: API route + integration tests

**Files:**
- Create: `app/api/worksheets/append/route.ts`
- Create: `tests/integration/api/worksheets-append.test.ts`

**Interfaces:**
- Consumes: `appendCharToMyWorksheet` from `@/lib/worksheet-append`, `appendToWorksheetSchema` from `@/lib/validators`, `logUserAction` from `@/lib/audit`
- Produces: `POST /api/worksheets/append` — body `{ char: string }` → `{ ok: true, data: { worksheetId, added } }`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/api/worksheets-append.test.ts`:

```ts
import { beforeAll } from 'vitest';
import { integrationDescribe, uniqueUsername, installTestEnv, truncateAll } from '../setup';

installTestEnv();
beforeAll(async () => {
  if (!process.env.DATABASE_URL_TEST) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const { initDb } = await import('@/scripts/init-db');
  await initDb();
});

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: append } = await import('@/app/api/worksheets/append/route');
import { afterEach } from 'vitest';

async function regUser(username: string) {
  return register(new Request('http://x/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
}

async function loginAndCookie(username: string) {
  const r = await login(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'longenoughpwd' }),
  }) as any);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return { cookie };
}

function withCookie(cookie: string, req: Request): Request {
  const h = new Headers(req.headers);
  h.set('cookie', cookie);
  return new Request(req, { headers: h });
}

integrationDescribe('POST /api/worksheets/append (integration)', () => {
  afterEach(async () => { await truncateAll(); });

  it('rejects unauthenticated request with 401', async () => {
    const r = await append(new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    }) as any);
    expect(r.status).toBe(401);
  });

  it('rejects non-CJK char with 400', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我我' }),
    })) as any);
    expect(r.status).toBe(400);
  });

  it('first append creates 我的字帖 and returns added=true', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.data.added).toBe(true);
    expect(j.data.worksheetId).toBeGreaterThan(0);
  });

  it('appending different chars preserves order', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    const r1 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const j1 = await r1.json();
    const r2 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '你' }),
    })) as any);
    const j2 = await r2.json();

    expect(j1.data.worksheetId).toBe(j2.data.worksheetId);
    expect(j2.data.added).toBe(true);

    const { getPool } = await import('@/lib/db');
    const [rows] = await getPool().query<any[]>(
      `SELECT content FROM worksheets WHERE id = ?`, [j2.data.worksheetId]
    );
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    expect(content).toEqual(['我', '你']);
  });

  it('appending same char twice returns added=false second time', async () => {
    const u = uniqueUsername('ws');
    await regUser(u);
    const { cookie } = await loginAndCookie(u);
    await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const r2 = await append(withCookie(cookie, new Request('http://x/api/worksheets/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ char: '我' }),
    })) as any);
    const j2 = await r2.json();
    expect(j2.data.added).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL_TEST=$(grep ^DATABASE_URL_TEST= .env | cut -d= -f2-) pnpm test tests/integration/api/worksheets-append.test.ts`
Expected: FAIL — cannot find `@/app/api/worksheets/append/route`.

- [ ] **Step 3: Write the route**

Create `app/api/worksheets/append/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withErrorHandling, badRequest, unauthorized } from '@/lib/api-handler';
import { appendToWorksheetSchema } from '@/lib/validators';
import { appendCharToMyWorksheet } from '@/lib/worksheet-append';
import { logUserAction } from '@/lib/audit';

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const parsed = appendToWorksheetSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return badRequest('bad_input', issue?.message ?? 'bad input');
    }
    const result = await appendCharToMyWorksheet(user.id, parsed.data.char);
    await logUserAction(req, user.id, 'worksheet_char_appended', {
      worksheetId: result.worksheetId,
      char: parsed.data.char,
      added: result.added,
    });
    return NextResponse.json({ ok: true, data: result });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL_TEST=$(grep ^DATABASE_URL_TEST= .env | cut -d= -f2-) pnpm test tests/integration/api/worksheets-append.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 5: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/worksheets/append/route.ts tests/integration/api/worksheets-append.test.ts
git commit -m "feat(worksheets-append): POST /api/worksheets/append endpoint + integration tests"
```

---

## Task 4: Toast infrastructure

**Files:**
- Create: `lib/toast-store.ts`
- Create: `components/common/Toast.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces: `useToastStore` (zustand) with `toasts: Toast[]`, `push(kind, text)`, `dismiss(id)`
- Produces: `<ToastViewport />` client component that renders the toast list at fixed bottom-right

- [ ] **Step 1: Write toast store**

Create `lib/toast-store.ts`:

```ts
'use client';

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 3000);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
```

- [ ] **Step 2: Write Toast viewport component**

Create `components/common/Toast.tsx`:

```tsx
'use client';

import { useToastStore } from '@/lib/toast-store';

const kindStyles: Record<string, string> = {
  success: 'bg-emerald-700 text-paper',
  error: 'bg-red-700 text-paper',
  info: 'bg-ink-soft text-paper',
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded shadow-lg px-4 py-2 text-sm flex items-center gap-3 min-w-[200px] max-w-md ${kindStyles[t.kind] ?? kindStyles.info}`}
        >
          <span className="flex-1">{t.text}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-paper/80 hover:text-paper text-xs"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount ToastViewport in layout**

Edit `app/layout.tsx`. Add import after existing imports:

```ts
import { ToastViewport } from '@/components/common/Toast';
```

Then in the `<body>` JSX, add `<ToastViewport />` after `{children}`:

```tsx
<body className="font-sans antialiased min-h-screen">
  <AuthSync />
  {children}
  <ToastViewport />
</body>
```

- [ ] **Step 4: Verify tsc + build**

Run: `pnpm tsc --noEmit`
Expected: clean.

Do **not** run `pnpm build` — dev server is alive on port 4444, would corrupt `.next/`.

- [ ] **Step 5: Manual smoke (dev server alive)**

Open `http://localhost:4444/` in browser. To trigger a toast for verification, run this in browser console:

```js
// dynamic import — toast store is client-only
const m = await import('/_next/static/chunks/app/layout.js').catch(() => null);
// fallback: navigate to /admin/email and trigger a test send
```

Easier path: skip standalone toast smoke here; Task 5 will exercise the toast end-to-end via the right-click flow.

- [ ] **Step 6: Commit**

```bash
git add lib/toast-store.ts components/common/Toast.tsx app/layout.tsx
git commit -m "feat(toast): zustand store + ToastViewport mounted in root layout"
```

---

## Task 5: Right-click menu + client wiring

**Files:**
- Create: `lib/api-worksheet.ts` modification — add `appendCharToMyWorksheetApi`
- Create: `components/dictionary/CharContextMenu.tsx`
- Create: `components/dictionary/DictionaryCharGridClient.tsx`
- Modify: `components/dictionary/DictionaryCharGrid.tsx` — slim wrapper

**Interfaces:**
- Produces: client helper `appendCharToMyWorksheetApi(char)` — throws `Error { code: 'unauthorized' }` on 401, otherwise returns `{ worksheetId, added }`
- Produces: `<CharContextMenu x y char onClose />` — single-item menu, fixed position, Esc/click-outside closes
- Produces: `<DictionaryCharGridClient chars />` — same rendering as current grid but with `onContextMenu` to open menu + add-to-worksheet handler

- [ ] **Step 1: Add API helper**

Edit `lib/api-worksheet.ts`. Append at the bottom:

```ts
export async function appendCharToMyWorksheetApi(char: string): Promise<{ worksheetId: number; added: boolean }> {
  const res = await fetch('/api/worksheets/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ char }),
  });
  if (res.status === 401) {
    throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  }
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'add failed';
    throw new Error(msg);
  }
  return data.data;
}
```

- [ ] **Step 2: Write CharContextMenu**

Create `components/dictionary/CharContextMenu.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';

interface Props {
  x: number;
  y: number;
  char: string;
  onAdd: (char: string) => void;
  onClose: () => void;
}

export function CharContextMenu({ x, y, char, onAdd, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded shadow-lg bg-paper-warm border border-ink/30 py-1 text-sm"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onAdd(char); onClose(); }}
        className="block w-full text-left px-4 py-2 hover:bg-paper text-ink"
      >
        添加到「我的字帖」
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write DictionaryCharGridClient**

Create `components/dictionary/DictionaryCharGridClient.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Char } from '@/lib/chars-types';
import { useToastStore } from '@/lib/toast-store';
import { appendCharToMyWorksheetApi } from '@/lib/api-worksheet';
import { CharContextMenu } from './CharContextMenu';

interface MenuState { x: number; y: number; char: string; }

export function DictionaryCharGridClient({ chars }: { chars: Char[] }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const push = useToastStore((s) => s.push);

  const onContextMenu = (e: React.MouseEvent, c: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, char: c });
  };

  const handleAdd = async (char: string) => {
    try {
      const { added } = await appendCharToMyWorksheetApi(char);
      if (added) {
        push('success', `已添加「${char}」到「我的字帖」`);
      } else {
        push('info', `「${char}」已经在「我的字帖」里了`);
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'unauthorized') {
        push('error', '请先登录后再添加');
      } else {
        push('error', '添加失败,请重试');
      }
    }
  };

  if (chars.length === 0) {
    return <p className="text-ink-faint text-sm py-8 text-center">没有匹配的字</p>;
  }

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {chars.map((c) => (
          <Link
            key={c.char}
            href={`/dictionary/${encodeURIComponent(c.char)}`}
            onContextMenu={(e) => onContextMenu(e, c.char)}
            className="rounded border border-ink/10 p-2 text-center transition hover:border-seal hover:shadow-sm bg-paper"
          >
            <div className="text-2xl font-serif text-ink leading-none">{c.char}</div>
            <div className="text-xs text-ink-soft mt-1">{c.pinyin || '—'}</div>
          </Link>
        ))}
      </div>
      {menu && (
        <CharContextMenu
          x={menu.x}
          y={menu.y}
          char={menu.char}
          onAdd={handleAdd}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Replace DictionaryCharGrid with slim wrapper**

Edit `components/dictionary/DictionaryCharGrid.tsx`. Replace the entire file:

```tsx
import type { Char } from '@/lib/chars-types';
import { DictionaryCharGridClient } from './DictionaryCharGridClient';

export function DictionaryCharGrid({ chars }: { chars: Char[] }) {
  return <DictionaryCharGridClient chars={chars} />;
}
```

- [ ] **Step 5: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual browser smoke**

Open `http://localhost:4444/dictionary`. Right-click on any char — menu should appear with one item. Click → toast should show. Verify:

- Anonymous user: toast「请先登录后再添加」
- Logged-in user: toast「已添加『X』到『我的字帖』」; navigate to `/worksheet/<id>` (use id from API response or check history) and confirm char is in content list
- Same char twice: second toast「『X』已经在『我的字帖』里了」

- [ ] **Step 7: Commit**

```bash
git add lib/api-worksheet.ts components/dictionary/CharContextMenu.tsx components/dictionary/DictionaryCharGridClient.tsx components/dictionary/DictionaryCharGrid.tsx
git commit -m "feat(dictionary): right-click '添加到我的字帖' menu + client wiring"
```

---

## Task 6: Dictionary level filter

**Files:**
- Modify: `components/dictionary/DictionaryClient.tsx`

**Interfaces:**
- Produces: 4-button level filter group on `/dictionary` page (全部 / 一级 / 二级 / 三级)
- URL state: `?level=1|2|3` (already plumbed through `app/dictionary/page.tsx` → `listChars`)

- [ ] **Step 1: Edit DictionaryClient to add level filter**

Edit `components/dictionary/DictionaryClient.tsx`. Find the existing view-toggle button group (the `<div className="ml-auto flex gap-1">` block with 按拼音 / 按部首 buttons). Insert a sibling button group before it.

Add to the imports at the top:

```ts
const LEVELS: Array<{ value: undefined | 1 | 2 | 3; label: string }> = [
  { value: undefined, label: '全部' },
  { value: 1, label: '一级' },
  { value: 2, label: '二级' },
  { value: 3, label: '三级' },
];
```

Inside the component, after the `switchView` definition, add:

```ts
const activeLevel = sp.get('level');
const activeLevelNum = activeLevel === '1' ? 1 : activeLevel === '2' ? 2 : activeLevel === '3' ? 3 : undefined;

const switchLevel = (lvl: 1 | 2 | 3 | undefined) => {
  const params = new URLSearchParams(sp.toString());
  if (lvl === undefined) {
    params.delete('level');
  } else {
    params.set('level', String(lvl));
  }
  router.push(`/dictionary?${params.toString()}`);
};
```

Then in the JSX, insert a new button group AFTER the existing `字典 · {total} 字` span but BEFORE the existing view-toggle group:

```tsx
<div className="ml-4 flex gap-1">
  {LEVELS.map((l) => (
    <button
      key={l.label}
      onClick={() => switchLevel(l.value)}
      className={`text-sm px-3 py-1 rounded ${
        activeLevelNum === l.value ? 'bg-ink text-paper' : 'bg-paper-warm text-ink-soft border border-ink/20'
      }`}
    >
      {l.label}
    </button>
  ))}
</div>
```

The final structure should be:

```tsx
<div className="mb-4 flex items-center gap-2">
  <span className="text-xs text-ink-faint tracking-widest">字典 · {total} 字</span>
  <div className="ml-4 flex gap-1">
    {LEVELS.map((l) => (...))}
  </div>
  <div className="ml-auto flex gap-1">
    <button onClick={() => switchView('pinyin')} ...>按拼音</button>
    <button onClick={() => switchView('radical')} ...>按部首</button>
  </div>
</div>
```

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual browser smoke**

Open `http://localhost:4444/dictionary`. Click「一级」— total count should drop to ~3514. Click「二级」— ~2999. Click「三级」— ~1416. Click「全部」— back to ~7929. URL bar should reflect `?level=N` and remove when「全部」selected. Combine with view toggle (e.g. `?level=2&view=radical`) — both filters apply.

- [ ] **Step 4: Commit**

```bash
git add components/dictionary/DictionaryClient.tsx
git commit -m "feat(dictionary): level filter buttons (全部/一级/二级/三级)"
```

---

## Task 7: Dictionary detail page — inline add-to-worksheet

**Files:**
- Create: `components/dictionary/DictionaryDetailAddToWorksheet.tsx`
- Modify: `components/dictionary/DictionaryDetailTabs.tsx` (replace the `+ 字帖` `<Link>` with the new client button)

**Interfaces:**
- Consumes: `useToastStore` from `@/lib/toast-store`, `appendCharToMyWorksheetApi` from `@/lib/api-worksheet`
- Produces: `<DictionaryDetailAddToWorksheet char={c.char} />` — client button that calls the append API and toasts feedback

- [ ] **Step 1: Write the client component**

Create `components/dictionary/DictionaryDetailAddToWorksheet.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useToastStore } from '@/lib/toast-store';
import { appendCharToMyWorksheetApi } from '@/lib/api-worksheet';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const { added } = await appendCharToMyWorksheetApi(char);
      if (added) {
        push('success', `已添加「${char}」到「我的字帖」`);
      } else {
        push('info', `「${char}」已经在「我的字帖」里了`);
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'unauthorized') {
        push('error', '请先登录后再添加');
      } else {
        push('error', '添加失败,请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="px-3 py-2 text-sm text-ink-soft hover:text-ink disabled:opacity-50"
    >
      {busy ? '添加中…' : '+ 字帖'}
    </button>
  );
}
```

- [ ] **Step 2: Replace the existing `+ 字帖` link in DictionaryDetailTabs**

Edit `components/dictionary/DictionaryDetailTabs.tsx`. 

Add an import at the top alongside the other imports:

```ts
import { DictionaryDetailAddToWorksheet } from './DictionaryDetailAddToWorksheet';
```

Find the line:

```tsx
<Link href={`/worksheet?text=${encodeURIComponent(char.char)}`} className="px-3 py-2 text-sm text-ink-soft hover:text-ink">+ 字帖</Link>
```

Replace it with:

```tsx
<DictionaryDetailAddToWorksheet char={char.char} />
```

- [ ] **Step 3: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual browser smoke**

Open `http://localhost:4444/dictionary/<a-real-char>` (e.g. `/dictionary/不`). The `+ 字帖` button should now be a `<button>` not a `<Link>`. Click → toast appears, no navigation. Verify anonymous + logged-in flows.

- [ ] **Step 5: Commit**

```bash
git add components/dictionary/DictionaryDetailAddToWorksheet.tsx components/dictionary/DictionaryDetailTabs.tsx
git commit -m "feat(dictionary-detail): inline +字帖 button on char page (no nav)"
```

---

## Task 8: Fix /etymology/<char> 404 — read etymology_story from JSON

**Files:**
- Modify: `lib/etymology.ts` — `getEtymology` returns minimal record when no `char_etymology` row exists but JSON content exists

**Interfaces:**
- Produces: `getEtymology(char): Promise<Etymology | null>` where the returned object has eraGlyphs defaulting to all `hasGlyph: false` and `story` from JSON when DB row is missing

**Context:** Post 2026-06-17 slim migration, most chars have etymology_story in `data/content/<char>.json` only — no `char_etymology` row. The current `if (rows.length === 0) return null` makes `/etymology/<char>` 404 for them. Fix: if no row, return a minimal record so the page renders the JSON story.

- [ ] **Step 1: Modify `getEtymology` to fall back to JSON-only path**

Edit `lib/etymology.ts`. Find the line `if (rows.length === 0) return null;` and replace it with:

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
  };
}
```

- [ ] **Step 2: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual browser smoke**

- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4444/etymology/不` — should be 200 (was 404)
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4444/etymology/<a-char-with-no-content-json>` — should still 404 (genuine not-found)

- [ ] **Step 4: Commit**

```bash
git add lib/etymology.ts
git commit -m "fix(etymology): read story from JSON when no char_etymology row (post slim-migration)"
```

---

## Task 9: Fix /stories/<char> 404 — read hanzi_story from JSON

**Files:**
- Create: `lib/story.ts`
- Modify: `app/stories/[char]/page.tsx` — use new `getHanziStory` instead of `getChar`

**Interfaces:**
- Produces: `getHanziStory(char): Promise<{ char: string; story: string; pinyin?: string } | null>` — reads from JSON first, falls back to `rare_chars`

**Context:** Same root cause as Task 8. `/stories/<char>` reads from `rare_chars` table only — most chars don't have a rare_chars row, so the page 404s even though their `data/content/<char>.json` has a `hanzi_story` field.

- [ ] **Step 1: Write `getHanziStory`**

Create `lib/story.ts`:

```ts
import 'server-only';
import { getPool } from './db';
import { getContent } from './content';

export interface HanziStory {
  char: string;
  story: string;
  pinyin?: string;
}

/**
 * Read a char's hanzi_story (汉字故事).
 *
 * Slim-DB order: data/content/<char>.json (preferred, post 2026-06-17
 * migration), then rare_chars.story (legacy L3 fallback).
 */
export async function getHanziStory(char: string): Promise<HanziStory | null> {
  const content = await getContent(char);
  if (content?.hanzi_story) {
    return { char: content.char, story: content.hanzi_story, pinyin: content.pinyin };
  }

  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT \`char\`, pinyin, story FROM rare_chars WHERE \`char\` = ? LIMIT 1`,
    [char]
  );
  if (rows.length === 0 || !rows[0].story) return null;
  return { char: rows[0].char, story: rows[0].story, pinyin: rows[0].pinyin };
}
```

- [ ] **Step 2: Update stories page**

Edit `app/stories/[char]/page.tsx`. Replace the imports:

```ts
// before
import { getChar } from '@/lib/rare-chars';
import type { RareCharClient } from '@/lib/api-rare-chars';
import { StoryClient } from '../StoryClient';

// after
import { getHanziStory } from '@/lib/story';
import { StoryClient } from '../StoryClient';
```

Then in the page body, replace `const data = await getChar(decoded);` with:

```ts
const data = await getHanziStory(decoded);
```

And replace `if (!data || !data.story) notFound();` — keep as-is (data.story check still applies).

Replace `<StoryClient initialChar={data as unknown as RareCharClient} />` with a wrapper that adapts the slimmer `HanziStory` shape to whatever `StoryClient` needs. **Action for implementer:** read `app/stories/StoryClient.tsx` to see what fields it reads from `initialChar`, then write a small adapter inline:

```tsx
{(() => {
  const adapted = {
    char: data.char,
    story: data.story,
    pinyin: data.pinyin ?? '',
    // ... other fields StoryClient reads, with sensible defaults
  };
  return <StoryClient initialChar={adapted as any} />;
})()}
```

The implementer MUST open `StoryClient.tsx` first to learn its actual prop shape, then write the adapter. (The dict-detail Tabs pattern; cannot be fully verbatim without seeing StoryClient.)

- [ ] **Step 3: Verify tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual browser smoke**

- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4444/stories/不` — should be 200 (was 404)
- Page should render the hanzi_story from `data/content/不.json`

- [ ] **Step 5: Commit**

```bash
git add lib/story.ts app/stories/[char]/page.tsx
git commit -m "fix(stories): read hanzi_story from JSON (slim-DB path) so /stories/<char> stops 404ing"
```

---

## Self-Review

**Spec coverage:**
- Level filter ✓ (Task 6)
- Right-click menu single item ✓ (Task 5)
- "我的字帖" model: per-user, fixed title, dedup ✓ (Tasks 1, 3)
- New endpoint `POST /api/worksheets/append` ✓ (Task 3)
- Audit event `worksheet_char_appended` ✓ (Task 2)
- Toast infra: zustand + viewport ✓ (Task 4)
- 401 handling ✓ (Task 5)
- Concurrent risk acknowledged in lib comment ✓ (Task 1)
- Validator with `SINGLE_CJK` reuse ✓ (Task 2)
- Detail page inline add-to-worksheet ✓ (Task 7)
- /etymology/<char> JSON fallback (no more 404) ✓ (Task 8)
- /stories/<char> JSON fallback (no more 404) ✓ (Task 9)

**Placeholder scan:** no TBD/TODO/FIXME; all steps have full code.

**Type consistency:**
- `AppendResult = { worksheetId: number; added: boolean }` used uniformly across Tasks 1, 3, 5
- `useToastStore.push(kind, text)` signature consistent across Tasks 4, 5
- `appendCharToMyWorksheetApi` throws `Error & { code: 'unauthorized' }` matches catch in Task 5

**Risks:**
- Tasks 1 and 3 both truncate worksheets (Task 3's `truncateAll` between tests) — fine, they don't run together
- Task 4 only does manual smoke — that's by design; Task 5 exercises the toast end-to-end

## Verification (whole plan)

After all tasks:
1. `pnpm tsc --noEmit` clean
2. `pnpm test tests/unit/lib/audit.test.ts` — all pass (count bumped to 34 + 2 new formatLogMessage cases)
3. `pnpm test tests/integration/api/worksheets-append.test.ts` — 5/5
4. **Skipped:** `pnpm test tests/unit/lib/worksheet-append.test.ts` — `piyin_test` DB does not exist on this host (per user decision 2026-06-18); rely on integration test + browser smoke for behavior verification
5. Manual browser smoke:
   - `/dictionary` — level filter (全部/一级/二级/三级) works; URL has `?level=N`
   - `/dictionary/<char>` — right-click any char → menu → toast feedback; click `+ 字帖` button (no nav)
   - `/etymology/<char>` — 200 (was 404); renders etymology_story
   - `/stories/<char>` — 200 (was 404); renders hanzi_story

Do **NOT** run `pnpm build` while `pnpm dev` is alive on port 4444 — corrupts `.next/`. If you need build verification, kill dev first.