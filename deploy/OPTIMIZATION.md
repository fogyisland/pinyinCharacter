# 字·韵 站点优化 —— nginx 部署手册

> 这份手册给**有服务器权限的运维**用。目标是一次上线两件事：
> **(a) 给被反代的 HTML 打开运行时 brotli**；(b) 给**匿名** HTML 加 10 秒微缓存
> （登录态、RSC 飞行请求、所有 API 响应一律不缓存）。
>
> 每一段都是可复制的命令、每一个命令都有**期望输出**、每一步都有**失败时怎么办**。
> 照着做即可，不需要读过这个仓库。

---

## ⚠️ 第一段：不要整份覆盖

**仓库里这份 `deploy/nginx.ziyun.pudafo.com.conf` 不是线上跑的那份。**
**不要** `cp` 覆盖线上配置。**只把需要的那几行手工合并进去。**

这不是推测，是拿响应头逐项对出来的（2026-10-29 / 2026-10-30 实测）：

| 判据 | 仓库配置会产生 | 线上实测 | 结论 |
|---|---|---|---|
| `/font/…woff2` 的 `ETag` | nginx `alias` + `expires` ⇒ `W/"<mtime-hex>-<size-hex>"`（mtime 在前、带 `T`/`O`） | `W/"1af64-1a16d58bed8"`（**size 在前**） | **Next.js** 的形状 |
| 同一个响应的 `Expires:` | nginx 的 `expires 1y` **必定**带 `Expires:` | **没有** | 不是 nginx 的 `expires` |
| `Cache-Control` | nginx 产出 `max-age=…`，再叠 `add_header` ⇒ **两个** `Cache-Control` | **一个**：`public, max-age=31536000, immutable`，与 `next.config.ts:45` 的 `/font/:path*` **逐字相同** | 由 Next.js 发出 |
| 一个不存在的字体 | nginx 的 `try_files $uri =404` ⇒ nginx 的 404 | `X-Powered-By: Next.js` + `link: </_next/static/css/…>` + `Vary: rsc, …` ⇒ **Next.js 的 404 页面** | 请求根本没进 nginx 的静态分支 |

⇒ 线上 `/font/`、`/fonts/`、`/strokes/`、`/_next/static/`、`/audio/`、`/logo.png`
**全部由 Next.js 提供**，而仓库配置里对应的 `alias` 块（`deploy/nginx.ziyun.pudafo.com.conf` 里的
`location /_next/static/`、`/strokes/`、`/fonts/`、`/font/`、`/audio/` 及几个 `location = /logo*`）
**在生产上没有生效**。

**为什么这条是硬约束**：那些 `alias` 块一旦真的生效，静态资源就改由 nginx 出，
而 `alias` + `try_files $uri =404` 是 nginx 的已知坑（`try_files` 在 `alias` 语境下会用
alias 目录拼**完整请求 URI**，路径多出一层前缀）⇒ 最坏情况是**这一整段静态资源全部 404**——
本波次刚做出来的 7 936 个字体文件会全部消失 ⇒ 而**页面上看不出任何错误**（字悄悄回落到系统字体）。

**顺带确定 `/font/` 归谁**：控制器 2026-10-30 04.12 的线上 HEAD 实测结论是
**`/font/` 归 Next.js**（`/font/fonts-sans.css` 的 `ETag` 是 `W/"1af64-1a16d58bed8"`，
**size 在前**，是 Next.js 的形状；nginx 自己出静态文件用的是 `"%xT-%xO"`，**mtime 在前且带
`T`/`O` 字母**）。**你在第 1 步必须自己复核这一条并写进对账结论**（线上可能已经漂移）。
这条决定 Task 7 的 `.br` / `.gz` 旁挂文件**今天出不出力**（旁挂文件只有 nginx 自己出文件时
才会被选中）。

---

## 部署顺序（六步）

### 第 1 步 · 对账（**不改任何东西**）

```bash
# 1.1 导出当前生效的完整配置
sudo nginx -T > /tmp/nginx-effective.conf
wc -l /tmp/nginx-effective.conf
```

**期望输出**：一个行数（几十到几百行）。**若报 `nginx: command not found` 或
`Permission denied`** ⇒ 服务器上 nginx 不在 PATH 上，或当前账号没有 sudo 权限
⇒ **停下来找有权限的账号**，后面每一步都要 sudo。

```bash
# 1.2 线上到底有没有那些 alias 块?
grep -n 'alias ' /tmp/nginx-effective.conf
```

**期望输出**：**空**（线上目前没有 `alias` 块）。
**若这里列出了 `alias /opt/pinyin-character/public/font/` 之类的行** ⇒ 线上已经漂移过，
**立刻停下来**并把结论写进对账记录——这一步的结论决定第 3 步合并什么。

```bash
# 1.3 /font/ 这个 location 归谁?
grep -n -A6 'location /font/' /tmp/nginx-effective.conf
```

**期望输出**：**`proxy_pass http://…;`**（归 Next.js）。
**若看到 `alias /opt/pinyin-character/public/font/`** ⇒ 归 nginx（已漂移），
**记下来**并告知运维，不要自行改动。

