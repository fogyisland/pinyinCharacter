import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterCandidates } from './filter';

export interface DictEntry { char: string; freq: number; }
export type Script = 'simplified' | 'traditional';

let dict: Record<string, DictEntry[]> = {};
let loaded = false;

export function loadDictionaries(): void {
  if (loaded) return;
  const dataDir = join(process.cwd(), 'data');
  dict = JSON.parse(readFileSync(join(dataDir, 'pinyin-hanzi.json'), 'utf8')) as Record<string, DictEntry[]>;
  loaded = true;
}

/**
 * Normalize a pinyin string to match dict keys:
 *   - Strip diacritics (nǐ → ni)
 *   - Replace ü with v (lǜ → lv)
 *   - Strip tone digits (ni3 → ni)
 *   - Keep only a-z and v
 */
export function normalizePinyin(s: string): string {
  return s
    // Replace ü/ǖ/ǘ/ǚ/ǜ (and uppercase) with v FIRST, before NFD strips the diaeresis
    .replace(/[üǖǘǚǜÜǕǗǙǛ]/g, 'v')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[1-5]/g, '')
    .replace(/[^a-zv]/g, '');
}

export function getCandidates(
  pinyinStr: string,
  safeMode: boolean,
  _script: Script       // 留作 Plan C 接入
): DictEntry[] {
  if (!loaded) loadDictionaries();
  const key = normalizePinyin(pinyinStr);
  const raw = dict[key] ?? [];
  return filterCandidates(raw, safeMode);
}
