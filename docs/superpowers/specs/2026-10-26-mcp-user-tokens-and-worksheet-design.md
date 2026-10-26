# MCP: per-user tokens, site-mounted endpoint, worksheet design + PNG — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to produce the implementation plan after this spec is approved.

**Goal:** Turn the existing standalone MCP server (18 read-only tools, `mcp/`, a separate process on port 4455) into **a route inside the site itself** (`POST/GET/DELETE https://ziyun.pudafo.com/mcp`), authenticated by a **per-user token each registered user can issue, rotate and revoke from their own profile page**, and extend it with a **worksheet-design toolset** that hands the AI a **standard worksheet scheme** and the rendered **PNG** of the worksheet.

**Why now:** The user asked for three things in one breath (2026-10-26):

1. 「我们还需要为每个注册用户启用 MCP token 申请功能」 — per-user tokens, not one global env-var key.
2. 「mcp 直接挂网站 不需要额外的端口」 — no second process, no second port, no nginx change.
3. 「另外提供字帖设计的 mcp 提供标准的字帖方案，并且支持生成后以 png 方式发送给 ai」 — a worksheet-design toolset that returns a PNG image block the model can actually look at.

Requests 1 and 2 together dissolve the one structural conflict the current design has: *"the MCP server is zero-MySQL by construction, but per-user tokens need a database."* Mounting the server as a Next.js route handler puts `getPool()` in-process, so **only the auth layer touches MySQL — the 18 tools stay exactly as file-only as they are today.** The purity property is preserved where it matters (the data path) and dropped where it was only a constraint of the standalone process.

---

## §0 The six binding decisions

These were settled with the user before this document was written. They are not reopened here.

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | Transport | **HTTP, mounted on the site at `/mcp`** — one process, one port, one runbook entry | a second process on a second port |
| D2 | Token backing | **the database** (`mcp_tokens` table) | a stateless HMAC/JWT with a blacklist |
| D3 | Tokens per user | **exactly one** | several named tokens (multi-device) |
| D4 | Approval | **self-service**, no admin approval | an admin approval queue |
| D5 | Expiry | **none — permanent, revoked by hand** | a TTL that expires on its own |
| D6 | Worksheet PNG renderer | **a pure-JS rasteriser we write** (zero new runtime deps) | sharp / resvg / a headless browser |

D6 was chosen over `sharp` deliberately: `sharp` is a **devDependency** in this repo and has a documented history of breaking the Linux production install (`next.config.ts` carries the scar: *"sharp missing on prod Linux → images.unoptimized = true"*). A hand-written rasteriser has no native binary, no install-time risk, and produces a byte-for-byte reproducible image.

**A note on the "zero new runtime dependency" claim.** The PNG renderer needs glyph outlines. The obvious source is a font file, and reading a font needs a font parser. The repo already has one: **`fontkit` 2.0.4, currently a devDependency**. Moving it to `dependencies` is the only dependency change in this document. It is safe to do so: fontkit is **pure JavaScript** — its `brotli` dependency (the WOFF2 decoder) is the `brotli.js` port, which is a pure-JS implementation with **no native addon and no prebuilds** (`node_modules/brotli/dec/decode.js`). Verified in this repo, 2026-10-26.

---

## §1 Scope

### In scope

- **`/mcp` as a Next.js route handler** — the MCP Streamable HTTP endpoint served by the site process, no extra port, no nginx change.
- **Per-user MCP tokens** — issue, rotate and revoke; the raw token is shown exactly once.
- **The token UI** — a card on the user's own profile page, plus the client configuration JSON to paste into an MCP client.
- **A worksheet-design toolset** — a catalogue of standard worksheet schemes, a layout tool, and a renderer that returns the worksheet as a **PNG image content block**.
- **A pure-JS PNG rasteriser** — path filling, anti-aliasing, PNG encoding, and glyph outlines from the fonts the site already ships.

### Not in scope (and why)

| Excluded | Reason |
|---|---|
| OAuth 2.1 / dynamic client registration | The MCP clients in use (Claude Desktop, mcp-remote, IDE clients) all support a static `Authorization` header. D2 already chose "a token in a table"; an OAuth server is a second product. |
| Scoped / per-tool permissions | Every tool is read-only and file-only. A scope system would be a UI with no security value today. |
| Multiple named tokens per user | D3. One token, rotate it. |
| Token expiry | D5. Revocation is the control. |
| Admin approval / admin-side token management | D4. The admin can revoke a user's token from the users screen if we want it later; it is not required for v1. |
| Writing to the database from any MCP tool | The tools stay read-only. `synthesize_speech` already reaches an external TTS service and stays as it is. |
| Multiple PNGs per call (one image block per page) | v1 renders **one page per call**. A caller that wants page 3 calls the tool again with `page: 3`. |

### Anti-goals (what would make this a failure)

- **Publishing the character library without a credential.** `/mcp` must answer **401** to a request with no valid bearer token, in every environment including production.
- **A per-request MySQL round trip for tool data.** Only the auth path may touch the database; the 18 file-backed tools must keep working exactly as they do in the standalone server.
- **A PNG that does not look like the site's own worksheet.** The rasteriser reproduces `components/worksheet/WorksheetCell.tsx` geometry, not an approximation of it.
- **Silently shipping a broken image.** A glyph the fonts cannot draw must be reported, not rendered as an invisible blank.

---

## §2 Architecture

```
                      ┌──────────────────────────────────────────┐
  Claude Desktop ───► │  nginx  location /  →  127.0.0.1:4444    │  (no nginx change)
  IDE MCP client      └──────────────────┬───────────────────────┘
                                         │
                      ┌──────────────────▼───────────────────────┐
                      │  Next.js process (the site)              │
                      │                                          │
                      │  app/mcp/route.ts   ←── MCP endpoint     │
                      │    │                                     │
                      │    ├─ resolveBearer → sha256 → MySQL     │  ← the ONLY DB path
                      │    │    mcp_tokens JOIN users             │
                      │    │                                     │
                      │    └─ session map (globalThis)           │
                      │         └─ McpServer + WebStandard        │
                      │            StreamableHTTPServerTransport │
                      │               └─ mcp/tools/*  (file only)│
                      │                                          │
                      │  app/api/mcp/token/route.ts  ← token API │
                      │  components/mcp/McpTokenCard.tsx  ← UI    │
                      └──────────────────────────────────────────┘
```

**What survives from the standalone server:** all of `mcp/tools/*`, `mcp/errors.ts`, `mcp/tool-result.ts`. The tool bodies, their schemas, their annotations and their envelopes are **not touched** except for the worksheet tool, which gains two tools.