```bash
# 1.4 找出线上那份配置的真实路径（记为 LIVE_CONF）
grep -n '# configuration file ' /tmp/nginx-effective.conf
```

从输出里找到**包含 ziyun.pudafo.com 那个 server 块**的文件路径，记为 `LIVE_CONF`，**并把它赋给 shell 变量** `LIVE_CONF=<第 1.4 步找到的那个路径>`（尖括号里换成实际路径，**不要留尖括号**）。
**后面所有备份 / 合并 / 回滚命令一律用 `"$LIVE_CONF"`，不许写死任何一个路径** ——
仓库文件头部注释里写的那个路径只是「它自己该放哪」，线上跑的那份**从未实测过**。

```bash
# 1.5 查 http / server / location 三个层级的 add_header（关键，见下）
sudo nginx -T | grep -nE '^[[:space:]]*(http|server|location)[[:space:]].*\{|add_header'
```

**期望输出**：若干行，**块头与 `add_header` 行交错出现** ⇒ 顺着上一行块头就能判断层级。
**只看 ziyun.pudafo.com 那个 `server` 块，以及它所属的 `http` 块。**

⚠️ **nginx 的 `add_header` 只在「当前层级没有定义任何 `add_header`」时才继承父级**，
而且只有「**替换**」语义、**没有「追加」语义 ⇒ 在 `location /` 里加
`X-Ziyun-Cache` 这一行，会让该 location **继承到的父级 `add_header` 全部消失**
（HSTS / `X-Frame-Options` / `X-Content-Type-Options` 之类）。

**判断依据（三分，不许再用二分）**：

- 出现在 **`http {` 之内、任何 `server {` 之外** ⇒ **http 级**
- 出现在 **`server {` 与它的 `}` 之间** ⇒ **server 级**
- 出现在 **某个 `location … {` 内部** ⇒ **location 级**

⇒ **http 级与 server 级的每一条，都必须逐条复制到 `location /` 里**（复制 HSTS 就复制
HSTS 的值与 `always` 参数，一条一条来）。**location 级的不用复制** —— 它们各管各的，
本来就不受影响。

- **仓库这份配置（`deploy/nginx.ziyun.pudafo.com.conf` 这份片段内）**：http 级 **0 条**、server 级 **0 条**、location 级 **7 条**
  ⇒ 仓库这份不受影响；
- **线上那份从未实测过** ⇒ 若第 1.5 步发现 http 级或 server 级 `add_header`，
  **先把那些条目逐条复制到 `location /` 里**，再继续第 3 步。
- **不要**把 `X-Ziyun-Cache` 提到 server 级：那会让 `/api/`、`/mcp`、`/font/` 也带上这个头。

```bash
# 1.6 应用安装根（5.1 的字体验收要用；仓库文档写的是 /opt/pinyin-character）
APP_ROOT=/opt/pinyin-character
ls -d "$APP_ROOT"/public/font "$APP_ROOT"/public/font/web/sans
```

**期望输出**：两个目录都列出来（`hot.woff2` 所在的目录）。

**若这里报 `No such file or directory`** ⇒ 线上安装根不是这个 ⇒ **改 `APP_ROOT` 的值再跑一次**，
把改成的那个值写进对账结论第 5 条。后面 5.1 用的是同一个 `$APP_ROOT`。

⚠️ **不要凭猜的路径去 `sha256sum`** —— 路径不对会报「文件不存在」，
而 5.1(d) 的判据是「两个哈希都存在且不同」⇒ **路径写错会把一次健康上线误判成要回滚**。

#### 对账结论（必须写下这五句）

1. 线上有没有 `alias` 块：**有 / 没有**
2. `/font/` 归谁：**Next.js / nginx**
3. http 级 / server 级 `add_header` 各有几条、要不要复制进 `location /`：**列出条目或「无」**
4. `LIVE_CONF` = **<从 `nginx -T` 读出来的路径>**
5. `APP_ROOT` = **<第 1.6 步确认的应用安装根>**（仓库默认 `/opt/pinyin-character`）

### 第 2 步 · 备份

```bash
BAK="$LIVE_CONF.bak-$(date +%F-%H%M)"
sudo cp "$LIVE_CONF" "$BAK" && ls -l "$BAK"
```

**期望输出**：一行 `-rw-r--r-- … <LIVE_CONF>.bak-YYYY-MM-DD-HHMM`（**就是 `ls "$BAK"` 这一条**）。

**若 `ls` 没有任何输出** ⇒ `cp` 失败了（`&&` 保证 `cp` 失败时 `ls` 根本不会执行）
⇒ 你没有写权限（正常用户对 `/etc/nginx/` 没有写权限）⇒ 用 `sudo`，两个参数都要带引号
（路径里有变量）。**备份失败就不要往下走** —— 后面第 6 步的回滚要靠它。

**若 `cp` 报 `No such file or directory`** ⇒ `$LIVE_CONF` 这个变量是空的或路径不对
⇒ 回第 1.4 步重读一次 `nginx -T` 的输出。

### 第 3 步 · 合并（不是覆盖）

把下面**两块**内容**手工合并**进 `$LIVE_CONF`：

**块 A —— `http` 层（与 `limit_req_zone` 同级，`upstream` 之前）**

