# Image-to-Char (拍照识别单字) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 拍照 (📷) button next to the `/pinyin` textarea that recognizes a single Chinese character from a photo via MiniMax-M3 vision and appends it to the textarea. Anonymous users get 5/day/IP; logged-in users need `ai_calls` membership + 5/day/user.

**Architecture:** Client-side `<input type="file" accept="image/*" capture="environment">` captures image → FileReader + canvas resize → base64 data URL → POST `/api/ai/char-recognize` → server validates gating/rate-limit → `lib/llm.ts` multimodal call to MiniMax-M3 → hard-validate response (length=1, CJK BMP) → return `{ ok, char }` → client appends to textarea. Errors surface as inline toasts (3s auto-dismiss). No new dependencies.

**Tech Stack:** Next.js 15.5.19 App Router + React 19 + mysql2/promise + `lib/llm.ts` (extending existing OpenAI-compatible HTTP client with multimodal content type) + `lib/ai-calls.ts` (reusing `withAiLogging()` + adding `checkAnonRateLimit()`) + Lucide `Camera` icon + `vitest` + `mock_mode='true'` short-circuit for LLM tests.

**Commit strategy:** 3 commits (one per task), each with `[2026-08-05 HH.MM]` suffix per `feedback-commit-timestamps.md`. TDD discipline requires tests ship with their code.

## Global Constraints

- **package manager**: `npm` (per `project-uses-npm.md`); no new deps this plan
- **Vision model**: reuse the existing `ai.model` config (default `MiniMax-M3`) — no new config key. If MiniMax-M3 turns out to lack vision support, follow-up work adds `ai.vision_model` override.
- **mysql2**: select via `pool.query()` (text protocol); insert via `pool.query()` for parameter binding (per `lib/ai-calls.ts:20` pattern; this codebase uses `pool.query` for INSERTs, NOT `pool.execute`, due to mojibake bug)
- **TypeScript strict**: no `any` leaks in exported interfaces; `LLMMessage.content` union is the key contract
- **Tests**: vitest, mock-LLM via `ai.mock_mode='true'` (already supported at `lib/llm.ts:45-49`)
- **Test path convention**: `tests/unit/app/api/<route-path>.test.ts` mirrors `app/api/<route-path>/route.ts` (e.g., `tests/unit/lib/llm.test.ts` for `lib/llm.ts`)
- **Commits**: append `[YYYY-MM-DD HH.MM]` per `feedback-commit-timestamps.md`
- **Branch**: local main only (no auto-push per `no-prod-env-2026-06-21.md`)
- **Anonymous rate limit**: tracked via `ai_calls` table with `user_id IS NULL` + new `ip` column. `ai_calls.user_id BIGINT NULL` ✅ already allowed (per `scripts/init-db.ts:283`); need to add `ip VARCHAR(45) NULL` column + `idx_ai_calls_ip_created` index via migration
- **Image constraints**: ≤ 5MB raw; client-side resize to 1024px wide, JPEG quality 0.8 before upload; server-side validates data URL prefix (`image/jpeg|png|webp`) and decoded length
- **Hard response validation**: trimmed response must be exactly 1 char, code point in BMP (U+0000..U+FFFF), Unicode block CJK Unified Ideographs (U+4E00..U+9FFF) or extensions (U+3400..U+4DBF, U+F900..U+FAFF). Any other → 502 `not_recognized`
- **API error response shape**: `{ ok: false, error: '<code>', message: '<chinese-msg>' }` (mirrors existing 401/403/404 patterns in `app/api/ai/char-explain/route.ts`)
- **REDEPLOY**: no REDEPLOY bump this plan (user-facing feature, no production schema change beyond the `ai_calls` migration; bumps on next wave that ships admin-visible changes)
- **Inline `char-explain` rate limit fix**: this plan adds the missing `checkAiRateLimit()` call to `app/api/ai/char-explain/route.ts` (1 line, consistent with new feature)

### Schema notes (verified against init-db.ts)

`ai_calls` table (per `scripts/init-db.ts:281-297`):
```sql
id BIGINT, user_id BIGINT NULL, feature VARCHAR(32), model VARCHAR(64),
status ENUM('ok','error','rate-limited'), prompt_tokens INT, completion_tokens INT,
duration_ms INT, error TEXT, metadata JSON, created_at DATETIME,
KEY idx_user_created (user_id, created_at DESC),
KEY idx_feature_created (feature, created_at DESC),
KEY idx_status (status, created_at DESC)
```

This plan adds:
```sql
ALTER TABLE ai_calls ADD COLUMN ip VARCHAR(45) NULL AFTER user_id;
ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at DESC);
```

