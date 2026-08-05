# Image-to-Char (拍照识别单字) Design

> **For agentic workers:** This spec adds a 拍照识别单字 feature to the `/pinyin` (字转拼音) interface. Users snap a photo of a single Chinese character; MiniMax-M3 (vision-capable) recognizes the character; the recognized character is appended to the existing textarea so the user immediately sees its pinyin. Some chars can't be copied (physical books, signages, photo-only PDFs) — this closes that gap.

**Goal:** Add a 拍照 (📷) button next to the `/pinyin` textarea that recognizes a single Chinese character from a photo via MiniMax-M3 vision and appends it to the textarea. Anonymous users get 5/day/IP; logged-in users need `ai_calls` membership + 5/day/user.

**Architecture:** Client-side `<input type="file" accept="image/*" capture="environment">` captures image → FileReader → base64 data URL → POST `/api/ai/char-recognize` → server validates gating/rate-limit → `lib/llm.ts` multimodal call to MiniMax-M3 → hard-validate response (length=1, CJK) → return `{ ok, char }` → client appends to textarea. Errors surface as inline toasts (3s auto-dismiss). No new dependencies.

**Tech Stack:** Next.js 15.5.19 App Router + React 19 + mysql2/promise + `lib/llm.ts` (extending existing OpenAI-compatible HTTP client with multimodal content type) + `lib/ai-calls.ts` (reusing `withAiLogging()` + adding `checkAnonRateLimit()`) + Lucide `Camera` icon. **No new dependencies.**

## Context

User feedback 2026-07-11 (mid-Wave-2 brief): "另外我们在 字转拼音界面中支持AI 图片转字，因为有些字也复制不过来，只能通过图片来拍照，来获取当前字。"

User explicitly sequenced this feature: "Finish Wave 2 first, then image-to-char." Wave 2 (admin/analytics detail page) shipped 2026-08-05 (commits `c4563307..77beb031`). This spec is the next plan.

The current `/pinyin` interface (`app/pinyin/page.tsx` + `components/TextToPinyin.tsx`) is a public, real-time pinyin converter: user types Chinese characters into a `<textarea>` and immediately sees pinyin. It has no image/camera/upload UI today. The closest image-upload pattern is `AudioTracksForm` (multipart, saves to disk), but vision AI doesn't need persistence — we send base64 directly to MiniMax.

The MiniMax provider integration (`lib/llm.ts`) is currently text-only. We extend the `LLMMessage.content` type to a union (`string | ContentPart[]`) so the existing text-only call sites are unchanged. New vision calls use `ContentPart[]` with `{type:'image_url', image_url:{url:'data:image/...'}}` — the OpenAI-compatible format MiniMax-M3 supports.