```nginx
# ---------------------- HTML 微缓存 ----------------------
proxy_cache_path /var/cache/nginx/ziyun
    levels=1:2
    keys_zone=ziyun_html:10m
    max_size=64m
    inactive=10m
    use_temp_path=off;
```

**块 B —— 443 那个 server 块里 `location / {` 的内部（`proxy_pass` 之后）**

```nginx
        # HTML 微缓存(仅匿名、仅文档请求)
        proxy_cache ziyun_html;
        proxy_cache_key "$scheme$request_method$host$request_uri$http_accept_encoding";
        proxy_cache_valid 200 10s;
        proxy_cache_methods GET HEAD;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_bypass $cookie_auth_token $http_rsc;
        proxy_no_cache $cookie_auth_token $upstream_http_set_cookie $http_rsc;
        proxy_cache_lock on;
        proxy_ignore_headers Cache-Control;
        add_header X-Ziyun-Cache $upstream_cache_status always;
```

**块 C —— 443 那个 server 块里，`location /mcp` 之后、`location /` 之前**

```nginx
    # ---- API 一律不缓存 ----
    location /api/ {
        proxy_pass http://ziyun_app;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_cache off;
    }
```

> ⚠️ **上面 `location /api/` 里的 `proxy_pass http://ziyun_app;` 要改成线上那份里
> `location /` 用的那个 upstream 名字**（线上可能叫别的名字）。
> **块 C 必须插在 `location /mcp` 之后、`location /` 之前** ——
> nginx 取最长前缀匹配，所以 `location /api/auth/`、`location /api/init/` 两个限流块不受影响。
>
> ⚠️ **线上那份的 `location /` 可能已经有 `add_header`** ⇒ 先按第 1.5 步的结论把 **http 级与 server 级的每一条**
> 逐条复制进来，再加 `X-Ziyun-Cache`。

**缓存目录先建好**：

```bash
sudo mkdir -p /var/cache/nginx/ziyun
ls -ld /var/cache/nginx/ziyun
```

**期望输出**：`drwxr-xr-x … /var/cache/nginx/ziyun`。
**失败** ⇒ 权限不足（`/var/cache/nginx` 是 root 所有）⇒ 确认命令里带 `sudo`；
实在建不出来也没关系 —— `proxy_cache_path` 指到的目录 nginx 启动时会自己建。

#### brotli 片段怎么到服务器上（与缓存指令不是一回事）

上面三块是**手工合并**的，不需要拷贝任何文件；但 **brotli 片段是要一个文件落到服务器磁盘上的**。
**两条路径都要知道**：

**(a) 服务器上有仓库检出时**

```bash
sudo cp deploy/nginx-brotli.conf /etc/nginx/conf.d/nginx-brotli.conf
```

**(b) 服务器上**没有**仓库检出时（常见）** —— 先在**本地**机器上：

```bash
scp deploy/nginx-brotli.conf <user>@<host>:/tmp/nginx-brotli.conf
ssh <user>@<host> 'sudo cp /tmp/nginx-brotli.conf /etc/nginx/conf.d/nginx-brotli.conf'
```

> ⚠️ **只写 (a) 会让没有仓库检出的操作员卡在 `No such file or directory`** ——
> 而那个报错看不出真实原因（他不是路径写错了，是**根本没有那份仓库**）。
> **不知道服务器上有没有仓库检出 ⇒ 走 (b)。**

**失败了怎么办**：`cp` 报 `Permission denied` ⇒ 忘了 `sudo`（或这台机器上你本来就有权限）
⇒ 加上 `sudo` 重跑；报 `No such file or directory` ⇒ **多半是 (a) 路径不适用**
（这台服务器上没有仓库检出）⇒ 改走 (b) 路径。

⚠️ **拷进 `conf.d/` 并不等于它生效。** 只有当线上 `nginx.conf` 的 `http` 块里有
`include /etc/nginx/conf.d/*.conf;`（Ubuntu 默认有）才自动生效；没有的话，必须自己在
ziyun 那个 server 块里加一行 `include /etc/nginx/conf.d/nginx-brotli.conf;`。
**漏了这一步 ⇒ 文件在那里、指令一条没生效、而且看不出任何异常。**

```bash
# 自检:必须有输出
sudo nginx -T | grep -n 'nginx-brotli'
```

**期望输出**：至少一行（含 `nginx-brotli.conf` 的路径）。
**没有输出** ⇒ 片段没被 include ⇒ 要么加那行 `include`，要么这个片段根本不该上线。

⚠️ **`brotli on;` 只在服务器编译了 brotli 模块时才存在**：

```bash
nginx -V 2>&1 | grep -o brotli
```

**期望输出**：`brotli`。
**没有输出** ⇒ 服务器没有这个模块 ⇒ **不要放这个片段**（nginx 会因未知指令启动失败），
本波次的 brotli 收益在服务器上是 0（其余五步照做）。

### 第 4 步 · 校验 + 加载（**reload，不是 restart**）

```bash
sudo nginx -t
```

**期望输出**：

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

**若失败** ⇒ **不要 reload**。错误信息会指出行号与文件；回滚见第 6 步。
最常见的原因是第 3 步手工合并时**漏了一个花括号**（`location / { … }` 少一个 `}`）。
**`nginx -t` 不过 ⇒ 线上现在的服务还活着**（reload 还没发生）⇒ 不必惊慌，但必须修好才能继续。

