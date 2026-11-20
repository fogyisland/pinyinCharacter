// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * The admin seed screen, and the schema panel on it.
 *
 * The screen has two jobs that look alike and fail differently:
 *
 *  - the seed panel answers "is the CONTENT complete?";
 *  - the schema panel answers "is the database's STRUCTURE behind the
 *    code?".
 *
 * The second question is the one that bites. A server that was
 * initialized and then had new code copied onto it keeps serving every
 * page that does not touch the new tables, while the pages that do fail
 * with `ER_NO_SUCH_TABLE`. Nothing on the site says "you are behind".
 *
 * The wiring matters as much as the panel: a panel that is built but
 * never mounted is a panel nobody sees. So these tests pin that the
 * page renders the schema panel, and that the page **degrades** when
 * the schema probe fails — an unreachable database must not 500 the
 * operator's screen, because the content half of the page still works.
 */

const readSeedCountsMock = vi.fn();
vi.mock('@/lib/seed-runner', () => ({
  readSeedCounts: () => readSeedCountsMock(),
}));

const compareSchemaMock = vi.fn();
vi.mock('@/lib/schema-check', () => ({
  compareSchema: () => compareSchemaMock(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminSeedPage from '@/app/admin/seed/page';

const UP_TO_DATE = {
  missingTables: [],
  missingColumns: [],
  actualTables: 40,
  expectedTables: 40,
  actualColumns: 300,
  expectedColumns: 300,
  upToDate: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  readSeedCountsMock.mockResolvedValue({});
  compareSchemaMock.mockResolvedValue(UP_TO_DATE);
});

afterEach(() => {
  cleanup();
});

describe('/admin/seed', () => {
  it('renders the schema migration panel', async () => {
    render(await AdminSeedPage());
    expect(screen.getByText('数据结构')).toBeTruthy();
    expect(screen.getByRole('button', { name: /运行迁移/ })).toBeTruthy();
  });

  it('still renders the content seed panel', async () => {
    // The schema panel is an addition, not a replacement: the content
    // seed is what it was always for.
    render(await AdminSeedPage());
    expect(screen.getByText('数据集')).toBeTruthy();
  });

  it('says the schema is behind when it is', async () => {
    compareSchemaMock.mockResolvedValue({
      ...UP_TO_DATE,
      upToDate: false,
      missingTables: [{ table: 'idioms', source: 'scripts/migrations/2026-11-19-idioms.sql' }],
    });
    render(await AdminSeedPage());
    // The table name and the file that should have created it are both
    // on screen — the operator needs both to know what is wrong and
    // where it came from.
    expect(screen.getAllByText('idioms').length).toBeGreaterThan(0);
    expect(screen.getByText(/2026-11-19-idioms\.sql/)).toBeTruthy();
  });

  it('degrades instead of 500 when the schema probe fails', async () => {
    // The content half of the page still works — a database that is
    // briefly unreachable must not take the whole screen down.
    compareSchemaMock.mockRejectedValue(new Error('ER_NO_SUCH_TABLE'));
    render(await AdminSeedPage());
    expect(screen.getByText(/无法读取数据库结构/)).toBeTruthy();
    // The schema panel is gone, and the content panel is still there.
    // The seed manager's own button is the marker: the "数据集" panel
    // title is rendered unconditionally, so it cannot tell a degraded
    // page from a complete one.
    expect(screen.queryByRole('button', { name: /运行迁移/ })).toBeNull();
    expect(screen.getByRole('button', { name: /补齐全部缺口/ })).toBeTruthy();
  });
});
