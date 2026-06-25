# 生产部署指南

> 适用:字·韵 v1 (Plan A+) — Next.js 15 + React 19 + MySQL 5.7+
> 反向代理:任意 HTTP 1.1 + WebSocket 兼容的反向代理 (Nginx / Caddy / Apache / Cloudflare / 阿里云 SLB)

## 1. 服务器最小要求

| 资源 | 最低 | 推荐 | 说明 |
|---|---|---|---|
| CPU | 1 vCPU | 2+ vCPU | PDF 生成 / 批量 AI 调用时峰值 |
| RAM | 2 GB | 4+ GB | Next.js 进程 + mysql2 连接池 (limit 10) |
| 磁盘 | 5 GB | 20+ GB | Up/ 438M + node_modules/ ~400M + MySQL 数据 |
| MySQL | 5.7+ | 8.0+ | 字符集 `utf8mb4` / 排序 `utf8mb4_unicode_ci` |

## 2. 部署步骤

```bash
# 1. 解压
unzip Up.zip
cd Up   # 或 mv Up pinyin-character

# 2. 装依赖
npm install --omit=dev

# 3. 配置 .env (先复制模板)
cp .env.example .env
nano .env    # 至少改 DATABASE_URL / JWT_SECRET / COOKIE_SECURE

# 4. 构建 + 启动
npm run build
HOST=127.0.0.1 npm start    # 只 listen 在 127.0.0.1,反代访问
```

**首次启动**访问 `http://your-server/` 会被中间件重定向到 `/init`,按向导三步走:
1. 数据库连接
2. 管理员账号
3. 初始化数据 (poems / sutras / chars / activate singleton)

完成后 `setup_completed=true` 写入 `app_config`,wizard 锁死。

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
- `/api/tts`  `maxDuration = 30s` (TTS 合成)
- 字帖 PDF 生成  3-10s
- `/api/worksheets/.../can-print`  Edge TTS WebSocket 流式

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
location /font/        { proxy_pass http://127.0.0.1:4444; expires 1y; add_header Cache-Control "public, immutable"; }
location /fonts/       { proxy_pass http://127.0.0.1:4444; expires 1y; add_header Cache-Control "public, immutable"; }
location /logo.png     { proxy_pass http://127.0.0.1:4444; expires 1d; }
location /favicon.ico  { proxy_pass http://127.0.0.1:4444; expires 1d; }
location /manifest.json { proxy_pass http://127.0.0.1:4444; expires 1d; }
```

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
    location /font/        { proxy_pass http://pinyin_app; expires 1y; add_header Cache-Control "public, immutable"; }
    location /fonts/       { proxy_pass http://pinyin_app; expires 1y; add_header Cache-Control "public, immutable"; }
    location /logo.png     { proxy_pass http://pinyin_app; expires 1d; }
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

| # | 检查 | 怎么验 |
|---|---|---|
| 1 | `setup_completed` cookie 是 `Secure` | 浏览器 DevTools → Application → Cookies,看 `Secure` 列打勾 |
| 2 | 静态资源被反代 cache | `curl -I https://your.domain/strokes/一.png` 看到 `Cache-Control: public, immutable` |
| 3 | WebSocket 通 | 打开 `/worksheet/...` 打印页,看 console **无** `WebSocket connection failed` |
| 4 | audit_log 记的是真 IP | 登录后到 `/admin/downloads`,看 IP 列是你的真实 IP (不是 `127.0.0.1` 也不是反代 IP) |
| 5 | `/api/init/*` 被限流 | 用脚本狂发,429 出现 |
| 6 | sitemap 域名对 | `https://your.domain/sitemap.xml` 里的 URL 都是 `https://your.domain/...` 不是 `localhost:3000` (要先去 admin 后台配 `NEXT_PUBLIC_SITE_URL`) |
| 7 | `/init` 三步全跑通 | 浏览器走完 DB → admin → seed 三步,看到绿色"完成"卡 |

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

# 2. 拉新代码
git pull origin main

# 3. 重新打包部署
#    (或者直接覆盖 Up/ 目录的对应文件,因为是单仓部署)

# 4. 装新依赖 + 重新构建
npm install --omit=dev
npm run build

# 5. 重启 (假设用 pm2 / systemd)
pm2 restart pinyin
# 或
systemctl restart pinyin

# 6. 如果有 schema 变更,跑一次手动 migrate
npx tsx scripts/migrate.ts
```

**注意**: `/init` 走完后会自动锁住 (`setup.route_enabled=false`)。下次再想跑 `/init` (例如全新 DB 恢复),需要 admin 登录后到 `/admin/settings/setup` 把它打开,或者直接清掉 `app_config` 里的 `setup.completed` flag。