```bash
sudo systemctl reload nginx
systemctl is-active nginx
```

**期望输出**：`active`。
**若 `reload` 报错** ⇒ 看 `sudo journalctl -u nginx -n 50 --no-pager`；
配置有问题就**立刻执行第 6 步回滚**（服务此时可能已经不可用）。

### 第 5 步 · 冒烟

#### 5.1 字体文件（**本波次的验收项**）

> **先确认 `$APP_ROOT` 和 `$LIVE_CONF` 还在**：它们分别是在第 1.6 步与第 1.4 步设的 shell 变量。
> **换了终端要重新设**（`APP_ROOT=/opt/pinyin-character`、`LIVE_CONF=<第 1.4 步找到的那个路径>`），
> 否则下面的命令会报「文件不存在」，第 6 步的回滚也会找不到备份。

```bash
# a) 取 manifest 版本号（部署后的那份）
MV=$(grep -o '"version": *"[0-9a-f]\{12\}"' "$APP_ROOT/public/font/fonts-manifest.json" | grep -o '[0-9a-f]\{12\}')
echo "manifest version=$MV"

# b) 取线上 sans 样式表里 sans 的令牌
TOKEN=$(curl -s "https://ziyun.pudafo.com/font/fonts-sans.css?v=$MV" \
        | grep -o 'hot\.woff2?v=[0-9a-f]\{12\}' | head -1 | sed 's/.*v=//')
echo "token=$TOKEN"          # 必须是 12 位小写 hex

# c) 带令牌的 URL 必须 200 + font/woff2 + 一年 immutable
curl -sI "https://ziyun.pudafo.com/font/web/sans/hot.woff2?v=$TOKEN" | head -20

# d) 取回来的字节必须与服务器上的文件逐字节相同
curl -s "https://ziyun.pudafo.com/font/web/sans/hot.woff2?v=$TOKEN" -o /tmp/sans-hot.woff2
sha256sum /tmp/sans-hot.woff2
sha256sum "$APP_ROOT/public/font/web/sans/hot.woff2"
```

**期望输出**

- a) `manifest version=82c79ff72035`（或部署后的新版本，12 位小写 hex）
- b) `token=f31ca9b32566`（或部署后的新族令牌，12 位小写 hex）
- c) `HTTP/2 200`、`Content-Type: font/woff2`、`Cache-Control: public, max-age=31536000, immutable`
- d) **两个 sha256 完全相同**

> **文件名注意**：sans / serif 是单字重，热区文件叫 `hot.woff2`；楷体（wenkai）是双字重，
> 叫 `hot-400.woff2` / `hot-700.woff2`。**用错文件名会拿到 404 或 `No such file or directory`**，
> 而 404 在页面上又看不出错。

**失败了怎么办**

- a) `$MV` **是空的** ⇒ manifest 没找到、或版本号格式不对 ⇒ **先查 `$APP_ROOT` 与文件名**，
  **不要**当成「字体没上线」，更不要回滚。
- c) 返回 **404** ⇒ 字体产物没上线，或被某个 `alias` 块挡掉了 ⇒ **立即执行第 6 步回滚**，
  然后查应用发布记录（字体文件是随应用发布上去的）。
- d) `sha256sum` 报 **`No such file or directory`** ⇒ **这是路径写错了，不是字节不一致**
  ⇒ 确认 `$APP_ROOT` 与文件名（sans / serif 是单字重、热区文件叫 `hot.woff2`；
  楷体 wenkai 是双字重，叫 `hot-400.woff2` / `hot-700.woff2`）⇒ **不要回滚**。
- d) **两个 sha256 都存在且不同** ⇒ 线上返回的不是服务器上那个文件（可能被别的缓存挡着）
  ⇒ **立即回滚**，并把两个哈希都记下来。
- d) 两个 sha256 相同 ⇒ 这一项通过。

#### 5.2 微缓存与「哪些响应不许进缓存」

> ⚠️ **每一条都必须带 `Cookie: setup_completed=1`**。站点的初始化闸门
> （`middleware.ts:92-100`）是**只看 cookie** 的：没有 `setup_completed=1` 的请求
> **一律 307 跳 `/init`**。307 不在 `proxy_cache_valid 200 10s` 里 ⇒ **不会被写进缓存**。
>
> ⚠️ **但「不带 cookie 就一定是 MISS」是错的，不要拿它当判据。**
> 缓存键是 `$scheme$request_method$host$request_uri$http_accept_encoding` ——
> **键里不含 cookie** ⇒ 带 cookie 的请求写下的那条 200 条目，**不带 cookie 的请求照样能命中**
> （命中时 nginx 直接回缓存，**请求根本到不了 `middleware.ts`**）。
> ⇒ 冒烟的判据只有一条：**带 cookie 连发两次，这两次里出现过 `HIT`**。
>
> ⚠️ **两次都 MISS 才是故障**；**第一次就是 HIT 也正常**（最近 10 秒内别的访客把同一个 URL
> 写进了缓存 ⇒ 你接手的就是热条目）。不要把热条目当成「缓存没生效」。