**What is retired:** `mcp/main.ts`, `mcp/server.ts`, `mcp/session.ts`, `mcp/body.ts`, `mcp/config.ts`, `mcp/auth.ts` (the env-token half) — plus the `mcp:dev` / `mcp:start` npm scripts. The standalone process and the site process would otherwise be two implementations of the same protocol, and the standalone one would have no way to authenticate per-user tokens without a second DB connection pool.

> **The user's instruction, 2026-10-26 (verbatim): 「直接挂到本身站点，不需要额外开启进程，太多了」.** There is **no second process, no second port and no second runbook entry**. The MCP endpoint is a route in the site, and that is the only way it runs — in development, in production, and in the tests. The standalone server that existed as of commit `28f7b1ee7` is **removed**, not deprecated and not kept as an alternative entry point.

**Why the SDK's Web-standard transport is the enabling fact:** the SDK 1.32.2 ships `WebStandardStreamableHTTPServerTransport` (`dist/esm/server/webStandardStreamableHttp.js`), whose `handleRequest(req: Request, options?): Promise<Response>` speaks the Web platform's `Request`/`Response` — exactly what a Next.js route handler has. The older `StreamableHTTPServerTransport` only accepts Node's `IncomingMessage`/`ServerResponse`, which is what forced the standalone process in the first place.

---

## §3 Part A — the `/mcp` endpoint

### §3.1 The route

**File:** `app/mcp/route.ts` (new)

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

`runtime = 'nodejs'` is mandatory: the route imports `node:crypto`, `node:zlib` and fontkit, none of which exist in the Edge runtime.

`dynamic = 'force-dynamic'` is mandatory: a route that answers per-request credentials must never be cached. (The repo rule `feedback-cache-control-route-iterations` — new dev routes carry `no-store`.)

The route exports four handlers: `POST`, `GET`, `DELETE`, `OPTIONS`.

### §3.2 CORS

The MCP client is not a browser, but a browser-based client (or a proxy) may be, and the previous standalone server already answered with CORS headers. Keep them, with one change: the `Access-Control-Expose-Headers` list **must** contain `mcp-session-id`, or a browser client cannot read the session id out of the initialize response and every later request fails with 400.

```
Access-Control-Allow-Origin: <MCP_CORS_ORIGIN, default *>
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, mcp-session-id, mcp-protocol-version
Access-Control-Expose-Headers: mcp-session-id
Access-Control-Max-Age: 86400
```

`OPTIONS` answers **204** with those headers and no body.

### §3.3 The request flow

Every request — POST, GET and DELETE alike — goes through the same three gates before the transport is touched:

1. **Extract the bearer.** `Authorization: Bearer <token>`. Missing, malformed, or a different scheme → **401**.
2. **Resolve the token.** sha256 the raw token, look it up (§4.3). Not found / revoked / the owning account is disabled → **401**.
3. **Bind the session to the user.** A session opened with user A may not be used with user B's token → **403**.

The 401 body is the site's own envelope:

```json
{ "ok": false, "error": { "code": "unauthorized", "message": "the request must carry a valid MCP token" } }
```

After the three gates, the request is handed to the transport:

| Method | Behaviour |
|---|---|
| `POST` with no `mcp-session-id` | **Open a session.** Build a fresh `McpServer` + transport, register the tools, let the transport answer the `initialize` request. The `mcp-session-id` response header carries the new session id. |
| `POST` with `mcp-session-id` | Route to that session's transport. An unknown session id → **404** (`not_found`). |
| `GET` | The notification stream of an open session. No session id → **400**; unknown session id → **404**. |
| `DELETE` | End the session: close the transport, close the server, drop it from the map. No session id → **400**; unknown session id → **404**. |

**The 400-vs-404 distinction is deliberate and must not be collapsed.** 400 means *the request is malformed* (no session id at all); 404 means *the session id is well-formed but unknown* (never opened, already closed, or the server restarted). The standalone server already draws this line and the SDK's own transport draws the same one; the route must agree with both.

**The route checks the session id against its own map *before* handing the request to the transport.** The map is the only place the `McpServer` instance lives, so the route has to look the session up anyway — and by looking it up first, **the 400 and 404 bodies are the site's `{ok:false,error:{code}}` envelope**, not the transport's JSON-RPC error bodies. A client that knows the site's API reads the MCP endpoint's errors with the same vocabulary. The transport's own error paths (a malformed JSON-RPC message, an unsupported `mcp-protocol-version`) still produce JSON-RPC errors — those are protocol-level, and the route does not intercept them.

### §3.4 The session map

Stateful mode: `sessionIdGenerator: () => randomUUID()`.

A session owns an `McpServer` and a `WebStandardStreamableHTTPServerTransport`, plus the `userId` resolved when the session was opened.

**The map lives on `globalThis`, not in a module-level `const`.** Next.js dev re-evaluates route modules on every edit; a module-level `Map` would drop every open session on each hot reload and the clients would see a cascade of 404s. The repo has the same bug and the same fix once already — the `/init` wizard's dev token had to move from a module-level `Map` to `globalThis` (see `init-wizard-dev-token-bug`). The pattern:

```ts
const SESSION_STORE_KEY = Symbol.for('pinyin-character.mcp.sessions');

type SessionStore = Map<string, McpSession>;

function sessionStore(): SessionStore {
  const holder = globalThis as unknown as Record<symbol, SessionStore | undefined>;
  const existing = holder[SESSION_STORE_KEY];
  if (existing) return existing;
  const created: SessionStore = new Map();
  holder[SESSION_STORE_KEY] = created;
  return created;
}
```

`Symbol.for` (not `Symbol()`) so that a hot reload — which re-evaluates the module and creates a *new* symbol — still finds the same store.

**Session lifetime.** A session lives until the client sends `DELETE`, or until the transport closes. There is no idle timeout in v1. The map is bounded in practice by the number of open clients; a production deployment that needs a cap can add an LRU later.

**Sessions are not shared between users.** A session opened with user A's token stores `userId: A`. Every later request must present a token that resolves to the same user; otherwise **403** (`forbidden`, "this session belongs to another account"). This is what makes revocation effective: revoking the token stops the *next* request, and the existing session dies with it.

**Restart behaviour.** A server restart empties the map. Every open session id becomes unknown → **404**, and the client re-initialises. This is correct, and it is why the client configuration in §5.3 tells the user to paste the endpoint, not a session id.

### §3.5 Building the server

**File:** `mcp/server-factory.ts` (new)

```ts
export function createMcpServer(): McpServer
```

It builds an `McpServer` with the site identity and `{ capabilities: { tools: {} } }`, then calls the existing `registerAllTools(server)` from `mcp/tools/index.ts`. `registerAllTools` is **unchanged** except for the worksheet module (§6).

