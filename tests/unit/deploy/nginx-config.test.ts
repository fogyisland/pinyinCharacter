import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const conf = readFileSync(resolve(ROOT, 'deploy', 'nginx.ziyun.pudafo.com.conf'), 'utf8');
const brotli = readFileSync(resolve(ROOT, 'deploy', 'nginx-brotli.conf'), 'utf8');
const manual = readFileSync(resolve(ROOT, 'deploy', 'OPTIMIZATION.md'), 'utf8');
const readme = readFileSync(resolve(ROOT, 'deploy', 'README.md'), 'utf8');
const deployDoc = readFileSync(resolve(ROOT, 'DEPLOY.md'), 'utf8');

/**
 * A command line that installs a file into a live nginx directory.
 *
 * Anchored at the start of a line so that a *prose* mention (a warning, a
 * sentence) is not mistaken for an instruction. The three documents that used
 * to carry the F30-a failure mode are checked with the exact strings they
 * actually contained, because those strings are facts we measured, not
 * guesses.
 */
const INSTALL_COMMAND = /^[ \t]*(sudo[ \t]+)?(cp|ln)[ \t]+[^\n]*\/etc\/nginx\/(sites-available|sites-enabled)/m;

// 整份模板安装命令：把 nginx.ziyun.pudafo.com.conf 装进 /etc/nginx/ 的任何一行。
// 这条对四份文档都要查 —— 手册里如果被误加一条整份覆盖命令，原来那条抓不到。
const TEMPLATE_INSTALL_COMMAND =
  /^[ \t]*(sudo[ \t]+)?(cp|ln)[ \t]+[^\n]*nginx\.ziyun\.pudafo\.com\.conf[^\n]*\/etc\/nginx\//m;

// conf.d 也是「安装位置」。只查 conf / README / DEPLOY 三份 ——
// 手册与 brotli 片段有正当理由把 *brotli 片段*(不是模板)放进 conf.d。
const CONF_D_INSTALL_COMMAND =
  /^[ \t]*(sudo[ \t]+)?(cp|ln)[ \t]+[^\n]*\/etc\/nginx\/conf\.d/m;

/**
 * Returns the text of the `location` block that starts at `marker`.
 *
 * ⚠️ The config contains TWO `location / {` blocks: the port-80 301 redirect
 * (line 74) and the HTTPS main server (line 202). `conf.indexOf('location / {')`
 * finds the FIRST one, which sits before every block we care about — slicing
 * by it yields an empty string, and the assertion then fails no matter how
 * correct the config is. Anchor on the marker instead and stop at the NEXT
 * `location` header.
 */
function locationBlock(marker: string): string {
  const start = conf.indexOf(marker);
  expect(start, `nginx config has no "${marker}" block`).toBeGreaterThan(-1);
  const next = conf.indexOf('location ', start + 1);
  return conf.slice(start, next === -1 ? conf.length : next);
}

/**
 * The config with every `#` comment stripped out.
 *
 * ⚠️ Two assertions below look for a FORBIDDEN directive spelling. If they
 * ran against the raw file, a *warning comment* that quotes the forbidden
 * spelling — e.g. `# 绝不能写成 proxy_ignore_headers Cache-Control Set-Cookie;`
 * — would make the test fail while the config is perfectly correct. The
 * implementer is told to warn about exactly these spellings, so the raw-file
 * form of these assertions is a landmine. Strip the comments first and judge
 * the directives only.
 */
const confDirectives = conf.replace(/#[^\n]*/g, '');

/**
 * The brace nesting of the directive text.
 *
 * ⚠️ This config CANNOT be syntax-checked here: the development machine has
 * no `nginx` binary and no docker (the controller measured both), so
 * `nginx -t` only ever runs on the server, in the operator's hands. The most
 * likely way to break it is a paste error in the block that gets merged into
 * `location / { }` — one missing brace and the server refuses to start.
 *
 * The count runs on the comment-stripped text, so a brace inside a comment
 * cannot throw it off. A negative running depth means a block is closed that
 * was never opened — also a paste error.
 */
function braceBalance(text: string): { balance: number; minDepth: number } {
  let depth = 0;
  let minDepth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < minDepth) minDepth = depth;
  }
  return { balance: depth, minDepth };
}

/**
 * The nesting level an `add_header` directive lives at.
 *
 * nginx inherits `add_header` along http -> server -> location, and a level
 * that declares its own headers REPLACES (never extends) the inherited ones.
 * That is why the manual and the config comment both have to say how many
 * headers sit at each level.
 */