```bash
C='Cookie: setup_completed=1'
curl -I -H "$C" https://ziyun.pudafo.com/ | grep -i x-ziyun-cache      # MISS 或 HIT 都行（热条目就是 HIT）
curl -I -H "$C" https://ziyun.pudafo.com/ | grep -i x-ziyun-cache      # 这两条里只要出现过一次 HIT 就算通过
curl -I -H 'Cookie: setup_completed=1; auth_token=dummy' https://ziyun.pudafo.com/ | grep -i x-ziyun-cache   # BYPASS
curl -I -H "$C" -H 'RSC: 1' https://ziyun.pudafo.com/ | grep -i x-ziyun-cache   # BYPASS（飞行请求不碰缓存）
curl -I -H "$C" https://ziyun.pudafo.com/api/stats | grep -i x-ziyun-cache      # 无该头（API 不缓存）
```

**期望输出**

| 命令 | 期望 |
|---|---|
| 第 1 条 | `X-Ziyun-Cache: MISS` **或** `HIT`（热条目时就是 HIT，不是故障） |
| 第 2 条 | `X-Ziyun-Cache: MISS` **或** `HIT`（TTL 只有 10 秒，第二次也可能已经过期） |
| 第 3 条（带 `auth_token`） | `X-Ziyun-Cache: BYPASS` |
| 第 4 条（带 `RSC: 1`） | `X-Ziyun-Cache: BYPASS` |
| 第 5 条（`/api/stats`） | **没有 `X-Ziyun-Cache` 这一行** |

> **判据**：**这两条里只要出现过一次 `HIT` 就算通过**；两次都 MISS 才是故障
> （TTL 只有 10 秒 ⇒ 第二条也可能已经过期 ⇒ 它是 MISS 不是故障）。

> ⚠️ 第 3 条**必须把两个 cookie 写在同一个 `Cookie:` 头里**（用 `;` 分隔）。
> 写成两个 `-H 'Cookie: …'` 也可以 —— curl 会发成两行 `Cookie:`，Node 的 HTTP 解析器会把它们
> 用 `"; "` 连接起来，上游看到的仍是 `Cookie: setup_completed=1; auth_token=dummy` ——
> 但老版本 curl 只保留最后一个，那样就**测不到 BYPASS 了**，反而会误判成「缓存没生效」。
>
> ⚠️ 第 1 条与第 2 条之间**必须连着发**，中间不要隔太久（TTL 只有 10 秒）。
> 如果第 2 条还是 MISS，等一下再发一次 —— 第一次请求的响应要写盘，可能有几十毫秒延迟。

**编码隔离**（F31-u）：

```bash
# 先用 gzip 预热缓存,再发一个**不带** Accept-Encoding 的请求,
# 它的响应里**不能**出现 Content-Encoding: gzip
curl -sI -H "$C" -H 'Accept-Encoding: gzip' https://ziyun.pudafo.com/ | grep -iE 'x-ziyun-cache|content-encoding'   # 预热:MISS 或 HIT 都行,只要有 content-encoding: gzip
curl -sI -H "$C" https://ziyun.pudafo.com/ | grep -iE 'x-ziyun-cache|content-encoding'                              # MISS/HIT 都行,**只看有没有 content-encoding**
```

**期望输出**：第一条有 `Content-Encoding: gzip`；第二条**没有** `Content-Encoding`。
（两条各自的 `X-Ziyun-Cache` 是 MISS 还是 HIT **都不要紧** —— TTL 只有 10 秒，
两条之间隔着敲键盘的时间，第二次很可能已经 MISS。**判据只看 `Content-Encoding`。**）

**若第二条也带 `Content-Encoding: gzip`** ⇒ 编码隔离失效 ⇒ **立即回滚**。

> ⚠️ **一个已知的行为差异（微缓存带来的；不是 bug，但要知道）**：
> 微缓存命中时，请求**不会到达 `middleware.ts`** ⇒ 初始化闸门的那次 307 **不会发生**。
> ⇒ 一个**第一次访问**的访客，如果先命中了缓存，会**先看到首页**；等他下一次导航命中
> 未缓存的 URL 时，才会被 307 送去 `/init` 拿 cookie。**改动之前**那次 307 发生在他的
> **第一个**请求上 —— **只是跳转时机挪后了一次**。
>
> 这**不涉及任何用户数据**：缓存里只有匿名页面 —— 登录态 cookie `auth_token` 在
> `proxy_cache_bypass`（读）与 `proxy_no_cache`（写）两条闸里都被挡掉，
> 带 `Set-Cookie` 的响应也不会被写进缓存（`proxy_ignore_headers` 里只有 `Cache-Control`）。
> 真正的初始化闸门在**服务端**（`components/SetupGuard.tsx` → `getSetupState()`），
> 它是每个请求都跑的。§5.3 的必做清缓存把窗口限死在 10 秒以内。

**再手工确认一次「客户端导航没被缓存污染」**：浏览器打开首页 → 点进任意内链 →
DevTools Network 里该导航请求的响应 `Content-Type` 必须是 `text/x-component`，
且页面白屏 / 卡死都没有。

#### 5.3 上线后**立刻**清空微缓存（**必做，不是可选**）

