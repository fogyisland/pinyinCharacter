# MCP: per-user tokens, site-mounted endpoint, worksheet design + PNG — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to produce the implementation plan after this spec is approved.

**Goal:** Turn the existing standalone MCP server (18 read-only tools, `mcp/`, a separate process on port 4455) into **a route inside the site itself** (`POST/GET/DELETE https://ziyun.pudafo.com/mcp`), authenticated by a **per-user token each registered user can issue, rotate and revoke from their own profile page**, and extend it with a **worksheet-design toolset** that hands the AI a **standard worksheet scheme** and the rendered **PNG** of the worksheet.

**Why now:** The user asked for three things in one breath (2026-10-26):

1. 「我们还需要为每个注册用户启用 MCP token 申请功能」 — per-user tokens, not one global env-var key.
2. 「mcp 直接挂网站 不需要额外的端口」 — no second process, no second port, and (as §2.2 records) one small nginx block rather than a new upstream.
3. 「另外提供字帖设计的 mcp 提供标准的字帖方案，并且支持生成后以 png 方式发送给 ai」 — a worksheet-design toolset that returns a PNG image block the model can actually look at.

Requests 1 and 2 together dissolve the one structural conflict the current design has: *"the MCP server is zero-MySQL by construction, but per-user tokens need a database."* Mounting the server as a Next.js route handler puts `getPool()` in-process, so **only the auth layer touches MySQL — the 18 tools stay exactly as file-only as they are today.** The purity property is preserved where it matters (the data path) and dropped where it was only a constraint of the standalone process.

**Builder check (2026-10-26).** A fresh reviewer read this document against the repository. Its findings were checked against the code, not taken on trust, and folded in. Three of them changed the design materially:

- **The `middleware.ts` setup gate would have made the endpoint unreachable** (§2.1). No MCP client sends a cookie, so every request would have been 307'd to `/init`. This was invisible from the transport side and is now the first thing the document says.
- **The row counts and the four-line geometry were specified from a dead code path** (§7.4, §7.5). `WorksheetCell.tsx`'s four-line branch is not what the site renders; the live geometry is the CSS DOM in `app/globals.css` and the print geometry in `PracticePDF.tsx`. Both sections now describe the live one.
- **The SDK rejects a bad argument at the schema layer and returns it as a normal `isError` result** — the client does not reject (§8). The new tool therefore declares a loose schema and validates in its body, which is also the repo's own stated convention in `mcp/tools/shared.ts`.

The reviewer's remaining findings were either already settled by the conversation or were mine to settle; all of them are now written into the document. **No question is outstanding for the human partner** — see §13.

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

### §2.1 The middleware gate — the endpoint is unreachable without this

**This is the one thing that would have made the whole feature dead on arrival, and it is not visible from the transport side.**

`middleware.ts` is a cookie-only setup gate. Every path that is not on its whitelist is **307-redirected to `/init`** unless the request carries the `setup_completed=1` cookie. The whitelist today is `/init`, `/init/*`, `/api/init/*` and the static assets; the `matcher` excludes the static assets from the edge runtime but matches everything else.

**An MCP client sends no cookie.** Claude Desktop, `mcp-remote` and the IDE clients send only `Authorization: Bearer …`. So every request to `/mcp` would be answered with a 307 to `/init`; the client follows the redirect, receives the wizard's HTML instead of a JSON-RPC response, and the session never opens. The endpoint would exist, be correct, and be unreachable.

**The fix is one line in `middleware.ts`:** `/mcp` is let through untouched, exactly like `/init` and `/api/init/*`:

```ts
// The MCP endpoint is called by MCP clients, which send no cookies — the
// setup gate would 307 them to /init and the session would never open.
if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
  return NextResponse.next();
}
```

`/api/mcp/token` needs no exemption: it is called from the browser with the session cookie, and the setup gate is orthogonal to the login.

**This is a code change to a file the spec's file map did not mention.** It is listed in §11 now, and it is the reason the deployment table in §10 says "one file outside the MCP feature changes".

### §2.2 The nginx proxy and the GET stream

`deploy/nginx.ziyun.pudafo.com.conf` proxies `location /` to `127.0.0.1:4444` with nginx's **default `proxy_buffering on`** and `proxy_read_timeout 120s`. The Streamable HTTP transport's `GET` is an SSE stream, and with buffering on nginx withholds the frames until the buffer fills.

**The `GET` stream is optional in this protocol.** The SDK's own `StreamableHTTPClientTransport` does **not** open the `GET` stream on `connect()` — it opens it only for resumption and for the OAuth flow — and this server never sends server-initiated notifications, so a client that never opens the `GET` stream loses nothing. A browser-based client that does open it would get a buffered stream.

**A dedicated `location /mcp` block fixes it anyway, and it costs six lines.** The block disables buffering and raises the read timeout for the MCP path only, and leaves every other path exactly as it is:

```nginx
location /mcp {
    proxy_pass http://ziyun_app;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;              # SSE: do not withhold the frames
    proxy_cache off;
    proxy_read_timeout 3600s;         # a long-lived stream, not 120s
}
```

So §10's "no nginx change" is **false** for `GET /mcp` and the config file is in §11's modified list. The property that matters — one process, one port, no new upstream — is unchanged.

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

**The route is behind the setup gate.** `middleware.ts` redirects every non-whitelisted path to `/init`, and an MCP client sends no cookie — §2.1 explains why `/mcp` must be added to the middleware's whitelist, and that one line is a prerequisite for the endpoint existing at all.

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

**A POST only opens a session if it really is an `initialize`.** The route reads the body (capped at **4 MiB**, the same cap the retired `mcp/body.ts` used) and asks the SDK's own `isInitializeRequest(body)` — exported from `@modelcontextprotocol/sdk/types.js` — before it builds anything. A POST with no session id whose body is *not* an initialize is answered **400** and creates nothing.

This matters because the alternative leaks: a transport mints its session id *while* it handles the initialize, so a route that built the server first and registered it afterwards would have to register every POST — including the ones that turn out to be `tools/list` with no session, which the transport answers with a 400. Every one of those would leave an `McpServer` and a transport alive in the map, unreachable and never closed. The old `mcp/session.ts` avoided this the same way, and the ported route keeps that discipline.

**The 400-vs-404 distinction is deliberate and must not be collapsed.** 400 means *the request is malformed* (no session id at all); 404 means *the session id is well-formed but unknown* (never opened, already closed, or the server restarted). The standalone server already draws this line and the SDK's own transport draws the same one; the route must agree with both.

**The route checks the session id against its own map *before* handing the request to the transport.** The map is the only place the `McpServer` instance lives, so the route has to look the session up anyway — and by looking it up first, **the 400 and 404 bodies are the site's `{ok:false,error:{code}}` envelope**, not the transport's JSON-RPC error bodies. A client that knows the site's API reads the MCP endpoint's errors with the same vocabulary. The transport's own error paths (a malformed JSON-RPC message, an unsupported `mcp-protocol-version`) still produce JSON-RPC errors — those are protocol-level, and the route does not intercept them.

### §3.4 The session map

Stateful mode: `sessionIdGenerator: () => randomUUID()`.

A session owns an `McpServer` and a `WebStandardStreamableHTTPServerTransport`, plus the `userId` resolved when the session was opened.

**The map lives on `globalThis`, not in a module-level `const`.** Next.js dev re-evaluates route modules on every edit; a module-level `Map` would drop every open session on each hot reload and the clients would see a cascade of 404s. The repo has the same bug and the same fix once already — the `/init` wizard's dev token had to move from a module-level `Map` to `globalThis` (see `init-wizard-dev-token-bug`).

**File:** `mcp/session-store.ts` (new). It owns the map, the `McpSession` type and the store accessor; the route file owns the HTTP verbs. The pattern:

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
- **`users.disabled_at` is a prerequisite, not part of this migration.** The column is created by the idempotent `ALTER` inside `scripts/init-db.ts` and by no file in `scripts/migrations/` — but `lib/auth.ts` already selects it, so every live database has it. The `resolveToken` query in §4.3 reads it too, and it inherits the same prerequisite. The migration notes this in a comment; it does not add the column (a fresh database gets it from `init-db.ts`, and an upgraded one already has it).

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

export interface ResolvedToken {
  userId: number;
  username: string;
  isAdmin: boolean;
}

export async function getTokenStatus(userId: number): Promise<McpTokenStatus>;
export async function issueToken(userId: number): Promise<{ raw: string; createdAt: string }>;
export async function revokeToken(userId: number): Promise<{ revokedAt: string | null }>;
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

**Issuing (and rotating) resets `last_used_at` to NULL.** A rotated token is a new secret that has never been used; carrying the old timestamp forward would tell the user a brand-new token was used a minute ago.

### §4.4 The API

**File:** `app/api/mcp/token/route.ts` (new)

All three verbs require a logged-in user (`requireUser()` from `lib/auth.ts`) and answer `Cache-Control: no-store`.

| Verb | Behaviour | Success body |
|---|---|---|
| `GET` | The current state of the user's token. **Never returns the raw token.** | `{ok:true,data:{status, endpoint, config}}` |
| `POST` | Issue a token, or **rotate** it if one already exists. Returns the raw token **once**. | `{ok:true,data:{token, createdAt, endpoint, config}}` |
| `DELETE` | Revoke the token. Idempotent. | `{ok:true,data:{revokedAt}}` |

`status` is:

```ts
{ state: 'none' | 'active' | 'revoked', createdAt: string | null, lastUsedAt: string | null, revokedAt: string | null }
```

**The revoke contract, exactly.** `DELETE` answers 200 in every case, and `revokedAt` says what happened:

| State before the call | `revokedAt` in the answer |
|---|---|
| no token was ever issued | `null` — there was nothing to revoke |
| an active token | the timestamp of **this** call |
| an already-revoked token | the **original** revocation timestamp, unchanged |

