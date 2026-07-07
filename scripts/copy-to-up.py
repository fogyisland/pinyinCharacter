import os
import shutil
import sys
import gzip

SRC = '.'
DST = './Up'

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
    'public/strokes',    # Regenerable via pnpm strokes:build
    'playwright-report',
    'test-results',
    'coverage',
    'tests',             # Unit/integration tests — never ship
    '__tests__',         # Co-located test dirs — never ship
    '__mocks__',         # Jest-style mocks — never ship
    '.turbo',
    '.vscode',
    '.idea',
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
    'data/strokes-manifest.json',                 # Regenerable via pnpm strokes:build
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

