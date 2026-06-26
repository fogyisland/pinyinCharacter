/**
 * 生成 data/radicals.json — 从 Unicode Unihan 6.3 提取 char → radical 映射
 * 运行: pnpm radicals:build
 *
 * 数据源:
 *   - data/unihan/Unihan_RadicalStrokeCounts.txt (Unihan 6.3, 2013) — 包含 kRSUnicode 字段
 *   - data/unihan/CJKRadicals.txt — 214 部首 number → CJK unified ideograph 映射
 *
 * 注:
 *   - 原版用 cnchar-radical (npm), 缺字严重 (1163/7910 DB 字符无部首)
 *   - cnchar-radical 用日文 kRSAdobe_Japan1_6 + 简体部首变体 (亻/扌/刂/忄 等)
 *   - Unihan 6.3 kRSUnicode 是 Unicode 标准的部首数字 (1-214), 覆盖更全
 *   - 缺点: kRSUnicode 字段在 Unihan 7.0 (2014) 后被移除, 但 6.3 仍有完整数据
 *   - 现将 1163 个缺部首字符中的 1159 个补齐 (剩 4 个 CJK Ext B/C 超生僻字无数据)
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const UNIHAN_DIR = join(process.cwd(), 'data', 'unihan');
const KRS_FILE = join(UNIHAN_DIR, 'Unihan_RadicalStrokeCounts.txt');
const RAD_MAP_FILE = join(UNIHAN_DIR, 'CJKRadicals.txt');
const OUT_PATH = join(process.cwd(), 'data', 'radicals.json');

if (!existsSync(KRS_FILE) || !existsSync(RAD_MAP_FILE)) {
  console.error(
    `缺少 Unihan 数据文件: ${KRS_FILE} / ${RAD_MAP_FILE}\n` +
      `下载: \n` +
      `  curl -L -o data/unihan/Unihan-6.3.0.zip https://www.unicode.org/Public/6.3.0/ucd/Unihan.zip\n` +
      `  unzip -j data/unihan/Unihan-6.3.0.zip Unihan_RadicalStrokeCounts.txt -d data/unihan/\n` +
      `  curl -L -o data/unihan/CJKRadicals.txt https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt`,
  );
  process.exit(1);
}

// 1. 解析 CJKRadicals.txt — 214 部首 number → CJK unified ideograph
//    格式: "{radical_number}; {radical_char_in_2F00_block}; {cjk_unified_ideograph}"
//    例: "18; 2F11; 5200" → radical 18 = 刀 (U+5200)
const radMap: Record<number, string> = {};
{
  const lines = require('fs').readFileSync(RAD_MAP_FILE, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(';');
    if (parts.length < 3) continue;
    const num = parseInt(parts[0]!.trim().replace(/'+$/, ''), 10);
    const ideo = parts[2]?.trim();
    if (!ideo || isNaN(num)) continue;
    // 取首行(去尾部 ' 变体),跳过空 ideo
    if (parts[0]!.includes("'")) continue;
    radMap[num] = String.fromCodePoint(parseInt(ideo, 16));
  }
  if (Object.keys(radMap).length !== 214) {
    console.warn(
      `警告: CJKRadicals.txt 只解析出 ${Object.keys(radMap).length} 个部首 (期望 214)`,
    );
  }
}

// 2. 解析 Unihan_RadicalStrokeCounts.txt — 提取 kRSUnicode 字段
//    格式: "U+XXXX\tkRSUnicode\t<radical_num>.<extra_strokes>[optional]..."
//    例: "U+5200\tkRSUnicode\t18.0"
const out: Record<string, string> = {};
let parsed = 0;
let skipped = 0;
{
  const lines = require('fs').readFileSync(KRS_FILE, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    if (parts[1] !== 'kRSUnicode') continue;
    const m = parts[0]!.match(/^U\+([0-9A-F]+)$/);
    if (!m) continue;
    const code = parseInt(m[1]!, 16);
    // 只要 CJK Unified + Ext A + Ext B (BMP 之外用 surrogate pair)
    if (
      !(
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x20000 && code <= 0x2a6df)
      )
    )
      continue;
    // kRSUnicode 格式: "78.2" 或 "85.1'" 或 "18'2" (部首.附加笔数[变体])
    const rs = parts[2]!;
    const rm = rs.match(/^(\d+)/);
    if (!rm) {
      skipped++;
      continue;
    }
    const radNum = parseInt(rm[1]!, 10);
    const radChar = radMap[radNum];
    if (!radChar) {
      // 极少数变体部首号(>214) 跳过
      skipped++;
      continue;
    }
    const ch = String.fromCodePoint(code);
    // 同字多部首时,取第一个(最常见)
    if (!(ch in out)) out[ch] = radChar;
    parsed++;
  }
}

// 3. 补 214 部首本身 — 它们的 radical 是自己
for (const radChar of Object.values(radMap)) {
  if (!(radChar in out)) out[radChar] = radChar;
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(
  `Wrote ${Object.keys(out).length} radicals to ${OUT_PATH} ` +
    `(parsed ${parsed} chars, skipped ${skipped}; covers ${Object.keys(radMap).length} standard Kangxi radicals)`,
);
