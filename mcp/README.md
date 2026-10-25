# The MCP server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes the site's character library, its games and its classical
collections as MCP tools.

It runs as its own Node process — **not** as a Next.js route. The SDK's
Streamable HTTP transport consumes Node's `IncomingMessage` and
`ServerResponse` directly, so a separate process is the shortest path between
the SDK and the wire, and it leaves the site itself untouched: no new route, no
middleware change, no build.

## Running it

```bash
# development (watch mode)
MCP_AUTH_TOKEN=your-secret npm run mcp:dev

# production
MCP_AUTH_TOKEN=your-secret npm run mcp:start
```

The server then answers on `http://127.0.0.1:4455/mcp`.

> **The `--conditions=react-server` flag is not optional.**
> Several libraries the tools read (`lib/content.ts`, `lib/radical.ts`,
> `lib/game-quest-data.ts`) carry the `server-only` marker, whose whole
> purpose is to throw when it is imported outside a React Server Component.
> The `react-server` export condition resolves that marker to its empty
> module. The `mcp:dev` and `mcp:start` scripts already pass the flag; if you
> start the server by hand, pass it too.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_HOST` | `127.0.0.1` | the interface to bind to |
| `MCP_PORT` | `4455` | the port to listen on |
| `MCP_ENDPOINT` | `/mcp` | the path of the MCP endpoint |
| `MCP_AUTH_TOKEN` | — | the Bearer token every request must carry |
| `MCP_ALLOW_ANONYMOUS` | `false` | `true` runs the server without a token |
| `MCP_CORS_ORIGIN` | `*` | the allowed CORS origin |
| `MCP_SERVER_NAME` | `pinyin-character` | the name reported to the clients |
| `MCP_SERVER_VERSION` | `1.0.0` | the version reported to the clients |

Two rules are enforced at startup, and the server refuses to start rather than
run in a broken state:

1. **a token is required** unless `MCP_ALLOW_ANONYMOUS=true` is set
   explicitly;
2. **an anonymous server may only bind the loopback interface** — an
   unauthenticated MCP server on a routable address would publish the whole
   collection to anyone who can reach the port.

## Connecting a client

The endpoint speaks the Streamable HTTP transport. A client needs the URL and
the token:

```json
{
  "mcpServers": {
    "pinyin-character": {
      "type": "http",
      "url": "http://127.0.0.1:4455/mcp",
      "headers": {
        "Authorization": "Bearer your-secret"
      }
    }
  }
}
```

A request must carry the header `Accept: application/json, text/event-stream`
— the transport answers **406** without it. The SDK's own client sets it for
you; a hand-written `curl` has to.

## The health check

`GET /health` answers without a token, and says what the server is and how
many sessions are open:

```json
{
  "ok": true,
  "server": { "name": "pinyin-character", "version": "1.0.0" },
  "endpoint": "/mcp",
  "auth": "bearer",
  "sessions": 0
}
```

## The tools

Eighteen tools, all read-only, all served from the files — no database is
touched.

### The character

| Tool | What it answers |
| --- | --- |
| `get_char` | the reading, the meaning, the alternate readings, the variants and the story of one character |
| `get_radical` | the radical (部首) of one character |
| `get_stroke_count` | how many strokes one character is written with |
| `get_tone_forms` | the four tone-marked spellings of a character's syllable |

### The reading

| Tool | What it answers |
| --- | --- |
| `pinyin_to_hanzi` | the characters of a pinyin syllable, most frequent first |
| `pinyin_to_sentence` | the Chinese sentence a pinyin string spells out |
| `text_to_pinyin` | the pinyin of every character of a piece of text |

### The game

| Tool | What it answers |
| --- | --- |
| `build_quest_level` | one level of the character quest (闯关) with its four questions per character |
| `reveal_facets` | which parts of the character card may be shown at a given moment |

### The practice sheet

| Tool | What it answers |
| --- | --- |
| `generate_worksheet_layout` | the cells of a practice worksheet (字帖) |

### The classical collections

| Tool | What it answers |
| --- | --- |
| `list_poems` / `get_poem` | the classical poems, and one of them |
| `list_sutras` / `get_sutra_chunk` | the Buddhist scriptures, their chapters and one chapter |
| `list_classics` / `get_classic_outline` / `get_classic_chapter` | the classical books, their chapter lists and one chapter |

### The voice

| Tool | What it answers |
| --- | --- |
| `synthesize_speech` | the spoken form of a text, as an MCP audio content block |

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

## Where the data comes from

Every tool reads a file; none of them opens a database connection.

| The data | The file |
| --- | --- |
| the character library | `data/content/<char>.json` (7905 characters) |
| the radicals | `data/radicals.json` |
| the stroke counts | `public/strokes/<char>.json` |
| the readings | `data/pinyin-hanzi.json`, `data/bigrams.json` |
| the HSK ladder | `data/hsk-vocab.json` (2632 characters over six tiers) |
| the poems | `data/poems-manifest.json`, `data/poems/<id>.json` |
| the scriptures | `data/sutras/manifest.json`, `data/sutras/<slug>.json` |
| the classical books | `data/classics-manifest.json`, `data/classics/<slug>.json` |

The quest tool is the sharpest case: the site builds its ladder from the
`chars` table, and the server builds the same ladder from the files. The two
hand the same rows to the same pure builder, and
`tests/integration/api/quest-file-vs-db.test.ts` proves the two tiers are
byte-identical for all six HSK tiers against the live database.

## Exposing it beyond the machine

The server binds the loopback interface by default, which is the safe
default. If it is exposed publicly:

- keep `MCP_AUTH_TOKEN` set — an anonymous server is refused on a routable
  address, but the rule only protects the *configuration*, not a proxy in
  front of it;
- terminate TLS in front of it; the server speaks plain HTTP;
- restrict `MCP_CORS_ORIGIN` to the origin that serves the client instead of
  leaving it at `*`;
- remember that every tool is a read-only view of the collection — there is no
  write tool, but the whole library is there.

## The tests

```bash
npx vitest run tests/unit/mcp        # the transport, the tools, the config, the auth
npx vitest run tests/integration/api/quest-file-vs-db.test.ts   # the file tier against the database
```

The unit tests drive the real HTTP endpoint with the SDK's own client, so they
exercise the real transport, the real session handling and the real
authorization. The integration test needs `DATABASE_URL` — it reads the
project's `.env` when the environment does not carry it, and skips cleanly
when neither does.
