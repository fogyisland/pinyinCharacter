/** Shared types for char content lookups. */

export interface GetContentOptions {
  /** 强制跳过文件层,只读 DB (用于测试 + admin) */
  dbOnly?: boolean;
}
