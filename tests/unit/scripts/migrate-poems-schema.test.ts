import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock INFORMATION_SCHEMA responses to simulate pre-migration schema:
// - dynasty EXISTS as ENUM -> triggers MODIFY
// - category column does NOT exist -> triggers ADD COLUMN
// - idx_category does NOT exist -> triggers ADD INDEX
// - form EXISTS but not varchar(32) -> triggers MODIFY
// - idx_form does NOT exist -> triggers ADD INDEX
vi.mock('../../../lib/db', () => {
  const smartMock = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("COLUMN_NAME = 'dynasty'")) {
      return [[{ COLUMN_NAME: 'dynasty', COLUMN_TYPE: "enum('tang','song')" }]];
    }
    if (sql.includes("COLUMN_NAME = 'form'")) {
      return [[{ COLUMN_NAME: 'form', COLUMN_TYPE: 'varchar(20)' }]];
    }
    if (sql.includes('COLUMN_NAME = ?') && sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      // category does not exist
      return [[]];
    }
    if (sql.includes('INDEX_NAME = ?') && sql.includes('INFORMATION_SCHEMA.STATISTICS')) {
      // idx_category / idx_form do not exist
      return [[]];
    }
    return [[]];
  });
  return {
    getPool: () => ({
      query: smartMock,
      execute: smartMock,
    }),
    closePool: vi.fn().mockResolvedValue(undefined),
  };
});

describe('migratePoemsSchema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs without error', async () => {
    const { migratePoemsSchema } = await import('../../../scripts/migrate-poems-schema');
    await expect(migratePoemsSchema()).resolves.not.toThrow();
  });

  it('executes ALTER for dynasty, category, form', async () => {
    const { getPool } = await import('../../../lib/db');
    const { migratePoemsSchema } = await import('../../../scripts/migrate-poems-schema');
    const mockPool = getPool();
    await migratePoemsSchema();
    const calls = (mockPool.query as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((s: string) => s.includes('MODIFY COLUMN dynasty'))).toBe(true);
    expect(calls.some((s: string) => s.includes('ADD COLUMN category'))).toBe(true);
    expect(calls.some((s: string) => s.includes('MODIFY COLUMN form'))).toBe(true);
    expect(calls.some((s: string) => s.includes('ADD INDEX idx_form'))).toBe(true);
  });
});