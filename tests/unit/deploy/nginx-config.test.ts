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
});
