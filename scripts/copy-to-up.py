import os
import shutil
import sys
import gzip

SRC = '.'
DST = './Up'

# rmtree(Up/) at start — re-runs are hermetic. (If Up/ doesn't exist yet,
# shutil.rmtree(..., ignore_errors=True) is a no-op.)
if os.path.exists(DST):
    shutil.rmtree(DST, ignore_errors=True)
os.makedirs(DST, exist_ok=True)

# Excludes — never copy these to the deploy bundle
EXCLUDE_DIRS = {
    'node_modules',
    '.next',
    '.git',
    '.claude',
    '.superpowers',
    'docs',              # Dev plans/specs — not needed in prod
    'backups',
    'data/runtime',
    'Up',                # Don't recurse into the output dir
    # public/strokes/ is TRACKED in git (as of 2026-07-09) — included in Up/
    # bundle so prod deploys skip the 10-min `npm run strokes:build` step.
    'playwright-report',
    'test-results',
    'coverage',
    'tests',             # Unit/integration tests — never ship
    '__tests__',         # Co-located test dirs — never ship
    '__mocks__',         # Jest-style mocks — never ship
    '.turbo',
    '.vscode',
    '.idea',
    '.tmp',              # Throwaway scratch (font screenshots, dev logs)
}

# Path-relative excludes (matched against relative path from SRC).
# Use this for nested paths that need a deeper match.
# Use forward slashes — normalized to OS separator inside should_exclude_path.
EXCLUDE_PATHS = {
    'scripts/fonts/staging',  # Font download staging dir (not needed in prod)
}

# Exclude files by basename (matched anywhere)
EXCLUDE_FILES = {
    '.env',              # Local secrets — never upload
    '.env.local',        # Local secrets
    '.env.*.local',      # Local secrets (matched by glob below)
    '*.tsbuildinfo',
    'Thumbs.db',
    '.DS_Store',
    'vitest.config.ts',  # Test runner config — never ship to prod
    'Up.rar',            # Self-archive — never recurse back into Up/
}

# Explicit files to always include at root (overrides EXCLUDE_FILES if matched)
ALWAYS_INCLUDE_ROOT = {'.env.example'}  # Server template — safe to upload

def should_exclude_dir(name, rel_path=None):
    if name in EXCLUDE_DIRS:
        return True
    if rel_path:
        rel_norm = rel_path.replace(os.sep, '/')
        if rel_norm in EXCLUDE_DIRS or any(rel_norm == ex or rel_norm.startswith(ex + '/') for ex in EXCLUDE_DIRS):
            return True
    return False

def should_exclude_path(rel):
    """Match a relative path against EXCLUDE_PATHS (exact or subpath).
    Normalizes both sides to forward slashes for cross-platform safety."""
    rel_norm = rel.replace(os.sep, '/')
    for ex in EXCLUDE_PATHS:
        ex_norm = ex.replace(os.sep, '/')
        if rel_norm == ex_norm or rel_norm.startswith(ex_norm + '/'):
            return True
    return False

# Specific files to always exclude by full relative path
EXCLUDE_FILE_PATHS = {
    # data/strokes-manifest.json is TRACKED in git (as of 2026-07-09) —
    # included in Up/ bundle so prod deploys skip `npm run strokes:build`.
    'data/poems/yuefu.json',                      # Collection files (regenerable)
    'data/poems/shijiu.json',
    'data/poems/cifu.json',
    'data/poems/caocao.json',
    'data/poems/nalan.json',
}

def should_exclude_file(name, rel_path=None):
    if name in ALWAYS_INCLUDE_ROOT:
        return False
    if name in EXCLUDE_FILES:
        return True
    if rel_path and rel_path.replace(os.sep, '/') in EXCLUDE_FILE_PATHS:
        return True
    # glob-like patterns
    if name.startswith('.env.') and name.endswith('.local'):
        return True
    if name.endswith('.tsbuildinfo'):
        return True
    if name.endswith('.log'):
        return True
    if name in ('Thumbs.db', '.DS_Store'):
        return True
    return False

# Source repo ships plain .json. The Up/ deploy bundle ships .json.gz for these
# huge text datasets so the bundle shrinks ~180 MB without runtime cost
# (lib/json-fs.ts reads .json first, falls back to .json.gz via gunzipSync).
# Only .json under data/classics/ and data/content/ qualify — manifests,
# strokes, poems collections etc. stay plain.
GZIP_DIRS = {'data/classics', 'data/content'}