```bash
# 微缓存的落地目录就是 proxy_cache_path 里那个（/var/cache/nginx/ziyun）
sudo find /var/cache/nginx/ziyun -mindepth 1 -delete
# 等价写法： sudo rm -rf /var/cache/nginx/ziyun/*
```

**期望输出**：`find` 不打印任何东西（目录还在、内容空了）。
**若 `find` 报 `No such file or directory`** ⇒ 缓存目录根本没建出来 ⇒
第 3 步的 `proxy_cache_path` 没被合进去，或者根本还没有请求命中过缓存 ⇒ 回看第 3、4 步。
**⚠️ 不要指望 `systemctl reload nginx` 清缓存** —— reload **不会**清 `proxy_cache`，
只有删目录里的文件才清。

**为什么这一步是必须的**：新的字体子集文件**文件名是位置名**（`ext-042.woff2`）、
**跨构建复用**，而令牌在**查询串**里、服务器**按路径给文件、无视查询串** ⇒
浏览器若拿着**旧样式表**去请求**旧令牌**的 URL，服务器会给**新字节**（或 404）⇒
旧样式表宣称覆盖的字形不在这个文件里 ⇒ **字悄悄回落系统字体**（罕见字可能豆腐块），
而**页面上看不出任何报错**。

**窗口有多大**：浏览器**不缓存 HTML**（线上普通文档响应头是
`private, no-cache, no-store, max-age=0, must-revalidate`）⇒ **唯一**能拿到旧 HTML 的
就是**本页这个微缓存**，TTL **10 秒**（`proxy_cache_valid 200 10s;`）⇒
**暴露窗口 = 每次上线后约 10 秒**。

**⚠️ 说清楚对比（不夸大）**：**改造前的那一套**文件名**就是内容哈希**
（`/font/noto-sans-sc/k3kXo84MPvpLmixcA63oeALhLOCT-xWNm8Hqd37g1OkDRZe7lR4sg1IzSy-MNbE9VH8V.4.woff2`）、
URL 上**没有查询串令牌** ⇒ 路径即内容地址 ⇒ **旧样式表的每一个 URL 永远指向同一批字节**
⇒ **那套方案没有这个洞**。⇒ 现在这个 10 秒窗口是**新方案带进来的**（文件名从内容哈希换成
**位置名**、令牌挪进查询串）⇒ **「上线后清微缓存」这一步是必须的，不是可选的**。

**顺序**：**先**把应用与 `public/font/**` 上线，**再**清微缓存 ⇒ 清完之后第一个访客拿到的
就是**新 HTML** ⇒ 新样式表 URL ⇒ 新子集令牌。

**⚠️ 字体产物的上线顺序不能反（R-18）**

1. **先上 woff2 文件**（`public/font/web/**`）；
2. **再上三份样式表与 `fonts-manifest.json`**（样式表的 `?v=` 是 manifest 版本、
   字体文件的 `?v=` 是每族令牌 —— **两级令牌必须同时换**）。

**理由**：字体**文件名是稳定的**（`hot.woff2` / `hot-400.woff2` …），而 `/font/**` 的
`Cache-Control` 是 `public, immutable`（**一年**）⇒ **样式表先上**的话，浏览器会按
新样式表里的新 URL（`hot.woff2?v=<新族令牌>`）去取，而服务器磁盘上还是**旧文件** ⇒
**浏览器把旧字节缓存到新 URL 上** ⇒ **缺字（豆腐块）会持续一年**，而**页面上看不出任何错误**
⇒ 只有把顺序反过来才安全。
（这条与 5.1 的 d)「逐字节比对」**互补**：那条能发现**已经上错了**，这条能**防止上错**。）

#### 5.4 brotli 是否真的生效

```bash
curl -sI -H 'Accept-Encoding: br' https://ziyun.pudafo.com/ | grep -i content-encoding
```

**期望输出**：`Content-Encoding: br`。
**没有输出** ⇒ 片段没被 include（回看第 3 步的自检）或服务器没有 brotli 模块。

### 第 6 步 · 回滚

```bash
sudo cp "$LIVE_CONF.bak-<时间戳>" "$LIVE_CONF" && sudo nginx -t && sudo systemctl reload nginx
```

**顺序必须是 `cp` → `nginx -t` → `reload`** ——
少了中间那步 `nginx -t`，就等于把一个可能起不来的配置直接 reload 上去。

**期望输出**：`nginx: configuration file … test is successful`，随后站点恢复原状。
**若 `nginx -t` 失败** ⇒ **不要 reload**，回到备份里再查。

**撤销 brotli（两种情况，回滚命令不同）**

**(a) 只在 `conf.d/` 放了文件、靠 `include /etc/nginx/conf.d/*.conf;` 自动生效**

```bash
sudo rm -f /etc/nginx/conf.d/nginx-brotli.conf && sudo nginx -t && sudo systemctl reload nginx
```

**(b) 手工往 ziyun 的 server 块里加了 `include /etc/nginx/conf.d/nginx-brotli.conf;`**

**只删文件会让 `nginx -t` 直接失败**（悬空 include）⇒ 必须**先把那行 include 注释掉或删掉，
再删文件**，或者干脆保留文件、把 include 注释掉：