The third row is the point of the contract: a second `DELETE` is a no-op that reports *when* the token was actually revoked, not `null` and not a new timestamp. A `DELETE` never 404s and never errors.

**`endpoint` — where the URL comes from.** `getRuntimeSiteUrl()` (`lib/seo/config.ts:44`) resolves the public base URL at runtime, including the admin-configured `NEXT_PUBLIC_SITE_URL`. It is an **async** function, so the route awaits it. It falls back to `http://localhost:3000` when nothing is configured — but the dev server runs on **4444**, so that fallback would hand the user a URL that does not work.

A small helper, `lib/mcp-endpoint.ts`, resolves it:

```ts
export async function resolveMcpEndpoint(req?: { url: string }): Promise<string>;
```

It returns `${getRuntimeSiteUrl()}/mcp` when the site URL is configured, and the **request's own origin** (`${new URL(req.url).origin}/mcp`) when `getRuntimeSiteUrl()` fell back to the localhost placeholder. So dev hands out `http://localhost:4444/mcp` and production hands out the admin-configured `https://ziyun.pudafo.com/mcp`.

The parameter is typed as the **structural minimum** `{ url: string }` rather than `Request` or `NextRequest`: a plain Web `Request` has no `nextUrl` (only `NextRequest` has), the SDK's Web-standard transport hands the route a plain `Request`, and the test harness builds one by hand. Both `Request` and `NextRequest` satisfy `{ url: string }`, so the same helper serves the API route, the server component and the tests.

**Failure modes** (all in the site's envelope, via `lib/api-handler.ts`):

| Situation | Status | Code |
|---|---|---|
| Not logged in | 401 | `unauthorized` |
| Account disabled | 403 | `forbidden` |
| DB unavailable | 503 | `service_unavailable` |

There is **no 400**. `POST` has no body parameters, so it has no schema and no body to validate; it accepts an empty body and ignores any content. A 400 that can never happen is a failure mode nobody tests.

Every answer carries `Cache-Control: no-store` — the route's `Cache-Control` must be on the 503 as well as on the 200s. `lib/api-handler.ts`'s `serviceUnavailable(code, message)` takes no `ResponseInit` today, so the helper gains an optional third parameter (`init?: ResponseInit`) that is spread into the response — a one-line, backwards-compatible change.

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
  const endpoint = await resolveMcpEndpoint();
  return (
    <div className="card-paper p-5">
      …
      <McpTokenActions initialStatus={status} endpoint={endpoint} />
    </div>
  );
}
```

`resolveMcpEndpoint()` (§4.4) is the **no-request** form of the helper: the card is a server component rendered inside a page, so it has no `Request` of its own; it falls back to `getRuntimeSiteUrl()` and, in dev, to the dev server's port. The API route uses the request-aware form, which is why the helper takes an optional `req`.

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

`type: "http"` is the Streamable HTTP transport. The `url` is built by `resolveMcpEndpoint()` (§4.4), so a staging or a self-hosted deployment produces its own URL — and a dev server on 4444 produces `http://localhost:4444/mcp` rather than the `localhost:3000` placeholder.

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
| `pen-lattice-a3` | Pen · Cross · A3 | `pen-cross` | `A3` | `wenkai-gb` |
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
2. `cellStyle` / `paperSize` / `fontFamily` start from the scheme. **With no scheme**, the defaults are the site's own brush defaults — `brush-square` / `ma-shan-zheng` — and the paper size follows the cell style's tool, exactly as the existing tool does (`mcp/tools/worksheet.ts:77`): a brush style → `brush-12`, a pen style → `A4`. The site has no single default paper size; the paper size is a consequence of the tool, and the site has always derived it that way.
3. An explicit argument **overrides** the scheme.
4. `content` is validated by the site's own `validateWorksheetInput()` — the same validator the worksheet route uses, so a layout the site would reject never reaches a caller. A validation failure → `bad_input`.
5. `page` must be an integer ≥ 1 and ≤ the page count → otherwise `bad_input`.

**The JSON schema is deliberately loose; the body does the validating.** The SDK checks the tool's zod schema *before* the body runs. A mismatch comes back as a normal result with `isError: true` whose text is `Input validation error: Invalid arguments for tool <name>: …` — a bare string, **not** the site's `{ok:false,error:{code}}` envelope. So a schema with `content: z.string().min(1).max(500)` would answer an over-long content with an opaque protocol error instead of the friendly `bad_input` envelope the site uses everywhere.

The new tool therefore declares `content: z.string()` (and `title: z.string().optional()`) and does the real validation in the body with the shared helpers in `mcp/tools/shared.ts` — `requireText(value, argument, maxLength)`. This is the repo's own stated convention ("the char arguments are validated here rather than in the JSON schema on purpose"). The **existing** `generate_worksheet_layout` tool keeps its schema unchanged; only the new tool is written this way.

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

