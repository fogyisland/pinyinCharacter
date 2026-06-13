/**
 * 生成 data/radicals.json — 从 npm cnchar + cnchar-radical 提取 char → radical 映射
 * 运行: pnpm radicals:build
 *
 * 注:原计划用 npm `cjk-radicals`,但该包不存在于 npm registry。
 * 改用 cnchar + cnchar-radical:它有 ~6700 个常用汉字的部首数据(简体中文),
 *     适合本游戏使用(`你 → 亻`, 而不是日文 KRADFILE 的 `⺅`)。
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

// cnchar + cnchar-radical 都没有 .d.ts,用 require 规避
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cnchar = require('cnchar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rad = require('cnchar-radical');

// 注册 plugin (require 时不会自动 install)
cnchar.use(rad);

// 解析 cnchar-radical 的 packed 格式: '{count}:{char1}{struct1}{char2}{struct2}...'
// struct code 是单个字母 a-g
// 数据形如: '2:卧a卞b卟a占b卢b卣c卤c卦a'
function parseRadicalPacked(packed: string): string[] {
  const m = packed.match(/^(\d+):(.*)$/);
  if (!m) return [];
  const rest = m[2]!;
  const out: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i]!;
    if (/[一-鿿]/.test(c)) {
      out.push(c);
      i += 1;
      // 跳过可选的结构码 (a-g)
      if (i < rest.length && /[a-g]/.test(rest[i]!)) i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

// '*' 键存所有 214 部首,格式: '{char1}{struct1}{stroke1}{char2}...'
// 例: '一c1乙c1二c2人c2亻c2...'
// 214 部首的 radical 是自己,所以这些字符的 mapping 应该是 self-mapped。
function parseRadicalList(packed: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < packed.length) {
    const c = packed[i]!;
    if (/[一-鿿]/.test(c)) {
      out.push(c);
      i += 1;
      if (i < packed.length && /[a-g]/.test(packed[i]!)) i += 1;
      // 跳过 strokes (1-17 的一位/两位数字)
      while (i < packed.length && /[0-9]/.test(packed[i]!)) i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

const dict = rad.dict.radical as Record<string, string>;
const out: Record<string, string> = {};
for (const [radChar, packed] of Object.entries(dict)) {
  if (radChar === '*') continue;
  const chars = parseRadicalPacked(packed);
  for (const c of chars) {
    // 重复字符以第一个部首为准(防御性,理论上不应有)
    if (!(c in out)) out[c] = radChar;
  }
}
// 补 214 部首本身:它们的 radical 是自己
const radicals = parseRadicalList(dict['*'] ?? '');
for (const c of radicals) {
  if (!(c in out)) out[c] = c;
}

const outPath = join(process.cwd(), 'data', 'radicals.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} radicals to ${outPath}`);