```bash
# 先把 $LIVE_CONF 里那行 include 注释掉或删掉,再执行下面两条
sudo rm -f /etc/nginx/conf.d/nginx-brotli.conf && sudo nginx -t && sudo systemctl reload nginx
```

---

## 微缓存的硬约束（**全部保留，一个字都不许删**）

1. **新增任何「按用户区分」的 cookie 或请求头时，必须同时扩展 `proxy_cache_bypass` 与
   `proxy_no_cache`** —— 只改前者会让登录态响应被写进缓存
   （`proxy_cache_bypass` 只管「读」不管「写」）。
   当前的会话 cookie 名是 `auth_token`（`lib/auth.ts:18`）。
2. **不要给 `location /` 之外的路径加缓存**，尤其不要把 `location /api/` 的
   `proxy_cache off;` 删掉 —— 73 个带 GET 的 API 路由里混着「每次给新内容」的
   （`/api/chars/random`、`/api/poetry/random`、`/api/game/round`、`/api/stats`、
   `/api/audio/active`）和用户态数据（`/api/history`、`/api/notes`、
   `/api/membership/me`、`/api/worksheets/*`）。
3. **`$http_rsc` 不能从两条指令里去掉** —— 同一个 URL 带 `RSC: 1` 返回的是 Next 的
   flight 数据（`text/x-component`），不带则返回整页 HTML（`text/html`），二者**只有这一个
   请求头不同**。缓存键是 `$request_uri`，不隔离就等于把 HTML 喂给客户端路由 → 白屏。
4. **缓存键里的 `$http_accept_encoding` 不能去掉** —— 上游按请求头协商压缩：同一个 URL，
   带 `Accept-Encoding: gzip` 回 **gzip 体**、不带回**原始体**。
   ⚠️ **nginx 认 `Vary`**（官方文档：响应头含 `Vary` 且不是 `*` 时会按对应的请求头字段
   分别缓存，**1.7.7** 起），线上实测上游发的是
   `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`
   ⇒ **今天编码分档本来就有两道**（nginx 的 `Vary` 处理 + 我们显式写的缓存键）。
   ⇒ 显式缓存键防的是**将来**的两种情况：上游哪天不再发 `Vary`；或有人往
   `proxy_ignore_headers` 里加了 `Vary`（那会关掉 nginx 那道闸）。
5. **`proxy_ignore_headers` 里绝不许加 `Vary`** —— 加上它就会**关掉 nginx 自带的 `Vary` 分档**。
   本任务只允许 `proxy_ignore_headers Cache-Control;` 这一种写法。
   ⚠️ **绝不能写成 `proxy_ignore_headers Cache-Control Set-Cookie;`** ——
   那会让带登录态的响应被写进缓存 ⇒ **用户串号**。
6. **冒烟必须带 `Cookie: setup_completed=1`** —— 见第 5.2 节。判据只有一条：
   **带 cookie 连发两次，这两次里出现过 `HIT`**；两次都 MISS 才是故障，
   第一次就 HIT 是热条目、正常（缓存键里不含 cookie，命中时请求到不了 `middleware.ts`）。
7. **静态资源也会进微缓存，这是预期的，不是配置错误** —— 生产上 `/font/`、`/strokes/`、
   `/_next/static/`、`/audio/` 由 Next.js 提供，走的就是 `location /` ⇒ 它们同样被缓存 10 秒
   （响应头也会带 `X-Ziyun-Cache`）。这些文件本来就是 immutable 的静态产物，缓存它们只是
   省掉一次回源往返。⚠️ 但它们**占的是同一个磁盘缓存**（`proxy_cache_path` 那个，
   `max_size=64m`）⇒ 将来命中率下降时，先查是不是静态资源把 HTML 条目挤出去了：
   `du -sh /var/cache/nginx/ziyun`。

---

## 配置漂移（**这是运维的活，本波次不动那些 `alias` 块**）

仓库这份配置与线上跑的那份**不一致**，而且**不一致的方向已经测清楚了**（见开头那一段）。

**两条去漂移的路径，二选一**：

- **路径一：把线上改成与仓库一致** —— 在服务器上把那些 `alias` 块加上。
  ⚠️ **风险很高**：`alias` + `try_files $uri =404` 是已知坑，最坏情况是整段静态资源 404，
  而页面上看不出任何错误。**并且这会改变 Task 7 旁挂文件是否生效**（见下一节）。
- **路径二：把仓库改成与线上一致** —— 删掉仓库里的那些 `alias` 块，
  让仓库如实反映线上。**本波次不做**（会把一个「已知的部署漂移」变成「未知的部署漂移」）。

### 今天**真正**在生效的压缩（**不要把旁挂文件当成已经省下来的带宽**）

由于 `/font/`、`/fonts/`、`/strokes/`、`/_next/static/`、`/audio/` 这些路径在生产上
**由 Next.js 提供**（不是 nginx 从磁盘直出），仓库配置里的 `alias` 块**不生效**
⇒ `gzip_static on;` / `brotli_static on;` 对它们**是空转的**
⇒ **Task 7 生成的 `.br` / `.gz` 旁挂文件在当前拓扑下不会被选中**。

