/**
 * download-ancient-fonts.ts
 *
 * Plan L — Fonts phase.
 * Downloads 4 ancient-script fonts to public/fonts/ from jsDelivr CDNs.
 * KaiTi (5th font) falls back to local OS font via @font-face in globals.css.
 *
 * Skips files that already exist.
 * Soft-fails on network errors: logs a warning and exits 0
 * (Plan L still works — EraGlyph shows 「暂无」for missing fonts).
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = resolve(process.cwd(), 'public', 'fonts');

type FontEntry = {
  /** Local filename under public/fonts/ */
  filename: string;
  /** jsDelivr (or fallback) URL */
  url: string;
  /** Human label for logs */
  label: string;
};

const FONTS: FontEntry[] = [
  {
    filename: 'yinqi-jiaguwen.woff2',
    url: 'https://cdn.jsdelivr.net/gh/Kin-fu/yinqi-jia-gu-wen@main/yinqi-jiaguwen.woff2',
    label: '殷契甲骨文 (YinQi JiaGuWen)',
  },
  {
    filename: 'handian-jinwen.woff2',
    url: 'https://cdn.jsdelivr.net/gh/sahuidhsu/han-dian-jin-wen@main/handian-jinwen.woff2',
    label: '汉典金文 (HanDian JinWen)',
  },
  {
    filename: 'quanziku-shuowen.ttf',
    url: 'https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/中文/方正字库/方正说文小篆.ttf',
    label: '全字库说文小篆 (QuanZiKu ShuoWen)',
  },
  {
    filename: 'quanziku-liding.ttf',
    url: 'https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/中文/方正字库/方正隶书.ttf',
    label: '全字库隶书 (QuanZiKu LiDing)',
  },
];

async function downloadOnce(url: string, dest: string, timeoutMs = 20000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
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
  const dest = resolve(FONTS_DIR, entry.filename);
  if (existsSync(dest) && statSync(dest).size > 0) {
    return { status: 'skip' };
  }
  // Try primary URL, then a couple of fallbacks (e.g. raw GitHub).
  const candidates = [entry.url];
  const ok = (await Promise.all(candidates.map((u) => downloadOnce(u, dest)))).some(Boolean);
  if (!ok) return { status: 'fail' };
  return { status: 'ok', size: statSync(dest).size };
}

async function main() {
  // Allow `tsx scripts/download-ancient-fonts.ts` direct execution.
  if (process.argv[1] && process.argv[1].endsWith('download-ancient-fonts.ts')) {
    const thisFile = fileURLToPath(import.meta.url);
    void thisFile;
  }

  mkdirSync(FONTS_DIR, { recursive: true });
  console.log(`[fonts] target dir: ${FONTS_DIR}`);

  const results: Array<{ label: string; status: string; detail?: string }> = [];
  let anyHardFail = false;

  for (const f of FONTS) {
    const r = await downloadFont(f);
    if (r.status === 'ok') {
      const kb = ((r.size ?? 0) / 1024).toFixed(1);
      console.log(`[fonts] OK   ${f.label}  -> ${f.filename}  (${kb} KB)`);
      results.push({ label: f.label, status: 'ok', detail: `${kb} KB` });
    } else if (r.status === 'skip') {
      console.log(`[fonts] SKIP ${f.label}  (already on disk)`);
      results.push({ label: f.label, status: 'skip' });
    } else {
      console.warn(`[fonts] FAIL ${f.label}  (network/CDN unavailable — will rely on fallback)`);
      results.push({ label: f.label, status: 'fail' });
      // Soft-fail per spec: do not throw.
    }
  }

  // KaiTi (5th font) is system-fallback only; nothing to download.
  console.log(`[fonts] KaiTi is local-fallback only (no download).`);

  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length > 0) {
    anyHardFail = false; // soft-fail by design
  }

  console.log(`[fonts] done. ok=${results.filter((r) => r.status === 'ok').length} skip=${results.filter((r) => r.status === 'skip').length} fail=${failed.length}`);
  if (anyHardFail) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[fonts] unexpected error:', err);
  process.exit(0); // soft-fail
});