Server name / version come from the environment with the current defaults, so an operator can rename the server in the client's UI without a code change:

| Variable | Default |
|---|---|
| `MCP_SERVER_NAME` | `pinyin-character` |
| `MCP_SERVER_VERSION` | `1.0.0` |
| `MCP_CORS_ORIGIN` | `*` |

**`MCP_AUTH_TOKEN` and `MCP_ALLOW_ANONYMOUS` are gone.** The env token was the "one global key" that D2 replaces. There is no anonymous mode: `/mcp` always requires a database-backed token.

**Dev exception (my call).** In development only (`NODE_ENV !== 'production'`), a request whose bearer is exactly the literal string `dev-anonymous` is accepted and attributed to a synthetic user id `0`, which grants read-only access to the tools but no user-scoped data (there is none — the tools are file-only). This keeps local testing possible without a database row, and it is **hard-disabled in production** by an explicit `NODE_ENV === 'production'` check rather than by an environment flag, so it cannot be switched on by accident. If the builder prefers no exception at all, this is a one-line change with no other consequence.

### §3.6 The `server-only` marker

`mcp/tools/*` reach `lib/content.ts`, `lib/radical.ts`, `lib/story.ts`, `lib/game-quest-data.ts` and `lib/sutra-copy-progress.ts`, all of which `import 'server-only'`. Inside the Next.js server bundle the `react-server` export condition resolves `server-only` to its no-op `empty.js`, so the marker is satisfied without any special handling. The standalone process needed `--conditions=react-server`; **the route does not**.

The vitest runner already aliases `server-only` to `node_modules/server-only/empty.js` (commit `e3b86e24d`) — that alias stays and keeps covering the tool tests.

---

## §4 Part B — per-user MCP tokens

### §4.1 The table

**Migration:** `scripts/migrations/2026-10-26-mcp-tokens.sql` (new) — idempotent, `information_schema` guard + `PREPARE`/`EXECUTE`, exactly like `scripts/migrations/2026-10-24-users-created-index.sql`.