Concurrent discovery during exploration: `app/api/ai/char-explain/route.ts` is missing the `checkAiRateLimit()` guard (only logs, doesn't enforce). This spec fixes it inline (1-2 lines, no interface change) so the new feature ships a consistent pattern.

## Global Constraints

- **package manager**: `npm` (per `project-uses-npm.md`); no new deps
- **Vision model**: reuse the existing `ai.model` config (default `MiniMax-M3`) — no new config key. If MiniMax-M3 turns out to lack vision support, follow-up work adds `ai.vision_model` override.
- **No `app/admin/**` route** — this is user-facing only
- **server-side `ip`**: `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45)` (per `lib/audit.ts:39` + IPv6 VARCHAR(45) cap)
- **mysql2**: select via `pool.query()` (text protocol); insert via `pool.execute()` for parameterized writes (per mysql2-supp-plane-bug memory)
- **TypeScript strict**: no `any` leaks in exported interfaces; `LLMMessage.content` union is the key contract
- **Tests**: vitest, mock-LLM pattern via `lib/llm.ts` mock_mode (already supported at `lib/llm.ts:45-49`)
- **Commits**: append `[YYYY-MM-DD HH.MM]` per `feedback-commit-timestamps.md`
- **Branch**: local main only (no auto-push per `no-prod-env-2026-06-21.md`)
- **Anonymous rate limit**: tracked via `ai_calls` table with `user_id IS NULL` + `metadata.ip`; need to confirm schema first (if `user_id NOT NULL`, add migration)
- **Image constraints**: ≤ 5MB raw; client-side resize to 1024px wide, JPEG quality 0.8 before upload; server-side validates data URL prefix (`image/jpeg|png|webp`) and length
- **Hard response validation**: trimmed response must be exactly 1 char, code point in BMP (U+0000..U+FFFF), Unicode block `CJK Unified Ideographs` (U+4E00..U+9FFF) or extensions (U+3400..U+4DBF, U+F900..U+FAFF). Any other → 502 `not_recognized`.

## Design

### Architecture

```
[Browser /pinyin]
  ↓ User clicks 📷 button next to textarea
[<input type="file" accept="image/*" capture="environment">]
  │ Mobile: launch rear camera; Desktop: open file picker
  ↓ User selects/takes photo
[Client TextToPinyin.tsx]
  │ FileReader.readAsDataURL(file) → base64 data URL
  │ Client-side compress: <canvas> resize to 1024px wide, jpeg 0.8
  │ fetch POST /api/ai/char-recognize { image: dataUrl }
  ↓
[POST /api/ai/char-recognize route.ts]
  ├── getCurrentUser() → user | null
  ├── Body validation: dataUrl prefix + decoded size ≤ 5MB
  ├── Gating:
  │   • anonymous: checkAnonRateLimit(ip) → 429 if exceeded
  │   • logged-in: hasFeature(user.id, 'ai_calls') else 403
  │   • logged-in + hasFeature: checkAiRateLimit(user.id) → 429 if exceeded
  ├── withAiLogging({ feature:'char-recognize', userId, ip, status, duration, metadata:{ char } })
  │   ↳ internally calls logAiCall() → ai_calls table
  ├── llm.chatCompletion({
  │     messages: [{
  │       role: 'user',
  │       content: [
  │         { type: 'text', text: '请识别此图中的单个汉字,只返回该字符,无其他文字' },
  │         { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }
  │       ]
  │     }]
  │   })
  ├── Validate response: trim → length===1, CJK BMP
  ├── Return { ok: true, char: '字' } OR throw → 502 not_recognized
  ↓
[Client receive]
  ├── ok: state.text += char → triggers real-time pinyin conversion
  └── !ok: inline toast (Chinese msg, 3s auto-dismiss)
```

### Files (8 operations, ~336 LoC)

| File | Action | LoC | Purpose |
|---|---|---|---|
| `lib/llm.ts` | Modify (ContentPart union) | +15 | Extend `LLMMessage.content` to `string \| ContentPart[]`; add `ContentPart` type. Backward-compatible: existing text-only call sites unchanged. |
| `lib/ai-calls.ts` | Modify (+checkAnonRateLimit) | +15 | New `checkAnonRateLimit(ip)` queries `ai_calls` for `user_id IS NULL AND IP-based identifier` within today. Returns count. Threshold = 5/day/IP. |
| `app/api/ai/char-recognize/route.ts` | Create | ~80 | New API route. POST only. Validates/gates/calls LLM/hard-validates response. |
| `app/api/ai/char-explain/route.ts` | Modify (add rate limit) | +5 | Inline fix: add `checkAiRateLimit(user.id)` call before `logAiCall`. 1-2 lines. |
| `components/TextToPinyin.tsx` | Modify (+📷 button) | +60 | New hidden file input + camera icon button + handleFile + toast state. Append char to textarea on success. |
| `lib/admin-activity.ts` | Modify (+recognize entry) | +1 | Add `recognize: '拍照识别'` to `AI_FEATURE_ZH` map. |
| `tests/unit/lib/llm.test.ts` | Create | ~60 | 5 multimodal cases (text+image, image-only, mixed, detail field, type safety). |
| `tests/unit/api/char-recognize.test.ts` | Create | ~100 | 5 route cases (anon success, anon over-limit, no-membership, image-invalid, not-recognized). |

### Key Interfaces

```typescript
// lib/llm.ts (extend, backward-compatible)
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];  // was: string
}

// lib/ai-calls.ts (new)
export async function checkAnonRateLimit(ip: string): Promise<{ exceeded: boolean; count: number }>;

// lib/admin-activity.ts (extend)
const AI_FEATURE_ZH: Record<string, string> = {
  // ... existing
  recognize: '拍照识别',
};

// app/api/ai/char-recognize/route.ts (new)
export async function POST(req: NextRequest): Promise<NextResponse>;

// Server-side response type
type RecognizeResponse =
  | { ok: true; char: string }
  | { ok: false; error: 'rate_limited' | 'membership_required' | 'invalid_image' | 'not_recognized' | 'timeout' | 'provider_error'; message: string };
```

### Component Layout

```
┌─────────────────────────────────────────────────────────────┐
│ <Header/>                                                   │
│ <SectionTitle>字转拼音</SectionTitle>                       │
│ ┌─────────────────────────────────────────────────────┐    │
│ │ <TextToPinyin>                                       │    │
│ │ ┌────────────────────────────────────────┐ ┌────┐    │    │
│ │ │ <textarea>                             │ │📷 │    │ ← 📷 button (Lucide <Camera/>)
│ │ │ 输入汉字，如「你好世界」               │ │    │    │     hidden file input
│ │ │                                        │ └────┘    │     accept="image/*"
│ │ └────────────────────────────────────────┘          │     capture="environment"
│ │ ┌─────────────────────────────────────────────────┐ │    │
│ │ │ nǐ hǎo shì jiè                                │ │    │ ← real-time pinyin
│ │ └─────────────────────────────────────────────────┘ │    │
│ │                                                     │    │
│ │ {toast && <div class="absolute ...">{toast.msg}</div>}│ ← 3s auto-dismiss
│ └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow (error matrix)

| Scenario | HTTP | error code | Client Toast |
|---|---|---|---|
| Anonymous OK (≤5/day) | 200 | (success) | (none) |
| Anonymous 6th call | 429 | `rate_limited` (anon) | "今日试用次数已用完,请登录后继续使用" |
| Logged-in no `ai_calls` | 403 | `membership_required` | "拍照识别需要 AI 会员权限" |
| Logged-in + feature, 5/day exceeded | 429 | `rate_limited` (user) | "今日次数已用完,明天再来" |
| Image format/size invalid | 400 | `invalid_image` | "图片格式或大小不支持" |
| LLM returns non-CJK / multi-char | 502 | `not_recognized` | "未识别到汉字,请重试" |
| LLM timeout (> ai.timeout_ms) | 504 | `timeout` | "识别超时,请重试" |
| LLM provider error | 502 | `provider_error` | "识别服务暂时不可用" |
| Network error | (catch) | — | "网络异常,请重试" |

### Anonymous Rate Limit Storage

Confirmed via `scripts/init-db.ts:281-297`:

```sql
CREATE TABLE IF NOT EXISTS ai_calls (
  id, user_id BIGINT NULL,       -- ✅ NULL allowed
  feature, model, status ENUM, prompt_tokens, completion_tokens,
  duration_ms, error, metadata JSON, created_at,
  KEY idx_user_created (user_id, created_at DESC)  -- covers (NULL, today)
);
```

`user_id BIGINT NULL` ✅ already allowed. No `ip` column yet — need to add via migration.

**Plan**:
- Add migration `scripts/migrations/2026-08-05-ai-calls-ip.sql`:
  ```sql
  ALTER TABLE ai_calls ADD COLUMN ip VARCHAR(45) NULL AFTER user_id;
  ALTER TABLE ai_calls ADD KEY idx_ai_calls_ip_created (ip, created_at DESC);
  ```
- Anonymous rate limit query:
  ```sql
  SELECT COUNT(*) FROM ai_calls
  WHERE user_id IS NULL AND ip = ? AND created_at >= CURDATE()
  ```
- Index `idx_ai_calls_ip_created` covers this.
- Migration is idempotent (`ADD COLUMN IF NOT EXISTS` is MySQL 8.0.29+; for older, use a `SELECT` check first).

**Files affected**:
- `scripts/migrations/2026-08-05-ai-calls-ip.sql` (new, ~5 lines)
- `lib/ai-calls.ts::checkAnonRateLimit` (new, ~15 lines)

**Cost**: 1 small migration + 1 new function. Doesn't block spec.

### Testing

`tests/unit/lib/llm.test.ts` (5 cases, mock mode):
```typescript
describe('LLM multimodal content', () => {
  it('serializes text-only content as string (backward compat)', async () => {
    // existing call site: content: 'hello' → unchanged
  });
  it('serializes image_url content as OpenAI multipart format', async () => {
    // content: [{type:'image_url', image_url:{url:'data:...'}}]
    // → fetch body has messages[0].content[0].type === 'image_url'
  });
  it('preserves mixed text + image content order', async () => {
    // content: [{text...}, {image_url...}] → order preserved
  });
  it('passes detail field through to image_url', async () => {
    // detail: 'low' → outgoing JSON has it
  });
  it('type-safety: text-only call sites cannot pass ContentPart[] (compile-time)');
});
```

`tests/unit/api/char-recognize.test.ts` (5 cases, mock LLM + ai-calls):
```typescript
describe('POST /api/ai/char-recognize', () => {
  it('anonymous: 5 calls succeed, 6th returns 429 rate_limited', async () => {
    // mock getCurrentUser → null, mock check → 4 calls ok, 5th call returns 429
  });
  it('logged-in without ai_calls: returns 403 membership_required', async () => {
    // mock hasFeature → false
  });
  it('logged-in with ai_calls but over 5/day: returns 429 rate_limited', async () => {
    // mock checkAiRateLimit → exceeded
  });
  it('invalid image data URL: returns 400 invalid_image', async () => {
    // body: { image: 'not-a-data-url' }
  });
  it('LLM returns non-CJK char: returns 502 not_recognized', async () => {
    // mock llm.chatCompletion → 'abc'
  });
});
```

### Verification Checklist

```
[Helper layer]
  - npx tsc --noEmit                                              exit 0
  - npx vitest run tests/unit/lib/llm.test.ts                     5 pass
  - npx vitest run tests/unit/api/char-recognize.test.ts          5 pass
  - npx vitest run                                                428 pass (Wave 2 baseline 423 + 5 new) / 6 skip / 1 pre-existing DB fail

[Page layer]
  - npx tsc --noEmit                                              exit 0
  - npm run build                                                 exit 0, 196 routes unchanged

[Manual smoke]
  - GET /pinyin (no auth)                                         200, textarea + 📷 button visible
  - Click 📷 on mobile (simulator) → camera launches
  - Click 📷 on desktop → file picker opens
  - Photo "中" → textarea appends "中", pinyin shows "zhōng"
  - Photo fuzzy image → toast "未识别到汉字", textarea unchanged
  - 6th anonymous call → toast "请登录后继续使用"
  - Logged-in user without ai_calls → toast "需要 AI 会员权限"
  - Logged-in user with ai_calls → works like anon but gated by user rate
  - Browser console clear, no errors

[Schema]
  - DESC ai_calls shows user_id IS NULL allowed
  - If NOT NULL: migration adds ALTER + ip column + idx (small follow-up commit)
```

### Commit Strategy

```
feat(ai-vision): multimodal content type in lib/llm.ts [2026-08-05 HH.MM]
  - lib/llm.ts: LLMMessage.content union with ContentPart (text | image_url)
  - lib/admin-activity.ts: AI_FEATURE_ZH += recognize: '拍照识别'
  - tests/unit/lib/llm.test.ts: 5 multimodal cases
  - Backward-compatible: existing text-only call sites unchanged

feat(ai-recognize): POST /api/ai/char-recognize + anon rate limit + migration [2026-08-05 HH.MM+10]
  - scripts/migrations/2026-08-05-ai-calls-ip.sql: ADD COLUMN ip + KEY idx_ai_calls_ip_created
  - lib/ai-calls.ts: checkAnonRateLimit(ip) — 5/day/IP via ai_calls table
  - app/api/ai/char-recognize/route.ts: validate + gate + LLM call + hard-validate
  - app/api/ai/char-explain/route.ts: ADD missing checkAiRateLimit() call (consistency fix)
  - tests/unit/api/char-recognize.test.ts: 5 route cases

feat(pinyin-camera): append-to-textarea 📷 button on /pinyin [2026-08-05 HH.MM+20]
  - components/TextToPinyin.tsx: hidden file input + Lucide <Camera/> icon + handler
  - Client-side image compression (canvas resize 1024px, jpeg 0.8)
  - Inline toast state (3s auto-dismiss)
  - On success: state.text += char → real-time pinyin conversion
  - On error: toast only, textarea unchanged
```

3 commits: foundation (lib + tests) → API route → UI. Tests ship with each component.

### Out of Scope (this spec explicitly does NOT)

- ❌ Multi-char OCR (留作 follow-up; user picked single-char)
- ❌ Video recognition
- ❌ Offline OCR (浏览器无 OCR)
- ❌ 拍照 + 拼音同时返回 (本次只回 char)
- ❌ 历史记录拍照字 (未来可加)
- ❌ 离线模式 (无网络环境)
- ❌ AI config 加 `ai.vision_model` 切换 (留作 follow-up)
- ❌ Wave 3 admin overview / AnomalyBanner (独立 spec)
- ❌ 公开 API 给第三方 (仅网站内部)
- ❌ 视频流识别 (无意义)
- ❌ 用户拍照批量识别 (本次只单字)
- ❌ `ai_calls` 表 schema 重构 (仅检查/补 migration)

### Files Summary

| File | Action | LoC |
|---|---|---|
| `lib/llm.ts` | Modify (ContentPart union) | +15 |
| `lib/ai-calls.ts` | Modify (+checkAnonRateLimit) | +15 |
| `app/api/ai/char-recognize/route.ts` | Create | ~80 |
| `app/api/ai/char-explain/route.ts` | Modify (add rate limit) | +5 |
| `components/TextToPinyin.tsx` | Modify (+📷 button) | +60 |
| `lib/admin-activity.ts` | Modify (+recognize entry) | +1 |
| `scripts/migrations/2026-08-05-ai-calls-ip.sql` | Create (anon-ip column + index) | ~5 |
| `tests/unit/lib/llm.test.ts` | Create | ~60 |
| `tests/unit/api/char-recognize.test.ts` | Create | ~100 |

**Total: ~341 LoC across 9 files.**

### Risks / Notes

- **MiniMax-M3 Vision 能力未实测**: 当前 `lib/llm.ts` 没有 multimodal 调用。如果 MiniMax-M3 实际不支持 vision,实施时降级方案是 admin UI 加 `ai.vision_model` config key 切换到 vision 模型 (本次 spec 不做,留作 follow-up)。**风险: 中** — 假设错了需要再开 follow-up。
- **Image base64 大小**: 5MB 限制是保守值。手机拍照原图 3-8MB,base64 +33%。客户端先压缩 (Canvas resize 1024px, jpeg 0.8) → 5MB 限制 → 服务端二次校验。**风险: 低** — 现成方案。
- **Anonymous rate limit 需要 ai_calls 表 user_id NULL**: 假设已允许 (mirror `audit_log` 模式);若不是,需 1-line migration (`ALTER TABLE ai_calls MODIFY user_id BIGINT NULL, ADD COLUMN ip VARCHAR(45) NULL`)。**风险: 低** — Schema 迁移小。
- **Prompt injection**: prompt 严格 (`'只返回该字符,无其他文字'`),服务端硬校验 (length=1, CJK BMP)。AI 返回不进入 SQL/eval,只入 textarea。**风险: 低** — 输入不注入。
- **Cost**: Vision API 通常比 text 贵 2-5x。当前 5/day 限流足够防止滥用。**风险: 低** — Rate limit 兜底。
- **Camera permission UX**: iOS Safari 14+ 需要 HTTPS。桌面 Chrome/Firefox 弹出系统文件选择器。用户拒绝相机 → 文件选择器 fallback (大部分浏览器行为)。**风险: 低** — 浏览器原生处理。
- **char-explain 漏 rate limit 的 inline fix**: 顺手修复,1-2 行,无 interface 变化,与新 feature 行为一致。**风险: 无** — 微小一致性改进。
- **`image_recognize` 不需要单独 audit event**: AI 操作已通过 `ai_calls` 表记录 (含 `feature='char-recognize'`),不需要写 `audit_log`。**风险: 无** — 复用现成模式。
- **客户端图片压缩**: Canvas API resizing 至 1024px wide,jpeg quality 0.8。绝大多数手机拍照输出 4-8MB → 压缩后 200-500KB → 5MB base64 限制远不触及。**风险: 无** — 直接实现。
- **Wave 1 chart files 缺 trailing newline**: 已在 Wave 2 (Task 1) fix。本次 spec 文件清单不再 include (除非新增文件 commit 时一并 fix)。