export type AddHeaderLevel = 'http' | 'server' | 'location' | 'other';

export interface AddHeaderOccurrence {
  /** 1-based line number of the directive in the config file. */
  line: number;
  /** The level the directive was classified as. */
  level: AddHeaderLevel;
  /** The kinds of the blocks the directive is nested in, outermost first. */
  blocks: AddHeaderLevel[];
}

/**
 * The kind of the block a `{` opens, decided by the block's KEYWORD.
 *
 * ⚠️ Only the CURRENT INSTRUCTION's text may be looked at, and only its FIRST
 * WORD. The config contains `proxy_pass http://ziyun_app;` — the `http` in
 * there is an upstream URL, NOT a block header. Deciding the kind from the
 * whole line would turn that directive into an `http` block.
 *
 * ⚠️ A SUBSTRING match is not good enough either. `if ($http_user_agent ~*
 * "MSIE") {` mentions `http`, but the block it opens is an `if` block — and
 * nginx evaluates an `if` in the context of the block that encloses it, so a
 * header inside it is still location-level. `if` (like `map`, `geo`,
 * `upstream`, `types`) is therefore `other`, and `levelOf` skips `other`
 * frames, so the enclosing block wins.
 *
 * The keyword table:
 *   location → 'location' | server → 'server' | http → 'http' |
 *   https → 'http' (an `https` block is http-level) | everything else →
 *   'other'.
 */
function blockKind(instructionText: string): AddHeaderLevel {
  const keyword = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(instructionText);
  if (keyword === null) return 'other';
  switch (keyword[1]) {
    case 'location':
      return 'location';
    case 'server':
      return 'server';
    case 'http':
      return 'http';
    case 'https':
      return 'http';
    default:
      return 'other';
  }
}

/**
 * The level of a directive, given the blocks it is nested in.
 *
 * The level is the innermost of location / server / http the stack contains:
 * scan from the top of the stack (the innermost block) inward and take the
 * first frame that is one of the three.
 *
 * A block nested INSIDE a `location` — an `if { … }`, say — does not make the
 * header "other": nginx evaluates it in the location's context, so the level
 * is still the location. Frames whose kind is `other` are skipped.
 */
function levelOf(stack: AddHeaderLevel[]): AddHeaderLevel {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const kind = stack[index];
    if (kind === 'location' || kind === 'server' || kind === 'http') {
      return kind;
    }
  }
  return 'other';
}

/**
 * Classifies every `add_header` directive by the block it sits in.
 *
 * ⚠️ Run this on `confDirectives` (the comment-stripped text), NEVER on the
 * raw file: the config carries a comment that quotes `add_header` several
 * times, and a raw scan would count that prose as directives.
 *
 * ⚠️ This is a plain character walk, not an nginx parser — and it does not
 * need to be one: in the COMMENT-STRIPPED text no quoted string (single OR
 * double quoted) contains `{`, `}`, `;` or `#`. A `;` inside a quoted string
 * would cut a directive short, and a `{` would open a phantom block.
 * That premise is ASSERTED, not just documented — see
 * "the scanner's safety premise holds" below.
 * Three shapes the walk has to survive:
 *
 *   - a block that opens AND closes on one line
 *     (`location /api/auth/ { limit_req ...; proxy_pass http://ziyun_app; }`)
 *     => a single line can push and pop the stack;
 *   - a directive whose value mentions `http` but is not a block header
 *     (see `blockKind` above);
 *   - a block header whose own text mentions a level in a VARIABLE
 *     (`if ($http_user_agent ~* "MSIE") {`) — the keyword decides, not the
 *     substring (see `blockKind` above).
 */
export function classifyAddHeaders(source: string): AddHeaderOccurrence[] {
  const occurrences: AddHeaderOccurrence[] = [];
  const stack: AddHeaderLevel[] = [];
  let statement = '';
  let statementLine = 0;

  const lines = source.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const char = line[charIndex];

      if (char === '{') {
        stack.push(blockKind(statement));
        statement = '';
        continue;
      }

      if (char === '}') {
        stack.pop();
        statement = '';
        continue;
      }

      if (char === ';') {
        if (/^\s*add_header\b/.test(statement)) {
          occurrences.push({
            line: statementLine,
            level: levelOf(stack),
            blocks: [...stack],
          });
        }
        statement = '';
        continue;
      }

      // Remember where the directive that is being accumulated starts, so a
      // header can be reported with the line an operator would grep for.
      if (statement.trim() === '' && !/\s/.test(char)) {
        statementLine = lineIndex + 1;
      }
      statement += char;
    }
  }

  return occurrences;
}