The new index `idx_ai_calls_ip_created (ip, created_at DESC)` covers the anonymous rate-limit query (`WHERE user_id IS NULL AND ip = ? AND created_at >= CURDATE()` via prefix + range).

---

### Task 1: LLM multimodal content type extension (TDD) + AI_FEATURE_ZH entry

**Files:**
- Modify: `lib/llm.ts` (extend `LLMMessage.content` to union; add `ContentPart` type)
- Modify: `lib/admin-activity.ts` (add `recognize: '拍照识别'` to `AI_FEATURE_ZH`)
- Create: `tests/unit/lib/llm.test.ts` (5 multimodal cases)

**Interfaces:**
- Produces: `ContentPart` type (`{type:'text', text} | {type:'image_url', image_url:{url, detail?}}`) + extended `LLMMessage.content: string | ContentPart[]` — consumed by Task 2's `app/api/ai/char-recognize/route.ts`
- Produces: `AI_FEATURE_ZH['recognize'] = '拍照识别'` — consumed by `lib/admin-activity.ts` `formatAiFeature()` so admin audit log shows Chinese name

- [ ] **Step 1: Write failing tests for multimodal content**

Create `tests/unit/lib/llm.test.ts` with this complete content:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let configStore: Record<string, string> = {};
let lastFetchBody: any = null;
let lastFetchUrl: string | null = null;
let mockReply: string | null = null;

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(async (key: string) => configStore[key] ?? null),
}));

const fetchMock = vi.fn(async (url: string, init: any) => {
  lastFetchUrl = url;
  lastFetchBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: mockReply ?? 'mock-reply' } }],
    }),
    text: async () => JSON.stringify({ choices: [{ message: { content: mockReply ?? 'mock-reply' } }] }),
  };
});
vi.stubGlobal('fetch', fetchMock);

import { llmChat, type LLMMessage, type ContentPart } from '@/lib/llm';

beforeEach(() => {
  configStore = {};
  lastFetchBody = null;
  lastFetchUrl = null;
  mockReply = null;
  fetchMock.mockClear();
});

describe('LLM multimodal content', () => {
  it('text-only content: serializes as string (backward compat)', async () => {
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(lastFetchBody.messages[0].content).toBe('hello');
  });

  it('image_url content: serializes as OpenAI multipart format', async () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,XYZ' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content).toEqual(content);
    expect(lastFetchBody.messages[0].content[0].type).toBe('image_url');
    expect(lastFetchBody.messages[0].content[0].image_url.url).toBe('data:image/jpeg;base64,XYZ');
  });

  it('mixed text + image content: preserves order', async () => {
    const content: ContentPart[] = [
      { type: 'text', text: '识别此图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content[0]).toEqual({ type: 'text', text: '识别此图' });
    expect(lastFetchBody.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } });
  });

  it('detail field passes through to image_url', async () => {
    const content: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,X', detail: 'low' } },
    ];
    await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content }],
    });
    expect(lastFetchBody.messages[0].content[0].image_url.detail).toBe('low');
  });

  it('mock_mode short-circuit: returns vision mock char for array content', async () => {
    configStore['ai.mock_mode'] = 'true';
    const result = await llmChat({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,X' } }] }],
    });
    expect(result.content).toBe('中');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/lib/llm.test.ts`
Expected: FAIL — `Failed to resolve import` for `ContentPart` (type not exported), `messages[0].content` is `string` not `ContentPart[]` (4 of 5 tests fail with type errors at runtime via image_url test, or with `toEqual` mismatch).

- [ ] **Step 3: Extend `LLMMessage.content` type in `lib/llm.ts`**

Modify `lib/llm.ts`. **Replace lines 3-6** (the existing `LLMMessage` interface) with this complete block:

```ts
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}
```

**Do NOT modify `llmChat` body** — it already accepts `messages` and forwards to `fetch` via `JSON.stringify({ ..., messages: args.messages })`. The new union type flows through JSON serialization naturally.

Now **update `mockReply`** to handle both string and array input. The function is at `lib/llm.ts:101-140` and currently has specific keyword routing (`'字源演变'`, `'concise English gloss'`, etc.) used by `/admin/chars/init` and `lib/ai-rare-chars.ts` in mock mode. **Preserve the existing keyword routing** for string input; **add a vision branch** that returns a deterministic single CJK char for array input. Replace the existing `mockReply` function with this updated version (the function signature changes; the body keeps all existing branches and adds one new array branch at the top):

```ts
function mockReply(input: string | ContentPart[]): string {
  // Vision / multimodal path (char-recognize etc.): return a deterministic CJK char.
  // The hard validation in /api/ai/char-recognize accepts only length=1 + CJK BMP,
  // so the mock must return such a char — '中' is the conventional test fixture.
  if (Array.isArray(input)) {
    return '中';
  }
  // char-ai features. Note: mock return values must NOT contain the same
  // keywords we match on, because meaning_zh writes to chars.meaning_zh and
  // subsequent calls (e.g. variants) interpolate that into their prompt as
  // "释义: <meaning_zh>" — a keyword inside the stored value would cause
  // the wrong branch to fire.
  if (input.includes('字源演变')) {
    return 'MOCK-etym-字源故事。' + 'A'.repeat(80) + '(占位填充)';
  }
  if (input.includes('concise English gloss')) {
    return 'MOCK-en-gloss for the char';
  }
  if (input.includes('中文释义')) {
    return 'MOCK-zh-meaning 占位';
  }
  if (input.includes('所有常见读音')) {
    return '["mock-yī", "mock-yí"]';
  }
  if (input.includes('异体')) {
    return '["mock-变体A", "mock-变体B"]';
  }
  if (input.includes('形、义、用')) {
    return 'MOCK-explainChar 形义用解释';
  }
  // ai-rare-chars single-char: ask for "meaning only" / "story only" / both.
  if (input.includes('meaning only')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: 'MOCK-rare-mn', story: '' }]);
  }
  if (input.includes('story only')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: '', story: 'MOCK-rare-st 占位' }]);
  }
  if (input.includes('meaning') && input.includes('story')) {
    return JSON.stringify([{ char: '?', pinyin: '', meaning: 'MOCK-rare-mn', story: 'MOCK-rare-st' }]);
  }
  // ai-rare-chars batch path.
  if (input.includes('汉字列表')) {
    return '[]';
  }
  return 'MOCK-generic-llm-reply';
}
```

- [ ] **Step 4: Add `recognize: '拍照识别'` to `AI_FEATURE_ZH`**

Modify `lib/admin-activity.ts`. Find the `AI_FEATURE_ZH` constant (it's a `Record<string, string>`). Add this entry as the last line of the object:

```ts
  recognize: '拍照识别',