**Font fallback chain:** the requested font → `LXGWWenKaiGB-Regular.woff2` → `BabelStoneHanBasic.woff2`. The fallback is **per character**: each character is looked up in the requested font first, then in the two fallbacks, so a sheet may mix fonts. If none of the three has the glyph, the cell is drawn as an **empty box** (a tofu rectangle) and the character is listed in `missingGlyphs[]` in the tool's payload. A silently blank cell is the one outcome the anti-goals forbid.

`public/fonts/*.woff2` are **subsets of the site's charset** (they were produced by `npm run fonts:subset-brush` / `subset-hard-pen-fonts`). They are BMP-only and they do **not** cover all of U+9FFF — `LXGWWenKaiGB-Regular.woff2` carries 7 264 glyphs, `ma-shan-zheng.woff2` 6 981, `BabelStoneHanBasic.woff2` 8 778, and none has a glyph above U+20000. So `missingGlyphs` fires for legitimate requests more often than a first reading suggests, and that is exactly what it is for. The site's own `SINGLE_CJK` validator is BMP-only too (`lib/worksheet-types.ts:283`), so the two agree on what "a character" is.

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

**`font.layout()` rather than per-glyph paths.** A per-glyph lookup (`font.glyphForCodePoint(cp).path`) would give outlines without shaping, which is fine for one Han character per cell and wrong for the title and for a four-line row of up to 88 Latin letters — those need real advance widths and the font's own kerning. `font.layout(text)` returns the shaped run with both the glyphs and the positions, so one code path serves every case.