/**
 * How many `add_header` directives the config has, per level.
 *
 * The counts are DERIVED from the config, never hard-coded: the manual and
 * the config comment quote these numbers, so a new directive must make the
 * documents change — that is the whole point of the assertions below.
 */
const addHeaderOccurrences = classifyAddHeaders(confDirectives);
const addHeaderCounts = {
  http: addHeaderOccurrences.filter((occurrence) => occurrence.level === 'http').length,
  server: addHeaderOccurrences.filter((occurrence) => occurrence.level === 'server').length,
  location: addHeaderOccurrences.filter((occurrence) => occurrence.level === 'location').length,
  other: addHeaderOccurrences.filter((occurrence) => occurrence.level === 'other').length,
  total: addHeaderOccurrences.length,
};

/**
 * The level of every `add_header` in a synthetic fragment, outermost first.
 *
 * ⚠️ The fragment is fed RAW — it is a config, not a document, and a
 * synthetic fragment carries no comments to strip.
 */
function levelsOf(fragment: string): AddHeaderLevel[] {
  return classifyAddHeaders(fragment).map((occurrence) => occurrence.level);
}

/**
 * A DOUBLE-QUOTED string that holds one of the four characters the scanner
 * treats as structural (`{`, `}`, `;`, `#`).
 *
 * ⚠️ The naive shape — `/"[^"]*[{};#][^"]*"/` — is WRONG here and reports a
 * false positive on this very config: `[^"]*` happily crosses a newline, and
 * the quotes in the file are balanced per LINE, not per file. Such a pattern
 * matches one huge span that starts at a closing quote of one string and ends
 * at the opening quote of another, with a `;` in between.
 *
 * The prefix below therefore consumes COMPLETE quoted strings as units
 * (`"[^"\n]*"` / `'[^'\n]*'`) and refuses to cross a newline, so the quote
 * the tail matches is always one that OPENS a string, and the match is
 * confined to a single line.
 */
