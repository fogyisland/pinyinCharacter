export interface RareCharClient {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  needsReview: boolean;
  generatedBy: string | null;
  generatedAt: string | null;
  createdAt: string;
}