def should_gzip(rel_file):
    rel_norm = rel_file.replace(os.sep, '/')
    if not rel_norm.endswith('.json'):
        return False
    for d in GZIP_DIRS:
        if rel_norm == d or rel_norm.startswith(d + '/'):
            return True
    return False

count = 0
bytes_total = 0
gzipped_count = 0
gzipped_bytes_in = 0
gzipped_bytes_out = 0
for root, dirs, files in os.walk(SRC):
    # Filter dirs in-place so os.walk skips them
    rel_root = os.path.relpath(root, SRC)
    dirs[:] = [
        d for d in dirs
        if not should_exclude_dir(d, d if rel_root == '.' else os.path.join(rel_root, d))
        and not should_exclude_path(d if rel_root == '.' else os.path.join(rel_root, d))
    ]
    rel = rel_root
    target_dir = os.path.join(DST, rel) if rel != '.' else DST
    for f in files:
        rel_file = os.path.join(rel, f) if rel != '.' else f
        if should_exclude_file(f, rel_file):
            continue
        src_path = os.path.join(root, f)
        os.makedirs(target_dir, exist_ok=True)
        if should_gzip(rel_file):
            dst_path = os.path.join(target_dir, f + '.gz')
            with open(src_path, 'rb') as f_in, gzip.open(dst_path, 'wb', compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)
            gzipped_count += 1
            try:
                gzipped_bytes_in += os.path.getsize(src_path)
                gzipped_bytes_out += os.path.getsize(dst_path)
                bytes_total += os.path.getsize(dst_path)
            except OSError:
                pass
        else:
            dst_path = os.path.join(target_dir, f)
            shutil.copy2(src_path, dst_path)
            try:
                bytes_total += os.path.getsize(src_path)
            except OSError:
                pass
        count += 1
        if count % 500 == 0:
            print(f'  ... {count} files copied', file=sys.stderr)

print(f'Copied {count} files ({bytes_total/1024/1024:.1f} MB)')
if gzipped_count:
    saved = (gzipped_bytes_in - gzipped_bytes_out) / 1024 / 1024
    print(f'Gzipped {gzipped_count} files: {gzipped_bytes_in/1024/1024:.1f} MB → {gzipped_bytes_out/1024/1024:.1f} MB (saved {saved:.1f} MB)')


# ---------------------------------------------------------------------------
# Generate Up/.env — minimal safe defaults + wizard guidance.
#
# PinYinCharacter's flow is cleaner than the reference MINIMAXVoiceProject:
#   - No IS_INITIALIZED flag. middleware.ts reads the `setup_completed` cookie
#     and redirects to /init when missing. The /init orchestrator detects
#     fresh DB (no DATABASE_URL) and routes to /init/db → /init/admin →
#     /init/execute. After /init/execute mark-complete, the cookie is set
#     and the app is locked.
#   - DATABASE_URL gets written by /init Step 1 (lib/setup.ts writeEnvVars).
#   - JWT_SECRET must be set on prod; local dev auto-generates.
#   - Everything else (AI keys, SMTP, etc.) goes through /admin/settings UI.
# ---------------------------------------------------------------------------
def write_up_env():
    env_path = os.path.join(DST, '.env')
    content = '''# Up/ bundle .env — customer self-deploy
#
# 运行时配置全部走 /init 向导 / /admin/settings 系统配置:
#   - DATABASE_URL → /init 第一屏填(自动写回 .env)
#   - JWT_SECRET   → 产线必填,本地自动生成
#   - 其他配置    → /admin/settings 系统配置(admin 登录后可见)
#
# 安全默认值:下面 1 行不要改。/init 走完后会自动设置 setup.completed 标志,
# 由 middleware.ts 用 setup_completed cookie 锁定 /init 路径,无需 env flag。

NODE_ENV="production"
'''
    with open(env_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)