```sql
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_mcp_tokens_user (user_id),
  UNIQUE KEY uniq_mcp_tokens_hash (token_hash),
  CONSTRAINT fk_mcp_tokens_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes:

- `users.id` is `BIGINT` (`scripts/init-db.ts:50`), so `user_id` is `BIGINT` — a mismatched FK type fails on MySQL 8.
- `uniq_mcp_tokens_user` **is** D3: one row per user, so issuing a token again is an `UPDATE`, not an `INSERT`. It also makes the "rotate" path a single statement.
- `token_hash CHAR(64)` is the sha256 hex — the same shape and the same hashing as `password_resets.token_hash` and `email_verifications.token_hash`. The raw token never touches the database.
- `ON DELETE CASCADE` — deleting a user deletes their token.

`scripts/init-db.ts` gains the same `CREATE TABLE` statement, so a fresh install has the table without running migrations. (Repo rule `feedback-reseed-after-migrations`: after the migration runs, verify the row count and reseed if a table came out empty.)

### §4.2 The token format

```ts
export function generateMcpToken(): string   // 'mcp_' + base64url(randomBytes(32))  → 47 chars
export function hashMcpToken(raw: string): string  // sha256 hex, 64 chars
```

`mcp_` as a prefix makes a leaked token recognisable in a log or a config file, and makes it obvious to a reader that it is not a session cookie. 32 random bytes = 256 bits of entropy; base64url of 32 bytes is 43 characters.

The raw token is returned **exactly once** — at issue time. It is not recoverable afterwards, only regenerable. This is the standard practice and matches the repo's own one-time-token precedent (`password_resets`, `email_verifications`).

### §4.3 The store

**File:** `lib/mcp-token.ts` (new)

```ts
export interface McpTokenStatus {
  state: 'none' | 'active' | 'revoked';
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function getTokenStatus(userId: number): Promise<McpTokenStatus>;
export async function issueToken(userId: number): Promise<{ raw: string; createdAt: string }>;
export async function revokeToken(userId: number): Promise<{ revokedAt: string }>;
export async function resolveToken(raw: string): Promise<ResolvedToken | null>;
```

`resolveToken` returns `{ userId, username, isAdmin }` or `null`. Its query:

```sql
SELECT t.user_id, u.username, u.is_admin, u.disabled_at
FROM mcp_tokens t
JOIN users u ON u.id = t.user_id
WHERE t.token_hash = ? AND t.revoked_at IS NULL
```

`null` is returned for: no row, a revoked row, **or** a row whose user has `disabled_at` set. A disabled account's token stops working immediately, without the user having to remember to revoke it.

**`last_used_at` is throttled.** Writing it on every MCP request would put a `UPDATE` in front of every tool call. Instead, the write happens **at most once per hour** per token: the resolver compares the row's `last_used_at` against the current time in JS and issues the `UPDATE` only when the row is older than an hour (or `NULL`). The comparison reads the value it already fetched, so it costs nothing extra.

The throttle is *not* a security control — it is a write-amplification control. A token that is used every second still updates `last_used_at` at most 3600 times a day.

### §4.4 The API

**File:** `app/api/mcp/token/route.ts` (new)

All three verbs require a logged-in user (`requireUser()` from `lib/auth.ts`) and answer `Cache-Control: no-store`.

| Verb | Behaviour | Success body |
|---|---|---|
| `GET` | The current state of the user's token. **Never returns the raw token.** | `{ok:true,data:{status, endpoint, config}}` |
| `POST` | Issue a token, or **rotate** it if one already exists. Returns the raw token **once**. | `{ok:true,data:{token, createdAt, endpoint, config}}` |
| `DELETE` | Revoke the token. Idempotent: revoking an already-revoked (or never-issued) token is a 200 with `revokedAt: null`. | `{ok:true,data:{revokedAt}}` |

`status` is:

```ts
{ state: 'none' | 'active' | 'revoked', createdAt: string | null, lastUsedAt: string | null, revokedAt: string | null }
```

`endpoint` is `${await getRuntimeSiteUrl()}/mcp` — `lib/seo/config.ts:44` resolves the public base URL at runtime, including the admin-configured `NEXT_PUBLIC_SITE_URL`. It is an **async** function, so the route awaits it.

**Failure modes** (all in the site's envelope, via `lib/api-handler.ts`):

| Situation | Status | Code |
|---|---|---|
| Not logged in | 401 | `unauthorized` |
| Account disabled | 403 | `forbidden` |
| Malformed body | 400 | `validation` |
| DB unavailable | 503 | `service_unavailable` |

`POST` has no body parameters, so it needs no schema. It accepts an empty body and ignores any content.

### §4.5 The audit log

The repo rule is that **every mutating endpoint writes an audit row, and the metadata carries a title** (`user-action-audit-preference`). Three new events in `lib/audit-format.ts`:

| Event | Fired by | `EVENT_LABEL` | `formatLogMessage` |
|---|---|---|---|
| `mcp_token_created` | `POST` when the user had no token | 「签发 MCP Token」 | `签发 MCP Token「${username}」` |
| `mcp_token_regenerated` | `POST` when the user already had one | 「重新生成 MCP Token」 | `重新生成 MCP Token「${username}」` |
| `mcp_token_revoked` | `DELETE` | 「吊销 MCP Token」 | `吊销 MCP Token「${username}」` |

The audit log's own copy is Chinese — every existing `EVENT_LABEL` entry is (`注册`, `保存字帖`, `撤销会员`, …) — so these three follow suit.

The metadata for all three is `{ title: \`${username} 的 MCP Token\`, username }`. The **title is the username of the account the token belongs to**, so an admin reading the log sees *which* account the token was for, not just a user id — that is what the "metadata 要带标题" rule is for.

`lib/audit-format.ts` carries **four coupled structures** that must be updated in lockstep:

1. the `AuditEvent` union (line 9),
2. the `AUDIT_EVENTS` tuple (line 85 — a test asserts that the tuple covers the union exactly),
3. the `EVENT_LABEL` record (line 163),
4. the `formatLogMessage` per-event branch (line 239).

`logUserAction(req: NextRequest, userId, event, metadata)` is the helper to use (`lib/audit.ts`); it reads the ip from `x-forwarded-for` and the user agent from the header.

---

## §5 Part B, continued — the user-facing side

### §5.1 Where the card lives

**`app/profile/page.tsx`** — the user's own account page, a server component with `export const dynamic = 'force-dynamic'` that redirects to `/login` when there is no session. The card is mounted there.

The admin's user screen (`app/admin/users/`) is **not** changed in v1: D4 chose self-service, and an admin who needs to kill a token can do it from the user's profile card (the admin can open any user's profile) or with one SQL statement. Adding an admin-side management surface is a separate request.

### §5.2 The card

**Files:** `components/mcp/McpTokenCard.tsx` (new, **async server component**) and `components/mcp/McpTokenActions.tsx` (new, **client component**).

The card is split the way `components/membership/MembershipStatusCard.tsx` splits: the server component reads the state on the server (no client fetch, no loading spinner on first paint) and hands it to a small client component that owns the three buttons and the one-time token display.

```tsx
// components/mcp/McpTokenCard.tsx  (server)
export async function McpTokenCard({ userId }: { userId: number }) {
  const status = await getTokenStatus(userId);
  const endpoint = `${await getRuntimeSiteUrl()}/mcp`;
  return (
    <div className="card-paper p-5">
      …
      <McpTokenActions initialStatus={status} endpoint={endpoint} />
    </div>
  );
}
```

The client component (`McpTokenActions.tsx`) does the three calls and owns the local state:

- **no token** → the button 「申请 MCP Token」
- **active** → the buttons 「重新生成」 and 「吊销」, plus the client-configuration block (§5.3) with a copy button
- **revoked** → the button 「申请 MCP Token」 (issuing again replaces the revoked row)
- **the raw token**, in a monospace block, shown **only in the response to the click that issued it**, with a warning that it is shown once and a copy button. It is never re-fetchable — after the user navigates away it is gone for good.

Rotating **invalidates the old token immediately**, and the card says so.

**The copy is in Chinese**, matching the site. The user-facing pages are Chinese — `app/profile/page.tsx` says 「个人主页」「总字数」「已存字帖」, and `MembershipStatusCard` says 「会员状态」「开通会员」. A card with English labels on that page would look like a patch on top of the site. (The repo rule that code, commit messages and *developer* surfaces stay in English does not apply to a card that sits between 「显示拼音」 and 「我的字帖」.)

### §5.3 The client configuration

The API returns this block, ready to paste into an MCP client:

```json
{
  "mcpServers": {
    "ziyun-chinese": {
      "type": "http",
      "url": "https://ziyun.pudafo.com/mcp",
      "headers": {
        "Authorization": "Bearer mcp_<the raw token>"
      }
    }
  }
}
```

`type: "http"` is the Streamable HTTP transport. The `url` is built from `getRuntimeSiteUrl()`, so a staging or a self-hosted deployment produces its own URL.

---

## §6 Part C — the worksheet-design toolset

### §6.1 The scheme catalogue

**File:** `lib/worksheet-schemes.ts` (new)

A *scheme* is a named, standard worksheet format: a cell style + a paper size + a font. The site has no such catalogue today (the practice template page offers free selectors), so this is new — but it is written as **data**, not code, so the site's own practice-template page can adopt it later without a rewrite.

```ts
export interface WorksheetScheme {
  id: string;
  name: string;        // English label
  nameZh: string;      // Chinese label
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  note: string;        // one line, English
}

export const WORKSHEET_SCHEMES: readonly WorksheetScheme[];
export function findScheme(id: string): WorksheetScheme | undefined;
```

The catalogue (16 entries):

| id | name | cellStyle | paperSize | fontFamily |
|---|---|---|---|---|
| `pen-grid-a4` | Pen · Grid · A4 | `pen-square` | `A4` | `wenkai-gb` |
| `pen-cross-a4` | Pen · Cross · A4 | `pen-cross` | `A4` | `wenkai-gb` |
| `pen-lattice-a4` | Pen · Cross · A3 | `pen-cross` | `A3` | `wenkai-gb` |
| `pen-grid-b5` | Pen · Grid · B5 | `pen-square` | `B5` | `wenkai-gb` |
| `pen-lined-a4` | Pen · Lined · A4 | `pen-lined` | `A4` | `wenkai-gb` |
| `pen-english-a4` | Pen · Four-line · A4 | `pen-english` | `A4` | `wenkai-gb` |
| `brush-grid-a4` | Brush · Grid · A4 | `brush-square` | `A4` | `ma-shan-zheng` |
| `brush-cross-a4` | Brush · Cross · A4 | `brush-cross` | `A4` | `ma-shan-zheng` |
| `brush-lattice-a3` | Brush · Cross · A3 | `brush-cross` | `A3` | `ma-shan-zheng` |
| `brush-grid-b5` | Brush · Grid · B5 | `brush-square` | `B5` | `ma-shan-zheng` |
| `brush-trace-a4` | Brush · Trace · A4 | `brush-trace-square` | `A4` | `ma-shan-zheng` |
| `brush-trace-cross-a4` | Brush · Trace · A4 · Cross | `brush-trace-cross` | `A4` | `ma-shan-zheng` |
| `brush-large-12` | Brush · 12 cells | `brush-square` | `brush-12` | `ma-shan-zheng` |
| `brush-medium-24` | Brush · 24 cells | `brush-square` | `brush-24` | `ma-shan-zheng` |
| `brush-small-28` | Brush · 28 cells | `brush-square` | `brush-28` | `ma-shan-zheng` |
| `brush-grid-a3` | Brush · Grid · A3 | `brush-square` | `A3` | `ma-shan-zheng` |

Every `cellStyle` and `paperSize` value in the catalogue must exist in `lib/worksheet-types.ts`; a unit test asserts that.

### §6.2 The tools

`mcp/tools/worksheet.ts` currently holds one tool. It gains two, and the file is **split** so that no file exceeds 500 lines (the CLAUDE.md limit):

| File | Contents |
|---|---|
| `mcp/tools/worksheet.ts` | the three tool registrations + their bodies |
| `mcp/tools/worksheet-render.ts` | the bridge from a worksheet request to the rasteriser (the MCP-specific part of §7) |

#### Tool 1 — `list_worksheet_schemes` (new)

**Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

**Input:** no required arguments. One optional argument:

- `tool` — `'brush' | 'pen'`, filters the catalogue by the tool the cell style belongs to.

**Output** (`data`):

```json
{
  "schemes": [
    { "id": "pen-grid-a4", "name": "Pen · Grid · A4", "nameZh": "钢笔·田字格·A4",
      "cellStyle": "pen-square", "paperSize": "A4", "fontFamily": "wenkai-gb",
      "note": "…", "cellStyleLabel": "钢笔·田字格", "paperSizeLabel": "A4 · 标准" }
  ]
}
```

The labels come from the site's own `cellStyleLabel()` / `paperSizeLabel()` so the catalogue reads the same way the site does.

#### Tool 2 — `generate_worksheet_layout` (existing, unchanged)

No change to its schema or its behaviour. It keeps returning the padded cell list.

#### Tool 3 — `render_worksheet_png` (new)

**Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. It renders an image; it writes nothing.

**Input:**

| Argument | Type | Required | Default | Notes |
|---|---|---|---|---|
| `content` | string | **yes** | — | 1–500 characters, the characters to practise |
| `scheme` | string | no | — | a scheme id from `list_worksheet_schemes` |
| `cellStyle` | enum | no | — | overrides the scheme's cell style |
| `paperSize` | enum | no | — | overrides the scheme's paper size |
| `fontFamily` | enum | no | — | overrides the scheme's font |
| `title` | string | no | `"Untitled"` | 1–80 characters |
| `page` | number | no | `1` | which page to render, 1-based |
| `scale` | number | no | `1` | 1 or 2 — 2 doubles the pixel dimensions |

**Resolution rules** (in order):

1. If `scheme` is given, it must exist → otherwise `not_found` with the id in `details`.
2. `cellStyle` / `paperSize` / `fontFamily` start from the scheme (or, with no scheme, from the site defaults: `brush-square` / `A4` / `ma-shan-zheng` — the same defaults `defaultToolFor()` / `defaultFontFor()` imply).
3. An explicit argument **overrides** the scheme.
4. `content` is validated by the site's own `validateWorksheetInput()` — the same validator the worksheet route uses, so a layout the site would reject never reaches a caller. A validation failure → `bad_input`.
5. `page` must be an integer ≥ 1 and ≤ the page count → otherwise `bad_input`.

**Output.** The result carries **both** a text block (the JSON envelope) and an **image block**, so the model can look at the sheet:

```ts
{
  data: {
    title, scheme?, cellStyle, paperSize, fontFamily,
    page, totalPages,
    width, height,          // pixels
    bytes,                  // the PNG's byte length
    base64Length,           // the length of the base64 payload
    missingGlyphs: string[] // characters no font could draw
  },
  extraContent: [
    { type: 'image', data: '<base64>', mimeType: 'image/png' }
  ]
}
```

`mcp/tool-result.ts` already supports `extraContent` — **the image block needs no change to the result helper.** The image block goes *after* the text block, so a client that only reads text still gets the envelope.

**Size.** A4 at scale 1 is 794×1123 px. The PNG of a mostly-white sheet is roughly 40–120 KB, so the base64 payload is roughly 55–160 KB — comfortably inside a normal MCP message. Scale 2 doubles each dimension (quadruples the pixels) and roughly triples the file size.

---

## §7 The rasteriser

**Files (new):**

| File | Responsibility |
|---|---|
| `lib/png/geometry.ts` | `Point`, `Polygon`, `Rect`, `Color`, and the path-flattening helpers |
| `lib/png/raster.ts` | the canvas and the anti-aliased polygon filler |
| `lib/png/encode.ts` | RGBA bitmap → PNG bytes (Node's `zlib` + a CRC32) |
| `lib/png/glyph.ts` | font loading (fontkit) and glyph outlines |
| `lib/png/worksheet-page.ts` | the page compositor: cells, frames, glyphs, title |

No file exceeds 500 lines. No new dependency beyond moving `fontkit` to `dependencies`.

### §7.1 The canvas and the filler

The canvas is an **RGBA8 buffer** (`Uint8ClampedArray`, `width × height × 4`), white and opaque to begin with.

The filler is a **coverage accumulator**, not a supersampled buffer:

- For each polygon, for each of the **4 sub-scanlines** in a pixel row, compute the crossings, sort them, and fill the spans between crossing pairs (even-odd rule).
- For each span `[x0, x1)`, add to every pixel it touches the value `overlap × ¼` — the horizontal overlap is exact (fractional at the ends), the vertical weight is ¼ per sub-scanline.
- The accumulated coverage for a pixel (0…1) is the alpha of the fill.

This gives exact horizontal anti-aliasing and 4-level vertical anti-aliasing, in `O(pixels touched)` memory rather than a 4× buffer. A 4× full-resolution buffer for A4 would be 57 MB per render; this is a single row.

**Drawing primitives** (all of them reduce to "fill a polygon"):

- `fillPolygon(canvas, polygon, color)`
- `fillRect(canvas, x, y, w, h, color)` — a polygon
- `strokeLine(canvas, x1, y1, x2, y2, width, color)` — a quad (a rectangle) around the segment
- `strokeOutline(canvas, polygons, width, color)` — one quad per edge, the segment ends extended by `width / 2` to fake the join. This is how the trace (描红) red contour is drawn.

Colours are packed RGBA integers: `#555` → `(0x55, 0x55, 0x55, 255)`.

### §7.2 The PNG encoder

`lib/png/encode.ts` writes a standard PNG with no dependency:

1. The signature `89 50 4E 47 0D 0A 1A 0A`.
2. An `IHDR` chunk: width, height, bit depth 8, colour type 6 (RGBA), compression 0, filter 0, interlace 0.
3. An `IDAT` chunk: the **filtered** scanlines — every scanline is prefixed with filter type **0 (None)**, and the whole thing is deflated with `zlib.deflateSync` (Node's built-in).
4. An `IEND` chunk.

Filter 0 (None) makes the file bigger than a Paeth-filtered one, but the sheets are mostly flat white, where filter 0 + deflate already compresses to a few tens of KB, and "no filter" removes a whole class of bugs. (If size turns out to matter, switching to filter 1 (Sub) is a contained change — the encoder is the only file that touches it.)

CRC32 for the chunks is a 256-entry table, computed once.

**The encoder is verified by a test that decodes it.** `sharp` is already a devDependency, so the test can decode our own PNG with `sharp` and assert the dimensions and the pixel coverage. That validates the hand-written encoder without making `sharp` a runtime dependency.

### §7.3 Glyphs

**Source of truth:** the fonts the site already ships, in `public/fonts/*.woff2`. They are read at runtime by **fontkit** (moved from devDependencies to dependencies).

`lib/png/glyph.ts`:

```ts
export interface LoadedFont {
  family: string;
  hasGlyph(char: string): boolean;
  outline(text: string, sizePx: number, penX: number, baselineY: number): Polygon[];
}

export async function loadFont(file: string): Promise<LoadedFont>;
```

`outline` shapes the run with `font.layout(text)`, transforms each glyph's path into pixels (see the coordinate rules below) and returns the flattened polygons.

**The font file map** — `FontFamily` → the woff2 the site serves:

| `FontFamily` | File | Notes |
|---|---|---|
| `wenkai-gb` | `LXGWWenKaiGB-Regular.woff2` | 霞鹜文楷 GB — the site's hard-pen default |
| `yozai` | `Yozai-Regular.woff2` | |
| `iansui` | `Iansui-Regular.woff2` | |
| `zen-kaku-thin` | `ZenKakuGothicNew-Thin.woff2` | |
| `ma-shan-zheng` | `ma-shan-zheng.woff2` | the site's brush default |
| `long-cang` | `long-cang.woff2` | |
| `liu-jian-mao-cao` | `liu-jian-mao-cao.woff2` | |
| `zcool-xiaowei` | `zcool-xiaowei.woff2` | |
| `zhi-mang-xing` | `zhi-mang-xing.woff2` | |
| `song` | — | **no local file** — see the fallback below |
| `kai` | — | the site's `KaiTi` is `local()` only — see the fallback below |
| `hei` | — | the site's Noto Sans SC is a Google subset — see the fallback below |

**Font fallback chain:** the requested font → `LXGWWenKaiGB-Regular.woff2` → `BabelStoneHanBasic.woff2`. If none of the three has the glyph, the cell is drawn as an **empty box** (a tofu rectangle) and the character is listed in `missingGlyphs[]` in the tool's payload. A silently blank cell is the one outcome the anti-goals forbid.

`public/fonts/*.woff2` are **subsets of the site's charset** (they were produced by `npm run fonts:subset-brush` / `subset-hard-pen-fonts`), so a character outside the site's charset may be missing — that is exactly what `missingGlyphs` is for.

**Fonts are cached** in a module-level map (keyed by file name) so a second render does not re-parse a 3 MB woff2. The biggest file in use is 3.2 MB (`ma-shan-zheng.woff2`); parsing it costs a few hundred milliseconds, once.

**Coordinates — measured, not assumed.** fontkit has **no `font.getPath()`**; the glyph outline is reached through the layout:

```js
const run = font.layout(text);                 // Layout: { glyphs, positions, … }
const glyph = run.glyphs[0];
const path = glyph.path;                       // a fontkit Path
```

`glyph.path` is in **font units with the origin on the baseline, y pointing up**. Measured on `public/fonts/LXGWWenKaiGB-Regular.woff2` (`unitsPerEm` 1000):

| Glyph | x range (font units) | y range (font units) |
|---|---|---|
| 一 | 59 … 944 | **319 … 430** (a thin bar *above* the baseline) |
| 永 | 28 … 974 | −96 … 800 |
| 人 | 25 … 970 | −72 … 778 |

The 一 measurement is the decisive one: its ink sits at y ≈ 319–430, i.e. **above** the baseline, which is what a y-up font coordinate system gives.

The renderer maps font units to pixels with fontkit's `Path.transform(a, b, c, d, e, f)` (the SVG matrix convention: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`):

```js
const scale = sizePx / font.unitsPerEm;
const path = glyph.path.transform(scale, 0, 0, -scale, penX, baselineY);
```

The **`-scale` on `d` is the y-flip** — the glyph lands *above* `baselineY` on the canvas. Verified: 一 at `sizePx = 70` with `baselineY = 100` produces a bbox of `x 14.1 … 76.1`, `y 69.9 … 77.7` — the ink above the baseline, in the expected place.

For a **multi-character** run (the four-line row, the title) the pen advances by `run.positions[i].xAdvance * scale` per glyph, plus `xOffset` / `yOffset` from the same position record. `Path` also offers `translate`, `scale`, `rotate` and `toSVG()`, but the single `transform` above is all the renderer needs.

**Curve flattening.** fontkit emits `lineTo`, `quadraticCurveTo` and `bezierCurveTo`. Each curve is flattened into **8 line segments** — at a 70–140 px cell, 8 segments per curve is well under a pixel of error.

### §7.4 The page compositor

**File:** `lib/png/worksheet-page.ts`

`renderWorksheetPage(request): Canvas` where `request` is:

```ts
{
  title: string;
  cells: Cell[];         // from generateLayout()
  cellStyle: CellStyle;
  paperSize: PaperSize;
  fontFamily: FontFamily;
  page: number;          // 1-based
  scale: number;         // 1 or 2
}
```

**The page box** (CSS px at 96 DPI, then multiplied by `scale`):

| Paper | Width | Height | Source |
|---|---|---|---|
| `A3` | 1123 | 1587 | 297 × 420 mm |
| `A4` | 794 | 1123 | 210 × 297 mm |
| `B5` | 665 | 945 | 176 × 250 mm |
| `brush-12` / `brush-24` / `brush-28` | 794 | 1123 | A4 canvas |

**The layout** (all in CSS px):

- **Margin**: 56 px on every side (1.5 cm at 96 DPI, the same margin the site's PDF uses).
- **Title band**: the title is drawn at the top-left of the content area, 20 px em, in `#555`. The band is 48 px tall; the grid starts below it.
- **Gap**: 8 px between cells — the same gap as `components/worksheet/PracticePDF.tsx`.
- **Columns**: `PAPER_SIZES[paperSize].cols` (A3 12, A4 8, B5 6, brush-12 4, brush-24 6, brush-28 7).
- **Cell size**:
  - grid presentations (square / cross): `PRACTICE_GRID_CELL_SIZE[paperSize]` (A3 70, A4 70, B5 80, brush-12 140, brush-24 100, brush-28 85).
  - lined (`pen-lined`): width `PRACTICE_LAYOUT[paperSize].cellSize`, height `linedHeightPx(paperSize)` (A3 38, A4 38, B5 44).
  - four-line (`pen-english`): width `PRACTICE_GRID_CELL_SIZE[paperSize]`, height `round(width × 38 / 100)` — the 100:38 ratio of the site's four-line SVG viewBox.
- **Rows**: as many as fit between the grid top and the bottom margin.

**The grid is filled from the padded cell list.** `generateLayout()` already pads the content to whole pages, so page *n* takes `cells.slice((n-1) × cellsPerPage, n × cellsPerPage)` — except for the four-line presentation, where `generateLayout` returns **rows** (one cell per row, each cell's `char` holding the whole row's text) and `englishCharsPerRow` / `fourLineRowsPerPage` govern the split. The renderer follows the same two paths the site follows.

> **One small change to `lib/worksheet-types.ts`:** `englishCharsPerRow` is currently a **private** function (`lib/worksheet-types.ts:312`); the renderer needs it, so it becomes `export function englishCharsPerRow`. `fourLineRowsPerPage` is already exported.

### §7.5 The cell drawing

The cell drawing reproduces `components/worksheet/WorksheetCell.tsx` exactly, in the site's 100-unit viewBox, scaled to the cell's pixel size (`unit = cellSize / 100`):

| Element | Geometry (viewBox units) | Colour | Width |
|---|---|---|---|
| Border (square / cross) | `rect(2, 2, 96, 96)` | `#555` | 1 |
| Vertical guide | `(50, 2) → (50, 98)` | `#bbb` | 0.5 |
| Horizontal guide | `(2, 50) → (98, 50)` | `#bbb` | 0.5 |
| Diagonals (cross only) | `(2,2)→(98,98)` and `(98,2)→(2,98)` | `#bbb` | 0.5 |
| Baseline guide (cross only) | `(2, 90) → (98, 98)` | `#bbb` | 0.5 |
| Character | centred, `fontSize` = `size` (trace) or `round(size × 0.6)` (normal) | `#ddd` (trace) / `#bbb` (normal) | — |
| Trace contour | the character's outline, stroked | `#c0392b` | 1.5 |
| Lined rule (pen-lined) | a horizontal line at the bottom of the cell | `#555` | 1 |
| Four-line rules (pen-english) | `y = 8` solid, `y = 14` dashed, `y = 29` dashed, `y = 35` solid — in a 100×38 box | `#999` (solid) / `#bbb` (dashed) | 1 / 0.6 |
| Four-line text | centred at `y = 21`, `fontSize` 16, fill `#ddd`, stroke `#c0392b` | — | 0.8 |

The **character size** deserves a note. The site's SVG has a `viewBox="0 0 100 100"` mapped onto a `size`-px square, so a `fontSize` of *n* **viewBox units** is *n × size / 100* **pixels**. The site's `guideFontSize` is `size` for trace and `round(size × 0.6)` for normal — i.e. **80 % of the cell** for a trace character and **60 %** for a normal one. The rasteriser uses the pixel values directly (0.8 × cellSize and 0.6 × cellSize), which is what the browser ends up drawing.

**Dashed lines** (the four-line rules) are drawn as a run of short segments: 4 px on, 3 px off, in the cell's pixel units — the site's `strokeDasharray="4,3"`, which is in viewBox units.

### §7.6 The title

The title is drawn with the same font pipeline as the characters: the title string is shaped as one text run and rendered at 20 px em, left-aligned at the left margin, with its baseline 28 px below the top of the content area. A title longer than the content width is **not** wrapped — it is truncated with an ellipsis. (A wrapped title needs a line-breaking algorithm; a worksheet title is a label, not a paragraph.)

---

## §8 Error codes

The MCP error vocabulary is `mcp/errors.ts`; the site's is `lib/api-handler.ts`. The new codes fit the existing ones:

| Code | Where | Meaning |
|---|---|---|
| `unauthorized` | MCP route, MCP tools | no / invalid / revoked token |
| `forbidden` | MCP route | the session belongs to another account |
| `bad_input` | MCP tools, the API | the arguments failed validation |
| `not_found` | MCP tools, the API | unknown scheme id, unknown page |
| `data_unavailable` | MCP tools | a file the tool needs is not readable |
| `upstream_error` | MCP tools | an external service failed |
| `internal_error` | MCP tools | a bug |
| `validation` | the API | the body failed the schema |
| `service_unavailable` | the API | the database is unreachable |

**A note on how MCP reports errors.** The SDK validates the tool's zod schema *before* the body runs, and a mismatch comes back as a **normal result with `isError: true`** and the text `MCP error -32602: Invalid arguments for tool <name>: …` — the client does not reject. An error thrown *inside* the body becomes the `{ok:false,error:{code}}` envelope. The tools therefore validate their own arguments in the body (as the existing ones do) rather than relying on the schema alone.

---

## §9 Testing

### §9.1 The MCP route

| Test | Asserts |
|---|---|
| `POST /mcp` with no `Authorization` | **401**, envelope `unauthorized` |
| `POST /mcp` with an unknown token | **401** |
| `POST /mcp` with a revoked token | **401** |
| `POST /mcp` with a token whose user is disabled | **401** |
| `POST /mcp` with a valid token | **200**, the initialize result, and a `mcp-session-id` response header |
| `POST /mcp` with a valid session id and no `mcp-session-id` | the transport's own **400** |
| `POST /mcp` with an unknown session id | **404**, `not_found` |
| `GET /mcp` with no session id | **400** |
| `DELETE /mcp` with a valid session id | the session ends; a later request with that id is **404** |
| `OPTIONS /mcp` | **204** and the CORS headers, including `Access-Control-Expose-Headers: mcp-session-id` |
| a session opened with user A, then used with user B's token | **403** |

The route is tested by driving the exported handlers with a `Request` object — no port is bound. In the App Router the handler's parameter is a `NextRequest`, which **extends** `Request`, so the same object satisfies both the SDK's Web-standard transport and `logUserAction(req: NextRequest, …)` from `lib/audit.ts`.

### §9.2 The token store and the API

| Test | Asserts |
|---|---|
| issue | a row exists, the raw token is 47 chars and starts with `mcp_`, the stored hash is the sha256 of the raw token and is **not** the raw token |
| issue twice | one row, a **different** raw token, `created_at` refreshed |
| revoke | `revoked_at` is set; the raw token no longer resolves |
| revoke an already-revoked token | a 200, `revokedAt` unchanged (idempotent) |
| resolve a valid token | `{userId, username}` |
| resolve a revoked token / a disabled user's token | `null` |
| `last_used_at` throttling | two resolves within the hour → **one** write; a resolve after the hour → a second write |
| `GET /api/mcp/token` | 200; the response **contains no raw token** |
| `GET /api/mcp/token` while logged out | 401 |
| `POST /api/mcp/token` | 200; the response contains the raw token exactly once |
| `DELETE /api/mcp/token` | 200; the audit log has a `mcp_token_revoked` row with a title |
| the audit log | one row per mutating call, with the event and the title in the metadata |

### §9.3 The rasteriser

| Test | Asserts |
|---|---|
| the PNG encoder | `sharp` decodes it; the dimensions are right; the corner pixel is opaque white; a known black rectangle lands where it should |
| the filler | a square's edges are anti-aliased (the edge pixels are neither fully black nor fully white) |
| the polygon filler | a point-in-polygon test agrees with the rasterised result |
| **the glyph is not mirrored** | render 「永」 into a cell; the ink's bounding box is in the **upper** part of the cell (a y-flip bug would put it in the lower part) |
| the glyph fallback | a character no font has → a tofu box is drawn and the character appears in `missingGlyphs` |
| the page compositor | an A4 page is 794×1123 (and 1588×2246 at scale 2) |
| the cell geometry | the border, the guides and the diagonals land at the expected pixels — compared against the site's own viewBox numbers |
| the trace contour | a trace cell's character has red (`#c0392b`) pixels on its edge and gray (`#ddd`) pixels inside |
| the round trip | `render_worksheet_png` returns a base64 payload that `sharp` decodes to a PNG of the expected size |

### §9.4 The gates

Before any commit: `npx tsc --noEmit` clean, `npx vitest run` green, `npx eslint .` clean.

**A build is required** — the change adds `app/mcp/route.ts` and modifies `app/profile/page.tsx`, and the repo rule (`feedback-per-task-pnpm-build-gap`) is that touching `app/**/page.tsx` mandates a build, because neither `tsc` nor the tests catch a route conflict. The build runs **only** in the isolated worktree `D:/Temp/pinyin-build-check`; never while the dev server holds port 4444 (`dev-build-cache-stomp`).

---

## §10 Deployment

| Question | Answer |
|---|---|
| nginx | **No change.** `deploy/nginx.ziyun.pudafo.com.conf` has `location /` proxying everything to `127.0.0.1:4444`; `/mcp` is covered by it. The `client_max_body_size 500m` and the WebSocket `Upgrade` passthrough are untouched. |
| New port | **None.** This is the point of D1. |
| Process management | Unchanged: `HOST=127.0.0.1 nohup npm start &`. The standalone `mcp:start` process is no longer part of the runbook. |
| New environment variables | None required. `MCP_SERVER_NAME`, `MCP_SERVER_VERSION` and `MCP_CORS_ORIGIN` are optional with defaults. `MCP_AUTH_TOKEN` and `MCP_ALLOW_ANONYMOUS` are **removed** from the runbook. |
| New dependency | `fontkit` moves from devDependencies to dependencies. It is **pure JS** — no native binary, no install step, no `node-gyp`. `npm install --legacy-peer-deps` on the server, as usual. |
| Deploy bundle | `public/fonts/*.woff2` already ship (the deploy script excludes only `assets/fonts`, the subsetting source). The renderer reads them from `public/` at runtime. |
| Database | one new table; the migration is idempotent and runs like the others. |

**One operational caveat, stated plainly:** the MCP endpoint is now inside the site's Node process. A heavy PNG render competes with the site's request handling for the same event loop. A4 at scale 1 renders in well under a second; scale 2 is heavier. If this becomes a problem the fix is a worker, not a different design — but v1 does not need it.

---

## §11 The file map

**New**

```
app/mcp/route.ts                       the MCP endpoint (POST/GET/DELETE/OPTIONS)
app/api/mcp/token/route.ts             GET / POST / DELETE — the token API
components/mcp/McpTokenCard.tsx         the profile-page card (server component)
components/mcp/McpTokenActions.tsx      the card's buttons and the one-time token display (client)
mcp/server-factory.ts                  build a configured McpServer
mcp/tools/worksheet-render.ts           the MCP → rasteriser bridge
lib/mcp-token.ts                       the token store (issue / revoke / resolve)
lib/worksheet-schemes.ts                the named scheme catalogue
lib/png/geometry.ts                    points, polygons, flattening
lib/png/raster.ts                      the canvas and the AA polygon filler
lib/png/encode.ts                      PNG bytes from an RGBA bitmap
lib/png/glyph.ts                       font loading and glyph outlines
lib/png/worksheet-page.ts               the page compositor
scripts/migrations/2026-10-26-mcp-tokens.sql
```

**Modified**

```
lib/audit-format.ts                    3 new events (union + AUDIT_EVENTS + EVENT_LABEL + formatLogMessage)
lib/worksheet-types.ts                  export englishCharsPerRow (it is private today)
app/profile/page.tsx                   mount the card
mcp/tools/worksheet.ts                  + list_worksheet_schemes, + render_worksheet_png
package.json                           fontkit → dependencies; drop mcp:dev / mcp:start
scripts/init-db.ts                     + the mcp_tokens table
mcp/README.md                          rewritten for the mounted endpoint
```

**Deleted**

```
mcp/main.ts  mcp/server.ts  mcp/session.ts  mcp/body.ts  mcp/config.ts  mcp/auth.ts
tests/unit/mcp/auth.test.ts  tests/unit/mcp/config.test.ts  tests/unit/mcp/harness.ts
```

`tests/unit/mcp/errors.test.ts` stays.

---

## §12 What is left to the builder

1. **The exact shape of `lib/png/raster.ts`'s coverage accumulator.** The spec fixes the algorithm (4 sub-scanlines, exact horizontal overlap) and the outcome; the implementation is the builder's.
2. **The curve-flattening tolerance.** 8 segments per curve is specified; the builder may raise it if the visual result is visibly faceted, and should say so if they change it.
3. **The dev-anonymous exception** (§3.5) — keep it or drop it. Dropping it is a one-line change.
4. **The `title` truncation ellipsis** — `…` versus `...`; the site's convention is the former.
5. **The order of the `image` block versus the `text` block** — the spec says text first, image second.

---

## §13 Open questions for the human partner

*(none — every fork in this design was settled before the document was written; see §0.)*
