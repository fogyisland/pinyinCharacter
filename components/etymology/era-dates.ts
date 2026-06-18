import type { Era } from '@/lib/etymology-types';

export const ERA_DATES: Record<Era, { range: string }> = {
  jiaguwen:  { range: '商代晚期 (~1200-1046 BC)' },
  jinwen:    { range: '西周 (~1046-771 BC)' },
  xiaozhuan: { range: '秦 (~221-206 BC)' },
  lishu:     { range: '汉 (~206 BC-220 AD)' },
  kaishu:    { range: '魏晋至今 (~220 AD+)' },
};

export type CharLevel = 1 | 2 | 3;

export const LEVEL_LABEL: Record<CharLevel, string> = {
  1: '一级',
  2: '二级',
  3: '三级',
};

export function coverageHint(eraCount: number, level: CharLevel): string {
  if (eraCount === 5) return `${eraCount}/5 字形 · 完整`;
  if (eraCount >= 3) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖较全)`;
  if (eraCount >= 1) return `${eraCount}/5 字形 · 部分 (L${level} 字形覆盖有限)`;
  return '暂无字形';
}