# ---------------------------------------------------------------------------
# Generate Up/README.md — 4-step customer quick-start.
# ---------------------------------------------------------------------------
def write_up_readme():
    readme_path = os.path.join(DST, 'README.md')
    content = '''# 字韵 — 部署包

> 客户自部署版本(Up/)。首次启动走 `/init` 向导,无需手动编辑 `.env`。

## 快速开始(4 步)

```bash
# 0. 修复权限(zip 跨平台传输可能丢 Unix mode,显式修一次)
chmod -R u+rwX,g+rX,o+rX .

# 1. 安装依赖
npm ci --legacy-peer-deps

# 2. 构建
npm run build

# 3. 启动(默认端口 4444)
npm start -- -p 4444
```

启动后访问 `http://your-domain:4444/`,根路由检测到 `setup_completed` cookie 缺失会**自动 307 跳到 `/init` 向导**。

**`/init` 三屏走完即可上线**:
1. `/init/db` — 填 MySQL 连接(host / port / user / password / db),自动写入 `DATABASE_URL`
2. `/init/admin` — 创建第一个管理员账号(username + password + email)
3. `/init/execute` — 一键执行 9 阶段初始化(建表 + 导入数据 + 创建账号 + 激活 + 迁移 + mark-complete)

完成后:
- `setup_completed=1` cookie 写入浏览器
- 根路由改跳 `/login`(已就绪)
- `/init` 路径被 middleware 锁定,显示「已完成」卡片

> 整个部署流程**不需要手动编辑 `.env`** — 全部运行时配置在 `/init` 向导 / `/admin/settings` 系统配置里完成。`Up/.env` 只有 1 行安全默认值,不要手改。

## 关键文件

| 文件 | 作用 |
|------|------|
| `.env` | **不要手填** — 只含 `NODE_ENV="production"`,运行时配置走 `/init` 向导写回 |
| `.env.example` | 模板 + 全部变量说明(仅供运维参考,**不是**部署必填) |
| `DEPLOY.md` | 完整部署指南(Nginx 反代 + systemd + MySQL 初始化 + 字体生成 + 数据导入) |
| `README.md` | 项目使用说明(部署完成后给最终用户看) |
| `scripts/copy-to-up.py` | 重新打包工具(从主仓库根目录跑) |
| `app/init/` | `/init` 三屏向导源码 |

## 部署架构要求

- **Node.js 20+**(项目用 Next.js 15 + React 19)
- **MySQL 8.0+**(utf8mb4_unicode_ci 字符集,见 `DEPLOY.md`)
- **可选**:Nginx 反代(详见 `DEPLOY.md`)+ systemd 守护进程
- **首次启动**:`/init` 自动:
  - 创建 25 张表 + 写入 `app_config` 默认值
  - 导入古诗 / 佛经 / 字典
  - 创建第一个 admin 账号(填表时设置)
  - 写入 `DATABASE_URL` 到 `.env`
  - 写入 `setup.completed=true` 到 `app_config`
  - 设置 `setup_completed=1` cookie(浏览器锁定 `/init`)

## 出问题?

1. 看 `DEPLOY.md` 故障排查章节
2. 看启动日志(Nginx / systemd journal)
3. 确认 MySQL 连接信息正确(账号、host、库名)

## 升级

`DEPLOY.md` 升级流程速查。**必须**在 `npm run build` 之前 `rm -rf .next`。

## 重新打包

如果从 main 拉了新代码想重新出包:
```bash
cd <main-repo>
python3 scripts/copy-to-up.py    # 或 py / python,看环境
```
会清空 `Up/` 并重新生成(含新的 `.env` 极简模板和 README)。
'''
    with open(readme_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)


# ---------------------------------------------------------------------------
# normalize_permissions(Up/) — chmod 644/755 递归。
#
# shutil.copy2 + os.makedirs 的默认 mode 受 umask 影响:
#   - macOS(umask 022)出来 644/755 ✓
#   - 某些 Linux 配置出来 750/640,supervisor 切非 root 用户启不起来
#   - Windows zip 后传到 Linux 解压,mode 可能完全不对
# 显式 chmod 一次,产线解压后不需要再批量修权限。
# ---------------------------------------------------------------------------
def normalize_permissions(directory):
    for entry in os.scandir(directory):
        full = entry.path
        if entry.is_dir():
            try:
                os.chmod(full, 0o755)
            except OSError:
                pass  # Windows + non-Unix mode
            normalize_permissions(full)
        elif entry.is_file():
            try:
                os.chmod(full, 0o644)
            except OSError:
                pass


write_up_env()
write_up_readme()
normalize_permissions(DST)
print(f'Generated Up/.env + Up/README.md + normalized permissions')

