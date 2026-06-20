export type TextGridMode = 'default' | 'tian' | 'mi';

export const DEFAULT_TEXT_GRID: TextGridMode = 'default';

export const TEXT_GRID_STORAGE_KEY = 'pinyin:text-grid';

export const TEXT_GRID_LABEL: Record<TextGridMode, string> = {
  default: '默认',
  tian: '田字格',
  mi: '米字格',
};