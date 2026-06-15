import type { CharContent } from '@/scripts/schemas/content';

/** 重新导出 zod infer 的类型, 这样 lib/content.ts 和 test 都用同一份 */
export type { CharContent } from '@/scripts/schemas/content';

export interface GetContentOptions {
  /** 强制跳过文件层,只读 DB (用于测试 + admin) */
  dbOnly?: boolean;
}