```

(Ensure the previous entry ends with `,` and this entry is followed by the closing `};`)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/unit/lib/llm.test.ts`
Expected: PASS — `Tests 5 passed (5)`

- [ ] **Step 6: Run tsc, verify clean**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add lib/llm.ts lib/admin-activity.ts tests/unit/lib/llm.test.ts
git commit -m "feat(ai-vision): multimodal content type in lib/llm.ts [2026-08-05 HH.MM]

  - lib/llm.ts: LLMMessage.content union with ContentPart (text | image_url);
    mockReply helper handles both string and ContentPart[] for mock_mode
  - lib/admin-activity.ts: AI_FEATURE_ZH += recognize: '拍照识别'
  - tests/unit/lib/llm.test.ts: 5 multimodal cases (text-only back-compat,
    image_url serialization, mixed order, detail field, mock_mode)
  - Backward-compatible: existing text-only call sites unchanged
  - Used by /api/ai/char-recognize (Task 2)"
```

---

### Task 2: API layer — migration + `checkAnonRateLimit` + `/api/ai/char-recognize` + `char-explain` rate limit fix (TDD)

**Files:**
- Create: `scripts/migrations/2026-08-05-ai-calls-ip.sql` (DDL: ADD COLUMN ip + idx for existing prod DBs)
- Modify: `scripts/init-db.ts` (CREATE TABLE for fresh DBs adds `ip` column + `idx_ai_calls_ip_created`)
- Modify: `lib/ai-calls.ts` (extend `logAiCall` with `ip` field; add `checkAnonRateLimit(ip)`)
- Modify: `app/api/ai/char-explain/route.ts` (add missing `checkAiRateLimit()` call)
- Create: `app/api/ai/char-recognize/route.ts` (new POST handler)
- Create: `tests/unit/app/api/ai/char-recognize.test.ts` (5 route cases)

**Interfaces:**
- Consumes: `ContentPart` type from `lib/llm.ts` (Task 1)
- Consumes: `logAiCall`, `withAiLogging`, `checkAiRateLimit`, `RateLimitError` from `lib/ai-calls.ts`
- Consumes: `llmChat` from `lib/llm.ts` (Task 1)
- Consumes: `getCurrentUser` from `lib/auth`, `hasFeature` from `lib/membership`
- Produces: `checkAnonRateLimit(ip: string): Promise<{ exceeded: boolean; count: number }>` — only used internally by the new route
- Produces: `POST /api/ai/char-recognize` — returns `{ ok: true, char: string }` or `{ ok: false, error: string, message: string }`

- [ ] **Step 1: Write failing tests for `/api/ai/char-recognize`**

Create `tests/unit/app/api/ai/char-recognize.test.ts` with this complete content:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const cookieStore = new Map<string, string>();
let currentUser: { id: number; isAdmin: boolean } | null = null;
let hasAiCallsFeature = true;
let anonCount = 0;
let userCount = 0;
let llmMockReply: string = '中';
let llmShouldThrow: Error | null = null;

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    get: (name: string) => cookieStore.has(name)
      ? { name, value: cookieStore.get(name)! }
      : undefined,
  }),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

vi.mock('@/lib/membership', () => ({
  hasFeature: vi.fn(async (_userId: number, feature: string) =>
    feature === 'ai_calls' ? hasAiCallsFeature : false
  ),
}));

vi.mock('@/lib/ai-calls', () => ({
  checkAiRateLimit: vi.fn(async (_userId: number) => userCount < 5),
  checkAnonRateLimit: vi.fn(async (_ip: string) => ({ exceeded: anonCount >= 5, count: anonCount })),
  logAiCall: vi.fn(async () => { /* no-op */ }),
  withAiLogging: vi.fn(async (args: any, fn: () => Promise<any>) => {
    const start = Date.now();
    try { return await fn(); }
    finally { /* logAiCall would be called here */ }
  }),
  RateLimitError: class extends Error { constructor() { super('rate limit'); this.name = 'RateLimitError'; } },
}));

vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(async () => {
    if (llmShouldThrow) throw llmShouldThrow;
    return { content: llmMockReply };
  }),
}));

import { POST } from '@/app/api/ai/char-recognize/route';

beforeEach(() => {
  cookieStore.clear();
  currentUser = null;
  hasAiCallsFeature = true;
  anonCount = 0;
  userCount = 0;
  llmMockReply = '中';
  llmShouldThrow = null;
  vi.clearAllMocks();
});

function makeReq(body: any, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/ai/char-recognize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/char-recognize', () => {
  it('anonymous success: 200, returns { ok: true, char }, 5 in a row then 6th = 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, char: '中' });
    }
    // 6th call: anonCount is now 5 in the check
    anonCount = 5;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('rate_limited');
  });

  it('logged-in without ai_calls: returns 403 membership_required', async () => {
    currentUser = { id: 100, isAdmin: false };
    hasAiCallsFeature = false;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('membership_required');
  });

  it('logged-in with ai_calls but over limit: returns 429', async () => {
    currentUser = { id: 100, isAdmin: false };
    userCount = 5;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(429);
  });

  it('invalid image: missing data URL prefix returns 400', async () => {
    const res = await POST(makeReq({ image: 'not-a-data-url' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_image');
  });

  it('LLM returns non-CJK: returns 502 not_recognized', async () => {
    llmMockReply = 'abc';
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('not_recognized');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/app/api/ai/char-recognize.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/ai/char-recognize/route"` (5 test errors).

