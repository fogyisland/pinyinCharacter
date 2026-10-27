# The MCP endpoint

The site **is** the MCP server. The endpoint is a route handler of the app
(`app/mcp/route.ts`), mounted on `/mcp` — there is no standalone process, no
second port and nothing extra to start or to deploy. The tools read the same
files the pages read, and the clients reach them on the same origin (and the
same domain) as the site itself.

| | |
| --- | --- |
| Production | `https://ziyun.pudafo.com/mcp` |
| Development | `http://localhost:4444/mcp` |
| Transport | Streamable HTTP (`POST` / `GET` / `DELETE` / `OPTIONS`) |
| Runtime | Node (`export const runtime = 'nodejs'`) |

## Authentication

Every request must carry a **per-user bearer token**:

```
Authorization: Bearer mcp_…
```

The token is issued on the user's own profile page (`/profile`), where it can
also be rotated and revoked. The site stores only the SHA-256 digest of the
token, so a stolen database does not hand out usable credentials.

A request must also carry `Accept: application/json, text/event-stream` — the
transport answers **406** without it. The SDK's own client sets it for you; a
hand-written `curl` has to.

Once a session is open, its id travels in the `mcp-session-id` response
header, and every later request of that session has to send it back. A
session belongs to the user who opened it: another user's bearer gets **403**.

## Connecting a client

```json
{
  "mcpServers": {
    "pinyin-character": {
      "type": "http",
      "url": "https://ziyun.pudafo.com/mcp",
      "headers": {
        "Authorization": "Bearer mcp_your_token"
      }
    }
  }
}
```

## The tools

Twenty tools, all read-only. Nineteen of them answer from the files the
pages read; `synthesize_speech` calls the same TTS upstream the site's own
play button uses. No database is touched.

| Tool | What it answers |
| --- | --- |
| `get_char` | the reading, the meaning, the alternate readings, the variants and the story of one character |
| `get_radical` | the radical (部首) of one character |
| `get_stroke_count` | how many strokes one character is written with |
| `get_tone_forms` | the four tone-marked spellings of a character's syllable |
| `pinyin_to_hanzi` | the characters of a pinyin syllable, most frequent first |
| `pinyin_to_sentence` | the Chinese sentence a pinyin string spells out |
| `text_to_pinyin` | the pinyin of every character of a piece of text |
| `build_quest_level` | one level of the character quest (闯关) with the four questions asked about each of its characters |
| `reveal_facets` | which parts of the character card may be shown at a given moment |
| `generate_worksheet_layout` | the cells of a practice worksheet (字帖): the characters, the cell style and the paper size |
| `list_worksheet_schemes` | the catalogue of the ready-made worksheet schemes (字帖方案): the cell style, the paper size and the font of each one |
| `render_worksheet_png` | a practice worksheet rendered as a PNG image: the sheet itself, as an image block the model can look at, plus the page metadata |
| `list_poems` | the poems of the collection, with their title, author and dynasty |
| `get_poem` | one poem: its title, author, dynasty, the text line by line with the pinyin, the appreciation and the source |
| `list_sutras` | the scriptures of the collection, with their title, their slug and how many chunks they hold |
| `get_sutra_chunk` | one chapter of a scripture: its text line by line with the pinyin; without a chapter number, the chapter list instead |
| `list_classics` | the classical books of the collection, with their title, author, era and category |
| `get_classic_outline` | the chapter list of one classical book — the label of every chapter, without the text |
| `get_classic_chapter` | one chapter of a classical book: its label and its text line by line, with the pinyin |
| `synthesize_speech` | the spoken reading of a piece of text, as an MP3 audio block together with the metadata of the synthesis |

The registry lives in `mcp/tools/` — one file per subject, each registering
its own tools through `registerTool`. `tests/unit/mcp/route.test.ts` pins the
list above, so a tool cannot be added or renamed without the guard failing.

## Configuration

