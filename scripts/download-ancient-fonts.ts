/**
 * download-ancient-fonts.ts
 *
 * Plan L — Fonts phase (refreshed 2026-06-18 after the original jsDelivr URLs
 * went stale). Downloads ancient-script fonts to public/fonts/ so the era
 * glyphs in /etymology/<char> render correctly.
 *
 * Skips files that already exist.
 * Soft-fails on network errors: logs a warning and exits 0
 * (EraGlyph shows 「暂无」for missing fonts).
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = resolve(process.cwd(), 'public', 'fonts');

type FontEntry = {
  /** Local filename under public/fonts/ */
  filename: string;
  /** Ordered list of candidate URLs — first wins, fallbacks for resilience. */
  urls: string[];
  /** Human label for logs */
  label: string;
};

const FONTS: FontEntry[] = [
  {
    filename: 'founder-jiaguwen.ttf',
    urls: [
      // Founder 甲骨文 — copied locally from Windows font cache
      // C:/Users/<user>/AppData/Local/Microsoft/Windows/Fonts/FZJiaGW.TTF
      // (no public CDN; if absent, BabelStoneHanBasic covers 甲骨文 too)
    ],
    label: '方正甲骨文 (Founder JiaguWen)',
  },
  {
    filename: 'BabelStoneHanBasic.ttf',
    urls: [
      // babelstone/babelstonehan-ufo download.sh points here
      'https://www.babelstone.co.uk/Fonts/Download/BabelStoneHanBeta.zip',
    ],
    label: 'BabelStone Han Basic (甲骨文+金文+简帛)',
  },
  {
    filename: 'BabelStoneHanExtra.ttf',
    urls: [
      // Same zip — extracted sibling
      'https://www.babelstone.co.uk/Fonts/Download/BabelStoneHanBeta.zip',
    ],
    label: 'BabelStone Han Extra (extended ancient glyphs)',
  },
  {
    filename: 'quanziku-shuowen.ttf',
    urls: [
      // Primary: jsDelivr mirror of wordshub/free-font (10.4 MB, 全字庫說文解字)
      'https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/%E4%B8%AD%E6%96%87/%E5%85%A8%E5%AD%97%E5%BA%93%E7%B3%BB%E5%88%97/%E5%85%A8%E5%AD%97%E5%BA%93%E8%AF%B4%E6%96%87%E8%A7%A3%E5%AD%97.ttf',
    ],
    label: '全字庫說文解字 (QuanZiKu ShuoWen, 小篆)',
  },
  {
    filename: 'wang-hanzong-lishu.ttf',
    urls: [
      // raw GitHub (verified 2026-06-18, 8.4 MB) — note: requires User-Agent
      // header on some clients; without UA raw.githubusercontent.com can
      // return 404 instead of 200. The browser fetches work either way.
      'https://raw.githubusercontent.com/wordshub/free-font/master/assets/font/%E4%B8%AD%E6%96%87/%E7%8E%8B%E6%B1%89%E5%AE%97%E5%AD%97%E4%BD%93%E7%B3%BB%E5%88%97/%E7%8E%8B%E6%BC%A2%E5%AE%97%E4%B8%AD%E9%9A%B8%E6%9B%B8%E7%B9%81.ttf',
    ],
    label: '王漢宗中隸書繁 (Wang Hanzong Lishu, 隶书)',
  },
  {
    filename: 'Oracular-Regular.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/jamshidh/Oracular@master/Oracular-Regular.ttf'],
    label: 'Oracular (甲骨文)',
  },
  {
    filename: 'Oracular-Inverted.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/jamshidh/Oracular@master/Oracular-Inverted.ttf'],
    label: 'Oracular Inverted (甲骨文 阴文)',
  },
  {
    filename: 'wang-hanzong-weibei.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/%E4%B8%AD%E6%96%87/%E7%8E%8B%E6%B1%89%E5%AE%97%E5%AD%97%E4%BD%93%E7%B3%BB%E5%88%97/%E7%8E%8B%E6%BC%A2%E5%AE%97%E4%B8%AD%E9%AD%9A%E9%9A%86%E7%A2%91.ttf'],
    label: '王漢宗魏碑 (Wang Hanzong WeiBei, 金文近似)',
  },
  {
    filename: 'wang-hanzong-xingshu.ttf',
    urls: ['https://cdn.jsdelivr.net/gh/wordshub/free-font@master/assets/font/%E4%B8%AD%E6%96%87/%E7%8E%8B%E6%B1%89%E5%AE%97%E5%AD%97%E4%BD%93%E7%B3%BB%E5%88%97/%E7%8E%8B%E6%BC%A2%E5%AE%97%E8%A1%8C%E6%9B%B8%E7%B9%81.ttf'],
    label: '王漢宗行書繁 (Wang Hanzong XingShu)',
  },
];

async function downloadOnce(url: string, dest: string, timeoutMs = 30000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
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
  const dest = resolve(FONTS_DIR, entry.filename);
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
  if (process.argv[1] && process.argv[1].endsWith('download-ancient-fonts.ts')) {
    const thisFile = fileURLToPath(import.meta.url);
    void thisFile;
  }

  mkdirSync(FONTS_DIR, { recursive: true });
  console.log(`[fonts] target dir: ${FONTS_DIR}`);

  const results: Array<{ label: string; status: string; detail?: string }> = [];

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
    }
  }

  // BabelStone zip extraction (only if Basic/Extra/PUA were extracted from one
  // zip — keep this simple by re-downloading via download.sh pattern).
  // The BabelStone zip is "BabelStoneHanBeta.zip" with 3 ttf files inside.
  // We download once and unzip. If you only need one of them, the others
  // can be deleted from public/fonts/.

  // KaiTi (楷书) is system-fallback only; nothing to download.
  console.log(`[fonts] KaiTi is local-fallback only (no download).`);

  const failed = results.filter((r) => r.status === 'fail');
  console.log(
    `[fonts] done. ok=${results.filter((r) => r.status === 'ok').length} skip=${results.filter((r) => r.status === 'skip').length} fail=${failed.length}`,
  );
  if (failed.length > 0) {
    console.warn(
      `[fonts] ${failed.length} font(s) failed to download. Era glyphs will fall back to system fonts.`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[fonts] unexpected error:', err);
  process.exit(0);
});