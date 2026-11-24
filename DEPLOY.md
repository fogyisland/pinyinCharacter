# 生产部署指南

> 适用:字·韵 v1 (Plan A+) — Next.js 15 + React 19 + MySQL 5.7+
> 反向代理:任意 HTTP 1.1 + WebSocket 兼容的反向代理 (Nginx / Caddy / Apache / Cloudflare / 阿里云 SLB)

## 1. 服务器最小要求

| 资源  | 最低   | 推荐    | 说明                                         |
| ----- | ------ | ------- | -------------------------------------------- |
| CPU   | 1 vCPU | 2+ vCPU | PDF 生成 / 批量 AI 调用时峰值                |
| RAM   | 2 GB   | 4+ GB   | Next.js 进程 + mysql2 连接池 (limit 10)      |
| 磁盘  | 5 GB   | 20+ GB  | Up/ 438M + node_modules/ ~400M + MySQL 数据  |
| MySQL | 5.7+   | 8.0+    | 字符集 `utf8mb4` / 排序 `utf8mb4_unicode_ci` |

## 2. 部署步骤

```bash
# 1. 在**开发机**生成部署包 (排除 node_modules / .next / .git / .env / Up/ 等)
python scripts/copy-to-up.py
# 输出 ./Up/ 目录,约 387 MB / 10k 文件
# (旧版 Up.zip 已废弃;如需 zip 可在 Up/ 目录上自行 zip -r)

# 2. 上传 Up/ 到服务器
rsync -avz --progress Up/ user@server:/opt/pinyin-character/

# 3. 在服务器装依赖
cd /opt/pinyin-character
npm ci --omit=dev --legacy-peer-deps
#    `npm ci` 严格按 package-lock.json 装,可复现;--omit=dev 跳过 dev 依赖。
#    ⚠️ 别用 `npm install --omit=dev`:它会顺手改写 package-lock.json,
#    服务器上的 lock 与仓库漂移,下次升级 `npm ci` 就会失败。
#    ⚠️ 别漏掉 --legacy-peer-deps:本项目的 peer 依赖树有冲突,
#    不加这个参数 npm 会直接拒绝安装。
#    字体构建工具链 (subset-font / typescript / tsx) 已经是生产依赖,
#    --omit=dev 也会装上,不用单独装。

# 4. 配置 .env (先复制模板)
cp .env.example .env
nano .env    # 至少改 DATABASE_URL / JWT_SECRET / COOKIE_SECURE

# 5. 构建 + 启动
npm run build:clean
HOST=127.0.0.1 npm start    # 只 listen 在 127.0.0.1,反代访问
```

**首次启动**访问 `http://your-server/` 会被中间件重定向到 `/init`,按向导三步走:

1. 数据库连接 —— 填 MySQL host/port/user/password/db,向导会写好服务器上的 `.env`
   (`DATABASE_URL` + 自动生成的 `JWT_SECRET` + `COOKIE_SECURE`),**不需要手改任何配置文件**
2. 管理员账号 —— 创建第一个管理员
3. 初始化数据 —— 一键跑完 12 个阶段

第 3 步的阶段顺序是 `表结构 → 配置 → 各数据集导入 → 管理员 → 激活 → **迁移** → **种子**`,
最后两个阶段最关键,别跳:

- **迁移** (`/api/init/migrate` → `scripts/migrations/*.sql`,23 个文件,幂等)
  负责把 schema 补到当前代码的样子 —— `chars.hsk_level`、`playlists`、`audio_tracks`、
  `page_views`、`mcp_tokens`、`webfont_build_jobs` 等列和表都是这一步加的。
  **少了这一步,代码读不存在的表会整页 RSC 崩掉(表现为 404/503)。**
- **种子** (`/api/init/seed` → `lib/seed-runner.ts`)
  负责把数据填到位 —— 其中 `hsk-grading` 这一项批量写 `chars.hsk_level`
  (2632 个字),不做的话游戏区每个关卡都返回 `503 hsk_level_not_imported`。

> 迁移只加结构,种子只填数据,**两者都不是「部署脚本」自动做的** ——
> 它们由 `/init` 向导的第 3 步调用。走向导 = 两者都做了。
> 如果跳过向导直接在旧库上升级,请手动跑 `npm run db:migrate` + `npm run seed:run`。

完成后 `setup_completed=true` 写入 `app_config`,wizard 锁死,`/init` 路径返回「已完成」卡片。

## 3. 反向代理关键配置

### 3.1 TLS 与 Cookie

`lib/env.ts` 在生产环境会**强制** `COOKIE_SECURE=true`。所以:

- 反代必须做 TLS 终止 (Let's Encrypt / Cloudflare 证书)
- 后端 Node 进程**只** listen 在 `127.0.0.1:4444`,不直接对外
- `Secure` cookie 才能被浏览器接受,否则登录后立刻被丢

### 3.2 端口与协议

- App 固定 listen `:4444` (package.json 里 `next start -p 4444`)
- 反代 → `proxy_pass http://127.0.0.1:4444;`
- 反代必须支持 HTTP/1.1 + WebSocket Upgrade

### 3.3 客户端体量限制 — `client_max_body_size 500m`

> ⚠️ **必须**设为 `500m`,**不要**用默认 `1m`,**不要**用之前常写的 `10m`。
>
> 本项目内置的 `data/` 目录合计约 **280 MB** (古籍原文) + 33 MB 笔顺 + 101 MB 笔刷字体。这些是**只读** JSON/资源,不走 HTTP,不影响 body 限制。
>
> 但是 `lib/env.ts` Rule 3 校验会拒绝 `DATABASE_URL` 指向 `piyin_dev` / `127.0.0.1` / `localhost`,意味着任何备份恢复、批量 seed、字典全量导入都必须能走 HTTP (例如未来的 `/api/admin/restore` / 全量 chars 导入端点)。
>
> 安全值 `500m` 给将来留余地 (单次 POST 上传一个完整的内容包、批量 import 等);`100m` 在某些大数据恢复场景会不够。`1g` 也可以,但 Nginx 内存会随之涨,没必要。

```nginx
client_max_body_size 500m;
```

### 3.4 超时时间

下列端点耗时较长:

- `/api/tts` `maxDuration = 30s` (TTS 合成)
- 字帖 PDF 生成 3-10s
- `/api/worksheets/.../can-print` Edge TTS WebSocket 流式

```nginx
proxy_read_timeout 120s;
proxy_send_timeout 120s;
```

### 3.5 WebSocket 透传 (关键)

`/api/worksheets/[id]/can-print` 走 ws (Edge TTS 流式)。普通 HTTP 1.1 代理会直接挂掉,字帖打印页 console 报 `WebSocket connection failed`,但其他功能看似正常,容易忽略。

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 3.6 静态资源缓存 (强烈建议)

`public/strokes/` (33 MB) + `public/fonts/` (101 MB) + `public/font/` (22 MB) 都是**只读、永不过期**。不直接让 Nginx serve 并加 `expires`,每个用户首次访问都要从 Node 拉几百 MB,Node 内存会爆。

```nginx
location /_next/static/ { proxy_pass http://127.0.0.1:4444; expires 1y; add_header Cache-Control "public, immutable"; }
location /strokes/     { proxy_pass http://127.0.0.1:4444; expires 1y; add_header Cache-Control "public, immutable"; }
# ⚠️ /font/ 分两层。/font/web/ 是发布目录(r<令牌>/…),里面的 woff2 按内容哈希命名
#    ⇒ URL 字节永不变 ⇒ 一年 immutable;/font/ 的其余部分(fonts-*.css 与
#    fonts-manifest.json)会被重建替换 ⇒ 30 天。两个块都**不用** `expires`
#    (它自己会再生成一个 Cache-Control ⇒ 两个头)。长前缀在前。
# ⚠️ 线上 /font/** 的响应头其实是 Next.js 发的(next.config.ts 的 headers()),
#    本块对 /font/ 不生效 —— 这段是「照抄给别的部署用」的参考,不是线上现状。
# ⚠️ /font/ 一旦由 Nginx 接管,Next.js 的 headers() 就管不着这一层
#    ⇒ 两层 TTL 必须在 Nginx 侧配对。
location /font/web/   { proxy_pass http://127.0.0.1:4444; add_header Cache-Control "public, max-age=31536000, immutable" always; }
location /font/       { proxy_pass http://127.0.0.1:4444; add_header Cache-Control "public, max-age=2592000" always; }
location /fonts/      { proxy_pass http://127.0.0.1:4444; expires 1y; add_header Cache-Control "public, immutable"; }
location /logo.png     { proxy_pass http://127.0.0.1:4444; expires 1d; }
location /logo-sm.webp { proxy_pass http://127.0.0.1:4444; expires 30d; }
location /logo-sm.png  { proxy_pass http://127.0.0.1:4444; expires 30d; }
location /favicon.ico  { proxy_pass http://127.0.0.1:4444; expires 1d; }
location /manifest.json { proxy_pass http://127.0.0.1:4444; expires 1d; }
```

> ⚠️ **`/font/`(无 s)与 `/fonts/`(有 s) 是两条不同的路径、不同的目录**:`/font/` 是
> 子集 woff2 + 样式表(22 MB),`/fonts/` 是 OFL 笔刷字体(196 MB)。上面**只有 `/font/`
> 与 `/font/web/` 走两层**,`/fonts/` 仍是一年 immutable(那些文件的 URL 字节永不变)。
> ⚠️ 另外:**`deploy/nginx.ziyun.pudafo.com.conf` 是参考模板**,它的 `alias` +
> `try_files $uri` 组合会 **404 整个静态树** ⇒ **不许原样安装**,只手工合并需要的那几行。
> ⚠️ 完整字体验收流程见 [`deploy/OPTIMIZATION.md`](deploy/OPTIMIZATION.md)。

### 3.7 真实 IP 透传

`audit_log.ip` 字段、所有 admin 操作日志都从 `X-Forwarded-For` 第一段取 IP。所以:

- 反代必须**正确设置** `X-Forwarded-For`,且**只信任你自己的反代**
- Cloudflare / 阿里云 CDN 之类要在 Nginx 设 `set_real_ip_from <CDN IP 段>`,否则 audit_log 记的全是 CDN 节点 IP
- 不要让客户端直接连后端 :4444(防火墙挡)

### 3.8 限流 — 公开端点必须限流

`/api/auth/*` 和 `/api/init/*` 没内置限流,反代必须限:

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;

location /api/auth/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://127.0.0.1:4444; }
location /api/init/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://127.0.0.1:4444; }
```

> **生产域名 `ziyun.pudafo.com` 的具体反代配置见 [`deploy/nginx.ziyun.pudafo.com.conf`](deploy/nginx.ziyun.pudafo.com.conf)** —— 已包含 Let's Encrypt 路径、TLS 协议套件、Cloudflare CDN 真实 IP 段占位、HTTPS→HTTP 重定向。⚠️ **这是模板,不是线上跑的那份** —— 线上那份的真实路径从未实测过(用 `sudo nginx -T` 输出里的 `# configuration file <路径>:` 行读出),**不要整份覆盖**:先按 [`deploy/OPTIMIZATION.md`](deploy/OPTIMIZATION.md) 对账、备份,**只把需要的指令合并进线上那份**。配套流程见 [`deploy/README.md`](deploy/README.md)。

## 4. 完整 Nginx 示例

```nginx
upstream pinyin_app {
    server 127.0.0.1:4444;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name your.domain.com;

    ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;

    # 如果走 Cloudflare / 阿里云 CDN,解注下面两行 + 填入 CDN IP 段
    # set_real_ip_from 173.245.48.0/20;
    # set_real_ip_from 103.21.244.0/22;
    # real_ip_header X-Forwarded-For;

    # 必须 500m:为将来批量内容导入、备份恢复留余地
    client_max_body_size 500m;

    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;

    # 静态资源:直接由 Nginx serve 并加 1 年 immutable 缓存
    location /_next/static/ { proxy_pass http://pinyin_app; expires 1y; add_header Cache-Control "public, immutable"; }
    location /strokes/     { proxy_pass http://pinyin_app; expires 1y; add_header Cache-Control "public, immutable"; }
    # ⚠️ /font/ 分两层,理由见 3.6 的说明(与上面那块一样,只是 upstream 不同)
    location /font/web/   { proxy_pass http://pinyin_app; add_header Cache-Control "public, max-age=31536000, immutable" always; }
    location /font/       { proxy_pass http://pinyin_app; add_header Cache-Control "public, max-age=2592000" always; }
    location /fonts/      { proxy_pass http://pinyin_app; expires 1y; add_header Cache-Control "public, immutable"; }
    location /logo.png     { proxy_pass http://pinyin_app; expires 1d; }
    location /logo-sm.webp { proxy_pass http://pinyin_app; expires 30d; }
    location /logo-sm.png  { proxy_pass http://pinyin_app; expires 30d; }
    location /favicon.ico  { proxy_pass http://pinyin_app; expires 1d; }
    location /manifest.json { proxy_pass http://pinyin_app; expires 1d; }

    # 限流公开端点
    location /api/auth/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://pinyin_app; }
    location /api/init/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://pinyin_app; }

    # 默认:全部其它走 Node
    location / {
        proxy_pass http://pinyin_app;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

## 5. 部署后自检清单

| #   | 检查                                 | 怎么验                                                                                                                                       |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `setup_completed` cookie 是 `Secure` | 浏览器 DevTools → Application → Cookies,看 `Secure` 列打勾                                                                                   |
| 2   | 静态资源被反代 cache                 | `curl -I https://your.domain/strokes/一.png` 看到 `Cache-Control: public, immutable`                                                         |
| 3   | WebSocket 通                         | 打开 `/worksheet/...` 打印页,看 console **无** `WebSocket connection failed`                                                                 |
| 4   | audit_log 记的是真 IP                | 登录后到 `/admin/downloads`,看 IP 列是你的真实 IP (不是 `127.0.0.1` 也不是反代 IP)                                                           |
| 5   | `/api/init/*` 被限流                 | 用脚本狂发,429 出现                                                                                                                          |
| 6   | sitemap 域名对                       | `https://your.domain/sitemap.xml` 里的 URL 都是 `https://your.domain/...` 不是 `localhost:3000` (要先去 admin 后台配 `NEXT_PUBLIC_SITE_URL`) |
| 7   | `/init` 三步全跑通                   | 浏览器走完 DB → admin → seed 三步,看到绿色"完成"卡                                                                                           |

### 5.1 依赖安全现状（`npm audit`）

生产依赖树是干净的:

```bash
npm audit --omit=dev     # → found 0 vulnerabilities
```

这是**唯一有意义的口径** —— 它正是服务器上 `npm ci --omit=dev --legacy-peer-deps` 装出来的那棵树。

全树 audit（含 devDependencies）会报 **16 个 high**,但它们**全部**来自同一条链:

```
picomatch@4.0.7  ReDoS (GHSA-fc5q-39xc-vjpf, CVSS 7.5)
  └─ tinyglobby ─┬─ vitest / @vitest/ui
                 ├─ @typescript-eslint/*
                 └─ eslint-import-resolver-typescript
picomatch@2.3.2  (同上,经 fast-glob → micromatch)
  └─ @next/eslint-plugin-next → eslint-config-next
```

**这 16 条目前无法修复**,原因不是本项目的配置,而是上游:

| 事实 | 证据 |
| --- | --- |
| `picomatch` 最新版就是 `4.0.7`(2026-08-24 发布) | `npm view picomatch dist-tags` → `latest: 4.0.7` |
| 通告的漏洞区间是 `<=4.0.7` —— **最新版自己也在区间内** | `npm view picomatch versions` → 全部版本都 ≤ 4.0.7 |
| 所有 `tinyglobby` 版本都依赖 `picomatch@^4.x` | `npm view tinyglobby@0.2.14…0.2.17 dependencies.picomatch` |
| `vitest@5.1.0` 仍依赖 `picomatch@^4.0.7` | `npm view vitest@5.1.0 dependencies` |
| `vite@9` 才彻底移除 picomatch,但 `vitest@5` 的 peer 范围还不允许 vite 9 | `vitest@5.1.0` peer `vite: ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| `npm audit fix --force` 的建议是**降级到 vitest@3.1.4** | 会丢掉当前测试运行器,不值得 |

**风险评估:可忽略**,理由:

1. **不进生产树** —— `npm ls picomatch --omit=dev` 返回 `(empty)`。服务器上根本不装。
2. **本项目从不直接调用 picomatch** —— `grep -rn picomatch app lib scripts components` 为空。
3. **ReDoS 需要攻击者控制的 glob 模式** —— 而这里的 glob 全部来自仓库里的测试文件和源码配置(开发者可控),不是用户输入。
4. 影响面仅限开发机上的 lint / test 工具链。

**待上游修复后应做的**:升级 `vitest` 到首个不再依赖 `picomatch@4.x` 的版本
(或 `vite@9` 进入 vitest 的 peer 范围后一并升),然后重跑 `npm audit` 确认归零。
在此之前不要为了「消灭 audit 计数」而降级 vitest。

## 6. 常见踩坑

- **漏掉 WebSocket 的 `Upgrade` 头** → 字帖打印页 console 报 `WebSocket connection failed`,其他功能都正常,容易忽略
- **`client_max_body_size` 默认 1m** → 任何稍大的 POST 直接 413,反代层报错很难追到
- **没设 `set_real_ip_from`** → audit_log 全记 CDN 节点 IP,追不到人
- **`:4444` 端口对外开着** → 绕过反代的安全措施,审计/限流全部失效
- **静态资源全走 Node** → 笔刷字体 101 MB 一次拉,Node 内存直接 OOM

## 7. 升级流程

```bash
# 1. 备份
mysqldump -uroot -p pinyin > backup-$(date +%F).sql

# 2. 拉新代码 (开发机或服务器上都行)
git pull origin main

# 3. 重新打包部署
#    开发机: python scripts/copy-to-up.py 然后 rsync Up/ 到服务器
#    或者:   直接覆盖服务器上 Up/ 目录的对应文件(单仓部署,git pull 后 up-to-date)

# 4. 装新依赖 + 重新构建
npm ci --omit=dev --legacy-peer-deps
#    同首次部署:`npm ci` 严格按 lock 装,`--legacy-peer-deps` 不能省。
#    字体构建工具链 (subset-font / typescript / tsx) 已经是生产依赖,
#    --omit=dev 也会装上,不用单独装。
npm run build:clean
#    `build:clean` 先删 `.next/cache` 再构建 —— 服务器上不会跑第二次构建,
#    增量缓存没有价值,只会白占磁盘(实测本机 `.next/cache` 达 718 MB,
#    而 `.next` 总共 847 MB)。产物完全一致。

# 5. 重启 (假设用 pm2 / systemd)
pm2 restart pinyin
# 或
systemctl restart pinyin

# 6. **必跑** schema 迁移 — scripts/migrate.ts 跑 scripts/migrations/ 下所有 SQL,
#    每个文件幂等 (MODIFY COLUMN / CREATE IF NOT EXISTS / 条件 ALTER),
#    即使没新迁移也是 no-op,可以每次升级都跑一次
#
#    用 npm run db:migrate,不要直接 `npx tsx scripts/migrate.ts`:
#    npm 不会读 .env,只有 Next.js 启动时才读。npm 脚本里带了
#    --env-file-if-exists=.env,脚本才能拿到 DATABASE_URL。
npm run db:migrate

# 7. **必跑** 内容 seed 补齐 — 把仓库 data/ 里的内容灌进数据库。
#    幂等:只补差额,不会删掉你手动加的行。可以重复跑。
#    先看缺口再补:
npm run seed:run -- --dry-run
npm run seed:run
```

### 7.1 后台一键补齐(不用登录服务器)

第 6、7 步也可以在后台点一下完成 —— 适合没有 shell 权限、或者忘了跑命令的情况:

| 后台页面 | 能做什么 |
|---|---|
| `/admin/seed` 的 **数据结构** 面板 | 逐表逐列对比数据库与代码声明的结构,**点名**缺了什么(缺哪张表、缺哪个列、该由哪个迁移文件创建),点「运行迁移」一键补齐 |
| `/admin/seed` 的 **数据集** 面板 | 内容 seed 的缺口与补齐 |
| `/admin/init` 的 **必需表** 检查项 | 同一套结构对比,直接点名缺表/缺列;探测失败时显示为**失败**而不是伪装成通过 |

两个面板背后的结构期望不是手写的清单,而是从仓库自身推导出来的(`scripts/init-db.ts` 的基础 DDL + `scripts/migrations/*.sql`),所以代码加了表或列,面板会跟着知道。迁移本身幂等 —— 没有新变更时点「运行迁移」不会改动任何东西。

> **复制代码上去不会自动升级 schema。** `/init` 向导走完后会自锁 (`setup.route_enabled=false`),而启动时的 `initDb()` 只建基础表、不读 `scripts/migrations/*.sql`。所以每次升级仍然要跑第 6 步(或用上面的后台面板)。漏掉这一步的症状很隐蔽:网站照常运行,只有用到新表的那一块报 `ER_NO_SUCH_TABLE`。

**注意 1**: `/init` 走完后会自动锁住 (`setup.route_enabled=false`)。下次再想跑 `/init` (例如全新 DB 恢复),需要 admin 登录后到 `/admin/settings/setup` 把它打开,或者直接清掉 `app_config` 里的 `setup.completed` flag。

**注意 2 (schema 兼容)**: `scripts/init-db.ts` 已切换为 **slim schema** —— `chars` 表只有结构列 (`char` / `level` / `pinyin` / `radical` / `stroke_count` / `unicode_codepoint`),LLM 生成的内容 (meaning_zh / meaning_en / pinyin_alt / variants / etymology_story) 已迁到 `data/content/<char>.json` 文件。`lib/content.ts` 读路径优先 JSON、legacy fallback 仍兼容老 rich schema (16+ 列),所以**老库不用迁移也能跑**,但建议跑一次 `npm run db:migrate` + 重导 `data/content/` 以彻底对齐。

**注意 3 (脚本读不到 DATABASE_URL)**: `npm` **不会**读 `.env` —— 只有 Next.js 启动时才加载它。所以从 shell 里跑的脚本(`npm run db:migrate`、`npm run seed:run`、`npm run build:classics` 等)必须自己带 `--env-file-if-exists=.env`,这也是这些 npm 脚本的写法。直接跑 `npx tsx scripts/migrate.ts` 会报 `DATABASE_URL is not set`,而网站却好好地连着库 —— 看到这个报错就改用 `npm run db:migrate`。

## 8. 近期 schema 变更清单 (运维参考)

升级后如果遇到字段缺失 / ENUM 报错,对照下表确认是否缺迁移。所有迁移在 `scripts/migrations/` 下,文件名前缀是日期 (YYYY-MM-DD-...):

| 日期       | 文件                                        | 内容                                                                                | 影响                            |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| 2026-06-18 | `...-cell-style-cross.sql`                  | `worksheets.cell_style` 加 `cross`                                                  | 老库保存 worksheet 时 ENUM 报错 |
| 2026-06-18 | `...-multi-worksheet-print-feature.sql`     | 字帖批量打印相关                                                                    | 不跑功能缺失                    |
| 2026-06-19 | `...-brush-paper-size.sql`                  | `worksheets.paper_size` 加 brush-12/24/28                                           | 选毛笔纸型保存失败              |
| 2026-06-19 | `...-sutra-copy-progress.sql`               | 新增 `sutra_copy_progress` 表                                                       | 抄经模式进度保存失败            |
| 2026-06-20 | `...-classics.sql`                          | `classics` 加 category/era/source 列                                                | 古籍列表缺失分类                |
| 2026-06-20 | `...-worksheet-tool-presentation-split.sql` | cell_style ENUM 加 brush-/pen-square/cross                                          | 选新格子样式保存失败            |
| 2026-06-22 | `...-cell-style-trace.sql`                  | cell_style ENUM 加 brush-trace-square/cross                                         | 描红模式保存失败                |
| 2026-06-23 | `...-downloads-user-agent.sql`              | `downloads` 加 `user_agent` 列                                                      | 审计溯源不齐                    |
| 2026-06-23 | `...-email-send-history.sql`                | 新增 `email_send_history` 表                                                        | 邮件发送历史缺失                |
| 2026-06-23 | `...-scheduler-run-history.sql`             | 新增 `scheduler_run_history` 表                                                     | 定时任务执行历史缺失            |
| 2026-06-25 | `...-platform-activation.sql`               | 新增 `activate` 表(平台激活 + 云端心跳)                                             | 多副本激活锁缺失                |
| 2026-06-27 | `...-email-campaigns.sql`                   | 新增 `email_campaigns` + `email_campaign_recipients` + `users.marketing_opt_out` 列 | 营销广播功能缺失                |
| 2026-06-27 | `...-email-verification.sql`                | 新增 `email_verifications` 表                                                       | 邮箱验证功能缺失                |
| 2026-06-28 | `...-era-font-defaults.sql`                 | 写入 5 条 era.*.font 默认 app_config                                                | 字源朝代字体配置空              |
| 2026-06-29 | `...-audio-tracks.sql`                      | 新增 `audio_tracks` 表                                                              | 佛经音频播放器缺失              |
| 2026-06-29 | `...-playlists.sql`                         | 新增 `playlists` + `playlist_tracks` 表                                             | 佛经音频播放列表缺失            |
| 2026-07-04 | `...-hsk-level.sql`                         | `chars` 加 `hsk_level` TINYINT 列 + 索引                                            | `/game` HSK 1-6 难度筛选全空    |
| 2026-07-05 | `...-notes.sql`                             | CREATE notes + notes_rate_limits                                                    | 留言笔记功能                    |

**不在 SQL 迁移里的变更** (运行时行为变化,不需要 SQL):

- `data/content/<char>.json` 成为内容单一来源 (取代 chars 表的内容列)
- `classics` 表的 `chunks` / `chunk_count` 列已 drop,内容迁到 `data/classics/<slug>.json`
- `data/classics/` 在**仓库里**也存成了 gzip(`data/classics/<slug>.json.gz`,196 个文件 251 MB → 39 MB)⇒ 仓库瘦身 212 MB。**读取路径不变**:`lib/json-fs.ts` 的 `readJsonAuto` 先试 `.json`、再试 `.json.gz`,发布包(`scripts/copy-to-up.py`)里也是同样的形态。⚠️ 若要改语料内容,先 `npm run classics:gzip -- --decompress` 展开成裸 `.json`,改完再 `npm run classics:gzip` 压回去。
  ⚠️ **构建期的脚本也必须认这两种形态**:任何遍历 `data/classics/` 的脚本都要走 `scripts/corpus-files.ts`(TypeScript)或 `scripts/fonts/corpus-files.mjs`(字体流水线),它们把 `.json` 和 `.json.gz` 一起列出来、同一本书只列一次。**只认 `.json` 的脚本会静默看到空目录**——字体字符集会少掉 10 970 个汉字(`npm run fonts:subset-web` 会切出一个画不了经典的字体,而且**没有任何一项会变红**),`data/classics-manifest.json` 会重建成空的(而 `scripts/init-db.ts` 正是用它灌 `classics` 表 ⇒ 新装一台机器一本书都没有)。
- `poems` 表同样迁到 `data/poems/<id>.json`(不影响字段,只是数据物理位置变化)
- 新增 SEO 路由:`/sitemap.xml`、`/sitemap-poetry.xml`、`/sitemap-ancient.xml`、`/sitemap-chars.xml`、`/robots.txt`(反代无需变更,Next.js 自动 serve)
- 新增 `deploy/nginx.ziyun.pudafo.com.conf`(具体域名配置模板)
- 新增 `scripts/copy-to-up.py`(取代旧的 `Up.zip` 打包流程,`data/classics/` + `data/content/` 自动 gzip)
- 新增 `scripts/audit/seed-check.js`、`scripts/audit/db.js`(运维检查工具)
- 新增 `/game` HSK 1-6 难度轴 + 6 档 progressive reveal(声调 / 部首 / 拼音接龙 三款小游戏)
- 新增 `/sutra/[id]` 抄经模式(同页 toggle + 点击入墨 + 印章)
- 新增 `/admin/settings/audio` 音频曲目管理 + 默认播放列表
- 新增 `/admin/settings/era-fonts` 字源朝代字体管理 + 写回 `app_config`
- 新增 TTS 朗读 + 缓存 (`lib/tts.ts` + `lib/tts-cache.ts`,浏览器 Cache API,5s AbortController)
- 新增 `data/era-coverage.json`(由 `scripts/build-era-coverage.ts` 生成,字源页面 slim-DB fallback 必需)
- 字帖生成器新增「英文描红」Tab(`WorksheetGenerator` 4 个 tab + `EnglishTraceTab` 组件 + A-Z/a-z 输入过滤 + 大小写切换)
- 字帖空模板新增 `钢笔·英文描红` 选项 + 4 线 SVG 分支(`WorksheetCell` + `PracticePDF` 共用)
- 字帖中心 `/worksheets` 支持多字帖 + 重命名 + 追加到现有 (`AddToWorksheetDialog`)
- 留言笔记 (`/notes` 公共墙 + `/admin/notes` 管理) — 表 `notes`, `notes_rate_limits`. 管理员邮箱通过 `app_config.notes.admin_emails` 配置(逗号分隔,空时回退到 `smtp.from`).

## 9. 种子数据 (自动补齐 + 手动导入)

**所有内容数据都是 seed。** 服务器启动时会自动把库里缺的补齐,不需要手工跑脚本。

内容数据集的期望规模定义在 `lib/seed-registry.ts` —— 它读仓库自己的数据文件
(`data/hsk-vocab.json`、`data/general-standard-chinese-characters.json`、`data/content/`、
`data/poems-manifest.json`、`data/classics/`、`data/sutras/`),是**唯一事实来源**。
`scripts/init-db.ts`、`/admin/init` 检查清单、`/admin/seed` 导入页、`npm run seed:run`
全部读它,所以这四处永远一致。

判定规则是「**够才算 seed**」:库里行数 ≥ 仓库行数才算完整,不足则自动补齐差额,
超出不删(管理员手动加的行不会被覆盖)。**旧的「有行就 skip」规则已废除** ——
那会让只导入了一半的库永远保持残缺,而所有检查项都显示「就绪」。

| 数据集 | 期望行数 | 目标表 | 缺失时的后果 |
|---|---|---|---|
| HSK 分级 | 2632 | `chars.hsk_level` | /game 闯关每关 404、每轮 503 |
| 通用规范汉字 | 7909 | `chars` | 字典与字库功能的基础表 |
| 罕用字 | 1409 | `rare_chars` | /rare-chars 显示「字库为空」 |
| 字源字体 | 7909 | `char_etymology` | 字源页无字形 |
| 诗词 | 1160 | `poems` | /poetry 为空 |
| 古籍 | 203 | `classics` | /ancient 为空 |
| 经文 | 11 | `sutras` | /sutra 为空 |

⚠️ **期望行数 = 库里应该实际持有的行数，而且这个数必须可达。**
- **7909**（不是源文件里的 8105）：源文件有 196 个补充平面字符（码位 > U+FFFF），
  mysql2 的二进制协议会弄坏 4 字节 UTF-8，所以导入器**有意**跳过它们。
- **1409**（不是 1412）：`rare_chars` 只取 `level === 3` 的字。另有 3 个字
  （`亍` / `尢` / `彳`）带 `rare.meaning` 但难度是 level 2，不在罕用字层。
- **11**（不是 12）：`data/sutras/` 是 11 部经文 + 一个索引它们的 `manifest.json`；
  索引不是经文。

期望值算得比可达上限高 ⇒ 缺口永远关不掉（seed 一直报 pending，后台一直催你补），
所以期望值的口径必须和导入条件一致。

### 9.1 自动补齐的触发点

`instrumentation.ts` → `isSetupComplete()` → `scripts/init-db.ts::initDb()` →
`lib/seed-runner.ts::runAllSeeds()`。**每次启动都跑**,缺什么补什么,幂等。
单项失败只记日志,**不阻塞启动**(一个数据集坏了不该让整站起不来)。

### 9.2 手动导入

后台:`/admin/seed` —— 列出每个数据集「仓库有多少 / 库里有多少」,可逐个或一次性补齐。

命令行:

```bash
# 查看缺口(只读,不写库)
npm run seed:run -- --dry-run

# 补齐全部缺口
npm run seed:run

# 只补某一个
npm run seed:run -- --only=hsk-grading

# 列出全部数据集及期望规模
npm run seed:run -- --list
```

### 9.3 检查内容是否齐备

`/admin/init` 的「初始化步骤」面板会报告 HSK 分级覆盖率和全部内容数据集的就绪状态。
生产环境下缺数据 = **红字(fail)**,开发环境 = 黄字(warn)。

### 9.4 升级已运行的生产环境

升级后**不需要**手工跑任何导入脚本 —— 新的启动流程会自动补齐。
想确认一下:

```bash
npm run seed:run -- --dry-run
```

`data/era-coverage.json` 是字源页 slim-DB fallback 的缓存文件,由
`scripts/build-era-coverage.ts` 生成,不是数据库 seed,升级时若该文件缺失需单独生成。

## 10. 微信公众号公告

用服务号模板消息把公告推送给公众号的关注者。**不是**群发消息 —— 群发需要
`message/mass/send` 权限且每月次数受限;模板消息走的是另一套接口。

### 10.1 公众号后台要做的三件事

1. **认证服务号** —— 订阅号没有模板消息权限,只有认证过的服务号有。
2. **服务器公网 IP 加入 IP 白名单** —— 公众号后台「设置与开发 → 基本配置 → IP 白名单」。
   不加的话接口会返回 `40164`,而且错误信息不会点名白名单,很难查。
3. **在「模板库」申请模板** —— 记下两样东西:**模板 ID** 和**字段名**
   （比如 `first` / `keyword1` / `thing2` / `remark`）。字段名必须与填的时候
   完全一致,多一个空格、少一个大小写,接口就会拒。

### 10.2 本站后台的配置

`/admin/wechat` —— 填 **AppID** 和 **AppSecret**,勾上「启用微信公告」。
AppSecret 只写不回显,留空表示不修改。

⚠️ 关注者人数是实时向微信拉的,页面加载后才出现。**如果显示 0 人**,说明
`user/get` 没拿到数据 —— 先查 IP 白名单,再查凭据,别急着发公告。

### 10.3 打开定时任务

`/admin/scheduler` —— 确认 **`wechat-broadcast-send`** 这个任务已启用,
并且**整个 scheduler 是开着的**。

⚠️ 两层开关,别只看一层:

- **`wechat-broadcast-send` 默认是开的**（`scheduler.task_wechat_broadcast` 默认 `'1'`）。
- ⚠️ **但 scheduler 本身默认是关的**（`scheduler.enabled` 默认 `'0'`）。
  整个 scheduler 关着的时候,任务开关设成什么都没用 —— 写完公告会一直
  排队不发。这个才是常见卡住的地方。

⚠️ **默认间隔是 60 分钟**,不是 1 分钟。要更快就把 `scheduler.interval_min`
调小（最小 1,最大 1440）。

### 10.4 流程

写公告 → 入队(status = `queued`) → scheduler tick 发出(`sent`)。
入队不等于发出,所以公告发出去之前还来得及取消。

### 10.5 两个必须知道的限制

1. ⚠️ **每日接口调用有额度**(各账号不同,以公众号后台「接口权限」页为准)。
   消耗 ≈ 发送人数 × 公告次数。额度用完会返回 `45009`,任务会停手不再重试。
2. ⚠️ **`errcode: 0` 只代表微信平台接受了消息**,不代表对方收到了。
   微信对模板消息不提供送达回执 —— 数据库里 `sent` 只说明平台收下了。
   要确认对方真的收到,得有人自己看手机。

### 10.6 出问题时先看哪里

| 现象 | 多半是 |
|---|---|
| `40164` | 服务器公网 IP 没进白名单 |
| `40013` | AppID 无效 —— 后台填的 AppID 不对 |
| `40001` | access_token 失效 —— AppID 与 AppSecret 不匹配,保存一次配置即可 |
| `40003` | openid 无效 —— 这个 openid 不存在 |
| `40037` | 模板 ID 不对 —— 公众号后台的模板 id 填错了 |
| `47003` | 模板不匹配 —— 模板 ID 不对,或字段名与模板里的字段名不一致(多一个空格、少一个大小写都会算) |
| `48001` | 接口未授权 —— 账号不是认证服务号,或后台还没开启模板消息权限 |
| `43101` | 这个用户不是关注者,跳过(不算失败) |
| `45009` | 每日额度用完了 |
| 关注者人数是 0 | 白名单或凭据;确认公众号确实有人关注 |

> ⚠️ 这张表和 `lib/wechat-api-error.ts` 是同一份错误码含义 —— 后台页面显示的就是
> 这里说的内容。改了一处就要改另一处,不然排查的人会被指到错的方向上去。
