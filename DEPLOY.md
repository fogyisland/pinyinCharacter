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
# 1. 在**开发机**生成部署包 (排除 node_modules / .next / .git / .env / Up/ 等)
python scripts/copy-to-up.py
# 输出 ./Up/ 目录,约 387 MB / 10k 文件
# (旧版 Up.zip 已废弃;如需 zip 可在 Up/ 目录上自行 zip -r)

# 2. 上传 Up/ 到服务器
rsync -avz --progress Up/ user@server:/opt/pinyin-character/

# 3. 在服务器装依赖
cd /opt/pinyin-character
npm install --omit=dev

# 4. 配置 .env (先复制模板)
cp .env.example .env
nano .env    # 至少改 DATABASE_URL / JWT_SECRET / COOKIE_SECURE

# 5. 构建 + 启动
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

> **生产域名 `ziyun.pudafo.com` 的具体反代配置见 [`deploy/nginx.ziyun.pudafo.com.conf`](deploy/nginx.ziyun.pudafo.com.conf)** —— 已包含 Let's Encrypt 路径、TLS 协议套件、Cloudflare CDN 真实 IP 段占位、HTTPS→HTTP 重定向,直接 `cp` 到 `/etc/nginx/sites-available/` 即可。配套流程见 [`deploy/README.md`](deploy/README.md)。

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

# 2. 拉新代码 (开发机或服务器上都行)
git pull origin main

# 3. 重新打包部署
#    开发机: python scripts/copy-to-up.py 然后 rsync Up/ 到服务器
#    或者:   直接覆盖服务器上 Up/ 目录的对应文件(单仓部署,git pull 后 up-to-date)

# 4. 装新依赖 + 重新构建
npm install --omit=dev
npm run build

# 5. 重启 (假设用 pm2 / systemd)
pm2 restart pinyin
# 或
systemctl restart pinyin

