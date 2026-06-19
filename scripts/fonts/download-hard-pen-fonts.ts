/**
 * download-hard-pen-fonts.ts
 *
 * Plan G2 — Hard-pen font pipeline (download phase).
 * Pulls 4 source TTFs/OTFs from upstream releases into
 * scripts/fonts/staging/ (gitignored). Soft-fails on network errors.
 *
 * Run: pnpm fonts:download-hard-pen
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(__dirname, 'staging');

type FontEntry = {
  /** Local filename under scripts/fonts/staging/ */
  filename: string;
  /** Ordered list of candidate URLs — first wins, fallbacks for resilience. */
  urls: string[];
  /** Human label for logs */
  label: string;
};

const FONTS: FontEntry[] = [
  {
    filename: 'LXGWWenKaiGB-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwWenkaiGB/releases/latest/download/LXGWWenKaiGB-Regular.ttf',
    ],
    label: 'LXGW WenKai GB (霞鹜文楷 GB)',
  },
  {
    filename: 'Yozai-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwYozai/releases/latest/download/Yozai-Regular.ttf',
    ],
    label: 'Yozai (悠哉)',
  },
  {
    filename: 'Iansui-Regular.ttf',
    urls: [
      'https://github.com/lxgw/LxgwIansui/releases/latest/download/Iansui-Regular.ttf',
    ],
    label: 'Iansui (芫荽)',
  },
  {
    filename: 'ZenKakuGothicNew-Thin.otf',
    urls: [
      'https://github.com/googlefonts/zen-kakugothic/releases/download/v1.0.0/ZenKakuGothicNew-Thin.otf',
    ],
    label: 'Zen Kaku Gothic New Thin (思源极细黑)',
  },
];

async function downloadOnce(url: string, dest: string, timeoutMs = 60000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pinyin-character-font-loader)' },
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFont(entry: FontEntry): Promise<{ status: 'ok' | 'skip' | 'fail'; size?: number }> {
  const dest = resolve(STAGING, entry.filename);
  if (existsSync(dest) && statSync(dest).size > 0) {
    return { status: 'skip' };
  }
  for (const url of entry.urls) {
    const ok = await downloadOnce(url, dest);
    if (ok && statSync(dest).size > 0) {
      return { status: 'ok', size: statSync(dest).size };
    }
  }
  return { status: 'fail' };
}

async function main() {
  mkdirSync(STAGING, { recursive: true });
  console.log(`[fonts] target dir: ${STAGING}`);

  const results: Array<{ label: string; status: string; detail?: string }> = [];
  for (const f of FONTS) {
    const r = await downloadFont(f);
    if (r.status === 'ok') {
      const mb = ((r.size ?? 0) / 1024 / 1024).toFixed(2);
      console.log(`[fonts] OK   ${f.label}  -> ${f.filename}  (${mb} MB)`);
      results.push({ label: f.label, status: 'ok', detail: `${mb} MB` });
    } else if (r.status === 'skip') {
      console.log(`[fonts] SKIP ${f.label}  (already on disk)`);
      results.push({ label: f.label, status: 'skip' });
    } else {
      console.warn(`[fonts] FAIL ${f.label}  (network/CDN unavailable)`);
      results.push({ label: f.label, status: 'fail' });
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  console.log(
    `[fonts] done. ok=${results.filter((r) => r.status === 'ok').length} skip=${results.filter((r) => r.status === 'skip').length} fail=${failed.length}`,
  );
  if (failed.length > 0) {
    console.warn(`[fonts] ${failed.length} font(s) failed; subset will skip them.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[fonts] unexpected error:', err);
  process.exit(0);
});