const DOUBLE_QUOTED_STRING_WITH_STRUCTURAL_CHARACTER =
  /^(?:[^"'\n]|"[^"\n]*"|'[^'\n]*')*?"[^"\n]*[{};#]/m;

/**
 * A SINGLE-QUOTED string that holds one of the four structural characters.
 *
 * ⚠️ Both quote styles have to be checked: the config's raw text does carry
 * single quotes, and one of them holds a `{` — but that line is a COMMENT, so
 * it is gone from `confDirectives`. Checking only double quotes would leave
 * the single-quoted half of the premise unguarded.
 */
const SINGLE_QUOTED_STRING_WITH_STRUCTURAL_CHARACTER =
  /^(?:[^"'\n]|"[^"\n]*"|'[^'\n]*')*?'[^'\n]*[{};#]/m;

describe('the config is structurally sound', () => {
  // 这条只兜「漏花括号」这一类粘贴错误 —— 它**不能**证明 nginx 会接受这份配置
  // (漏 `;`、指令放错层级、字符串未闭合都能过)。真正的闸门是手册第 4 步的 `nginx -t`,
  // 那一步只能由运维在服务器上跑(本机没有 nginx 也没有 docker)。
  it('has balanced braces', () => {
    const { balance, minDepth } = braceBalance(confDirectives);
    expect(balance, 'the braces of the config do not balance').toBe(0);
    expect(minDepth, 'a block is closed that was never opened').toBe(0);
  });
});

describe('the nginx config caches HTML but never for a logged-in user', () => {
  it('declares the cache zone', () => {
    expect(conf).toMatch(/proxy_cache_path\s+\S+\s+levels=1:2\s+keys_zone=ziyun_html:10m/);
  });

  it('bypasses the cache for the session cookie and for RSC flight requests', () => {
    expect(conf).toContain('proxy_cache_bypass $cookie_auth_token $http_rsc;');
  });

  it('never writes the cache for a logged-in user, a cookie-setting response or a flight request', () => {
    expect(conf).toContain('proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;');
  });

  it('never caches for longer than ten seconds', () => {
    expect(conf).toContain('proxy_cache_valid 200 10s;');
  });

  it('keeps the response encodings apart in the cache key (F31-u)', () => {
    // The upstream compresses per Accept-Encoding and answers with
    // `Vary: Accept-Encoding`, and nginx's proxy_cache DOES honour that
    // `Vary` (since 1.7.7) — it caches each variant separately. Without the
    // encoding in the key, the first visitor's variant would still be
    // served to every later visitor if the upstream ever stopped sending
    // `Vary`, or if someone added `Vary` to `proxy_ignore_headers` (which
    // switches nginx's own handling off).
    //
    // ⚠️ The closing quote is part of the needle. The nginx directive is
    // `proxy_cache_key "…";` — the value is a quoted string, so the config
    // reads `...$http_accept_encoding";`. A needle that stops before the
    // quote would never match, and "fixing" it by dropping the quote from
    // the CONFIG would produce an unterminated string that `nginx -t`
    // rejects. Both sides carry the quote.
    expect(conf).toContain(
      'proxy_cache_key "$scheme$request_method$host$request_uri$http_accept_encoding";',
    );
  });

  it('puts the microcache in the HTTPS location block, not in the port-80 redirect', () => {
    // The file has TWO `location / {` blocks: the port-80 301 redirect and
    // the HTTPS main server. Every assertion above only asks "does this
    // string appear anywhere in the file" — so a config that pasted the
    // whole cache block into the port-80 redirect would pass EVERY test
    // above while the cache never ran on a single request. This is the
    // silent no-op the whole task exists to prevent.
    const first = conf.indexOf('location / {');
    const last = conf.lastIndexOf('location / {');
    expect(last).toBeGreaterThan(first);
    const httpsBlock = conf.slice(last);
    const port80Block = conf.slice(first, last);
    expect(httpsBlock).toContain('proxy_cache ziyun_html;');
    expect(httpsBlock).toContain(
      'proxy_cache_key "$scheme$request_method$host$request_uri$http_accept_encoding";',
    );
    expect(port80Block).not.toContain('proxy_cache ziyun_html;');
  });

  it("ignores Next's private no-store header but keeps Set-Cookie protection", () => {
    expect(confDirectives).toContain('proxy_ignore_headers Cache-Control;');
    expect(confDirectives).not.toContain('proxy_ignore_headers Cache-Control Set-Cookie;');
  });

  it("never turns off nginx's own Vary handling (F31-u, corrected 2026-10-30)", () => {
    // nginx's proxy_cache DOES honour the upstream's `Vary` (since 1.7.7) and
    // caches each variant separately. The upstream's Vary line carries
    // `Accept-Encoding`, so the encoding variants are already split.
    //
    // The explicit `$http_accept_encoding` in the cache key is the SECOND
    // gate: it keeps the isolation if the upstream ever stops sending `Vary`,
    // and it is the ONLY remaining gate if someone adds `Vary` to
    // `proxy_ignore_headers` — which would switch nginx's own handling off.
    // Hence this assertion: the config must ignore `Cache-Control` only.
    expect(confDirectives).not.toMatch(/proxy_ignore_headers[^;]*\bVary\b/);
  });

  it('reports the cache status', () => {
    expect(conf).toContain('add_header X-Ziyun-Cache $upstream_cache_status always;');
  });

  it('only caches GET and HEAD', () => {
    expect(conf).toContain('proxy_cache_methods GET HEAD;');
  });

  it('keeps the API and MCP blocks below the port-80 redirect block (F31-l)', () => {
    // The first `location / {` in the file belongs to the port-80 301
    // redirect; the API / MCP blocks live in the HTTPS server below it.
    expect(conf.indexOf('location / {')).toBeLessThan(conf.indexOf('location /mcp'));
    expect(conf.lastIndexOf('location / {')).toBeGreaterThan(conf.indexOf('location /api/ {'));
  });

  it('turns the cache off for every API route', () => {
    const apiBlock = locationBlock('location /api/ {');
    expect(apiBlock).not.toBe('');
    expect(apiBlock).toContain('proxy_cache off;');
  });

  it('turns the cache off for the MCP stream endpoint', () => {
    const mcpBlock = locationBlock('location /mcp');
    expect(mcpBlock).not.toBe('');
    expect(mcpBlock).toContain('proxy_cache off;');
  });
});

describe('the brotli snippet is opt-in', () => {
  it('turns brotli on with a static precompressed lookup', () => {
    expect(brotli).toContain('brotli on;');
    expect(brotli).toContain('brotli_comp_level 6;');
    expect(brotli).toContain('brotli_static on;');
  });

  it('is not included by the main config', () => {
    expect(conf).not.toContain('include /etc/nginx/conf.d/nginx-brotli.conf;');
  });
});

describe('the deploy manual refuses to overwrite the live nginx config (F30-a)', () => {
  it('says the repository config is not the one running in production', () => {
    expect(manual).toMatch(/不是线上跑的那份|不是线上生效的那份/);
  });

  it('requires reconciling the effective config before changing anything', () => {
    expect(manual).toContain('nginx -T');
  });

  it('derives the live config path instead of hard-coding one (F31-j)', () => {
    // The path of the config that is actually running has never been measured;
    // it comes from the "# configuration file <path>:" lines of `nginx -T`.
    expect(manual).toContain('LIVE_CONF');
    // And above all: the manual must never tell anyone to copy the repository
    // config over a live path -- that is the F30-a failure mode itself.
    expect(manual).not.toMatch(/cp\s+deploy\/nginx\.ziyun\.pudafo\.com\.conf\s+\/etc\/nginx/);
  });

  it('smoke-tests the webfont path, because a 404 there is invisible on the page', () => {
    expect(manual).toContain('/font/web/sans/hot.woff2');
    expect(manual).toContain('font/woff2');
  });

  it('keeps a rollback command', () => {
    expect(manual).toMatch(/回滚/);
    expect(manual).toContain('nginx -t');
  });
});

describe('the deploy manual states the one known font trade-off (R-28)', () => {
  // The new webfont subsets cover NO codepoint below U+2E80. Latin letters,
  // digits, western punctuation and the tone-marked pinyin vowels
  // (ǎ ǐ ǒ ǔ ǹ ḿ) therefore fall through to the system font
  // (`--font-sans: var(--font-han-sans), system-ui, …`).
  //
  // Before the wave, Google's subsets covered every one of those, so the
  // pinyin under each character was painted by Noto Sans SC. It is now
  // painted by system-ui. The Chinese glyphs themselves are untouched.
  //
  // The manual is the first document the deployer reads, and this is the one
  // visible consequence of the whole wave -- it must be stated there, with
  // the price of putting it back.
  it('says that Latin is painted by the system font now', () => {
    expect(manual).toContain('system-ui');
    expect(manual).toMatch(/Latin/);
  });

  it('states what putting Latin back into the webfont would cost', () => {
    expect(manual).toMatch(/\d+(\.\d+)?\s*(KiB|KB)/);
  });
});

describe('the deploy documents refuse to overwrite the live nginx config (F30-a)', () => {
  // deploy/README.md used to say, as its step 4:
  //   sudo cp deploy/nginx.ziyun.pudafo.com.conf /etc/nginx/sites-available/
  //   sudo ln -s /etc/nginx/sites-available/ziyun.pudafo.com.conf /etc/nginx/sites-enabled/
  // DEPLOY.md used to say, in its section 3.7:
  //   直接 `cp` 到 `/etc/nginx/sites-available/` 即可
  // and the template's own header still said:
  //   放置位置: /etc/nginx/sites-available/ziyun.pudafo.com.conf
  //   启用:     ln -s .../ziyun.pudafo.com.conf /etc/nginx/sites-enabled/
  //
  // Each of those is the F30-a failure mode in a document a human actually
  // reads. Once those `alias` blocks take effect, /font/, /fonts/,
  // /strokes/, /_next/static/ and /audio/ all 404 -- and the page shows no
  // error at all, the glyphs just quietly fall back to a system font.
  it('never carries an install command for the template', () => {
    for (const [name, text] of [
      ['the config header', conf],
      ['deploy/README.md', readme],
      ['DEPLOY.md', deployDoc],
    ] as const) {
      expect(text, `${name} still tells someone to install the template`).not.toMatch(
        INSTALL_COMMAND,
      );
    }
  });

  it('never tells anyone to install the whole template into /etc/nginx', () => {
    for (const [name, text] of [
      ['the config header', conf],
      ['deploy/README.md', readme],
      ['DEPLOY.md', deployDoc],
      ['the optimization manual', manual],
    ] as const) {
      expect(text, `${name} still tells someone to install the whole template`).not.toMatch(
        TEMPLATE_INSTALL_COMMAND,
      );
    }
  });

  it('never installs a config into conf.d from the template docs', () => {
    for (const [name, text] of [
      ['the config header', conf],
      ['deploy/README.md', readme],
      ['DEPLOY.md', deployDoc],
    ] as const) {
      expect(text, `${name} still tells someone to install a config into conf.d`).not.toMatch(
        CONF_D_INSTALL_COMMAND,
      );
    }
  });

  it('drops the exact sentences those three documents used to carry', () => {
    expect(readme).not.toContain(
      'sudo cp deploy/nginx.ziyun.pudafo.com.conf /etc/nginx/sites-available/',
    );
    expect(readme).not.toContain(
      'sudo ln -s /etc/nginx/sites-available/ziyun.pudafo.com.conf /etc/nginx/sites-enabled/',
    );
    expect(deployDoc).not.toContain('直接 `cp` 到 `/etc/nginx/sites-available/` 即可');
    expect(conf).not.toContain(
      '放置位置 (Ubuntu/Debian):   /etc/nginx/sites-available/ziyun.pudafo.com.conf',
    );
    expect(conf).not.toContain(
      'ln -s .../ziyun.pudafo.com.conf /etc/nginx/sites-enabled/',
    );
  });

  it('points the deployer at the reconcile procedure instead', () => {
    expect(readme).toContain('OPTIMIZATION.md');
    expect(deployDoc).toContain('OPTIMIZATION.md');
    expect(conf).toContain('OPTIMIZATION.md');
  });
});

/**
 * The fix round (2026-10-30) corrected a set of runbook assumptions that were
 * simply wrong, and every one of those corrections is a trap that could send
 * an operator into a wrong rollback. Each of them is pinned here so a later
 * edit cannot quietly put the wrong text back.
 */
describe('the optimization manual tells the truth about the runbook', () => {
  // F-1: `/var/www/ziyun` is not an install root in this repository — the
  // repo's own deploy docs and the config's alias paths both say
  // `/opt/pinyin-character`. A wrong path made a HEALTHY deploy look like a
  // byte mismatch, and the old failure branch said "roll back immediately".
  it('never hard-codes an install root that does not exist in this repo', () => {
    expect(manual).not.toContain('/var/www/ziyun');
  });

  it('takes the install root from a variable the operator confirms first', () => {
    expect(manual).toContain('APP_ROOT');
  });

  // F-2: nginx's add_header inheritance chain is http -> server -> location.
  // The old two-way criterion (server / location) could not classify an
  // http-level directive at all.
  it('classifies add_header on all three levels', () => {
    expect(manual).toContain('http 级');
    expect(manual).toContain('server 级');
    expect(manual).toContain('location 级');
  });

  // F-3: the brotli snippet lands in /etc/nginx/, which a normal user cannot
  // write to — the manual's own step 2 already says so.
  it('copies the brotli snippet with sudo', () => {
    expect(manual).toContain('sudo cp deploy/nginx-brotli.conf /etc/nginx/conf.d/nginx-brotli.conf');
  });

  it('says the same thing in the brotli snippet itself', () => {
    expect(brotli).toContain('sudo cp deploy/nginx-brotli.conf /etc/nginx/conf.d/nginx-brotli.conf');
  });

  it('points at the runbook from the config header', () => {
    expect(conf).toContain('deploy/OPTIMIZATION.md');
  });

  it('gives the config header the second landing path too', () => {
    expect(conf).toContain('scp deploy/nginx-brotli.conf');
  });

  // F-4: `cp` without `&&` plus `ls "$LIVE_CONF".bak-*` listed every OLD
  // backup as well — a failed copy could still look like a successful one.
  it('chains the backup copy to its own listing', () => {
    expect(manual).toContain('sudo cp "$LIVE_CONF" "$BAK" && ls -l "$BAK"');
  });

  // F-6: the heading said "五条" while the list had six, then seven.
  it('does not count the hard constraints in their heading', () => {
    expect(manual).not.toMatch(/硬约束[（(][^）)]*[一二三四五六七八九十]条/);
  });

  // F-8: the cache key contains no cookie, so a request without the cookie
  // can still HIT a cached entry — "no cookie means MISS" was never true.
  it('does not claim that a cookie-less request is always a MISS', () => {
    expect(manual).not.toContain('必然看到 MISS/MISS');
  });

  it('explains that the cache key carries no cookie', () => {
    expect(manual).toContain('键里不含 cookie');
  });

  it('says that a hot entry on the first request is normal', () => {
    expect(manual).toContain('第一次就是 HIT 也正常');
  });

  // F-13: the inline comments on the two smoke commands still said
  // "first one MISS / second one HIT" — which contradicts the criterion
  // two lines above them ("both MISS is the failure"). An operator reading
  // the command block would call a hot entry a fault.
  it('does not put a fixed MISS/HIT expectation on the two smoke commands', () => {
    expect(manual).not.toContain('# 第一次 MISS');
    expect(manual).not.toContain('# 第二次 HIT');
  });

  // F-14: the config's own warning comment still used the two-way criterion
  // and pointed at `grep -n "add_header"`, which prints the directives but
  // not the block they sit in — an operator cannot tell an http-level
  // directive from a server-level one with it.
  it('gives the config comment the same three-level criterion as the manual', () => {
    expect(conf).toContain('http 级');
    expect(conf).toContain('server 级');
    expect(conf).toContain('location 级');
    expect(conf).not.toContain('grep -n "add_header"');
  });

  // F-14: the manual's step 3 cross-reference still said "server 级的那几条",
  // which is the two-way criterion the step 1.5 judgment replaced.
  it('cross-references both inherited levels from the manual', () => {
    expect(manual).not.toContain('server 级的那几条');
  });

  // F-14: the counts in the prose had drifted from the config (Task 6 added a
  // seventh add_header of its own) — derive the number from the config instead
  // of hard-coding it, so the next added directive fails this test.
  //
  // ⚠️ The number quoted in the prose is the LOCATION-level count, not the
  // total. The old assertion counted every `add_header` in the file and then
  // used that total as if it were the location count — so adding a single
  // SERVER-level header would have demanded that both documents say
  // "location 级 8 条", which is a lie, and both assertions would still be
  // green. The documents now quote each level separately, and the level is
  // derived from where the directive actually sits.
  it('quotes the add_header count the config actually contains', () => {
    const { http, server, location, other, total } = addHeaderCounts;
    expect(total).toBeGreaterThan(0);
    // Every directive is accounted for by exactly one level.
    expect(http + server + location + other).toBe(total);
    // In THIS fragment there is no inherited header to copy: all seven
    // headers live inside a location, which is why the config comment can
    // say "不受影响".
    expect(http).toBe(0);
    expect(server).toBe(0);
    expect(other).toBe(0);
    expect(location).toBe(total);
    expect(manual).toContain(`location 级 **${location} 条**`);
    expect(conf).toContain(`location 级 ${location} 条`);
  });

  // F-14 (round 5): each level's number in the prose must follow the config,
  // not just the location one. If a server-level header is ever added, the
  // documents have to say so — the operator has to copy every inherited
  // header into `location /` by hand, and a stale count hides that.
  it('quotes every add_header level the config actually contains', () => {
    const { http, server, location } = addHeaderCounts;
    expect(manual).toContain(`http 级 **${http} 条**`);
    expect(manual).toContain(`server 级 **${server} 条**`);
    expect(manual).toContain(`location 级 **${location} 条**`);
    expect(conf).toContain(`http 级 ${http} 条`);
    expect(conf).toContain(`server 级 ${server} 条`);
    expect(conf).toContain(`location 级 ${location} 条`);
  });

  // F-14: the config comment and the manual must quote the same command —
  // if they drift, an operator runs one and reads the other.
  it('keeps the config comment and the manual on the same nginx -T command', () => {
    const command =
      "sudo nginx -T | grep -nE '^[[:space:]]*(http|server|location)[[:space:]].*\\{|add_header'";
    expect(manual).toContain(command);
    expect(conf).toContain(command);
  });
});

describe("the scanner's safety premise holds", () => {
  // The scanner is a character walk: it ends a directive at every `;` and
  // opens a block at every `{`, wherever they sit. That is only sound while
  // no QUOTED string holds one of those characters — a `;` inside a string
  // would cut a directive short, a `{` would open a block that does not
  // exist.
  //
  // ⚠️ The object of the check is the COMMENT-STRIPPED text, not the raw
  // file: the raw config carries a comment (the `nginx -T` command) whose
  // single-quoted shell string contains a `{`, and a comment is not a
  // directive — the scanner never sees it.
  it('has no quoted string that holds a structural character', () => {
    expect(confDirectives).not.toMatch(DOUBLE_QUOTED_STRING_WITH_STRUCTURAL_CHARACTER);
    expect(confDirectives).not.toMatch(SINGLE_QUOTED_STRING_WITH_STRUCTURAL_CHARACTER);
  });
});

describe('the add_header classifier follows the block keyword', () => {
  // ⚠️ These fragments are SYNTHETIC. The repository config has no `if` block
  // at all, so the assertions above can never reach the defect this
  // classifier had: `if ($http_user_agent …) {` mentions `http`, and a
  // substring match called the whole block http-level, which then MASKED the
  // enclosing `location`. Without these cases the defect comes straight back.
  //
  // Each fragment carries exactly one `add_header` and asserts its level.
  // Every fragment also satisfies the scanner's safety premise: no quoted
  // string in it holds `{`, `}`, `;` or `#`.

  it('keeps a header inside an if block at the level of the enclosing location', () => {
    const fragment = [
      'location / {',
      '    if ($http_user_agent ~* "MSIE") {',
      '        add_header A "1";',
      '    }',
      '}',
    ].join('\n');
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  it('keeps a header inside an if block at the level of the enclosing server', () => {
    const fragment = [
      'server {',
      '    if ($http_upgrade = websocket) {',
      '        add_header A "1";',
      '    }',
      '}',
    ].join('\n');
    expect(levelsOf(fragment)).toEqual(['server']);
  });

  it('keeps a header inside an if block at the http level', () => {
    const fragment = ['http {', '    if ($http_x) {', '        add_header A "1";', '    }', '}'].join(
      '\n',
    );
    expect(levelsOf(fragment)).toEqual(['http']);
  });

  it('skips a map block when it looks for the enclosing block', () => {
    const fragment = [
      'http {',
      '    map $http_x $y {',
      '        default 0;',
      '    }',
      '    location / {',
      '        add_header A "1";',
      '    }',
      '}',
    ].join('\n');
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  it('does not read the upstream URL of a proxy_pass as a block header', () => {
    const fragment = 'location / { proxy_pass http://ziyun_app; add_header A "1"; }';
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  it('keeps a single-line if block at the level of the enclosing location', () => {
    const fragment = 'location / { if ($request_method = POST) { add_header A "1"; } }';
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  it('keeps a single-line location that proxies to an upstream at location level', () => {
    // ⚠️ The single-line shape of the real `location /api/auth/` block, with an
    // `add_header` added so that the LEVEL of the block is actually observable:
    // without a header inside, the classifier has nothing to report.
    const fragment =
      'location /api/auth/ { limit_req zone=auth_init burst=5 nodelay; proxy_pass http://ziyun_app; add_header A "1"; }';
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  // ⚠️ The `https` keyword is mapped to the http level on its own branch.
  // Removing that branch does not change the result for a NESTED `https`
  // (the enclosing `http` answers first), so the case has to be a TOP-LEVEL
  // `https` block to pin the documented keyword table at all.
  // ⚠️ nginx has NO `https` block context — `https { … }` is rejected as
  // `unknown directive "https"`. HTTPS is configured with
  // `listen 443 ssl http2;` inside an ordinary `server` block, which is what
  // this repository does. The branch is therefore unreachable for every
  // config nginx accepts, and the rule has no behavioural consequence at
  // all; what this case guards is the TABLE — if someone folds
  // `case 'https'` into `case 'http'`, or drops it, this case goes red.
  it('treats a top-level https block as the http level', () => {
    const fragment = 'https { add_header A "1"; }';
    expect(levelsOf(fragment)).toEqual(['http']);
  });

  // ⚠️ Two block headers on ONE line: the level must come from the
  // instruction that opens THIS brace (`location`), not from the whole-line
  // prefix — the whole-line prefix reads `server`, so the `location` brace
  // would be attributed to the `server` block and the reported level would
  // be `server` instead of `location`.
  // The repository config never writes two blocks on one line, so this case
  // pins a general shape rather than a live defect.
  it('takes the level from the instruction that opens the brace, not from the whole line', () => {
    const fragment = 'server { listen 80; location / { add_header A "1"; } }';
    expect(levelsOf(fragment)).toEqual(['location']);
  });

  // ⚠️ The same whole-line trap in a fragment that puts a `map` block and a
  // `location` block on ONE line: the whole-line prefix reads `http`, so
  // the `location` brace would be attributed to the `http` block and the
  // reported level would be `http` instead of `location`.
  // ⚠️ `map $http_upgrade $connection_upgrade` is the idiom nginx's own
  // WebSocket documentation uses, but nginx writes it with each block on
  // its own line, and this repository does not use it at all — its
  // WebSocket pass-through is a hardcoded `proxy_set_header Connection
  // "upgrade";`. The single-line layout here is deliberate: it is what
  // exposes the whole-line prefix.
  it('takes the location level out of a one-line map plus location', () => {
    const fragment =
      "http { map $http_upgrade $connection_upgrade { default upgrade; '' close; } location / { add_header A \"1\"; } }";
    expect(levelsOf(fragment)).toEqual(['location']);
  });
});