# 6. **必跑** schema 迁移 — scripts/migrate.ts 跑 scripts/migrations/ 下所有 SQL,
#    每个文件幂等 (MODIFY COLUMN / CREATE IF NOT EXISTS / 条件 ALTER),
#    即使没新迁移也是 no-op,可以每次升级都跑一次
npx tsx scripts/migrate.ts
```

**注意 1**: `/init` 走完后会自动锁住 (`setup.route_enabled=false`)。下次再想跑 `/init` (例如全新 DB 恢复),需要 admin 登录后到 `/admin/settings/setup` 把它打开,或者直接清掉 `app_config` 里的 `setup.completed` flag。

**注意 2 (schema 兼容)**: `scripts/init-db.ts` 已切换为 **slim schema** —— `chars` 表只有结构列 (`char` / `level` / `pinyin` / `radical` / `stroke_count` / `unicode_codepoint`),LLM 生成的内容 (meaning_zh / meaning_en / pinyin_alt / variants / etymology_story) 已迁到 `data/content/<char>.json` 文件。`lib/content.ts` 读路径优先 JSON、legacy fallback 仍兼容老 rich schema (16+ 列),所以**老库不用迁移也能跑**,但建议跑一次 `scripts/migrate.ts` + 重导 `data/content/` 以彻底对齐。

## 8. 近期 schema 变更清单 (运维参考)

升级后如果遇到字段缺失 / ENUM 报错,对照下表确认是否缺迁移。所有迁移在 `scripts/migrations/` 下,文件名前缀是日期 (YYYY-MM-DD-...):

| 日期 | 文件 | 内容 | 影响 |
|---|---|---|---|
| 2026-06-18 | `...-cell-style-cross.sql` | `worksheets.cell_style` 加 `cross` | 老库保存 worksheet 时 ENUM 报错 |
| 2026-06-18 | `...-multi-worksheet-print-feature.sql` | 字帖批量打印相关 | 不跑功能缺失 |
| 2026-06-19 | `...-brush-paper-size.sql` | `worksheets.paper_size` 加 brush-12/24/28 | 选毛笔纸型保存失败 |
| 2026-06-19 | `...-sutra-copy-progress.sql` | 新增 `sutra_copy_progress` 表 | 抄经模式进度保存失败 |
| 2026-06-20 | `...-classics.sql` | `classics` 加 category/era/source 列 | 古籍列表缺失分类 |
| 2026-06-20 | `...-worksheet-tool-presentation-split.sql` | cell_style ENUM 加 brush-/pen-square/cross | 选新格子样式保存失败 |
| 2026-06-22 | `...-cell-style-trace.sql` | cell_style ENUM 加 brush-trace-square/cross | 描红模式保存失败 |
| 2026-06-23 | `...-downloads-user-agent.sql` | `downloads` 加 `user_agent` 列 | 审计溯源不齐 |
| 2026-06-23 | `...-email-send-history.sql` | 新增 `email_send_history` 表 | 邮件发送历史缺失 |
| 2026-06-23 | `...-scheduler-run-history.sql` | 新增 `scheduler_run_history` 表 | 定时任务执行历史缺失 |
| 2026-06-25 | `...-platform-activation.sql` | 新增 `activate` 表(平台激活 + 云端心跳) | 多副本激活锁缺失 |
| 2026-06-27 | `...-email-campaigns.sql` | 新增 `email_campaigns` + `email_campaign_recipients` + `users.marketing_opt_out` 列 | 营销广播功能缺失 |
| 2026-06-27 | `...-email-verification.sql` | 新增 `email_verifications` 表 | 邮箱验证功能缺失 |
| 2026-06-28 | `...-era-font-defaults.sql` | 写入 5 条 era.*.font 默认 app_config | 字源朝代字体配置空 |
| 2026-06-29 | `...-audio-tracks.sql` | 新增 `audio_tracks` 表 | 佛经音频播放器缺失 |
| 2026-06-29 | `...-playlists.sql` | 新增 `playlists` + `playlist_tracks` 表 | 佛经音频播放列表缺失 |
| 2026-07-04 | `...-hsk-level.sql` | `chars` 加 `hsk_level` TINYINT 列 + 索引 | `/game` HSK 1-6 难度筛选全空 |

**不在 SQL 迁移里的变更** (运行时行为变化,不需要 SQL):
- `data/content/<char>.json` 成为内容单一来源 (取代 chars 表的内容列)
- `classics` 表的 `chunks` / `chunk_count` 列已 drop,内容迁到 `data/classics/<slug>.json`
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

## 9. 种子数据补全 (首次部署必跑)

`/init` 三步向导**只**会写入 schema + poems/sutras/chars 三个表 + app_config + activate singleton。以下数据**不在 `/init` 范围内**,首次部署完成 `/init` 后必须手工跑这些脚本(每个都幂等):

```bash
# 1. HSK 等级标定 (2632 个 HSK 1-6 字写入 chars.hsk_level)
#    /game 难度筛选依赖此列;不跑的话 HSK 1-6 chip 都返回 0 字
npx tsx scripts/import-hsk.ts
#    数据来源:data/hsk-vocab.json (HSK 2.0 official, 2632 chars)

# 2. 古籍导入 (196 本写入 classics 表)
#    /ancient 页面依赖此表;不跑的话 /ancient 显示空
npx tsx scripts/build-classics.ts && \
npx tsx scripts/build-classics-guwendao.ts && \
npx tsx scripts/build-pianwen.ts
#    数据来源:data/classics/<slug>.json (190+ books)

# 3. 字源 etymology_story + era_*_has 标记 (~7905 字)
#    /etymology 页面依赖此表 + data/era-coverage.json
npx tsx scripts/import-content.ts
npx tsx scripts/build-era-coverage.ts   # 生成 data/era-coverage.json (slim-DB fallback)
#    数据来源:data/content/<char>.json (7905 个文件)

# 4. 罕用字 (1412 个,写入 rare_chars 表)
#    ⚠️ 仓库里暂无 seeder 脚本 —— /rare-chars 页面首次部署会显示空列表
#    需要从历史备份恢复,或补一个 scripts/import-rare-chars.ts
```

### 9.1 升级已运行的生产环境

如果之前已经手工跑过这些脚本,升级时无需重跑(脚本都是 INSERT ... ON DUPLICATE KEY 幂等)。建议每季度跑一次 `scripts/show-stats.ts` + `scripts/check-progress.ts` 检查:

- `chars.hsk_level` 是否还有 NULL(应为 5278 NULL = 7910 - 2632,非 HSK 字,正常)
- `rare_chars` 行数是否还是 1412(没有缺失)
- `classics` 行数是否与 `ls data/classics/ | wc -l` 一致(都是 196)
- `data/era-coverage.json` 是否存在(不跑 `build-era-coverage` 的话 slim-DB 字源页面会慢很多)