- [ ] **Step 3: Create the migration file**

Create `scripts/migrations/2026-08-05-ai-calls-ip.sql` with this complete content:

```sql
-- Add ip column + index for anonymous rate-limit queries on ai_calls.
-- Existing schema (per scripts/init-db.ts:281-297) has user_id BIGINT NULL.
-- Anonymous rows will have user_id IS NULL + ip = <client-ip>.

ALTER TABLE ai_calls ADD COLUMN ip VARCHAR(45) NULL AFTER user_id;
ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at DESC);
```

- [ ] **Step 4: Extend `logAiCall` to record `ip`, and add `checkAnonRateLimit` in `lib/ai-calls.ts`**

Modify `lib/ai-calls.ts`. **Two changes**:

**4a. Extend the `LogAiCallArgs` interface (lines 6-16)** — add `ip?: string | null` field. Replace the existing interface with:

```ts
export interface LogAiCallArgs {
  userId: number | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  /** Client IP for anonymous callers; written to `ai_calls.ip` for rate-limit queries. */
  ip?: string | null;
}
```

**4b. Update `logAiCall` INSERT (lines 21-34)** to include `ip` column. Replace the existing INSERT block with:

```ts
    await getPool().query(
      `INSERT INTO ai_calls
         (user_id, ip, feature, model, status, prompt_tokens, completion_tokens, duration_ms, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.userId,
        args.ip ?? null,
        args.feature,
        args.model,
        args.status,
        args.promptTokens ?? null,
        args.completionTokens ?? null,
        args.durationMs ?? null,
        args.error ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
```

**4c. Append `checkAnonRateLimit`** at the end of the file (after `withAiLogging`):

```ts
/**
 * Anonymous rate limit check for clients without a session.
 * Counts `ai_calls` rows with `user_id IS NULL AND ip = <ip>` since today.
 * Threshold mirrors `checkAiRateLimit`: 5/day by default, configurable via
 * `ai.rate_limit_per_user_per_day` (same config key; both paths share the limit).
 */
export async function checkAnonRateLimit(ip: string): Promise<{ exceeded: boolean; count: number }> {
  const limitStr = await getConfig('ai.rate_limit_per_user_per_day');
  const limit = limitStr ? parseInt(limitStr, 10) : 5;
  if (limit <= 0) return { exceeded: false, count: 0 };
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM ai_calls
     WHERE user_id IS NULL AND ip = ? AND created_at >= CURDATE()
       AND status IN ('ok','error')`,
    [ip],
  );
  const count = Number(rows[0].n);
  return { exceeded: count >= limit, count };
}
```

- [ ] **Step 5: Add `ip` column + index to `ai_calls` CREATE TABLE in `scripts/init-db.ts`**

Modify `scripts/init-db.ts` at lines 281-297 (the `CREATE TABLE IF NOT EXISTS ai_calls (...)` block). **Add the `ip` column and `idx_ai_calls_ip_created` index** so fresh DBs (via the init wizard) get the same schema as the migration ALTER. The existing CREATE TABLE block becomes:

```ts
  `CREATE TABLE IF NOT EXISTS ai_calls (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     user_id     BIGINT       NULL,
     ip          VARCHAR(45)  NULL,
     feature     VARCHAR(32)  NOT NULL,
     model       VARCHAR(64)  NOT NULL,
     status      ENUM('ok','error','rate-limited') NOT NULL,
     prompt_tokens     INT UNSIGNED NULL,
     completion_tokens INT UNSIGNED NULL,
     duration_ms INT UNSIGNED NULL,
     error       TEXT         NULL,
     metadata    JSON         NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_feature_created (feature, created_at DESC),
     KEY idx_user_created (user_id, created_at DESC),
     KEY idx_ai_calls_ip_created (ip, created_at DESC),
     KEY idx_status (status, created_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
```

This is the symmetric partner of the migration: init wizard covers fresh DBs, migration ALTER covers already-deployed prod DBs.

- [ ] **Step 6: Create `app/api/ai/char-recognize/route.ts`**

Create `app/api/ai/char-recognize/route.ts` with this complete content:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { hasFeature } from '@/lib/membership';
import { llmChat, getConfig } from '@/lib/llm';
import { logAiCall, checkAiRateLimit, checkAnonRateLimit } from '@/lib/ai-calls';

const VALID_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB after base64 decode ~ 6.67MB raw

function isCjkBmpChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||  // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) ||  // CJK Extension A
    (cp >= 0xf900 && cp <= 0xfaff)     // CJK Compatibility Ideographs
  );
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) ?? null;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid_image', message: '请求体格式错误' }, { status: 400 }); }

  const image = typeof body?.image === 'string' ? body.image : '';
  if (!image || !VALID_PREFIXES.some((p) => image.startsWith(p))) {
    return NextResponse.json({ ok: false, error: 'invalid_image', message: '图片格式或大小不支持' }, { status: 400 });
  }
  // Approximate decoded size: base64 length × 3/4, subtract padding.
  const decodedApprox = Math.floor(image.length * 3 / 4);
  if (decodedApprox > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: 'invalid_image', message: '图片过大' }, { status: 400 });
  }

  const user = await getCurrentUser();

  // Gating: anonymous vs logged-in
  if (user) {
    if (!await hasFeature(user.id, 'ai_calls')) {
      return NextResponse.json({ ok: false, error: 'membership_required', message: '拍照识别需要 AI 会员权限' }, { status: 403 });
    }
    if (!await checkAiRateLimit(user.id)) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '今日次数已用完,明天再来' }, { status: 429 });
    }
  } else {
    if (!ip) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '无法识别客户端' }, { status: 429 });
    }
    const { exceeded } = await checkAnonRateLimit(ip);
    if (exceeded) {
      return NextResponse.json({ ok: false, error: 'rate_limited', message: '今日试用次数已用完,请登录后继续使用' }, { status: 429 });
    }
  }

  // LLM call
  const model = (await getConfig('ai.model')) ?? 'unknown';
  const start = Date.now();
  let raw = '';
  try {
    const result = await llmChat({
      baseUrl: (await getConfig('ai.base_url')) ?? 'https://api.openai.com/v1',
      apiKey: (await getConfig('ai.api_key')) ?? '',
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请识别此图中的单个汉字,只返回该字符,无其他文字' },
          { type: 'image_url', image_url: { url: image, detail: 'low' } },
        ],
      }],
      maxTokens: 16,
      temperature: 0,
    });
    raw = result.content.trim();
  } catch (err) {
    await logAiCall({
      userId: user?.id ?? null, feature: 'char-recognize', model,
      status: 'error', durationMs: Date.now() - start,
      error: (err as Error).message,
      ip, metadata: { ip },
    });
    const isTimeout = (err as Error).message.includes('timeout');
    return NextResponse.json({
      ok: false,
      error: isTimeout ? 'timeout' : 'provider_error',
      message: isTimeout ? '识别超时,请重试' : '识别服务暂时不可用',
    }, { status: isTimeout ? 504 : 502 });
  }

  if (!isCjkBmpChar(raw)) {
    await logAiCall({
      userId: user?.id ?? null, feature: 'char-recognize', model,
      status: 'error', durationMs: Date.now() - start,
      error: `not_cjk: ${raw.slice(0, 20)}`,
      ip, metadata: { ip, raw: raw.slice(0, 20) },
    });
    return NextResponse.json({ ok: false, error: 'not_recognized', message: '未识别到汉字,请重试' }, { status: 502 });
  }

  await logAiCall({
    userId: user?.id ?? null, feature: 'char-recognize', model,
    status: 'ok', durationMs: Date.now() - start,
    ip, metadata: { ip, char: raw },
  });
  return NextResponse.json({ ok: true, char: raw });
}
```

- [ ] **Step 7: Add `checkAiRateLimit` to `app/api/ai/char-explain/route.ts`**

Modify `app/api/ai/char-explain/route.ts`. **Replace lines 18-20** (the existing membership check) with this complete block:

```ts
    if (!await hasFeature(user.id, 'ai_calls')) {
      return forbidden('membership_required', '需要 AI 调用会员');
    }
    if (!await checkAiRateLimit(user.id)) {
      return tooManyRequests('rate_limited', '今日 AI 调用次数已用完');
    }
```

Then add `tooManyRequests` to the import from `@/lib/api-handler` (line 3). Update the import to:

```ts
import { withErrorHandling, badRequest, unauthorized, forbidden, tooManyRequests } from '@/lib/api-handler';
```

And add `checkAiRateLimit` to the import from `@/lib/ai-calls` (line 8). Update to:

```ts
import { logAiCall, checkAiRateLimit } from '@/lib/ai-calls';
```

Verify `tooManyRequests` exists in `lib/api-handler.ts` (`unauthorized`, `forbidden`, `badRequest` are confirmed via line 3 import; if `tooManyRequests` is not exported, define it inline as a `NextResponse.json({...}, { status: 429 })` literal). Read `lib/api-handler.ts` first to confirm.

- [ ] **Step 8: Run tests, verify they pass**

Run: `npx vitest run tests/unit/app/api/ai/char-recognize.test.ts`
Expected: PASS — `Tests 5 passed (5)`

- [ ] **Step 9: Run focused vitest, verify no regressions**

Run: `npx vitest run tests/unit/lib/llm.test.ts tests/unit/app/api/ai/char-recognize.test.ts tests/unit/lib/admin-activity.test.ts`
Expected: 5 + 5 + 8 = 18 pass.

- [ ] **Step 10: Run tsc, verify clean**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 11: Commit**

```bash
git add scripts/migrations/2026-08-05-ai-calls-ip.sql scripts/init-db.ts lib/ai-calls.ts \
        app/api/ai/char-recognize/route.ts app/api/ai/char-explain/route.ts \
        tests/unit/app/api/ai/char-recognize.test.ts
git commit -m "feat(ai-recognize): POST /api/ai/char-recognize + anon rate limit + migration [2026-08-05 HH.MM+10]

  - scripts/migrations/2026-08-05-ai-calls-ip.sql: ADD COLUMN ip VARCHAR(45) +
    KEY idx_ai_calls_ip_created for anonymous rate-limit queries
  - lib/ai-calls.ts: checkAnonRateLimit(ip) — 5/day/IP via ai_calls table
    (mirrors checkAiRateLimit, shares ai.rate_limit_per_user_per_day config)
  - app/api/ai/char-recognize/route.ts: validate data URL prefix + size +
    gate (anon vs logged-in) + llmChat with multimodal content +
    hard-validate CJK BMP char + logAiCall
  - app/api/ai/char-explain/route.ts: ADD missing checkAiRateLimit() call
    (consistency fix; previously only logged but never enforced)
  - tests/unit/app/api/ai/char-recognize.test.ts: 5 route cases (anon
    success+over-limit, no-membership, user over-limit, invalid image,
    LLM non-CJK reply)"
```

---

### Task 3: UI 📷 button on `/pinyin` (TextToPinyin component)

**Files:**
- Modify: `components/TextToPinyin.tsx` (+60 LoC: hidden file input + camera icon + handler + toast)

**Interfaces:**
- Consumes: `POST /api/ai/char-recognize` from Task 2
- Consumes: existing `text` state and `setText()` setter from `TextToPinyin.tsx`

- [ ] **Step 1: Read `components/TextToPinyin.tsx` to find textarea + state**

Read `components/TextToPinyin.tsx` (94 lines). Note:
- State: `text: string`, `withSpaces: boolean`, `tokens: PinyinToken[]`
- text setter: `setText`
- textarea: `<textarea>` rendering `text`
- Currently no 'use client' directive — but the existing component already uses `useState`/`useEffect` so it must be a client component. Verify by reading — if no `'use client'` is at the top, add it (the existing imports prove it must be client).

- [ ] **Step 2: Add hidden file input + camera icon button**

Modify `components/TextToPinyin.tsx`. **Add** these imports at the top (after existing imports):

```tsx
import { Camera } from 'lucide-react';
import { useRef } from 'react';
```

Find the existing `useState` declarations (likely at the top of the component function). Add these new state hooks AFTER the existing ones:

```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
const [recognizing, setRecognizing] = useState(false);
const [toast, setToast] = useState<{ msg: string; type: 'error' | 'info' } | null>(null);
```

Add a helper function inside the component (after the existing state hooks):

```tsx
const showToast = (msg: string, type: 'error' | 'info' = 'info') => {
  setToast({ msg, type });
  setTimeout(() => setToast(null), 3000);
};

const compressImage = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image load failed'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_W = 1024;
        const scale = Math.min(1, MAX_W / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas 2d unavailable')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
};

const handleFile = async (file: File) => {
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片', 'error');
    return;
  }
  setRecognizing(true);
  try {
    const dataUrl = await compressImage(file);
    const res = await fetch('/api/ai/char-recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const body = await res.json();
    if (res.ok && body.ok && typeof body.char === 'string') {
      setText((prev) => prev + body.char);
    } else {
      showToast(body?.message ?? '识别失败,请重试', 'error');
    }
  } catch (err) {
    showToast('网络异常,请重试', 'error');
  } finally {
    setRecognizing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};
```

Find the existing `<textarea>` element. Wrap it in a `<div className="relative">` (or append a sibling) and add these elements **inside** the same wrapper:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  capture="environment"
  hidden
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }}
/>
<button
  type="button"
  onClick={() => fileInputRef.current?.click()}
  disabled={recognizing}
  aria-label="拍照识别单字"
  className="absolute right-2 top-2 p-2 rounded hover:bg-muted/50 disabled:opacity-50"
  title="拍照识别单字"
>
  {recognizing ? (
    <span className="inline-block w-5 h-5 border-2 border-ink-soft border-t-transparent rounded-full animate-spin" />
  ) : (
    <Camera className="w-5 h-5 text-ink-soft" />
  )}
</button>
{toast && (
  <div
    role="alert"
    className={`absolute left-1/2 -translate-x-1/2 -top-10 px-3 py-1.5 rounded text-sm whitespace-nowrap ${
      toast.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-paper text-ink border border-line'
    }`}
  >
    {toast.msg}
  </div>
)}
```

- [ ] **Step 3: Run tsc, verify clean**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Run build, verify clean**

Run: `npm run build`
Expected: `✓ Compiled successfully`. The route list should be unchanged (no new routes; this is a UI-only change to the existing `/pinyin` page).

- [ ] **Step 5: Manual smoke (dev server)**

Run:
```bash
npx next dev -p 4448 &
DEV_PID=$!
for i in {1..30}; do
  if curl -s http://localhost:4448/pinyin -o /dev/null -w "%{http_code}" | grep -q 200; then
    break
  fi
  sleep 1
done
```

Manually verify in browser:
1. Open `/pinyin` — textarea visible, 📷 camera icon visible in top-right of textarea
2. Click 📷 on desktop → file picker opens (or on mobile, camera launches)
3. Pick a small image of a single Chinese char → textarea appends the char, pinyin line shows pinyin
4. Pick a fuzzy image → Toast "未识别到汉字" appears (3s), textarea unchanged
5. Pick a non-image file → Toast "请选择图片"

After smoke:
```bash
kill $DEV_PID
```

- [ ] **Step 6: Commit**

```bash
git add components/TextToPinyin.tsx
git commit -m "feat(pinyin-camera): append-to-textarea 📷 button on /pinyin [2026-08-05 HH.MM+20]

  - components/TextToPinyin.tsx: hidden file input + Lucide <Camera/> icon
    button + handler + toast state (3s auto-dismiss)
  - Client-side image compression (canvas resize 1024px wide, jpeg 0.8)
  - On success: state.text += char → triggers real-time pinyin conversion
  - On error: toast only (Chinese msg from API), textarea unchanged
  - capture='environment' on mobile → rear camera; desktop → file picker
  - No new deps; consumes Task 2 /api/ai/char-recognize"
```

---

## Final verification (after all 3 tasks)

- [ ] **Final tsc**: `npx tsc --noEmit` → exit 0
- [ ] **Final vitest (focused)**: `npx vitest run tests/unit/lib/llm.test.ts tests/unit/app/api/ai/char-recognize.test.ts` → 5 + 5 = 10 pass
- [ ] **Final vitest (full)**: `npx vitest run` → 428 pass (Wave 2 baseline 423 + 5 new LLM tests + 5 new route tests - 5 pre-existing char-explain changes don't add tests) / 6 skip / 1 pre-existing DB fail
- [ ] **Final build**: `npm run build` → exit 0, 196 routes unchanged
- [ ] **Final git status**: only 3 new commits on local main; not pushed
- [ ] **Migration verified**: `mysql piyin_dev -e "DESC ai_calls"` shows `ip VARCHAR(45) NULL` and `idx_ai_calls_ip_created` index

## Files Summary

| File | Action | LoC |
|---|---|---|
| `lib/llm.ts` | Modify (ContentPart union + mockReply) | +15 |
| `lib/admin-activity.ts` | Modify (+recognize entry) | +1 |
| `tests/unit/lib/llm.test.ts` | Create | +60 |
| `scripts/migrations/2026-08-05-ai-calls-ip.sql` | Create (DDL: ip column + index) | +5 |
| `scripts/init-db.ts` | Modify (CREATE TABLE adds `ip` + index) | +3 |
| `lib/ai-calls.ts` | Modify (logAiCall.ip field + checkAnonRateLimit) | +18 |
| `app/api/ai/char-recognize/route.ts` | Create | ~80 |
| `app/api/ai/char-explain/route.ts` | Modify (add rate limit) | +5 |
| `tests/unit/app/api/ai/char-recognize.test.ts` | Create | +100 |
| `components/TextToPinyin.tsx` | Modify (+📷 button) | +60 |

**Total: ~344 LoC across 10 files.**

## Risks / Notes

- **MiniMax-M3 Vision 能力未实测**: 如果 MiniMax-M3 不支持 OpenAI `image_url` 格式,Task 2 的 LLM 调用会失败 → Toast "识别服务暂时不可用"。**风险: 中** — 假设错了需要再开 follow-up (admin UI 加 `ai.vision_model` 切换)。
- **Image base64 大小**: 客户端压缩 (Canvas resize 1024px, jpeg 0.8) → 5MB 限制。绝大多数手机拍照输出 4-8MB → 压缩后 200-500KB → 5MB 限制远不触及。**风险: 低**。
- **Anonymous rate limit 存储**: `ai_calls.user_id BIGINT NULL` 已确认允许; `ip` 列 + 索引通过 migration ALTER (production) + init-db.ts CREATE TABLE (fresh DB) 双轨落地。**风险: 低** — Schema 迁移小 (2 文件, 8 行)。
- **Prompt injection**: 服务端硬校验 (length=1, CJK BMP 范围)。AI 返回不进入 SQL/eval,只入 textarea。**风险: 低**。
- **Cost**: Vision API 通常比 text 贵 2-5x。5/day 限流足够防止滥用。**风险: 低** — Rate limit 兜底。
- **Camera permission UX**: iOS Safari 14+ 需要 HTTPS。桌面浏览器弹出文件选择器。**风险: 低** — 浏览器原生。
- **char-explain inline fix**: 顺手修复,4 行 (1 import + 1 check + 1 import + 1 helper 函数)。**风险: 无** — 现有测试覆盖率足够。
- **Wave 1 chart files 缺 trailing newline**: 已在 Wave 2 (Task 1) fix。本次 spec 文件清单不再 include。

## Reference

- Spec: `docs/superpowers/specs/2026-08-05-image-to-char-design.md` (commit `bd2ab998`)
- Implementation plan: this file
- Wave 1 status: `plan-admin-analytics-foundation-status.md`
- Wave 2 status: `plan-admin-analytics-detail-status.md`
- Deferred Wave 3: `/admin` overview redesign + AnomalyBanner (separate spec)
