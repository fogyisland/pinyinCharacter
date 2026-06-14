export type SutraReading = 'horizontal' | 'vertical-rtl' | 'vertical-ltr';

export const DEFAULT_SUTRA_READING: SutraReading = 'horizontal';

export const SUTRA_READING_LABELS: Record<SutraReading, string> = {
  'horizontal': '横向',
  'vertical-rtl': '竖排从右到左',
  'vertical-ltr': '竖排从左到右',
};