import os
import shutil
import sys

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
}

# Explicit files to always include at root (overrides EXCLUDE_FILES if matched)
ALWAYS_INCLUDE_ROOT = {'.env.example'}  # Server template — safe to upload

def should_exclude_dir(name):
    return name in EXCLUDE_DIRS

def should_exclude_path(rel):
    """Match a relative path against EXCLUDE_PATHS (exact or subpath).
    Normalizes both sides to forward slashes for cross-platform safety."""
    rel_norm = rel.replace(os.sep, '/')
    for ex in EXCLUDE_PATHS:
        ex_norm = ex.replace(os.sep, '/')
        if rel_norm == ex_norm or rel_norm.startswith(ex_norm + '/'):
            return True
    return False

def should_exclude_file(name):
    if name in ALWAYS_INCLUDE_ROOT:
        return False
    if name in EXCLUDE_FILES:
        return True
    # glob-like patterns
    if name.startswith('.env.') and name.endswith('.local'):
        return True
    if name.endswith('.tsbuildinfo'):
        return True
    if name in ('Thumbs.db', '.DS_Store'):
        return True
    return False

count = 0
bytes_total = 0
for root, dirs, files in os.walk(SRC):
    # Filter dirs in-place so os.walk skips them
    rel_root = os.path.relpath(root, SRC)
    dirs[:] = [
        d for d in dirs
        if not should_exclude_dir(d)
        and not should_exclude_path(d if rel_root == '.' else os.path.join(rel_root, d))
    ]
    rel = rel_root
    target_dir = os.path.join(DST, rel) if rel != '.' else DST
    for f in files:
        if should_exclude_file(f):
            continue
        src_path = os.path.join(root, f)
        dst_path = os.path.join(target_dir, f)
        os.makedirs(target_dir, exist_ok=True)
        shutil.copy2(src_path, dst_path)
        count += 1
        try:
            bytes_total += os.path.getsize(src_path)
        except OSError:
            pass
        if count % 500 == 0:
            print(f'  ... {count} files copied', file=sys.stderr)

print(f'Copied {count} files ({bytes_total/1024/1024:.1f} MB)')