Three environment variables are optional; none of them is needed for the
endpoint to work.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_SERVER_NAME` | `pinyin-character` | the name reported to the clients |
| `MCP_SERVER_VERSION` | `1.0.0` | the version reported to the clients |
| `MCP_CORS_ORIGIN` | `*` | the allowed CORS origin |

`MCP_CORS_ORIGIN` is the one to think about: the endpoint is public, and
`*` lets a page on any origin call it. The bearer token is still required,
but a browser-based client served from another origin is a case worth
restricting.

## The answer format

Every tool answers with the site's own envelope — the same one the HTTP API
uses:

```json
{ "ok": true, "data": { "char": "爱", "pinyin": "ài" } }
```

and, on a failure,

```json
{ "ok": false, "error": { "code": "not_found", "message": "…" } }
```

The envelope is carried both as a text block and as the result's
`structuredContent`, so a client can read it either way. The error codes are
`bad_input`, `not_found`, `unauthorized`, `data_unavailable`,
`upstream_error` and `internal_error`.

Those six are what a tool reports. The endpoint itself answers with
`unauthorized` (no or unknown bearer), `not_found` (an unknown session),
`bad_input` (a body that is not valid JSON), `forbidden` (the session
belongs to another user), `service_unavailable` (the token store or the MCP
server is not reachable) and `payload_too_large` (the request body is over
4 MiB) — so a client sees nine codes in all.

## Where the data comes from

Every tool reads a file — except `synthesize_speech`, which calls the TTS
upstream. None of them opens a database connection.

| The data | The file |
| --- | --- |
| the character library | `data/content/<char>.json` (7905 characters) |
| the radicals | `data/radicals.json` |
| the stroke counts | `public/strokes/<char>.json` |
| the readings | `data/pinyin-hanzi.json`, `data/bigrams.json` |
| the HSK ladder | `data/hsk-vocab.json` (2632 characters over six tiers) |
| the worksheet schemes | `lib/worksheet-schemes.ts` |
| the worksheet fonts and the PNG rasteriser | `public/fonts/*.woff2`, `lib/png/*` |
| the poems | `data/poems-manifest.json`, `data/poems/<id>.json` |
| the scriptures | `data/sutras/manifest.json`, `data/sutras/<slug>.json` |
| the classical books | `data/classics-manifest.json`, `data/classics/<slug>.json` |

The quest tool is the sharpest case: the site builds its ladder from the
`chars` table, and the server builds the same ladder from the files. The two
hand the same rows to the same pure builder, and
`tests/integration/api/quest-file-vs-db.test.ts` proves the two tiers are
byte-identical for all six HSK tiers against the live database.

> The tools reach modules that carry the `server-only` marker
> (`lib/content.ts`, `lib/radical.ts`, `lib/game-quest-data.ts`). Inside the
> Next.js server bundle the `react-server` export condition resolves that
> marker to its no-op module, so the route needs no special handling — the
> flag the retired standalone process required is gone.

## Debugging it locally

```bash
npm run dev            # the site on http://localhost:4444
```

Then point an MCP client at `http://localhost:4444/mcp`. Outside production
the endpoint also accepts the development bearer `dev-anonymous`, which needs
no account — handy when only the protocol is being debugged:

```bash
curl -s http://localhost:4444/mcp \
  -H 'Authorization: Bearer dev-anonymous' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
```

Against a real account, take a token from `/profile` instead.

## The tests

```bash
npx vitest run tests/unit/mcp        # the endpoint, the tools, the sessions
npx vitest run tests/integration/api/quest-file-vs-db.test.ts   # the file tier against the database
```

`tests/unit/mcp/route-harness.ts` drives the endpoint two ways: directly with
a Web `Request` (the assertions are about the route's own answers — 401,
403, 404, 400, 413, CORS) and behind a loopback HTTP server with the SDK's
own client (the assertions are about the wire). The integration test needs
`DATABASE_URL` — it reads the project's `.env` when the environment does not
carry it, and skips cleanly when neither does.