⇒ **今天真正生效的只有本任务这条运行时的 `brotli on;`**（作用在被反代的 HTML 上）。
要让旁挂文件被用上，前提是**线上 nginx 改为从磁盘直出这些路径**（运维的活，本波次不动）。

### 线上配置对账待办

线上响应带 `Alt-Svc: quic=":443"; h3=":443"; …`（2026-10-30 实测），而仓库配置只有
`listen 443 ssl http2` ⇒ **上线前必须在服务器上核对** `nginx -V` 与 `/etc/nginx/conf.d/`
里的实际配置：给仓库补 QUIC，还是把线上改回与仓库一致。**同时确认 brotli 模块是否存在。**

⚠️ **`nginx -V` 还要看版本号**，两个坑：

- **nginx < 1.19.3**：带 `Vary` 的上游响应进缓存可能刷
  `[crit] cache file ... has too long header`；
- **nginx < 1.23.0**：**多个 `Vary` 行只用最后一条** ——
  本例恰好最后一条就是含 `Accept-Encoding` 的那条 ⇒ 仍安全，但**上线前必须核对版本**。

```bash
nginx -v 2>&1
nginx -V 2>&1 | grep -o 'brotli'
```

---

## 字体改造的一处已知取舍（**说真话：字形观感有变化**）

新的三份样式表**一个 U+2E80 以下的码位都没有** ⇒ **Latin 字母、数字、西文标点、
以及带声调的拼音（ǎ ǐ ǒ ǔ ǹ ḿ ń ň）现在由系统字体绘制**：

| 用途 | 现在的兜底字体 |
|---|---|
| `--font-sans`（正文 / 拼音） | `system-ui`（Windows = Segoe UI、macOS = SF、Android = Roboto） |
| `--font-serif` | `Georgia` |
| `--font-kai` | `Kaiti SC` |

⚠️ **改造前不是这样**：线上原来发的是 Google 的子集，**覆盖了全部这些 Latin 码位** ⇒
**每个字下面的拼音，改造前是 Noto Sans SC，改造后是系统字体**。
**汉字本身的字形一个字节都没变**（同一份源字体、同一个 `[400,700]` 轴区间，只是重新分组）。

**为什么这样取舍**：字符集按设计只收中文（`scripts/fonts/webfont-charset.mjs` 里有明确的
设计说明：热区槽位稀缺，一个 ASCII 字母 / 数字 / 空格不许占名额），而**每页字体字节预算
只剩 21.9 KB 余量**（`/` `/dictionary` `/stories` 21.9 KB，`/poetry` 19.2 KB）⇒
**把 Latin 放回 webfont 要 +145.8 KiB/页**（`/` `/dictionary` `/stories`
308.1 → **457.6 KB**，`/poetry` 220.8 → **307.3 KB**），**超预算 38.7 % / 28.0 %**
⇒ 裁定**不装**，并把这一条作为**公开的取舍**上报。

**怎么装回去**：往 `scripts/fonts/webfont-charset.mjs` 的字符集里加 ASCII，让它成为一族的一个
新块，`unicode-range` 用精确并集，然后重跑 `fonts:build`；**流水线不用改**。

---

## 已实测的线上事实（改配置前请复核）

- **`RSC: 1` 是区分 flight 数据与 HTML 的唯一手段** —— `?_rsc=` 查询参数**不**产生 flight 数据
  （实测返回 200 `text/html`）；`Next-Router-Prefetch: 1` 单独发会得到 **500**
  （上游 Next 的行为，不是本项目引入的）。
- 普通文档请求的响应头是
  `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` +
  `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`。
- **编码变体**：同一个 URL 会回**两种不同的字节**。带 `Accept-Encoding: gzip, deflate, br`
  或 `gzip` ⇒ `200` + `Content-Encoding: gzip`；带 `identity` 或**不带** `Accept-Encoding`
  ⇒ `200` + **没有** `Content-Encoding`。两种情况的响应头**都**带 `Vary: … Accept-Encoding`。
  线上响应带**两条** `Vary` ——
  `Vary: Accept-Encoding`（nginx 自己的 `gzip_vary on;` 加的）+
  `Vary: rsc, …, Accept-Encoding`（Next.js 加的，92 字符）。
- **初始化闸门**：不带 `Cookie: setup_completed=1` ⇒ `307 location: /init`
  （`/`、`/dictionary`、`/poetry`、`/api/stats`、`/api/chars/random` 全部如此）；
  带上 ⇒ `200 text/html`。
- **命中率上的实话**：nginx 的 `Vary` 分档用的是**请求头的原始值** ⇒
  `Accept-Encoding: gzip, deflate, br` 与 `gzip, deflate, br, zstd` 是**两个不同的缓存条目**
  （**行为正确**，只是命中率略低）⇒ **别把命中率低怪成「缓存坏了」**。

---

## 配套文档

- `deploy/nginx.ziyun.pudafo.com.conf` — **模板**，本手册要合并进去的指令原型
- `deploy/nginx-brotli.conf` — brotli 片段（**手动 opt-in**，主配置**不**自动 include）
- `deploy/README.md` — 部署流程
- `DEPLOY.md`（项目根）— 完整部署指南