**One trap to avoid.** `glyph.getScaledPath(x, y, fontSize)` exists on fontkit's `Glyph` and looks like the convenient way to do this — it is not: for these TrueType outlines it returns **all-zero coordinates** (`bbox {0,0,0,0}`, every command `[0,0,…]`), so a renderer built on it draws nothing at all. The outline comes from `glyph.path` (or `run.glyphs[i].path`) and the transform above.

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
  siteHost: string;      // the footer line
}
```

**The page box** (CSS px at 96 DPI, then multiplied by `scale`):

| Paper | Width | Height | Source |
|---|---|---|---|
| `A3` | 1123 | 1587 | 297 × 420 mm |
| `A4` | 794 | 1123 | 210 × 297 mm |
| `B5` | 665 | 945 | 176 × 250 mm |
| `brush-12` / `brush-24` / `brush-28` | 794 | 1123 | A4 canvas |

**The counts come from the site, not from the geometry.** The rasteriser reproduces the site's own printable worksheet — `components/worksheet/PracticePDF.tsx` — and that file's row counts are the site's contract:

| Presentation | Rows per page | Source |
|---|---|---|
| grid (square / cross / trace) | `cellsPerPage(paperSize)` | `lib/worksheet-page-count.ts` (A3 168, A4 88, B5 48, brush-12 12, brush-24 24, brush-28 28) |
| lined (`pen-lined`) | `linesPerPage(paperSize)` | `lib/worksheet-types.ts` (A3 36, A4 24, B5 14) |
| four-line (`pen-english`) | `fourLineRowsPerPage(paperSize)` | `lib/worksheet-types.ts` (A3 21, A4 16, B5 12) |

The grid's row count is `cellsPerPage / PAPER_SIZES[paperSize].cols` (A3 14, A4 11, B5 8, brush-12 3, brush-24 4, brush-28 4).

**Why the site's counts and not "as many rows as fit".** Fitting the rows to the pixel height would pack the sheet to the bottom margin and produce a *different* page from the one the site prints — a different `totalPages`, a different last page, and a sheet that does not look like the site's own (an explicit anti-goal). The site's counts are tuned against the real print geometry, including the header/footer band, and they are the numbers the site already uses to decide how many cells fit on a page. The PNG therefore uses them verbatim. The leftover space at the bottom of the sheet is the site's own, and the PNG shows it too.

**The layout** (all in CSS px):

- **Margin**: 56 px on every side (1.5 cm at 96 DPI — the same padding the site's PDF uses: `padding: '1.5cm'`).
- **Header band**: the title at the top-left (20 px em, `#3a2a14`), the cell-style label and the font name at the top-right (12 px, `#5a4530`). The band is 40 px tall, with a 1 px `#3a2a1433` rule under it and 14 px of space below it — the site's PDF header metrics (`styles.header`).
- **Footer**: the site host, centred, 9 px, `#999`, above a 1 px `#3a2a141a` rule — the site's PDF footer (`styles.footer`).
- **Gap**: 8 px between grid cells — the same gap as `PracticePDF.tsx` (`styles.grid.gap`).
- **Columns**: `PAPER_SIZES[paperSize].cols` (A3 12, A4 8, B5 6, brush-12 4, brush-24 6, brush-28 7).
- **Cell size** (grid presentations): `PRACTICE_GRID_CELL_SIZE[paperSize]` (A3 70, A4 70, B5 80, brush-12 140, brush-24 100, brush-28 85) — the size the site's PDF uses.
- **Row geometry** (lined and four-line): the row is **the full content width** — `contentWidth = pageWidth - 2 × 56` — and its height is `linedHeightPx(paperSize)` (A3 38, A4 38, B5 44). The site's own lined and four-line rows are full-width strips (`PracticePDF.tsx` draws them at `PAGE_INNER_WIDTH_PT`; `globals.css` gives `.lined-paper-row` and `.four-line-paper-row` `width: 100%`), so a row one cell wide would be a stub, not the site's sheet.
- **Four-line row gap**: 16 px between rows (the site's `.four-line-paper-row { margin-bottom: 16px }`).

**The grid is filled from the padded cell list.** `generateLayout()` already pads the content to whole pages, so page *n* takes the slice for that page — `cells.slice((n-1) × cellsPerPage, n × cellsPerPage)` for the grid, the same for lined with `linesPerPage`, and for the four-line presentation `generateLayout` returns **rows** (one cell per row, each cell's `char` holding the whole row's text) and `englishCharsPerRow` / `fourLineRowsPerPage` govern the split. The renderer follows the same two paths the site follows.

> **One small change to `lib/worksheet-types.ts`:** `englishCharsPerRow` is currently a **private** function (`lib/worksheet-types.ts:312`); the renderer needs it, so it becomes `export function englishCharsPerRow`. `fourLineRowsPerPage` is already exported.

### §7.5 The cell drawing

There are **two** kinds of cell, and they do not come from the same source.

#### The grid cells (square / cross / trace)

The grid cells reproduce `components/worksheet/WorksheetCell.tsx` exactly, in the site's 100-unit viewBox, scaled to the cell's pixel size (`unit = cellSize / 100`):

| Element | Geometry (viewBox units) | Colour | Width |
|---|---|---|---|
| Border (square / cross) | `rect(2, 2, 96, 96)` | `#555` | 1 |
| Vertical guide | `(50, 2) → (50, 98)` | `#bbb` | 0.5 |
| Horizontal guide | `(2, 50) → (98, 50)` | `#bbb` | 0.5 |
| Diagonals (cross only) | `(2,2)→(98,98)` and `(98,2)→(2,98)` | `#bbb` | 0.5 |
| Baseline guide (cross only) | `(2, 90) → (98, 98)` | `#bbb` | 0.5 |
| Character | centred at (50, 50), `fontSize` = `size` (trace) or `round(size × 0.6)` (normal) | `#ddd` (trace) / `#bbb` (normal) | — |
| Trace contour | the character's outline, stroked | `#c0392b` | 1.5 |

The **character size** deserves a note. The site's SVG has a `viewBox="0 0 100 100"` mapped onto a `size`-px square, so a `fontSize` of *n* **viewBox units** is *n × size / 100* **pixels**. The site's `guideFontSize` is `size` for trace and `round(size × 0.6)` for normal — i.e. **100 % of the cell** for a trace character and **60 %** for a normal one. The rasteriser uses the pixel values directly (1.0 × cellSize and 0.6 × cellSize), which is what the browser ends up drawing.

#### The lined and four-line rows (full-width strips)

**These do not come from `WorksheetCell.tsx`.** The four-line branch of `WorksheetCell` (rules at 8 / 14 / 29 / 35 of a 100×38 viewBox, `#999` / `#bbb` dashed, text centred at 16 px) is **dead code for the shipped flow** — `WorksheetPreview.tsx` and `PracticeTemplate.tsx` render the CSS DOM (`.four-line-paper` / `.four-line-paper-row`) instead, and `PracticePDF.tsx` says so in a comment:

> *"Previous version used 8/38, 14/38, 29/38, 35/38 fractions which produced unequal gaps (4.5 / 11.25 / 4.5 pt) — the 'middle is the biggest' complaint."*

The PNG copies the **live** geometry — the CSS in `app/globals.css` and the PDF in `components/worksheet/PracticePDF.tsx`:

| Element | Geometry | Colour | Width |
|---|---|---|---|
| Lined rule (`pen-lined`) | one horizontal rule at `y = rowHeight - 0.5`, across the full content width | `#555` | 1 |
| Four-line rule 1 | `y = 0` | `#1d4ed8` | 2 |
| Four-line rule 2 | `y = 12` | `#d94c4c` | 2 |
| Four-line rule 3 (the baseline) | `y = 24` | `#c0392b` | 3 |
| Four-line rule 4 | `y = 36` | `#1d4ed8` | 2 |
| Four-line text | left-aligned at `x = 8`, **baseline on rule 3 (`y = 24`)**, 28 px em | `#ddd`, 1 px `#c0392b` outline | 1 |

The four-line row is 38 px tall (A3/A4) or 44 px (B5) — `linedHeightPx(paperSize)` — and the rules sit at `gap = rowHeight × 12 / 38` intervals, exactly as `PracticePDF.tsx` computes them (`const gap = size * (12 / 38)`) and exactly as `globals.css` spaces them (`--grid-gap: 12px`). The rule widths are the CSS pixel values (2 / 2 / 3 / 2 px); the PDF's point widths (1.2 / 1 / 2.2 / 1.2 pt) are the same lines at print scale.

The four-line text is 28 px — the CSS's `font-size: 28px` — in the sheet's font, left-aligned 8 px from the row's left edge, with the letters sitting on the thick red rule. The stroke around the letters is the CSS `-webkit-text-stroke: 1px #c0392b`, drawn as a 1 px outline of the glyph in `#c0392b` under a `#ddd` fill.

### §7.6 The header and the footer

The sheet's **header band** carries three things, left to right, on one line:

- the **title**, left-aligned at the content's left edge, 20 px em, `#3a2a14`;
- the **cell style label** (`cellStyleLabel(cellStyle)` — the site's own Chinese label) and the **font name** (`fontFamilyLabel(fontFamily)`), right-aligned at the content's right edge, 12 px, `#5a4530`.

The **footer** carries the site host, centred, 9 px, `#999` — the same line the site's PDF prints.

Both are drawn with the same font pipeline as the characters (`font.layout()` on the whole string, one run), so the title is shaped properly rather than glyph-by-glyph.

**The title's font is the sheet's font** (`fontFamily`) — the same `LoadedFont` the characters use. There is no separate title font.

**The title is truncated, not wrapped.** A worksheet title is a label, not a paragraph, and wrapping it would need a line-breaking algorithm. If the shaped title is wider than the content width, it is cut and an ellipsis (`…`, the site's convention) is appended. The truncation width is the content width minus the width of the ellipsis.

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
| `POST /mcp` with no session id whose body is not an `initialize` | **400**, and **no session is created** |
| `POST /mcp` with an unknown session id | **404**, `not_found` |
| `GET /mcp` with no session id | **400** |
| `DELETE /mcp` with a valid session id | the session ends; a later request with that id is **404** |
| `OPTIONS /mcp` | **204** and the CORS headers, including `Access-Control-Expose-Headers: mcp-session-id` |
| a session opened with user A, then used with user B's token | **403** |

**The route is tested through a Node↔Web adapter, not by calling the handler directly.** The SDK's `StreamableHTTPClientTransport` needs a URL, so driving the real client against the real route needs *something* that speaks HTTP. `tests/unit/mcp/route-harness.ts` is that something: a `node:http` server that converts Node's `IncomingMessage` into a Web `Request`, calls the route's exported handler, and writes the returned Web `Response` back to the socket. The client then talks to it exactly as it would talk to production.

The harness binds an **ephemeral loopback port in the test process only**. That is not a deployment port: the production deployment still has one process on one port (§10).

The four verbs' error paths (401 / 400 / 404 / 403 / 204) are driven by calling the exported handlers with a `Request` object directly — no port, no server. In the App Router the handler's parameter is a `NextRequest`, which **extends** `Request`, so the same object satisfies both the SDK's Web-standard transport and `logUserAction(req: NextRequest, …)` from `lib/audit.ts`.

**The harness replaces the old one.** The retired `tests/unit/mcp/harness.ts` imported `@/mcp/config` and `@/mcp/server`, both of which are deleted; it is replaced by `route-harness.ts`, and the three test files that used it (`server.test.ts`, `tools.test.ts`, `speech.test.ts`) are carried over to it. `server.test.ts` becomes `route.test.ts` and loses the standalone-only cases (the `/health` endpoint, the anonymous mode, the 404 on an unknown path) — none of them exists any more.

### §9.2 The token store and the API

| Test | Asserts |
|---|---|
| issue | a row exists, the raw token is 47 chars and starts with `mcp_`, the stored hash is the sha256 of the raw token and is **not** the raw token |
| issue twice | one row, a **different** raw token, `created_at` refreshed, `last_used_at` back to NULL |
| revoke | `revoked_at` is set; the raw token no longer resolves |
| revoke an already-revoked token | a 200, `revokedAt` is the **original** timestamp, unchanged |
| revoke when there was never a token | a 200, `revokedAt` is `null` |
| resolve a valid token | `{userId, username}` |
| resolve a revoked token / a disabled user's token | `null` |
| `last_used_at` throttling | two resolves within the hour → **one** write; a resolve after the hour → a second write |
| `GET /api/mcp/token` | 200; the response **contains no raw token** |
| `GET /api/mcp/token` while logged out | 401 |
| `POST /api/mcp/token` | 200; the response contains the raw token exactly once |
| `DELETE /api/mcp/token` | 200; the audit log has a `mcp_token_revoked` row with a title |
| the audit log | one row per mutating call, with the event and the title in the metadata |
| every answer | carries `Cache-Control: no-store` — including the 503 |

### §9.3 The rasteriser

| Test | Asserts |
|---|---|
| the PNG encoder | `sharp` decodes it; the dimensions are right; the corner pixel is opaque white; a known black rectangle lands where it should |
| the filler | a square's edges are anti-aliased (the edge pixels are neither fully black nor fully white) |
| the polygon filler | a point-in-polygon test agrees with the rasterised result |
| **the glyph is not mirrored** | render 「永」 into a cell; the ink's bounding box is in the **upper** part of the cell (a y-flip bug would put it in the lower part) |
| the glyph fallback | a character no font has → a tofu box is drawn and the character appears in `missingGlyphs` |
| the page compositor | an A4 page is 794×1123 (and 1588×2246 at scale 2) |
| the grid geometry | the border, the guides and the diagonals land at the expected pixels — compared against `WorksheetCell.tsx`'s own viewBox numbers |
| the four-line geometry | the four rules land at y = 0 / 12 / 24 / 36 of a 38 px row, in `#1d4ed8` / `#d94c4c` / `#c0392b` / `#1d4ed8` |
| the lined geometry | one `#555` rule at the bottom of a 38 px full-width row |
| the row counts | an A4 grid page has 11 rows of 8 cells; an A4 lined page has 24 rows; an A4 four-line page has 16 rows |
| the trace contour | a trace cell's character has red (`#c0392b`) pixels on its edge and gray (`#ddd`) pixels inside |
| the round trip | `render_worksheet_png` returns a base64 payload that `sharp` decodes to a PNG of the expected size |

### §9.4 The gates

Before any commit: `npx tsc --noEmit` clean, `npx vitest run` green, `npx eslint .` clean.

**A build is required** — the change adds `app/mcp/route.ts` and modifies `app/profile/page.tsx`, and the repo rule (`feedback-per-task-pnpm-build-gap`) is that touching `app/**/page.tsx` mandates a build, because neither `tsc` nor the tests catch a route conflict. The build runs **only** in the isolated worktree `D:/Temp/pinyin-build-check`; never while the dev server holds port 4444 (`dev-build-cache-stomp`).

---

## §10 Deployment

| Question | Answer |
|---|---|
| nginx | **One new block, `location /mcp`** (see §2.2). It exists so the SSE `GET` stream is not withheld by nginx's default `proxy_buffering on`, and so the MCP path gets a long read timeout instead of the site's 120 s. It points at the **same** upstream (`ziyun_app` → `127.0.0.1:4444`); no new upstream, no new port. `location /` is untouched, so every other path keeps its current behaviour. The `client_max_body_size 500m` and the WebSocket `Upgrade` passthrough are untouched. |
| New port | **None.** This is the point of D1. |
| Process management | Unchanged: `HOST=127.0.0.1 nohup npm start &`. The standalone `mcp:start` process is no longer part of the runbook. |
| New environment variables | None required. `MCP_SERVER_NAME`, `MCP_SERVER_VERSION` and `MCP_CORS_ORIGIN` are optional with defaults. `MCP_AUTH_TOKEN` and `MCP_ALLOW_ANONYMOUS` are **removed** from the runbook. |
| New dependency | `fontkit` moves from devDependencies to dependencies. It is **pure JS** — no native binary, no install step, no `node-gyp`. `npm install --legacy-peer-deps` on the server, as usual. |
| Deploy bundle | `public/fonts/*.woff2` already ship (the deploy script excludes only `assets/fonts`, the subsetting source). The renderer reads them from `public/` at runtime. |
| Database | one new table; the migration is idempotent and runs like the others. |
| Files outside the MCP feature that change | **Three, and each is a one-liner or a copy of an existing block:** `middleware.ts` (§2.1 — the whitelist line), `next.config.ts` (`serverExternalPackages` gains `'fontkit'`), `deploy/nginx.ziyun.pudafo.com.conf` (§2.2 — the new `location /mcp` block). |
| `next.config.ts` | `serverExternalPackages: ['ws', 'bufferutil']` gains `'fontkit'`. The renderer must `require` the real `fontkit` at runtime, not a webpack-bundled copy: fontkit reads font files through `fs`, and a bundled copy loses the `fs` binding. |
| Docs | `DEPLOY.md` and `deploy/README.md` have **zero** MCP references today, so nothing has to be un-stated. The runbook gains exactly one line: the MCP endpoint lives at `/mcp` on the same host. `mcp/README.md` is rewritten for the mounted endpoint (§11). |

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
mcp/session-store.ts                   the globalThis-backed session map (§3.4)
mcp/tools/worksheet-render.ts           the MCP → rasteriser bridge
lib/mcp-token.ts                       the token store (issue / revoke / resolve)
lib/mcp-endpoint.ts                    the endpoint URL helper (§4.4)
lib/worksheet-schemes.ts                the named scheme catalogue
lib/png/geometry.ts                    points, polygons, flattening
lib/png/raster.ts                      the canvas and the AA polygon filler
lib/png/encode.ts                      PNG bytes from an RGBA bitmap
lib/png/glyph.ts                       font loading and glyph outlines
lib/png/worksheet-page.ts               the page compositor
scripts/migrations/2026-10-26-mcp-tokens.sql
tests/unit/mcp/route-harness.ts        the Node↔Web adapter (§9.1)
tests/unit/mcp/route.test.ts           the endpoint's tests (was server.test.ts)
```

**Modified**

```
lib/audit-format.ts                    3 new events (union + AUDIT_EVENTS + EVENT_LABEL + formatLogMessage)
lib/api-handler.ts                     serviceUnavailable() gains an optional ResponseInit
lib/worksheet-types.ts                 export englishCharsPerRow (it is private today)
app/profile/page.tsx                   mount the card
mcp/tools/worksheet.ts                 + list_worksheet_schemes, + render_worksheet_png
mcp/tools/index.ts                     register the two new worksheet tools
middleware.ts                          let /mcp through the setup gate (§2.1)
next.config.ts                         serverExternalPackages += 'fontkit'
deploy/nginx.ziyun.pudafo.com.conf    + location /mcp (§2.2)
package.json                           fontkit → dependencies; drop mcp:dev / mcp:start
scripts/init-db.ts                     + the mcp_tokens table
mcp/README.md                          rewritten for the mounted endpoint
tests/unit/mcp/tools.test.ts           carried over to route-harness.ts
tests/unit/mcp/speech.test.ts          carried over to route-harness.ts
```

**Deleted**

```
mcp/main.ts  mcp/server.ts  mcp/session.ts  mcp/body.ts  mcp/config.ts  mcp/auth.ts
tests/unit/mcp/auth.test.ts  tests/unit/mcp/config.test.ts  tests/unit/mcp/harness.ts
```

`tests/unit/mcp/errors.test.ts` stays. `tests/unit/mcp/server.test.ts` becomes `route.test.ts` (§9.1).

**The three files that change outside the feature are one-liners or a copy of an existing block** — `middleware.ts` (§2.1), `next.config.ts` (one array element) and the nginx config (§2.2, six lines copied from `location /`).

---

## §12 What is left to the builder

These are the parts the document deliberately does **not** decide. Each is a small, local choice — a reasonable builder settles it without asking the human partner, and the plan will state the default for each so the implementer has one thing to write rather than three.

1. **The exact shape of `lib/png/raster.ts`'s coverage accumulator.** The spec fixes the algorithm (4 sub-scanlines, exact horizontal overlap) and the outcome; the implementation is the builder's.
2. **The curve-flattening tolerance.** 8 segments per curve is specified; the builder may raise it if the visual result is visibly faceted, and should say so if they change it.
3. **The dev-anonymous exception** (§3.5) — the plan keeps it; dropping it is a one-line change and nothing else depends on it.
4. **The `title` truncation ellipsis** — `…` (U+2026) is the site's convention, so the plan uses it.
5. **The order of the `image` block versus the `text` block** — the spec says text first, image second, and the plan follows.

**Decided, so the builder does not have to:**

| Question | Decision | Where |
|---|---|---|
| Which fontkit API | `font.layout(text)` → `run.glyphs[i].path` + `run.positions[i]`; **not** `font.getPath()` (it does not exist) and **not** `glyph.getScaledPath()` (it returns all-zero coordinates for these outlines) | §7.3 |
| The y-flip | `path.transform(scale, 0, 0, -scale, penX, baselineY)` — SVG matrix convention, font units are y-**up** | §7.3 |
| The glyph size | `scale = sizePx / unitsPerEm` | §7.3 |
| The font fallback | requested → `LXGWWenKaiGB-Regular.woff2` → `BabelStoneHanBasic.woff2`, **per character** | §7.3 |
| The page size in pixels | A3 1123×1587, A4 794×1123, B5 665×945, brush-* 794×1123 | §7.4 |
| The margins | 56 px on every side | §7.4 |
| The row counts | the site's own `cellsPerPage` / `linesPerPage` / `fourLineRowsPerPage` | §7.4 |
| The four-line rules | y = 0 / 12 / 24 / 36 of a 38 px row; `#1d4ed8` / `#d94c4c` / `#c0392b` / `#1d4ed8` | §7.5 |
| The four-line text | left at x = 8, **baseline on rule 3**, 28 px em, `#ddd` with a 1 px `#c0392b` outline | §7.5 |
| The revoke contract | never issued → `null`; active → this call's timestamp; already revoked → the **original** timestamp | §4.4 |
| The default paper size | follows the cell style's tool: brush → `brush-12`, pen → `A4` | §6.2 |
| The schema strictness | loose zod schema + validation in the body (the SDK's schema rejection is a soft failure) | §6.2, §8 |
| The endpoint URL | `getRuntimeSiteUrl()` when configured, else the request's own origin | §4.4 |
| The session store | `globalThis` + `Symbol.for`, because dev re-evaluates route modules | §3.4 |
| The 400 vs 404 | no session id at all → 400; well-formed but unknown → 404 | §3.3 |

---

## §13 Open questions for the human partner

*(none — every fork in this design was settled before the document was written; see §0.)*
